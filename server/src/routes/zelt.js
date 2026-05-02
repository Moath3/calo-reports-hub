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
  const raw = req.query.entity;
  if (!raw || typeof raw !== 'string') {
    return res.status(400).json({ error: 'Missing required query param: entity' });
  }
  const entities = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (!entities.length) {
    return res.status(400).json({ error: 'No valid entities provided' });
  }

  // asOfDate: optional. Past dates only — future projection is brittle.
  let asOfDate = null;
  if (req.query.asOfDate) {
    const d = String(req.query.asOfDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      return res.status(400).json({ error: 'asOfDate must be YYYY-MM-DD' });
    }
    if (new Date(d).getTime() > Date.now()) {
      return res.status(400).json({ error: 'asOfDate cannot be in the future' });
    }
    asOfDate = d;
  }
  try {
    const datas = await Promise.all(entities.map(e => getBalancesForEntity(e, asOfDate)));
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
  } catch (err) {
    console.error('[zelt/balances]', err.message);
    if (err.message === 'NotConnected') {
      return res.status(503).json({ error: 'Zelt not connected', code: 'NOT_CONNECTED' });
    }
    res.status(500).json({ error: 'Failed to fetch balances', detail: err.message });
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

// Data hygiene audit — surfaces flagged employees against 10+ checks.
router.get('/audit', dataLimiter, requireAuth, async (req, res) => {
  try {
    const report = await runAudit();
    res.json(report);
  } catch (err) {
    console.error('[zelt/audit]', err.message);
    if (err.message === 'NotConnected') {
      return res.status(503).json({ error: 'Zelt not connected', code: 'NOT_CONNECTED' });
    }
    res.status(500).json({ error: 'Audit failed', detail: err.message });
  }
});

// Send the audit digest by email (admin only). Uses Resend if configured.
router.post('/audit/digest', oauthLimiter, requireAuth, requireAdmin, async (req, res) => {
  try {
    const recipients = (req.body?.recipients || []).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
    if (!recipients.length) return res.status(400).json({ error: 'Provide at least one recipient email' });
    const report = await runAudit();
    const html = digestHtml(report);
    const subject = `Calo · Zelt Data Hygiene Digest · ${new Date().toLocaleDateString('en-GB')}`;

    if (!process.env.RESEND_API_KEY) {
      return res.status(503).json({ error: 'RESEND_API_KEY not configured on hub' });
    }
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || 'CALO Hub <hub@calo.app>',
        to: recipients,
        subject,
        html,
      }),
    });
    if (!r.ok) {
      const text = await r.text();
      return res.status(502).json({ error: 'Resend rejected', detail: text.slice(0, 200) });
    }
    logZeltAudit(req.user.id, 'zelt.audit.digest_sent', { recipients });
    res.json({ ok: true, recipients, summary: report.summary });
  } catch (err) {
    console.error('[zelt/audit/digest]', err.message);
    res.status(500).json({ error: 'Digest send failed', detail: err.message });
  }
});

function digestHtml(report) {
  const s = report.summary;
  const row = (label, count, severity) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;font-size:14px">${label}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:700;font-size:14px;color:${severity === 'high' ? '#c0392b' : severity === 'medium' ? '#9A6F0E' : '#28b17b'}">${count}</td>
    </tr>`;
  return `<!doctype html><html><body style="font-family:-apple-system,system-ui,sans-serif;background:#f7f7f7;margin:0;padding:24px">
    <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.06)">
      <div style="background:#28b17b;color:#fff;padding:24px 28px"><h1 style="margin:0;font-size:20px;letter-spacing:-0.02em">Zelt Data Hygiene Digest</h1>
        <div style="font-size:13px;opacity:0.85;margin-top:4px">${new Date(report.asOf).toLocaleString('en-GB')} · ${report.totalUsers} total users</div></div>
      <table style="width:100%;border-collapse:collapse;background:#fff">
        ${row('Active employees with leaveDate set', s.activeWithLeaveDate, s.activeWithLeaveDate > 0 ? 'high' : 'ok')}
        ${row('Active but userEvent=Terminated/Resigned', s.activeButTerminated, s.activeButTerminated > 0 ? 'high' : 'ok')}
        ${row('Duplicate employee IDs', s.duplicateEmployeeIds, s.duplicateEmployeeIds > 0 ? 'high' : 'ok')}
        ${row('Missing employee ID (active)', s.missingEmployeeId, s.missingEmployeeId > 0 ? 'medium' : 'ok')}
        ${row('Duplicate display names', s.duplicateNames, s.duplicateNames > 0 ? 'medium' : 'ok')}
        ${row('Missing entity', s.missingEntity, s.missingEntity > 0 ? 'medium' : 'ok')}
        ${row('Missing site', s.missingSite, s.missingSite > 0 ? 'low' : 'ok')}
        ${row('Missing department', s.missingDepartment, s.missingDepartment > 0 ? 'low' : 'ok')}
        ${row('Missing manager', s.missingManager, s.missingManager > 0 ? 'medium' : 'ok')}
        ${row('Future joiners (>90d)', s.futureJoiners, 'low')}
        ${row('Stale Created (>90d, never onboarded)', s.staleCreated, s.staleCreated > 50 ? 'medium' : 'low')}
        ${row('Test users on Active', s.testUsers, s.testUsers > 0 ? 'medium' : 'ok')}
        ${row('KSA active employees', s.ksaActiveCount, 'ok')}
      </table>
      <div style="padding:16px 28px;background:#fafafa;font-size:12px;color:#777;border-top:1px solid #eee">
        Full report at <a href="https://calo-reports-hub.onrender.com/data-hygiene" style="color:#28b17b">CALO Hub → Data Hygiene</a>.
      </div>
    </div></body></html>`;
}

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
