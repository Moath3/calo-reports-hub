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

async function slackCall(method, body) {
  if (!SLACK_BOT_TOKEN) return { ok: false, error: 'SLACK_BOT_TOKEN not set' };
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${SLACK_API}/${method}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
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

// Resolve a work email to a Slack user ID. Returns null on any failure.
export async function slackLookupUserByEmail(email) {
  if (!email) return null;
  const r = await slackCall('users.lookupByEmail', { email });
  if (r.ok && r.user?.id) return r.user.id;
  return null;
}

// DM a user, identified by Slack user ID (preferred) or work email. Posting to a
// user ID as the channel opens/uses the IM. Returns { sent, skipped?, error?, userId? }.
export async function postSlackDM({ slackUserId = '', email = '', text }) {
  if (!slackBotConfigured()) return { sent: false, skipped: 'SLACK_BOT_TOKEN not set' };
  if (!text) return { sent: false, skipped: 'empty text' };
  let userId = (slackUserId || '').trim();
  if (!userId && email) userId = await slackLookupUserByEmail(email);
  if (!userId) return { sent: false, error: email ? `no Slack user for ${email}` : 'no slackUserId or email' };
  const r = await slackCall('chat.postMessage', { channel: userId, text, unfurl_links: false, unfurl_media: false });
  if (r.ok) return { sent: true, userId };
  return { sent: false, error: r.error || 'postMessage failed', userId };
}
