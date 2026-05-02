/**
 * Zelt OAuth + integration routes.
 *
 * Bootstrap (admin-only):
 *   POST /api/zelt/oauth/init       → returns { authorizeUrl } with signed state
 *   GET  /api/zelt/oauth/callback   → consumes state, exchanges code → tokens
 *   POST /api/zelt/disconnect       → wipes tokens
 *
 * Read (auth):
 *   GET  /api/zelt/status           → { connected: bool, lastRefresh: ts }
 *
 * Phase 3 will add /entities and /balances.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { getDb } from '../db/database.js';

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
import {
  getBootstrapInstructions,
  exchangeCodeForTokens,
  getStatus,
  disconnect,
} from '../services/zeltApi.js';
import { listEntities, getBalancesForEntity, clearCaches, debugSampleUser } from '../services/zeltCompute.js';

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
router.post('/oauth/init', oauthLimiter, requireAuth, requireAdmin, (req, res) => {
  try {
    const instructions = getBootstrapInstructions();
    logZeltAudit(req.user.id, 'zelt.oauth.init');
    res.json(instructions);
  } catch (err) {
    console.error('[zelt/oauth/init]', err.message);
    res.status(500).json({ error: 'Failed to fetch bootstrap instructions' });
  }
});

/**
 * OAuth callback. Zelt redirects here with ?code=...&state=...
 *
 * Note: this endpoint does not use requireAuth — Zelt cannot pass our JWT.
 * Security comes from:
 *   1. The CSRF state token (single-use, 10-min TTL, generated only by an admin via /oauth/init)
 *   2. Zelt only redirects to the registered URI
 *   3. The endpoint can only succeed once per state
 */
// Zelt's manual code flow doesn't pass our `state` param, so state validation is
// not enforceable on this redirect. Mitigations:
//   - Bootstrap is rare (one-time per environment)
//   - Re-bootstrap simply overwrites tokens; no privilege escalation possible
//   - Admin verifies "Connected" badge in-hub after the flow
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

router.post('/disconnect', oauthLimiter, requireAuth, requireAdmin, (req, res) => {
  try {
    const result = disconnect();
    logZeltAudit(req.user.id, 'zelt.oauth.disconnected');
    res.json(result);
  } catch (err) {
    console.error('[zelt/disconnect]', err.message);
    res.status(500).json({ error: 'Disconnect failed' });
  }
});

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

router.get('/entities', dataLimiter, requireAuth, async (req, res) => {
  try {
    const entities = await listEntities();
    res.json({ entities });
  } catch (err) {
    console.error('[zelt/entities]', err.message, err.stack);
    if (err.message === 'NotConnected') {
      return res.status(503).json({ error: 'Zelt not connected', code: 'NOT_CONNECTED' });
    }
    // Always surface the upstream error message — this is HR-only data, not a public route.
    // The detail helps diagnose endpoint/scope issues without spelunking render logs.
    res.status(500).json({ error: 'Failed to fetch entities', detail: err.message });
  }
});

router.get('/balances', dataLimiter, requireAuth, async (req, res) => {
  const { entity } = req.query;
  if (!entity || typeof entity !== 'string' || entity.trim().length === 0) {
    return res.status(400).json({ error: 'Missing required query param: entity' });
  }
  try {
    const data = await getBalancesForEntity(entity.trim());
    res.json(data);
  } catch (err) {
    console.error('[zelt/balances]', err.message);
    if (err.message === 'NotConnected') {
      return res.status(503).json({ error: 'Zelt not connected', code: 'NOT_CONNECTED' });
    }
    res.status(500).json({ error: 'Failed to fetch balances', detail: IS_PROD ? undefined : err.message });
  }
});

router.post('/balances/export', dataLimiter, requireAuth, async (req, res) => {
  const { entity } = req.query;
  if (!entity || typeof entity !== 'string') {
    return res.status(400).json({ error: 'Missing required query param: entity' });
  }
  try {
    const { rows, asOf } = await getBalancesForEntity(entity.trim());
    const csv = toCsv(rows);
    const safeName = entity.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const dateTag = asOf.slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="calo-available-now-${safeName}-${dateTag}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('[zelt/balances/export]', err.message);
    if (err.message === 'NotConnected') {
      return res.status(503).json({ error: 'Zelt not connected', code: 'NOT_CONNECTED' });
    }
    res.status(500).json({ error: 'Export failed', detail: IS_PROD ? undefined : err.message });
  }
});

// Admin-only: clear server-side caches (entities + balances)
router.post('/cache/clear', oauthLimiter, requireAuth, requireAdmin, (req, res) => {
  clearCaches();
  res.json({ ok: true });
});

// Admin-only: returns the shape of one user record from Zelt for debugging
// field-name mismatches. No PII shape: only key names are returned, plus
// our extracted-field results so admin can see what we're reading.
router.get('/debug/sample', oauthLimiter, requireAuth, requireAdmin, async (req, res) => {
  try {
    const sample = await debugSampleUser();
    res.json(sample);
  } catch (err) {
    console.error('[zelt/debug/sample]', err.message);
    res.status(500).json({ error: 'Sample failed', detail: err.message });
  }
});

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
