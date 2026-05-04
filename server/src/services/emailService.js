import fetch from 'node-fetch';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'm.alghoniman@calo.app';
const APP_URL = process.env.RENDER_EXTERNAL_URL || process.env.FRONTEND_URL || 'https://calo-reports-hub.onrender.com';

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
          <tr><td style="padding:8px 0;color:#6b7280;width:100px;">Name</td><td style="padding:8px 0;font-weight:600;color:#111827;">${name}</td></tr>
          <tr><td style="padding:8px 0;color:#6b7280;">Email</td><td style="padding:8px 0;font-weight:600;color:#111827;">${email}</td></tr>
          <tr><td style="padding:8px 0;color:#6b7280;">Department</td><td style="padding:8px 0;font-weight:600;color:#111827;">${department || 'Not specified'}</td></tr>
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
