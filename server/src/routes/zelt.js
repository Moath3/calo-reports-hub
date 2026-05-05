/**
 * Zelt OAuth + integration routes.
 *
 * Bootstrap (admin-only):
 *   POST /api/zelt/oauth/init       → returns redirect URI + manual-flow steps
 *   GET  /api/zelt/oauth/callback   → exchanges code → tokens
 *   POST /api/zelt/disconnect       → wipes tokens
 *   POST /api/zelt/cache/clear      → clears server-side caches
 *   GET  /api/zelt/debug/sample     → raw sample of one user (admin only)
 *
 * Read (auth):
 *   GET  /api/zelt/status           → { connected: bool, lastRefresh: ts }
 *   GET  /api/zelt/entities         → { entities: string[] }
 *   GET  /api/zelt/balances?entity= → balance rows + diagnostic
 *   POST /api/zelt/balances/export?entity= → CSV download
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { getDb } from '../db/database.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HttpError, badRequest } from '../utils/httpError.js';
import {
  getBootstrapInstructions,
  exchangeCodeForTokens,
  getStatus,
  disconnect,
} from '../services/zeltApi.js';
import { listEntities, getBalancesForEntity, clearCaches, debugSampleUser } from '../services/zeltCompute.js';
import { runAudit } from '../services/zeltAudit.js';

const IS_PROD = process.env.NODE_ENV === 'production';

function logZeltAudit(userId, action, details = {}) {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO audit_log (user_id, action, resource_type, resource_id, details, ip_address)
      VALUES (?, ?, 'zelt', NULL, ?, NULL)
    `).run(userId || null, action, JSON.stringify(details));
  } catch (e) {
    console.error('[zelt/audit]', e.message);
  }
}

// Translates errors from Zelt service calls into HttpErrors with the right
// status and extras. Returns a function suitable for `.catch(zeltUpstream(...))`.
// NotConnected → 503 + { code: 'NOT_CONNECTED' } (UI uses this to prompt reconnect).
// Anything else → 500 + { detail }; pass `{ stripDetailInProd: true }` to suppress detail in prod (used by /balances/export).
function zeltUpstream(message, opts = {}) {
  return (err) => {
    if (err.message === 'NotConnected') {
      throw new HttpError(503, 'Zelt not connected', { code: 'NOT_CONNECTED' });
    }
    const extra = opts.stripDetailInProd && IS_PROD ? {} : { detail: err.message };
    throw new HttpError(500, message, extra);
  };
}

const router = Router();

// Looser rate limit for /status (UI may poll), tight for /oauth/*
const oauthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many OAuth attempts, please wait.' },
});

const statusLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
});

// ---- Bootstrap (admin only) ------------------------------------------

// Zelt's flow is manual — return instructions, not a URL to redirect to.
router.post('/oauth/init', oauthLimiter, requireAuth, requireAdmin, asyncHandler((req, res) => {
  const instructions = getBootstrapInstructions();
  logZeltAudit(req.user.id, 'zelt.oauth.init');
  res.json(instructions);
}));

/**
 * OAuth callback. Zelt redirects here with ?code=...&state=...
 *
 * NOTE: this endpoint returns HTML, not JSON, so it does NOT use asyncHandler /
 * the central JSON error handler. Keeps its own try/catch + renderCallbackPage.
 */
router.get('/oauth/callback', oauthLimiter, async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    console.error('[zelt/oauth/callback] zelt rejected:', error);
    return res.status(400).send(renderCallbackPage({
      ok: false,
      message: 'Zelt rejected the authorization. Restart from the hub and try again.',
    }));
  }

  if (!code) {
    return res.status(400).send(renderCallbackPage({
      ok: false,
      message: 'Missing authorization code. Restart from Zelt admin and click "Code flow" → "Allow access".',
    }));
  }

  try {
    await exchangeCodeForTokens(code);
    logZeltAudit(null, 'zelt.oauth.connected');
    return res.send(renderCallbackPage({
      ok: true,
      message: 'Zelt connected. You can close this tab and return to the hub.',
    }));
  } catch (err) {
    console.error('[zelt/oauth/callback]', err.message);
    return res.status(500).send(renderCallbackPage({
      ok: false,
      message: 'Token exchange failed. Contact your hub admin to diagnose.',
    }));
  }
});

router.post('/disconnect', oauthLimiter, requireAuth, requireAdmin, asyncHandler((req, res) => {
  const result = disconnect();
  logZeltAudit(req.user.id, 'zelt.oauth.disconnected');
  res.json(result);
}));

// ---- Status ----------------------------------------------------------

router.get('/status', statusLimiter, requireAuth, (req, res) => {
  res.json(getStatus());
});

// ---- Data (auth required) -------------------------------------------

const dataLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many data requests, please wait.' },
});

router.get('/entities', dataLimiter, requireAuth, asyncHandler(async (req, res) => {
  const entities = await listEntities().catch(zeltUpstream('Failed to fetch entities'));
  res.json({ entities });
}));

router.get('/balances', dataLimiter, requireAuth, asyncHandler(async (req, res) => {
  const raw = req.query.entity;
  if (!raw || typeof raw !== 'string') throw badRequest('Missing required query param: entity');
  const entities = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (!entities.length) throw badRequest('No valid entities provided');

  // asOfDate: optional. Past dates only — future projection is brittle.
  let asOfDate = null;
  if (req.query.asOfDate) {
    const d = String(req.query.asOfDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw badRequest('asOfDate must be YYYY-MM-DD');
    if (new Date(d).getTime() > Date.now()) throw badRequest('asOfDate cannot be in the future');
    asOfDate = d;
  }

  const datas = await Promise.all(
    entities.map(e => getBalancesForEntity(e, asOfDate).catch(zeltUpstream('Failed to fetch balances')))
  );
  if (datas.length === 1) return res.json(datas[0]);

  // Aggregate multi-entity result
  const allRows = [];
  const allDiagnostics = [];
  for (const d of datas) {
    for (const r of d.rows) allRows.push({ ...r, entity: d.entity });
    if (d.diagnostic) allDiagnostics.push(d.diagnostic);
  }
  allRows.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  res.json({
    entity: entities.join(' + '),
    asOf: datas[0].asOf,
    count: allRows.length,
    rows: allRows,
    multi: true,
    sources: datas.map(d => ({ entity: d.entity, count: d.count })),
  });
}));

router.post('/balances/export', dataLimiter, requireAuth, asyncHandler(async (req, res) => {
  const { entity } = req.query;
  if (!entity || typeof entity !== 'string') throw badRequest('Missing required query param: entity');

  const { rows, asOf } = await getBalancesForEntity(entity.trim())
    .catch(zeltUpstream('Export failed', { stripDetailInProd: true }));

  const csv = toCsv(rows);
  const safeName = entity.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const dateTag = asOf.slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="calo-available-now-${safeName}-${dateTag}.csv"`);
  res.send(csv);
}));

// Admin-only: clear server-side caches (entities + balances)
router.post('/cache/clear', oauthLimiter, requireAuth, requireAdmin, (req, res) => {
  clearCaches();
  res.json({ ok: true });
});

// Data hygiene audit — surfaces flagged employees against 10+ checks.
// `?force=1` clears caches first so Refresh actually re-pulls live data.
router.get('/audit', dataLimiter, requireAuth, asyncHandler(async (req, res) => {
  const forceRefresh = req.query.force === '1' || req.query.force === 'true';
  const report = await runAudit({ forceRefresh }).catch(zeltUpstream('Audit failed'));
  res.json(report);
}));

// Admin-only: returns the shape of one user record from Zelt for debugging
// field-name mismatches. No PII shape: only key names are returned, plus
// our extracted-field results so admin can see what we're reading.
router.get('/debug/sample', oauthLimiter, requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const sample = await debugSampleUser().catch(zeltUpstream('Sample failed'));
  res.json(sample);
}));

function toCsv(rows) {
  const cols = ['employeeId', 'name', 'site', 'department', 'jobTitle', 'policy',
                'startDate', 'upcoming', 'availableNow'];
  const header = cols.join(',');
  const body = rows.map(r => cols.map(c => csvCell(r[c])).join(',')).join('\n');
  return `${header}\n${body}\n`;
}

function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// ---- HTML for callback (so admin sees a friendly result page) --------

function renderCallbackPage({ ok, message }) {
  const color = ok ? '#28b17b' : '#c0392b';
  const title = ok ? 'Connected' : 'Connection failed';
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Zelt OAuth</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; background: #f7f7f7; margin: 0;
         display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .card { background: white; border-radius: 12px; padding: 36px 44px; box-shadow: 0 4px 24px rgba(0,0,0,.08);
          border-top: 6px solid ${color}; max-width: 480px; }
  h1 { margin: 0 0 12px; color: ${color}; font-size: 22px; }
  p { margin: 0; color: #333; line-height: 1.5; }
</style></head>
<body><div class="card"><h1>${title}</h1><p>${escapeHtml(message)}</p></div></body></html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

export default router;
