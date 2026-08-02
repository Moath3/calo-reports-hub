import { Router } from "express";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getModelIds, describeClaudeFailure } from "../services/aiService.js";
import { zeltGetOauthOnly } from "../services/zeltApi.js";
import { botGet, botConfigured } from "../services/zeltBot.js";

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

  // ── Claude (Anthropic) — key check (/v1/models) PLUS a real 1-token
  // /v1/messages probe per model. The key check alone is a known blind spot:
  // it passes even when the org can't call the model (not enabled / no credits).
  const claudeKey = process.env.CLAUDE_API_KEY;
  if (!claudeKey) {
    services.claude = { label: "Claude (Anthropic)", configured: false, ok: false, message: "CLAUDE_API_KEY is not set in the environment" };
  } else {
    try {
      const r = await ping("https://api.anthropic.com/v1/models", { "x-api-key": claudeKey, "anthropic-version": "2023-06-01" });
      if (!r.ok) {
        services.claude = {
          label: "Claude (Anthropic)", configured: true, ok: false, status: r.status,
          message: describe(r.status, {
            401: "401 — invalid or disabled key (or a Claude.ai login, not a Console API key)",
            403: "403 — key lacks permission for this org/workspace",
            429: "429 — rate limited or no credit/billing on the org",
          }),
        };
      } else {
        const ids = getModelIds();
        const probeModel = async (model, role) => {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
          try {
            const res = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: { "content-type": "application/json", "x-api-key": claudeKey, "anthropic-version": "2023-06-01" },
              body: JSON.stringify({ model, max_tokens: 8, messages: [{ role: "user", content: "ping" }] }),
              signal: ctrl.signal,
            });
            if (res.ok) return { model, role, ok: true, message: "responds" };
            const bodyText = await res.text();
            return { model, role, ok: false, message: describeClaudeFailure(res.status, bodyText, model) };
          } catch (e) {
            return { model, role, ok: false, message: e.name === "AbortError" ? "timed out" : e.message };
          } finally {
            clearTimeout(timer);
          }
        };
        const models = await Promise.all([
          probeModel(ids.sonnet, "chat / refine / T&A summary"),
          probeModel(ids.opus, "report generation (analyze)"),
        ]);
        const allOk = models.every((m) => m.ok);
        services.claude = {
          label: "Claude (Anthropic)", configured: true, ok: allOk,
          message: allOk ? "Key valid — both models respond" : "Key valid, but a model call failed — see below",
          models,
        };
      }
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

  // ── Zelt — distinguishes the partner OAuth (absence history, entity lists)
  // from the bot session (live balances, user cache). The Hub can limp along on
  // the bot alone, which HIDES a dead OAuth — this row is where that shows red
  // instead of surfacing weeks later as a 403 on some report.
  const zeltChecks = [];
  try {
    await zeltGetOauthOnly("/apiv2/partner/users", { page: 1, pageSize: 1 });
    zeltChecks.push({ name: "Partner API (OAuth)", role: "absence history, entity lists", ok: true, message: "responds" });
  } catch (e) {
    const msg = e.message === "NotConnected"
      ? "OAuth not connected — re-run the Connect Zelt bootstrap (Leave Balances page)"
      : (e.status ? `${e.status} — token dead/expired; re-run the Connect Zelt bootstrap` : (e.message || "failed").slice(0, 160));
    zeltChecks.push({ name: "Partner API (OAuth)", role: "absence history, entity lists", ok: false, message: msg });
  }
  if (botConfigured()) {
    try {
      await botGet("/apiv2/absence-policies/extended");
      zeltChecks.push({ name: "Bot session", role: "live balances, user cache", ok: true, message: "responds" });
    } catch (e) {
      zeltChecks.push({ name: "Bot session", role: "live balances, user cache", ok: false, message: (e.message || "failed").slice(0, 160) });
    }
  } else {
    zeltChecks.push({ name: "Bot session", role: "live balances, user cache", ok: false, message: "ZELT_BOT_EMAIL / ZELT_BOT_PASSWORD not set" });
  }
  const zeltOk = zeltChecks.every((c) => c.ok);
  services.zelt = {
    label: "Zelt (HRIS)",
    configured: true,
    ok: zeltOk,
    message: zeltOk
      ? "Partner OAuth + bot session both respond"
      : (zeltChecks[0].ok
          ? "Bot session issue — see below"
          : "Partner OAuth is down — the Hub limps on the bot fallback (absence history degraded)"),
    checks: zeltChecks,
  };

  res.json({ checkedAt: new Date().toISOString(), services });
}));

export default router;
