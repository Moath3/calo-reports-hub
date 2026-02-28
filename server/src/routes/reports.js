import { Router } from "express";
import { v4 as uuid } from "uuid";
import { getDb } from "../db/database.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// GET / - List reports (own or shared)
router.get("/", requireAuth, (req, res) => {
  try {
    const db = getDb();
    const { page = 1, limit = 20, status, search, visibility } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = [];

    let where;
    let selectCols = "r.id, r.title, r.description, r.status, r.source_filename, r.ai_provider, r.tags, r.netlify_url, r.visibility, r.created_at, r.updated_at";

    if (visibility === "shared") {
      // Show reports shared by OTHER users
      where = "WHERE r.visibility = 'shared' AND r.user_id != ?";
      params.push(req.user.id);
      selectCols += ", u.name as author_name";
    } else {
      // Default: user's own reports
      where = "WHERE r.user_id = ?";
      params.push(req.user.id);
    }

    if (status && status !== "all") {
      where += " AND r.status = ?";
      params.push(status);
    }
    if (search) {
      where += " AND (r.title LIKE ? OR r.description LIKE ?)";
      params.push("%" + search + "%", "%" + search + "%");
    }

    const total = db.prepare("SELECT COUNT(*) as count FROM reports r JOIN users u ON r.user_id = u.id " + where).get(...params).count;
    params.push(parseInt(limit), offset);
    const reports = db.prepare(
      "SELECT " + selectCols + " FROM reports r JOIN users u ON r.user_id = u.id " +
      where + " ORDER BY r.updated_at DESC LIMIT ? OFFSET ?"
    ).all(...params);

    res.json({ reports, total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    console.error("List reports error:", err);
    res.status(500).json({ error: "Failed to fetch reports" });
  }
});

// GET /shared/all - Published reports (legacy, kept for compatibility)
router.get("/shared/all", requireAuth, (req, res) => {
  try {
    const db = getDb();
    const reports = db.prepare(
      "SELECT r.id, r.title, r.description, r.status, r.ai_provider, r.tags, r.netlify_url, r.visibility, r.created_at, r.updated_at, u.name as author_name " +
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

    // Access: owner, admin, or shared report viewable by any authenticated user
    const isOwner = report.user_id === req.user.id;
    const isAdmin = req.user.role === "admin";
    const isShared = report.visibility === "shared";
    if (!isOwner && !isAdmin && !isShared) {
      return res.status(403).json({ error: "Access denied" });
    }

    report.report_data = JSON.parse(report.report_data || "{}");
    report.source_data = report.source_data ? JSON.parse(report.source_data) : null;
    report.tags = JSON.parse(report.tags || "[]");
    report.is_owner = isOwner;
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

    const { title, description, reportData, reportHtml, status, tags, netlifyUrl, visibility } = req.body;
    db.prepare(
      "UPDATE reports SET title=COALESCE(?,title), description=COALESCE(?,description), report_data=COALESCE(?,report_data), report_html=COALESCE(?,report_html), status=COALESCE(?,status), tags=COALESCE(?,tags), netlify_url=COALESCE(?,netlify_url), visibility=COALESCE(?,visibility), updated_at=CURRENT_TIMESTAMP WHERE id=?"
    ).run(
      title || null, description || null,
      reportData ? JSON.stringify(reportData) : null,
      reportHtml || null, status || null,
      tags ? JSON.stringify(tags) : null,
      netlifyUrl || null, visibility || null, req.params.id
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

// PATCH /:id/visibility — Toggle between private and shared
router.patch("/:id/visibility", requireAuth, (req, res) => {
  try {
    const { visibility } = req.body;
    if (!["private", "shared"].includes(visibility)) return res.status(400).json({ error: "Invalid visibility. Use 'private' or 'shared'." });

    const db = getDb();
    const report = db.prepare("SELECT user_id FROM reports WHERE id = ?").get(req.params.id);
    if (!report) return res.status(404).json({ error: "Report not found" });
    if (report.user_id !== req.user.id) return res.status(403).json({ error: "Only the report owner can change visibility" });

    db.prepare("UPDATE reports SET visibility = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(visibility, req.params.id);
    res.json({ message: "Visibility updated to " + visibility, visibility });
  } catch (err) {
    res.status(500).json({ error: "Failed to update visibility" });
  }
});

export default router;
