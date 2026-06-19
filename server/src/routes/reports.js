import { Router } from "express";
import { v4 as uuid } from "uuid";
import { getDb } from "../db/database.js";
import { requireAuth } from "../middleware/auth.js";
import { loadReport, requireReportOwner } from "../middleware/reportAccess.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { badRequest, forbidden, notFound } from "../utils/httpError.js";

const router = Router();

// Multi-path read access: owner, admin, team-shared, or specific-shared.
function canViewReport(report, user, sharedWith) {
  const isOwner = report.user_id === user.id;
  const isAdmin = user.role === "admin";
  const isTeamShared = report.visibility === "shared";
  const isSpecificShare = report.visibility === "specific" && sharedWith.includes(user.id);
  return isOwner || isAdmin || isTeamShared || isSpecificShare;
}

// GET / - List reports (own or shared)
router.get("/", requireAuth, asyncHandler((req, res) => {
  const db = getDb();
  const { page = 1, limit = 20, status, search, visibility } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const params = [];

  let where;
  let selectCols = "r.id, r.title, r.description, r.status, r.source_filename, r.ai_provider, r.tags, r.netlify_url, r.visibility, r.shared_with, r.created_at, r.updated_at";

  if (visibility === "shared") {
    // Show reports shared with this user: team-wide OR specifically shared with them
    const userIdPattern = '%"' + req.user.id + '"%';
    where = "WHERE (r.visibility = 'shared' OR (r.visibility = 'specific' AND r.shared_with LIKE ?)) AND r.user_id != ?";
    params.push(userIdPattern);
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
}));

// GET /shared/all - Published reports (legacy, kept for compatibility)
router.get("/shared/all", requireAuth, asyncHandler((req, res) => {
  const db = getDb();
  const reports = db.prepare(
    "SELECT r.id, r.title, r.description, r.status, r.ai_provider, r.tags, r.netlify_url, r.visibility, r.created_at, r.updated_at, u.name as author_name " +
    "FROM reports r JOIN users u ON r.user_id = u.id WHERE r.status = ? ORDER BY r.updated_at DESC LIMIT 50"
  ).all("published");
  res.json({ reports });
}));

// GET /:id — multi-path access (owner, admin, team-shared, specific-shared)
router.get("/:id", requireAuth, loadReport({ full: true }), asyncHandler((req, res) => {
  const report = req.report;
  const sharedWith = JSON.parse(report.shared_with || "[]");
  const isOwner = report.user_id === req.user.id;
  if (!canViewReport(report, req.user, sharedWith)) {
    throw forbidden("Access denied");
  }

  report.report_data = JSON.parse(report.report_data || "{}");
  report.source_data = report.source_data ? JSON.parse(report.source_data) : null;
  report.tags = JSON.parse(report.tags || "[]");
  report.shared_with = sharedWith;
  report.is_owner = isOwner;
  res.json({ report });
}));

// POST / - Create
router.post("/", requireAuth, asyncHandler((req, res) => {
  const { title, description, reportData, reportHtml, sourceFilename, sourceData, aiProvider, tags } = req.body;
  if (!title || !reportData) throw badRequest("Title and reportData required");

  const db = getDb();
  const id = uuid();
  db.prepare(
    "INSERT INTO reports (id, user_id, title, description, report_data, report_html, source_filename, source_data, ai_provider, tags) VALUES (?,?,?,?,?,?,?,?,?,?)"
  ).run(id, req.user.id, title, description || "", JSON.stringify(reportData), reportHtml || "", sourceFilename || "", sourceData ? JSON.stringify(sourceData) : null, aiProvider || "", JSON.stringify(tags || []));

  res.status(201).json({ id, message: "Report created" });
}));

// PUT /:id
router.put("/:id", requireAuth, loadReport(), requireReportOwner(), asyncHandler((req, res) => {
  const { title, description, reportData, reportHtml, status, tags, netlifyUrl, visibility, sharedWith } = req.body;
  getDb().prepare(
    "UPDATE reports SET title=COALESCE(?,title), description=COALESCE(?,description), report_data=COALESCE(?,report_data), report_html=COALESCE(?,report_html), status=COALESCE(?,status), tags=COALESCE(?,tags), netlify_url=COALESCE(?,netlify_url), visibility=COALESCE(?,visibility), shared_with=COALESCE(?,shared_with), updated_at=CURRENT_TIMESTAMP WHERE id=?"
  ).run(
    title || null, description || null,
    reportData ? JSON.stringify(reportData) : null,
    reportHtml || null, status || null,
    tags ? JSON.stringify(tags) : null,
    netlifyUrl || null, visibility || null,
    sharedWith ? JSON.stringify(sharedWith) : null, req.params.id
  );
  res.json({ message: "Report updated" });
}));

// DELETE /:id — owner or admin
router.delete("/:id", requireAuth, loadReport(), requireReportOwner({ adminOk: true }), asyncHandler((req, res) => {
  getDb().prepare("DELETE FROM reports WHERE id = ?").run(req.params.id);
  res.json({ message: "Report deleted" });
}));

// PATCH /:id/status
router.patch("/:id/status", requireAuth, loadReport(), requireReportOwner(), asyncHandler((req, res) => {
  const { status } = req.body;
  if (!["draft", "done", "published", "archived"].includes(status)) throw badRequest("Invalid status");

  getDb().prepare("UPDATE reports SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(status, req.params.id);
  res.json({ message: "Status updated to " + status });
}));

// PATCH /:id/share — Update sharing settings (visibility + specific users)
router.patch("/:id/share", requireAuth, loadReport(), requireReportOwner({ message: "Only the report owner can change sharing" }), asyncHandler((req, res) => {
  const { visibility, sharedWith } = req.body;
  if (!["private", "shared", "specific"].includes(visibility)) {
    throw badRequest("Invalid visibility. Use 'private', 'shared', or 'specific'.");
  }

  const db = getDb();

  // For specific sharing, validate user IDs
  let sharedWithArray = [];
  if (visibility === "specific" && Array.isArray(sharedWith) && sharedWith.length > 0) {
    for (const uid of sharedWith) {
      const user = db.prepare("SELECT id FROM users WHERE id = ? AND is_active = 1").get(uid);
      if (user) sharedWithArray.push(uid);
    }
  }

  db.prepare(
    "UPDATE reports SET visibility = ?, shared_with = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(visibility, JSON.stringify(sharedWithArray), req.params.id);

  res.json({ message: "Sharing updated", visibility, sharedWith: sharedWithArray });
}));

// PATCH /:id/visibility — Legacy toggle (kept for compatibility)
router.patch("/:id/visibility", requireAuth, loadReport(), requireReportOwner({ message: "Only the report owner can change visibility" }), asyncHandler((req, res) => {
  const { visibility } = req.body;
  if (!["private", "shared"].includes(visibility)) throw badRequest("Invalid visibility. Use 'private' or 'shared'.");

  getDb().prepare("UPDATE reports SET visibility = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(visibility, req.params.id);
  res.json({ message: "Visibility updated to " + visibility, visibility });
}));

export default router;
