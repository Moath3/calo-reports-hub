// Read-only data assistant: turn a question into a Zelt query plan, run it, return
// the real rows (salary scrubbed for non-admins by runReport). Also appends a result
// to a Google Sheet the service account can edit. No writes to Zelt.
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { planQuery, runPlan } from "../services/assistantService.js";
import { appendToSheet } from "../services/googleSheets.js";

const router = Router();

router.post("/query", requireAuth, asyncHandler(async (req, res) => {
  const isAdmin = req.user?.role === "admin";
  const { question = "", history = [], plan: given } = req.body || {};
  try {
    const plan = given && typeof given === "object" && "dataset" in given ? given : await planQuery(question, history, isAdmin);
    if (!plan.dataset) {
      return res.json({ ok: true, interpreted: plan, reply: plan.reply || "I pull live Zelt people data — ask for a roster list, a headcount, a breakdown (\"by business line\"), leave balances, or turnover." });
    }
    const data = await runPlan(plan, isAdmin);
    res.json({ ok: true, interpreted: plan, ...data });
  } catch (e) {
    if (e.code === "INDEX_BUILDING") return res.status(503).json({ error: e.message, building: true });
    if (e.code === "NO_AI") return res.status(501).json({ error: e.message });
    if (e.code === "NO_PLAN" || e.code === "NO_DATASET") return res.status(422).json({ error: e.message });
    throw e;
  }
}));

router.post("/sheet-append", requireAuth, asyncHandler(async (req, res) => {
  const { sheetUrl, columns = [], rows = [] } = req.body || {};
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: "Nothing to append." });
  const header = columns.map((c) => c.label || c.key || String(c));
  const matrix = [header, ...rows.map((r) => columns.map((c) => {
    const v = r[c.key ?? c];
    return v == null ? "" : String(v);
  }))];
  try {
    const out = await appendToSheet(sheetUrl, matrix);
    res.json({ ok: true, ...out });
  } catch (e) {
    if (["NO_GOOGLE", "BAD_SHEET", "SHEET_WRITE"].includes(e.code)) return res.status(400).json({ error: e.message });
    throw e;
  }
}));

export default router;
