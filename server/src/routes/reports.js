import { Router } from "express";
import { v4 as uuid } from "uuid";
import { getDb } from "../db/database.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// GET / - List reports
router.get("/", requireAuth, (req, res) => {
  try {
    const db = getDb();
    const { page = 1, limit = 20, status, search } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = "WHERE r.user_id = ?";
    const params = [req.user.id];

    if (status && status !== "all") {
      where += " AND r.status = ?";
      params.push(status);
    }
    if (search) {
      where += " AND (r.title LIKE ? OR r.description LIKE ?)";
      params.push("%" + search + "%", "%" + search + "%");
    }

    const total = db.prepare("SELECT COUNT(*) as count FROM reports r " + where).get(...params).count;
    params.push(parseInt(limit), offset);
    const reports = db.prepare(
      "SELECT r.id, r.title, r.description, r.status, r.source_filename, r.ai_provider, r.tags, r.netlify_url, r.created_at, r.updated_at FROM reports r " +
      where + " ORDER BY r.updated_at DESC LIMIT ? OFFSET ?"
    ).all(...params);

    res.json({ reports, total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    console.error("List reports error:", err);
    res.status(500).json({ error: "Failed to fetch reports" });
  }
});

// GET /shared/all - Published reports
router.get("/shared/all", requireAuth, (req, res) => {
  try {
    const db = getDb();
    const reports = db.prepare(
      "SELECT r.id, r.title, r.description, r.status, r.ai_provider, r.tags, r.netlify_url, r.created_at, r.updated_at, u.name as author_name " +
      "FROM reports r JOIN users u ON r.user_id = u.id WHERE r.status = ? ORDER BY r.updated_at DESC LIMIT 50"
    ).all("published");
    res.json({ reports });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch published reports" });
  }
});

// GET /:id
router.get("/:id", requireAuth, (req, res) => {
  try {
    const db = getDb();
    const report = db.prepare(
      "SELECT r.*, u.name as author_name FROM reports r JOIN users u ON r.user_id = u.id WHERE r.id = ?"
    ).get(req.params.id);
    if (!report) return res.status(404).json({ error: "Report not found" });
    if (report.user_id !== req.user.id && req.user.role !== "admin") {
      return res.status(403).json({ error: "Access denied" });
    }
    report.report_data = JSON.parse(report.report_data || "{}");
    report.source_data = report.source_data ? JSON.parse(report.source_data) : null;
    report.tags = JSON.parse(report.tags || "[]");
    res.json({ report });
  } catch (err) {
    console.error("Get report error:", err);
    res.status(500).json({ error: "Failed to fetch report" });
  }
});

// POST / - Create
router.post("/", requireAuth, (req, res) => {
  try {
    const { title, description, reportData, reportHtml, sourceFilename, sourceData, aiProvider, tags } = req.body;
    if (!title || !reportData) return res.status(400).json({ error: "Title and reportData required" });

    const db = getDb();
    const id = uuid();
    db.prepare(
      "INSERT INTO reports (id, user_id, title, description, report_data, report_html, source_filename, source_data, ai_provider, tags) VALUES (?,?,?,?,?,?,?,?,?,?)"
    ).run(id, req.user.id, title, description || "", JSON.stringify(reportData), reportHtml || "", sourceFilename || "", sourceData ? JSON.stringify(sourceData) : null, aiProvider || "", JSON.stringify(tags || []));

    res.status(201).json({ id, message: "Report created" });
  } catch (err) {
    console.error("Create report error:", err);
    res.status(500).json({ error: "Failed to create report" });
  }
});

// PUT /:id
router.put("/:id", requireAuth, (req, res) => {
  try {
    const db = getDb();
    const report = db.prepare("SELECT user_id FROM reports WHERE id = ?").get(req.params.id);
    if (!report) return res.status(404).json({ error: "Report not found" });
    if (report.user_id !== req.user.id) return res.status(403).json({ error: "Access denied" });

    const { title, description, reportData, reportHtml, status, tags, netlifyUrl } = req.body;
    db.prepare(
      "UPDATE reports SET title=COALESCE(?,title), description=COALESCE(?,description), report_data=COALESCE(?,report_data), report_html=COALESCE(?,report_html), status=COALESCE(?,status), tags=COALESCE(?,tags), netlify_url=COALESCE(?,netlify_url), updated_at=CURRENT_TIMESTAMP WHERE id=?"
    ).run(
      title || null, description || null,
      reportData ? JSON.stringify(reportData) : null,
      reportHtml || null, status || null,
      tags ? JSON.stringify(tags) : null,
      netlifyUrl || null, req.params.id
    );
    res.json({ message: "Report updated" });
  } catch (err) {
    console.error("Update report error:", err);
    res.status(500).json({ error: "Failed to update report" });
  }
});

// DELETE /:id
router.delete("/:id", requireAuth, (req, res) => {
  try {
    const db = getDb();
    const report = db.prepare("SELECT user_id FROM reports WHERE id = ?").get(req.params.id);
    if (!report) return res.status(404).json({ error: "Report not found" });
    if (report.user_id !== req.user.id && req.user.role !== "admin") return res.status(403).json({ error: "Access denied" });

    db.prepare("DELETE FROM reports WHERE id = ?").run(req.params.id);
    res.json({ message: "Report deleted" });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete report" });
  }
});

// PATCH /:id/status
router.patch("/:id/status", requireAuth, (req, res) => {
  try {
    const { status } = req.body;
    if (!["draft", "published", "archived"].includes(status)) return res.status(400).json({ error: "Invalid status" });

    const db = getDb();
    const report = db.prepare("SELECT user_id FROM reports WHERE id = ?").get(req.params.id);
    if (!report) return res.status(404).json({ error: "Report not found" });
    if (report.user_id !== req.user.id) return res.status(403).json({ error: "Access denied" });

    db.prepare("UPDATE reports SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(status, req.params.id);
    res.json({ message: "Status updated to " + status });
  } catch (err) {
    res.status(500).json({ error: "Failed to update status" });
  }
});

export default router;
