import { Router } from "express";
import { getDb } from "../db/database.js";
import { requireAuth } from "../middleware/auth.js";
import { callAI, buildReportSystemPrompt, buildChatSystemPrompt, buildRefineSystemPrompt, getAvailableProviders, extractJSON } from "../services/aiService.js";

const router = Router();

// POST /analyze
router.post("/analyze", requireAuth, async (req, res) => {
  try {
    const { dataSummary, provider, customPrompt } = req.body;
    if (!dataSummary) return res.status(400).json({ error: "dataSummary is required" });

    const systemPrompt = buildReportSystemPrompt(dataSummary);
    let userMessage = "Please analyze this data and generate a comprehensive report. Return ONLY valid JSON.";
    if (customPrompt) userMessage += "\n\nAdditional instructions: " + customPrompt;

    const startTime = Date.now();
    const result = await callAI(provider, systemPrompt, userMessage);
    const duration = Date.now() - startTime;

    const report = extractJSON(result.text);
    if (!report) {
      return res.status(422).json({ error: "AI did not return valid JSON. Please try again.", rawResponse: result.text?.slice(0, 2000) });
    }

    // Log usage
    try {
      const db = getDb();
      db.prepare("INSERT INTO ai_usage (user_id, provider, tokens_in, tokens_out, request_type, duration_ms) VALUES (?,?,?,?,?,?)")
        .run(req.user.id, provider || "gemini", result.tokensIn || 0, result.tokensOut || 0, "analyze", duration);
    } catch (e) { console.error("AI usage log error:", e.message); }

    res.json({ report, provider: provider || "gemini", duration });
  } catch (err) {
    console.error("AI analyze error:", err);
    res.status(500).json({ error: "AI analysis failed: " + err.message });
  }
});

// POST /chat
router.post("/chat", requireAuth, async (req, res) => {
  try {
    const { message, reportContext, provider, history } = req.body;
    if (!message) return res.status(400).json({ error: "Message is required" });

    const systemPrompt = buildChatSystemPrompt(reportContext);
    let userMessage = message;
    if (history && history.length > 0) {
      const contextMsgs = history.slice(-6).map(m => m.role + ": " + m.content).join("\n");
      userMessage = "Previous conversation:\n" + contextMsgs + "\n\nUser: " + message;
    }

    const result = await callAI(provider, systemPrompt, userMessage);

    try {
      const db = getDb();
      db.prepare("INSERT INTO ai_usage (user_id, provider, tokens_in, tokens_out, request_type) VALUES (?,?,?,?,?)")
        .run(req.user.id, provider || "gemini", result.tokensIn || 0, result.tokensOut || 0, "chat");
    } catch (e) {}

    res.json({ response: result.text, provider: provider || "gemini" });
  } catch (err) {
    console.error("AI chat error:", err);
    res.status(500).json({ error: "AI chat failed: " + err.message });
  }
});

// POST /refine
router.post("/refine", requireAuth, async (req, res) => {
  try {
    const { reportData, sectionIndex, instruction, provider } = req.body;
    if (!reportData || sectionIndex == null || !instruction) {
      return res.status(400).json({ error: "reportData, sectionIndex, and instruction are required" });
    }

    const section = reportData.sections?.[sectionIndex];
    if (!section) return res.status(400).json({ error: "Section not found at index " + sectionIndex });

    const systemPrompt = buildRefineSystemPrompt(section, instruction);
    const result = await callAI(provider, systemPrompt, "Refine the section as instructed. Return only JSON.");

    const updatedSection = extractJSON(result.text);
    if (!updatedSection) {
      return res.status(422).json({ error: "AI did not return valid JSON for the refined section." });
    }

    try {
      const db = getDb();
      db.prepare("INSERT INTO ai_usage (user_id, provider, tokens_in, tokens_out, request_type) VALUES (?,?,?,?,?)")
        .run(req.user.id, provider || "gemini", result.tokensIn || 0, result.tokensOut || 0, "refine");
    } catch (e) {}

    res.json({ updatedSection, provider: provider || "gemini" });
  } catch (err) {
    console.error("AI refine error:", err);
    res.status(500).json({ error: "AI refinement failed: " + err.message });
  }
});

// GET /providers
router.get("/providers", requireAuth, (req, res) => {
  res.json({ providers: getAvailableProviders() });
});

export default router;
