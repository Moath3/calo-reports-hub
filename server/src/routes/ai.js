import { Router } from "express";
import { getDb } from "../db/database.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { badRequest, unprocessable } from "../utils/httpError.js";
import {
  callAI, buildReportSystemPrompt, buildChatSystemPrompt, buildRefineSystemPrompt, buildPlanSystemPrompt,
  getAvailableProviders, extractJSON,
} from "../services/aiService.js";

const router = Router();

function logUsage(userId, provider, result, requestType, duration) {
  try {
    const db = getDb();
    db.prepare("INSERT INTO ai_usage (user_id, provider, tokens_in, tokens_out, request_type, duration_ms) VALUES (?,?,?,?,?,?)")
      .run(
        userId,
        provider || "claude-auto",
        result?.tokensIn || 0,
        result?.tokensOut || 0,
        requestType,
        duration || 0,
      );
  } catch (e) {
    console.error("AI usage log error:", e.message);
  }
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

  const systemPrompt = buildReportSystemPrompt(dataSummary, templateData);
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
  res.json({ report, reportData: report, provider: provider || "claude-auto", model: result.model, duration });
}));

// POST /chat — fast iteration: Sonnet by default
router.post("/chat", requireAuth, asyncHandler(async (req, res) => {
  const { message, reportContext, provider, history } = req.body;
  if (!message) throw badRequest("Message is required");

  const systemPrompt = buildChatSystemPrompt(reportContext);
  let userMessage = message;
  if (history && history.length > 0) {
    const contextMsgs = history.slice(-6).map(m => m.role + ": " + m.content).join("\n");
    userMessage = "Previous conversation:\n" + contextMsgs + "\n\nUser: " + message;
  }

  const startTime = Date.now();
  const result = await callAI(provider, systemPrompt, userMessage, { requestType: "chat" });
  const duration = Date.now() - startTime;

  // Parse structured response: { message, updates }
  const parsed = extractJSON(result.text);
  let responseMessage;
  let updates = null;

  if (parsed && typeof parsed === "object") {
    responseMessage = parsed.message || parsed.response || result.text;
    if (parsed.updates && typeof parsed.updates === "object") updates = parsed.updates;
  } else {
    responseMessage = result.text;
  }

  logUsage(req.user.id, provider, result, "chat", duration);
  res.json({
    response: responseMessage,
    message: responseMessage,
    updates,
    provider: provider || "claude-auto",
    model: result.model,
  });
}));

// POST /refine — single-section edit: Sonnet by default
router.post("/refine", requireAuth, asyncHandler(async (req, res) => {
  const { reportData, sectionIndex, instruction, provider } = req.body;
  if (!reportData || sectionIndex == null || !instruction) {
    throw badRequest("reportData, sectionIndex, and instruction are required");
  }

  const section = reportData.sections?.[sectionIndex];
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
  res.json({ updatedSection, section: updatedSection, provider: provider || "claude-auto", model: result.model });
}));

// POST /plan — multi-turn clarification chat BEFORE generation
// Sonnet (fast) because clarifying questions don't need Opus-level reasoning.
router.post("/plan", requireAuth, asyncHandler(async (req, res) => {
  const { history, provider } = req.body;
  if (!Array.isArray(history) || history.length === 0) {
    throw badRequest("history is required (array of messages)");
  }

  const systemPrompt = buildPlanSystemPrompt();
  const convo = history.slice(-8).map(m => `${m.role === 'ai' ? 'Assistant' : 'User'}: ${m.content}`).join("\n\n");
  const userMessage = "Conversation so far:\n\n" + convo + "\n\nReply with your JSON response.";

  const startTime = Date.now();
  const result = await callAI(provider, systemPrompt, userMessage, { requestType: "chat" });
  const duration = Date.now() - startTime;

  const parsed = extractJSON(result.text);
  if (!parsed) {
    throw unprocessable("AI did not return valid plan JSON.", {
      rawResponse: (result.text || "").slice(0, 1000),
    });
  }

  logUsage(req.user.id, provider, result, "chat", duration);
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
