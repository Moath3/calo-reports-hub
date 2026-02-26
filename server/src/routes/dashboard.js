import { Router } from "express";
import { getDb } from "../db/database.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.get("/stats", requireAuth, (req, res) => {
  try {
    const db = getDb();
    const uid = req.user.id;

    const totalReports = db.prepare("SELECT COUNT(*) as c FROM reports WHERE user_id = ?").get(uid).c;
    const draftReports = db.prepare("SELECT COUNT(*) as c FROM reports WHERE user_id = ? AND status = ?").get(uid, "draft").c;
    const publishedReports = db.prepare("SELECT COUNT(*) as c FROM reports WHERE user_id = ? AND status = ?").get(uid, "published").c;
    const totalTemplates = db.prepare("SELECT COUNT(*) as c FROM templates WHERE user_id = ?").get(uid).c;
    const recentReports = db.prepare("SELECT id, title, status, updated_at FROM reports WHERE user_id = ? ORDER BY updated_at DESC LIMIT 5").all(uid);

    const aiTotal = db.prepare("SELECT COUNT(*) as c FROM ai_usage WHERE user_id = ?").get(uid).c;
    const aiByProvider = db.prepare("SELECT provider, COUNT(*) as c FROM ai_usage WHERE user_id = ? GROUP BY provider").all(uid);
    const providerMap = {};
    aiByProvider.forEach(r => { providerMap[r.provider] = r.c; });

    const stats = {
      totalReports, draftReports, publishedReports, totalTemplates,
      recentReports,
      aiUsage: { total: aiTotal, byProvider: providerMap }
    };

    if (req.user.role === "admin") {
      stats.totalUsers = db.prepare("SELECT COUNT(*) as c FROM users").get().c;
      stats.activeUsers = db.prepare("SELECT COUNT(*) as c FROM users WHERE is_active = 1").get().c;
      stats.companyReports = db.prepare("SELECT COUNT(*) as c FROM reports").get().c;
      stats.companyAiUsage = db.prepare("SELECT COUNT(*) as c FROM ai_usage").get().c;
    }

    res.json(stats);
  } catch (err) {
    console.error("Dashboard stats error:", err);
    res.status(500).json({ error: "Failed to fetch dashboard stats" });
  }
});

export default router;
