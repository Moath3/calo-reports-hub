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
  getAccessToken,
  forceRefreshForDebug,
  zeltGet,
  zeltGetOauthOnly,
} from '../services/zeltApi.js';
import { botGet, botConfigured, getBotStatus } from '../services/zeltBot.js';
import { listEntities, listDepartments, entitiesForDepartments, getBalancesForEntity, clearCaches, debugSampleUser } from '../services/zeltCompute.js';
import { runAudit } from '../services/zeltAudit.js';
import { getMobility } from '../services/zeltMobility.js';
import { getWatchState, runSnapshotAndDiff, sendWeeklyDigestIfDue } from '../services/zeltWatcher.js';

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
    // Classic double-hit: the browser loads the callback URL twice, the first
    // hit exchanges the (single-use) code and stores tokens, the second throws.
    // If we're actually connected, say so instead of scaring the admin.
    if (getStatus().connected) {
      return res.send(renderCallbackPage({
        ok: true,
        message: 'Zelt is already connected — this link was opened twice, which is harmless. You can close this tab and return to the hub.',
      }));
    }
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

router.get('/departments', dataLimiter, requireAuth, asyncHandler(async (req, res) => {
  const departments = await listDepartments().catch(zeltUpstream('Failed to fetch departments'));
  res.json({ departments });
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

  // departments: optional, comma-joined. Rows are filtered AFTER the per-entity
  // compute so the entity-level caches and stale-snapshot fallback stay
  // reusable across different department picks.
  const departments = typeof req.query.departments === 'string'
    ? req.query.departments.split(',').map(s => s.trim()).filter(Boolean)
    : [];
  const deptSet = new Set(departments.map(d => d.toLowerCase()));
  const byDept = (rows) => deptSet.size
    ? rows.filter(r => r.department && deptSet.has(String(r.department).trim().toLowerCase()))
    : rows;

  // Department-first fan-out narrowing: when departments are picked, only fetch
  // entities that actually contain them (from the cached user list). A fan-out
  // to ALL entities otherwise hits fringe entities that have no snapshot and a
  // degraded upstream path, and one broken entity would fail the whole request.
  let targetEntities = entities;
  if (deptSet.size && entities.length > 1) {
    const relevant = await entitiesForDepartments(departments).catch(() => null);
    if (relevant && relevant.length) {
      const relNorm = relevant.map(r => r.toLowerCase());
      const narrowed = entities.filter(e => {
        const en = e.toLowerCase();
        return relNorm.some(r => r === en || r.includes(en) || en.includes(r));
      });
      if (narrowed.length) targetEntities = narrowed;
    }
  }

  // Partial-failure tolerance: return the entities that worked plus a `failed`
  // list, instead of letting one broken entity kill the whole report. Only
  // hard-fail when EVERY entity failed. Entities are fetched SEQUENTIALLY —
  // a parallel fan-out burst is what tripped Zelt's partner rate limit (429).
  const settled = [];
  for (const e of targetEntities) {
    try {
      settled.push({ status: 'fulfilled', value: await getBalancesForEntity(e, asOfDate, departments) });
    } catch (reason) {
      settled.push({ status: 'rejected', reason });
    }
  }
  const datas = [];
  const failed = [];
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') datas.push(s.value);
    else {
      const msg = s.reason?.message === 'NotConnected' ? 'Zelt not connected' : (s.reason?.message || 'fetch failed');
      failed.push({ entity: targetEntities[i], reason: msg.slice(0, 200) });
    }
  });
  if (!datas.length) zeltUpstream('Failed to fetch balances')(settled[0].reason);

  if (targetEntities.length === 1) {
    const d = datas[0];
    const rows = byDept(d.rows);
    return res.json({ ...d, rows, count: rows.length, departments });
  }

  // Aggregate multi-entity result
  const allRows = [];
  const allDiagnostics = [];
  for (const d of datas) {
    for (const r of byDept(d.rows)) allRows.push({ ...r, entity: d.entity });
    if (d.diagnostic) allDiagnostics.push(d.diagnostic);
  }
  allRows.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  // Surface stale-snapshot status: top-level stale=true if ANY entity is stale,
  // capturedAt = oldest snapshot timestamp across the stale entities.
  const staleEntities = datas.filter(d => d.stale);
  const aggregateStale = staleEntities.length > 0;
  const oldestCapturedAt = aggregateStale
    ? Math.min(...staleEntities.map(d => d.capturedAt || 0).filter(t => t > 0))
    : null;

  res.json({
    entity: targetEntities.join(' + '),
    asOf: datas[0].asOf,
    count: allRows.length,
    rows: allRows,
    multi: true,
    departments,
    failed: failed.length ? failed : undefined,
    sources: datas.map(d => ({
      entity: d.entity,
      count: d.count,
      stale: !!d.stale,
      capturedAt: d.capturedAt || null,
    })),
    stale: aggregateStale,
    capturedAt: oldestCapturedAt,
    staleReason: aggregateStale ? staleEntities[0].staleReason : null,
  });
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

// Admin-only: mobility & turnover analytics — trailing-12-month joiner/leaver
// series, tenure buckets, per-entity/dept splits and the leaver list.
router.get('/mobility', dataLimiter, requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const report = await getMobility().catch(zeltUpstream('Mobility fetch failed'));
  res.json(report);
}));

// Admin-only: hygiene watcher state — snapshot history, latest summary,
// diff vs the previous snapshot, and digest metadata.
router.get('/watch', dataLimiter, requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  res.json(getWatchState());
}));

// Admin-only: take a fresh audit snapshot now, then return the updated state.
router.post('/watch/run', dataLimiter, requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  await runSnapshotAndDiff().catch(zeltUpstream('Watcher snapshot failed'));
  logZeltAudit(req.user.id, 'zelt.watch.run');
  res.json(getWatchState());
}));

// Admin-only: force-send the weekly Slack digest (bypasses the 6.5-day gate).
router.post('/watch/digest', dataLimiter, requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const result = await sendWeeklyDigestIfDue({ force: true });
  logZeltAudit(req.user.id, 'zelt.watch.digest', { sent: result.sent, skipped: result.skipped || null });
  res.json(result);
}));

// Admin-only: returns the shape of one user record from Zelt for debugging
// field-name mismatches. No PII shape: only key names are returned, plus
// our extracted-field results so admin can see what we're reading.
router.get('/debug/sample', oauthLimiter, requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const sample = await debugSampleUser().catch(zeltUpstream('Sample failed'));
  res.json(sample);
}));

// Admin-only: exercise each Zelt connectivity layer independently and report
// per-call status. Use this when the leave portal "isn't working" — the
// response tells you exactly which layer is broken (OAuth bearer, bot cookie
// at /users/cache, bot cookie at /absences/balance, partner /entities, etc.).
router.get('/debug/probe', oauthLimiter, requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const probe = async (label, fn) => {
    const start = Date.now();
    try {
      const result = await fn();
      return { label, ok: true, ms: Date.now() - start, sample: typeof result === 'object' ? Object.keys(result || {}).slice(0, 8) : null };
    } catch (e) {
      return { label, ok: false, ms: Date.now() - start, error: e.message, status: e.status || null };
    }
  };

  const results = [];
  results.push({ label: 'oauthStatus',  ok: true, value: getStatus() });
  results.push({ label: 'botStatus',    ok: true, value: getBotStatus() });
  results.push(await probe('oauth.getAccessToken', () => getAccessToken().then(t => ({ tokenLength: t.length }))));
  results.push(await probe('oauthOnly.partner/users (page=1)', () => zeltGetOauthOnly('/apiv2/partner/users', { page: 1, pageSize: 1 })));
  results.push(await probe('oauthOnly.partner/entities (page=1)', () => zeltGetOauthOnly('/apiv2/partner/entities', { page: 1, pageSize: 1 })));
  results.push(await probe('fallback.partner/entities (page=1)', () => zeltGet('/apiv2/partner/entities', { page: 1, pageSize: 1 })));
  if (botConfigured()) {
    results.push(await probe('bot./apiv2/users/cache', () => botGet('/apiv2/users/cache')));
    results.push(await probe('bot./apiv2/auth/me', () => botGet('/apiv2/auth/me')));
  }

  res.json({ asOf: new Date().toISOString(), results });
}));

// Admin-only: force the OAuth refresh-token grant now. This rotates the stored
// token pair if Zelt accepts the refresh token. It never returns token values.
// Returns 200 even on failure with ok=false + the underlying error, so the
// caller doesn't get a generic prod-stripped 500. (Probe-style endpoint.)
router.post('/debug/refresh', oauthLimiter, requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  try {
    const result = await forceRefreshForDebug();
    logZeltAudit(req.user.id, 'zelt.oauth.debug_refresh', {
      refreshed: result.refreshed,
      refreshRotated: result.refreshRotated,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    logZeltAudit(req.user.id, 'zelt.oauth.debug_refresh_failed', {
      error: err.message,
    });
    // Also surface the post-attempt status so caller can see refreshFailureCount, lastError etc.
    res.json({
      ok: false,
      error: err.message,
      status: err.status || null,
      oauthStatus: getStatus(),
    });
  }
}));

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
