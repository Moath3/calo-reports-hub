import { Router } from "express";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// Admin-only connectivity checks for the external integrations. Each test runs
// server-side (where the keys live) and returns only a status + friendly
// message — the keys themselves are never sent back to the client.
const router = Router();
const TIMEOUT_MS = 12000;

async function ping(url, headers) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    return { ok: res.ok, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

const describe = (status, map) => map[status] || `${status} — unexpected response`;

router.get("/connections", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const services = {};

  // ── Claude (Anthropic) — GET /v1/models validates the key ──────────
  const claudeKey = process.env.CLAUDE_API_KEY;
  if (!claudeKey) {
    services.claude = { label: "Claude (Anthropic)", configured: false, ok: false, message: "CLAUDE_API_KEY is not set in the environment" };
  } else {
    try {
      const r = await ping("https://api.anthropic.com/v1/models", { "x-api-key": claudeKey, "anthropic-version": "2023-06-01" });
      services.claude = {
        label: "Claude (Anthropic)", configured: true, ok: r.ok, status: r.status,
        message: r.ok ? "Key valid — API reachable" : describe(r.status, {
          401: "401 — invalid or disabled key (or a Claude.ai login, not a Console API key)",
          403: "403 — key lacks permission for this org/workspace",
          429: "429 — rate limited or no credit/billing on the org",
        }),
      };
    } catch (e) {
      services.claude = { label: "Claude (Anthropic)", configured: true, ok: false, message: e.name === "AbortError" ? "Timed out reaching api.anthropic.com" : "Request failed: " + e.message };
    }
  }

  // ── Netlify — GET /api/v1/user validates the token ─────────────────
  const netlifyToken = process.env.NETLIFY_ACCESS_TOKEN;
  if (!netlifyToken) {
    services.netlify = { label: "Netlify", configured: false, ok: false, message: "NETLIFY_ACCESS_TOKEN is not set in the environment" };
  } else {
    try {
      const r = await ping("https://api.netlify.com/api/v1/user", { "Authorization": "Bearer " + netlifyToken });
      services.netlify = {
        label: "Netlify", configured: true, ok: r.ok, status: r.status,
        message: r.ok ? "Token valid — API reachable" : describe(r.status, {
          401: "401 — invalid or expired token",
          403: "403 — token lacks permission",
        }),
      };
    } catch (e) {
      services.netlify = { label: "Netlify", configured: true, ok: false, message: e.name === "AbortError" ? "Timed out reaching api.netlify.com" : "Request failed: " + e.message };
    }
  }

  res.json({ checkedAt: new Date().toISOString(), services });
}));

export default router;
