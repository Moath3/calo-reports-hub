// Slack Web API helper for DIRECT MESSAGES to specific users (the per-entity
// comp-expiry reports). An incoming webhook can only post to its one channel, so
// targeting a person needs a bot token (xoxb-) with scopes:
//   chat:write           — post messages / open DMs
//   users:read.email     — resolve a work email → Slack user ID
// Set SLACK_BOT_TOKEN on the server. All calls are best-effort and never throw.
import fetch from 'node-fetch';

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_API = 'https://slack.com/api';
const TIMEOUT_MS = 10000;

export function slackBotConfigured() {
  return Boolean(SLACK_BOT_TOKEN);
}

// `encoding`: 'json' for methods that accept a JSON body (chat.postMessage), or
// 'form' for the older methods that only read x-www-form-urlencoded args
// (users.lookupByEmail returns invalid_arguments if sent JSON).
async function slackCall(method, body, encoding = 'json') {
  if (!SLACK_BOT_TOKEN) return { ok: false, error: 'SLACK_BOT_TOKEN not set' };
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const form = encoding === 'form';
    const res = await fetch(`${SLACK_API}/${method}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
        'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json; charset=utf-8',
      },
      body: form ? new URLSearchParams(body).toString() : JSON.stringify(body),
      signal: controller.signal,
    });
    const json = await res.json().catch(() => ({ ok: false, error: `bad_response_${res.status}` }));
    return json;
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'timeout' : err.message };
  } finally {
    clearTimeout(t);
  }
}

// Resolve a work email to a Slack user ID. Returns { id, error } so callers can
// tell a genuine "not in workspace" (users_not_found) from a scope/auth problem
// (missing_scope, invalid_auth) instead of a blanket null.
export async function slackLookupUserByEmail(email) {
  if (!email) return { id: null, error: 'no email' };
  const r = await slackCall('users.lookupByEmail', { email }, 'form');
  if (r.ok && r.user?.id) return { id: r.user.id, error: null };
  return { id: null, error: r.error || 'lookup failed' };
}

// DM a user, identified by Slack user ID (preferred) or work email. Posting to a
// user ID as the channel opens/uses the IM. Returns { sent, skipped?, error?, userId? }.
export async function postSlackDM({ slackUserId = '', email = '', text }) {
  if (!slackBotConfigured()) return { sent: false, skipped: 'SLACK_BOT_TOKEN not set' };
  if (!text) return { sent: false, skipped: 'empty text' };
  let userId = (slackUserId || '').trim();
  if (!userId && email) {
    const look = await slackLookupUserByEmail(email);
    if (!look.id) {
      const hint = look.error === 'missing_scope' ? ' (bot is missing the users:read.email scope — add it and reinstall)'
        : look.error === 'users_not_found' ? ` (no Slack member has the email ${email} — check their Slack email or paste their Slack user ID)`
        : '';
      return { sent: false, error: `Slack lookup failed: ${look.error}${hint}` };
    }
    userId = look.id;
  }
  if (!userId) return { sent: false, error: 'no slackUserId or email' };
  const r = await slackCall('chat.postMessage', { channel: userId, text, unfurl_links: false, unfurl_media: false });
  if (r.ok) return { sent: true, userId };
  return { sent: false, error: `Slack postMessage failed: ${r.error || 'unknown'}`, userId };
}
