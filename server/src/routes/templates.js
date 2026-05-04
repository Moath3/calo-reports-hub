import { Router } from "express";
import { v4 as uuid } from "uuid";
import { getDb } from "../db/database.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { badRequest, forbidden, notFound } from "../utils/httpError.js";

const router = Router();

// GET /categories
router.get("/categories", requireAuth, asyncHandler((req, res) => {
  const cats = getDb().prepare("SELECT DISTINCT category FROM templates ORDER BY category").all();
  res.json({ categories: cats.map(c => c.category) });
}));

// GET /
router.get("/", requireAuth, asyncHandler((req, res) => {
  const db = getDb();
  const { category, mine } = req.query;
  let sql = "SELECT t.*, u.name as author_name FROM templates t LEFT JOIN users u ON t.user_id = u.id WHERE ";
  const params = [];

  if (mine === "true") {
    sql += "t.user_id = ?";
    params.push(req.user.id);
  } else {
    sql += "(t.is_shared = 1 OR t.is_default = 1 OR t.user_id = ?)";
    params.push(req.user.id);
  }
  if (category) {
    sql += " AND t.category = ?";
    params.push(category);
  }
  sql += " ORDER BY t.usage_count DESC, t.created_at DESC";

  const templates = db.prepare(sql).all(...params);
  templates.forEach(t => { t.template_data = JSON.parse(t.template_data || "{}"); });
  res.json({ templates });
}));

// GET /:id
router.get("/:id", requireAuth, asyncHandler((req, res) => {
  const t = getDb().prepare("SELECT t.*, u.name as author_name FROM templates t LEFT JOIN users u ON t.user_id = u.id WHERE t.id = ?").get(req.params.id);
  if (!t) throw notFound("Template not found");
  t.template_data = JSON.parse(t.template_data || "{}");
  res.json({ template: t });
}));

// POST /
router.post("/", requireAuth, asyncHandler((req, res) => {
  const { name, description, category, templateData, isShared } = req.body;
  if (!name || !templateData) throw badRequest("Name and templateData required");

  const id = uuid();
  getDb().prepare(
    "INSERT INTO templates (id, user_id, name, description, category, template_data, is_shared) VALUES (?,?,?,?,?,?,?)"
  ).run(id, req.user.id, name, description || "", category || "general", JSON.stringify(templateData), isShared !== false ? 1 : 0);

  res.status(201).json({ id, message: "Template created" });
}));

// PUT /:id
router.put("/:id", requireAuth, asyncHandler((req, res) => {
  const db = getDb();
  const t = db.prepare("SELECT user_id FROM templates WHERE id = ?").get(req.params.id);
  if (!t) throw notFound("Template not found");
  if (t.user_id !== req.user.id) throw forbidden("Access denied");

  const { name, description, category, templateData, isShared } = req.body;
  db.prepare(
    "UPDATE templates SET name=COALESCE(?,name), description=COALESCE(?,description), category=COALESCE(?,category), template_data=COALESCE(?,template_data), is_shared=COALESCE(?,is_shared), updated_at=CURRENT_TIMESTAMP WHERE id=?"
  ).run(name||null, description||null, category||null, templateData?JSON.stringify(templateData):null, isShared!=null?(isShared?1:0):null, req.params.id);
  res.json({ message: "Template updated" });
}));

// DELETE /:id
router.delete("/:id", requireAuth, asyncHandler((req, res) => {
  const db = getDb();
  const t = db.prepare("SELECT user_id, is_default FROM templates WHERE id = ?").get(req.params.id);
  if (!t) throw notFound("Template not found");
  if (t.is_default && req.user.role !== "admin") throw forbidden("Cannot delete default templates");
  if (t.user_id && t.user_id !== req.user.id && req.user.role !== "admin") throw forbidden("Access denied");

  db.prepare("DELETE FROM templates WHERE id = ?").run(req.params.id);
  res.json({ message: "Template deleted" });
}));

// POST /:id/use
router.post("/:id/use", requireAuth, asyncHandler((req, res) => {
  const db = getDb();
  const t = db.prepare("SELECT * FROM templates WHERE id = ?").get(req.params.id);
  if (!t) throw notFound("Template not found");

  db.prepare("UPDATE templates SET usage_count = usage_count + 1 WHERE id = ?").run(req.params.id);
  t.template_data = JSON.parse(t.template_data || "{}");
  res.json({ template: t });
}));

export default router;
