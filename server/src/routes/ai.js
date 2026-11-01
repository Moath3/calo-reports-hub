import { Router } from "express";
import { getDb } from "../db/database.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { badRequest, unprocessable } from "../utils/httpError.js";
import {
  callAI, buildReportSystemPrompt, buildChatSystemPrompt, buildChatContextBlock,
  buildRefineSystemPrompt, buildPlanSystemPrompt,
  getAvailableProviders, extractJSON,
} from "../services/aiService.js";
import { runReport, getDimensions } from "../services/zeltReport.js";

const router = Router();

const DEFAULT_PROVIDER_LABEL = 'claude-auto';
const CHAT_HISTORY_TURNS = 6;
const PLAN_HISTORY_TURNS = 8;

function logUsage(userId, provider, result, requestType, duration) {
  try {
    const db = getDb();
    db.prepare("INSERT INTO ai_usage (user_id, provider, tokens_in, tokens_out, request_type, duration_ms) VALUES (?,?,?,?,?,?)")
      .run(
        userId,
        provider || DEFAULT_PROVIDER_LABEL,
        result?.tokensIn || 0,
        result?.tokensOut || 0,
        requestType,
        duration || 0,
      );
  } catch (e) {
    console.error("AI usage log error:", e.message);
  }
}

// Redact salary / phone / personal-email before any NON-admin's data reaches the
// external model. Key-based for structured fields; emails masked in free text.
// Numeric values are left intact (reports are numbers-first). Admins are exempt.
const PII_KEY = /salary|basic[\s_-]?pay|compensation|\bwage\b|\bphone\b|mobile|personal[\s_-]?e?-?mail|home[\s_-]?e?-?mail|\biban\b|bank[\s_-]?acc/i;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
function scrubPII(v) {
  if (typeof v === "string") return v.replace(EMAIL_RE, "[redacted-email]");
  if (Array.isArray(v)) return v.map(scrubPII);
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = PII_KEY.test(k) ? "[redacted]" : scrubPII(val);
    return out;
  }
  return v;
}
// Only admins may send personal/salary data to the AI; everyone else is scrubbed.
const forAI = (data, user) => (user && user.role === "admin" ? data : scrubPII(data));

// --- Live Zelt pull for the chat -------------------------------------------
// When the chat model returns { needsZelt: { filters, fields } }, the server
// fetches the real roster via runReport (already active-only; salary/sensitive
// fields admin-gated inside runReport) and feeds it back for a second pass.
// Names flow by policy; forAI is NOT re-applied here because runReport IS the
// authoritative role-scrub for Zelt data and there is no email field to mask.
const ZELT_FILTER_KEYS = ["departments", "businessLines", "entities", "orgs", "sites", "jobFamilies", "workCountries"];
const ZELT_ROW_CAP = 250;                 // cap rows fed back to the model (token budget); aggregates still give exact totals
const ZELT_CONTEXT_CHAR_LIMIT = 24000;

function sanitizeZeltFilters(raw) {
  const out = {};
  if (raw && typeof raw === "object") {
    for (const k of ZELT_FILTER_KEYS) {
      const v = raw[k];
      if (Array.isArray(v)) {
        const vals = v.filter(x => typeof x === "string" && x.trim()).map(x => x.trim());
        if (vals.length) out[k] = vals;
      }
    }
  }
  return out;
}

async function fetchZeltForChat(need, user) {
  const filters = sanitizeZeltFilters(need?.filters);
  const fields = Array.isArray(need?.fields) ? need.fields.filter(f => typeof f === "string") : [];
  const rep = await runReport({ filters, fields, isAdmin: user.role === "admin" });
  const truncated = rep.rows.length > ZELT_ROW_CAP;
  return {
    appliedFilters: filters,
    headcount: rep.count,
    aggregates: rep.aggregates,
    fields: rep.fields,
    sensitiveDenied: rep.sensitiveDenied,
    truncated,
    rows: truncated ? rep.rows.slice(0, ZELT_ROW_CAP) : rep.rows,
  };
}

// POST /analyze — heavy-duty one-shot: Opus by default (smart routing)
router.post("/analyze", requireAuth, asyncHandler(async (req, res) => {
  const { dataSummary, provider, customPrompt, templateId } = req.body;
  if (!dataSummary) throw badRequest("dataSummary is required");

  // Fetch template data if a template was selected
  let templateData = null;
  if (templateId) {
    try {
      const tmpl = getDb().prepare("SELECT template_data FROM templates WHERE id = ?").get(templateId);
      if (tmpl && tmpl.template_data) templateData = JSON.parse(tmpl.template_data);
    } catch (e) {
      console.error("Template fetch error:", e.message);
    }
  }

  const systemPrompt = buildReportSystemPrompt(forAI(dataSummary, req.user), templateData);
  let userMessage = "Please analyze this data and generate a comprehensive report. Return ONLY valid JSON.";
  if (customPrompt) userMessage += "\n\nAdditional instructions: " + customPrompt;

  const startTime = Date.now();
  const result = await callAI(provider, systemPrompt, userMessage, { requestType: "analyze" });
  const duration = Date.now() - startTime;

  const report = extractJSON(result.text);
  if (!report) {
    throw unprocessable("AI did not return valid JSON. Please try again.", {
      rawResponse: (result.text || "").slice(0, 2000),
    });
  }

  logUsage(req.user.id, provider, result, "analyze", duration);
  res.json({ report, reportData: report, provider: provider || DEFAULT_PROVIDER_LABEL, model: result.model, duration });
}));

// POST /chat — fast iteration: Sonnet by default
router.post("/chat", requireAuth, asyncHandler(async (req, res) => {
  const { message, reportContext, provider, history } = req.body;
  if (!message) throw badRequest("Message is required");

  const systemPrompt = buildChatSystemPrompt();
  // Give the model the live filter vocabulary so it picks exact Zelt names.
  let dimsBlock = "";
  try { const d = getDimensions(); if (d.ready) dimsBlock = "Available Zelt filters (use EXACT names):\n" + JSON.stringify(d.dimensions) + "\n\n"; } catch { /* index warming — model falls back to asking */ }
  const dynamicContext = dimsBlock + buildChatContextBlock(forAI(reportContext, req.user));
  let userMessage = message;
  if (history && history.length > 0) {
    const contextMsgs = history.slice(-CHAT_HISTORY_TURNS).map(m => m.role + ": " + m.content).join("\n");
    userMessage = "Previous conversation:\n" + contextMsgs + "\n\nUser: " + message;
  }

  let t0 = Date.now();
  let result = await callAI(provider, systemPrompt, userMessage, { requestType: "chat", dynamicContext });
  logUsage(req.user.id, provider, result, "chat", Date.now() - t0);
  let parsed = extractJSON(result.text);
  let zeltMeta = null;

  // One live Zelt pull per message: fetch the real roster the model asked for,
  // feed it back, and let the model compose its answer from it.
  if (parsed && typeof parsed === "object" && parsed.needsZelt && typeof parsed.needsZelt === "object") {
    let zeltData;
    try {
      zeltData = await fetchZeltForChat(parsed.needsZelt, req.user);
    } catch (e) {
      if (e.code === "INDEX_BUILDING") {
        const msg = "The live Zelt directory is still loading — give it a few seconds and ask again.";
        return res.json({ response: msg, message: msg, updates: null, provider: provider || DEFAULT_PROVIDER_LABEL, model: result.model });
      }
      throw e;
    }
    zeltMeta = { count: zeltData.headcount, truncated: zeltData.truncated, filters: zeltData.appliedFilters };
    const zeltBlock = "LIVE ZELT DATA (real, active employees, role-scrubbed — answer ONLY from this):\n"
      + JSON.stringify(zeltData, null, 2).slice(0, ZELT_CONTEXT_CHAR_LIMIT);
    const followupMsg = userMessage + "\n\n(The live Zelt data you requested is now in context. Answer from it; do not request Zelt again.)";
    t0 = Date.now();
    result = await callAI(provider, systemPrompt, followupMsg, {
      requestType: "chat",
      dynamicContext: zeltBlock + (dynamicContext ? "\n\n" + dynamicContext : ""),
    });
    logUsage(req.user.id, provider, result, "chat-zelt", Date.now() - t0);
    parsed = extractJSON(result.text);
  }

  // Parse structured response: { message, updates }
  let responseMessage;
  let updates = null;
  if (parsed && typeof parsed === "object") {
    responseMessage = parsed.message || parsed.response || result.text;
    if (parsed.updates && typeof parsed.updates === "object") updates = parsed.updates;
  } else {
    responseMessage = result.text;
  }

  res.json({
    response: responseMessage,
    message: responseMessage,
    updates,
    zelt: zeltMeta,
    provider: provider || DEFAULT_PROVIDER_LABEL,
    model: result.model,
  });
}));

// POST /refine — single-section edit: Sonnet by default
router.post("/refine", requireAuth, asyncHandler(async (req, res) => {
  const { reportData, sectionIndex, instruction, provider } = req.body;
  if (!reportData || sectionIndex == null || !instruction) {
    throw badRequest("reportData, sectionIndex, and instruction are required");
  }

  const section = forAI(reportData, req.user).sections?.[sectionIndex];
  if (!section) throw badRequest("Section not found at index " + sectionIndex);

  const systemPrompt = buildRefineSystemPrompt(section, instruction);

  const startTime = Date.now();
  const result = await callAI(provider, systemPrompt, "Refine the section as instructed. Return only JSON.", { requestType: "refine" });
  const duration = Date.now() - startTime;

  const updatedSection = extractJSON(result.text);
  if (!updatedSection) {
    throw unprocessable("AI did not return valid JSON for the refined section.");
  }

  logUsage(req.user.id, provider, result, "refine", duration);
  res.json({ updatedSection, section: updatedSection, provider: provider || DEFAULT_PROVIDER_LABEL, model: result.model });
}));

// POST /plan — multi-turn clarification chat BEFORE generation
// Sonnet (fast) because clarifying questions don't need Opus-level reasoning.
router.post("/plan", requireAuth, asyncHandler(async (req, res) => {
  const { history, provider } = req.body;
  if (!Array.isArray(history) || history.length === 0) {
    throw badRequest("history is required (array of messages)");
  }

  const systemPrompt = buildPlanSystemPrompt();
  const convo = history.slice(-PLAN_HISTORY_TURNS).map(m => `${m.role === 'ai' ? 'Assistant' : 'User'}: ${m.content}`).join("\n\n");
  const userMessage = "Conversation so far:\n\n" + convo + "\n\nReply with your JSON response.";

  const startTime = Date.now();
  const result = await callAI(provider, systemPrompt, userMessage, { requestType: "chat" });
  const duration = Date.now() - startTime;

  logUsage(req.user.id, provider, result, "chat", duration);

  const parsed = extractJSON(result.text);
  if (!parsed) {
    // Model replied in plain text instead of JSON — degrade gracefully: show
    // the raw reply as a chat message rather than surfacing a 422 toast.
    return res.json({
      message: result.text,
      ready: false,
      brief: '',
      suggestedTitle: '',
      model: result.model,
    });
  }

  res.json({
    message: parsed.message || '',
    ready: parsed.ready === true,
    brief: parsed.brief || '',
    suggestedTitle: parsed.suggestedTitle || '',
    model: result.model,
  });
}));

// GET /providers — lists Claude Sonnet + Opus
router.get("/providers", requireAuth, (req, res) => {
  res.json({ providers: getAvailableProviders() });
});

export default router;
