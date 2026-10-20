// Sends mail through Google Workspace (Gmail API) with the shared service account
// and domain-wide delegation — DKIM-aligned as calo.app, so there is no third-party
// sender domain to verify. Impersonates the GMAIL_SENDER mailbox. Returns
// { sent, ... } and never throws, matching emailService.sendEmail's contract.
import fetch from 'node-fetch';
import { isConfigured as saConfigured, mintAccessToken } from './googleAuth.js';

const SCOPE = 'https://www.googleapis.com/auth/gmail.send';

// e.g. GMAIL_SENDER="CALO People <people@calo.app>" — must be a real Workspace mailbox.
function senderSpec() { return process.env.GMAIL_SENDER || ''; }
function bareEmail(spec) { const m = String(spec).match(/<([^>]+)>/); return (m ? m[1] : spec).trim(); }

export function gmailConfigured() { return saConfigured() && !!senderSpec(); }

function encodeSubject(s) {
  return /[^\x00-\x7F]/.test(s) ? `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=` : s;
}
function toBase64Url(buf) { return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

export async function sendGmail({ to, subject, html, from }) {
  const fromSpec = from || senderSpec();
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!recipients.length) return { sent: false, skipped: 'no recipient' };
  try {
    const token = await mintAccessToken({ scope: SCOPE, sub: bareEmail(fromSpec) });
    const mime = [
      `From: ${fromSpec}`,
      `To: ${recipients.join(', ')}`,
      `Subject: ${encodeSubject(subject)}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      '',
      html,
    ].join('\r\n');
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: toBase64Url(Buffer.from(mime, 'utf8')) }),
    });
    if (!res.ok) {
      const err = (await res.text().catch(() => '')).slice(0, 300);
      const hint = res.status === 403
        ? ' (grant the service account domain-wide delegation for gmail.send, and confirm GMAIL_SENDER is a real Workspace mailbox)'
        : '';
      return { sent: false, error: `Gmail ${res.status}${hint}: ${err}` };
    }
    return { sent: true };
  } catch (e) {
    return { sent: false, error: e.message };
  }
}
