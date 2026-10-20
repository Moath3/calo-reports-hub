import fetch from 'node-fetch';
import { gmailConfigured, sendGmail } from './googleMail.js';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'm.alghoniman@calo.app';
const APP_URL = process.env.RENDER_EXTERNAL_URL || process.env.FRONTEND_URL || 'https://calo-reports-hub.onrender.com';
// Sender for staff-facing mail. `onboarding@resend.dev` is Resend's sandbox and
// only delivers to verified addresses, so to email real employees set
// COMP_FROM_EMAIL to an address on a domain verified in Resend (e.g.
// "CALO People <people@notify.calo.app>").
const COMP_FROM_EMAIL = process.env.COMP_FROM_EMAIL || 'CALO Reports <onboarding@resend.dev>';

function escapeHtmlShared(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Generic Resend send. Returns { sent, skipped?, error? } — never throws, so a
// bad address or a transport blip can't crash the watcher tick.
export async function sendEmail({ to, subject, html, from = COMP_FROM_EMAIL }) {
  // Prefer Google Workspace (Gmail, DKIM-aligned as calo.app) when wired up; it
  // reaches any staff inbox without a verified third-party sender domain. Resend
  // stays as the fallback so nothing breaks if Gmail isn't configured.
  if (gmailConfigured()) return sendGmail({ to, subject, html, from: process.env.GMAIL_SENDER });
  if (!RESEND_API_KEY) return { sent: false, skipped: 'no email provider configured (set GMAIL_SENDER + GOOGLE_SERVICE_ACCOUNT_JSON, or RESEND_API_KEY)' };
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!recipients.length) return { sent: false, skipped: 'no recipient' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: recipients, subject, html }),
    });
    if (!res.ok) {
      const err = (await res.text().catch(() => '')).slice(0, 300);
      console.error('[Email] Resend error:', res.status, err);
      return { sent: false, error: `${res.status} ${err}` };
    }
    return { sent: true };
  } catch (err) {
    console.error('[Email] send failed:', err.message);
    return { sent: false, error: err.message };
  }
}

const MONTHS_E = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return escapeHtmlShared(iso);
  return `${d.getUTCDate()} ${MONTHS_E[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// 30-day comp-expiry reminder to an employee's work email. `additions` =
// [{ days, expiresOn, daysToExpiry }]. CALO-green, mirrors the admin templates.
export function buildCompReminderHtml({ name, additions = [] }) {
  const rows = additions.map((a) => `
    <tr>
      <td style="padding:8px 0;color:#111827;font-weight:600;">${escapeHtmlShared(a.days)} day${Number(a.days) === 1 ? '' : 's'}</td>
      <td style="padding:8px 0;color:#374151;text-align:right;">expires <strong>${fmtDate(a.expiresOn)}</strong>${a.daysToExpiry != null ? ` <span style="color:#9ca3af;">(${a.daysToExpiry}d left)</span>` : ''}</td>
    </tr>`).join('');
  const total = additions.reduce((s, a) => s + (Number(a.days) || 0), 0);
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
      <div style="background:#02B376;color:#fff;padding:16px 24px;border-radius:12px 12px 0 0;">
        <h2 style="margin:0;font-size:18px;">Your compensatory days are expiring soon</h2>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 12px 12px;">
        <p style="margin:0 0 16px;color:#374151;">Hi ${escapeHtmlShared((name || '').split(' ')[0] || 'there')}, you have <strong>${Number(total.toFixed(1))}</strong> compensatory day${total === 1 ? '' : 's'} expiring within the next 30 days. Please plan to use ${total === 1 ? 'it' : 'them'} before ${total === 1 ? 'it lapses' : 'they lapse'}, or speak to your People &amp; Culture contact.</p>
        <table style="width:100%;border-collapse:collapse;border-top:1px solid #eef2f0;">${rows}</table>
        <p style="margin:20px 0 0;font-size:12px;color:#9ca3af;">This is an automated reminder from the CALO People team. Balances are read live from Zelt; book leave in Zelt to use your days.</p>
      </div>
    </div>`;
}

export async function sendCompExpiryReminder({ to, name, additions }) {
  const total = (additions || []).reduce((s, a) => s + (Number(a.days) || 0), 0);
  return sendEmail({
    to,
    subject: `Reminder: ${Number(total.toFixed(1))} compensatory day${total === 1 ? '' : 's'} expiring soon`,
    html: buildCompReminderHtml({ name, additions }),
  });
}

// Escape public-form input before interpolating into the admin notification
// email — a registrant could otherwise inject markup/links the admin acts on.
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

export async function notifyAdminNewRegistration({ name, email, department }) {
  if (!RESEND_API_KEY) {
    console.warn('[Email] RESEND_API_KEY not set — skipping notification');
    return;
  }

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
      <div style="background:#02B376;color:#fff;padding:16px 24px;border-radius:12px 12px 0 0;">
        <h2 style="margin:0;font-size:18px;">CALO Reports — New Registration</h2>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 12px 12px;">
        <p style="margin:0 0 16px;color:#374151;">A new user has registered and is waiting for your approval:</p>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:8px 0;color:#6b7280;width:100px;">Name</td><td style="padding:8px 0;font-weight:600;color:#111827;">${escapeHtml(name)}</td></tr>
          <tr><td style="padding:8px 0;color:#6b7280;">Email</td><td style="padding:8px 0;font-weight:600;color:#111827;">${escapeHtml(email)}</td></tr>
          <tr><td style="padding:8px 0;color:#6b7280;">Department</td><td style="padding:8px 0;font-weight:600;color:#111827;">${escapeHtml(department || 'Not specified')}</td></tr>
        </table>
        <div style="margin-top:24px;text-align:center;">
          <a href="${APP_URL}/settings" style="display:inline-block;background:#02B376;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Review & Approve</a>
        </div>
        <p style="margin:20px 0 0;font-size:12px;color:#9ca3af;text-align:center;">Go to Settings → Manage Users to approve or reject this registration.</p>
      </div>
    </div>
  `;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'CALO Reports <onboarding@resend.dev>',
        to: [ADMIN_EMAIL],
        subject: `New Registration: ${name} (${email})`,
        html,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[Email] Resend API error:', res.status, err);
    } else {
      console.log(`[Email] Admin notified about new registration: ${email}`);
    }
  } catch (err) {
    console.error('[Email] Failed to send notification:', err.message);
  }
}

/**
 * Fired by zeltApi when OAuth refresh has failed multiple times in a row.
 * Tells the admin to re-bootstrap before users notice. Quiet no-op if
 * RESEND_API_KEY isn't configured.
 */
export async function notifyAdminZeltRefreshFailing({ failureCount, lastError }) {
  if (!RESEND_API_KEY) {
    console.warn('[Email] RESEND_API_KEY not set — skipping zelt-refresh-failing notification');
    return;
  }

  const safeError = String(lastError || '').slice(0, 400).replace(/[<>]/g, '');
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
      <div style="background:#c0392b;color:#fff;padding:16px 24px;border-radius:12px 12px 0 0;">
        <h2 style="margin:0;font-size:18px;">CALO Hub — Zelt OAuth refresh failing</h2>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 12px 12px;">
        <p style="margin:0 0 16px;color:#374151;">The Zelt partner-API refresh has failed <strong>${failureCount}</strong> times in a row. Tokens are still in the database (no auto-wipe), but the integration will return errors until you re-bootstrap.</p>
        <pre style="background:#fafafa;padding:12px;border-radius:6px;font-size:12px;color:#555;white-space:pre-wrap;word-break:break-word;border:1px solid #eee;">${safeError}</pre>
        <p style="margin:16px 0 0;color:#374151;">Reconnect: Zelt admin → Settings → Security → Developer Hub → your app → Code flow → Allow access.</p>
        <div style="margin-top:24px;text-align:center;">
          <a href="${APP_URL}/api/health" style="display:inline-block;background:#02B376;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px;">Check current state</a>
        </div>
      </div>
    </div>
  `;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'CALO Reports <onboarding@resend.dev>',
        to: [ADMIN_EMAIL],
        subject: `[CALO Hub] Zelt OAuth refresh failing (${failureCount}x)`,
        html,
      }),
    });
    if (!res.ok) {
      console.error('[Email] Resend API error (zelt alert):', res.status, await res.text().catch(() => ''));
    } else {
      console.log('[Email] Admin notified: zelt refresh failing');
    }
  } catch (err) {
    console.error('[Email] Failed to send zelt alert:', err.message);
  }
}
