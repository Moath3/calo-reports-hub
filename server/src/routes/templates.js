import { Router } from "express";
import { v4 as uuid } from "uuid";
import { getDb } from "../db/database.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// GET /categories
router.get("/categories", requireAuth, (req, res) => {
  try {
    const db = getDb();
    const cats = db.prepare("SELECT DISTINCT category FROM templates ORDER BY category").all();
    res.json({ categories: cats.map(c => c.category) });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch categories" });
  }
});

// GET /
router.get("/", requireAuth, (req, res) => {
  try {
    const db = getDb();
    const { category, mine } = req.query;
    let sql = "SELECT t.*, u.name as author_name FROM templates t LEFT JOIN users u ON t.user_id = u.id WHERE ";
    const params = [];

    if (mine === "true") {
      sql += "t.user_id = ?";
      params.push(req.user.id);
    } else {
      sql += "(t.is_shared = 1 OR t.user_id = ?)";
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
  } catch (err) {
    console.error("List templates error:", err);
    res.status(500).json({ error: "Failed to fetch templates" });
  }
});

// GET /:id
router.get("/:id", requireAuth, (req, res) => {
  try {
    const db = getDb();
    const t = db.prepare("SELECT t.*, u.name as author_name FROM templates t LEFT JOIN users u ON t.user_id = u.id WHERE t.id = ?").get(req.params.id);
    if (!t) return res.status(404).json({ error: "Template not found" });
    t.template_data = JSON.parse(t.template_data || "{}");
    res.json({ template: t });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch template" });
  }
});

// POST /
router.post("/", requireAuth, (req, res) => {
  try {
    const { name, description, category, templateData, isShared } = req.body;
    if (!name || !templateData) return res.status(400).json({ error: "Name and templateData required" });

    const db = getDb();
    const id = uuid();
    db.prepare(
      "INSERT INTO templates (id, user_id, name, description, category, template_data, is_shared) VALUES (?,?,?,?,?,?,?)"
    ).run(id, req.user.id, name, description || "", category || "general", JSON.stringify(templateData), isShared !== false ? 1 : 0);

    res.status(201).json({ id, message: "Template created" });
  } catch (err) {
    console.error("Create template error:", err);
    res.status(500).json({ error: "Failed to create template" });
  }
});

// PUT /:id
router.put("/:id", requireAuth, (req, res) => {
  try {
    const db = getDb();
    const t = db.prepare("SELECT user_id FROM templates WHERE id = ?").get(req.params.id);
    if (!t) return res.status(404).json({ error: "Template not found" });
    if (t.user_id !== req.user.id) return res.status(403).json({ error: "Access denied" });

    const { name, description, category, templateData, isShared } = req.body;
    db.prepare(
      "UPDATE templates SET name=COALESCE(?,name), description=COALESCE(?,description), category=COALESCE(?,category), template_data=COALESCE(?,template_data), is_shared=COALESCE(?,is_shared), updated_at=CURRENT_TIMESTAMP WHERE id=?"
    ).run(name||null, description||null, category||null, templateData?JSON.stringify(templateData):null, isShared!=null?(isShared?1:0):null, req.params.id);
    res.json({ message: "Template updated" });
  } catch (err) {
    res.status(500).json({ error: "Failed to update template" });
  }
});

// DELETE /:id
router.delete("/:id", requireAuth, (req, res) => {
  try {
    const db = getDb();
    const t = db.prepare("SELECT user_id FROM templates WHERE id = ?").get(req.params.id);
    if (!t) return res.status(404).json({ error: "Template not found" });
    if (t.user_id !== req.user.id && req.user.role !== "admin") return res.status(403).json({ error: "Access denied" });

    db.prepare("DELETE FROM templates WHERE id = ?").run(req.params.id);
    res.json({ message: "Template deleted" });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete template" });
  }
});

// POST /:id/use
router.post("/:id/use", requireAuth, (req, res) => {
  try {
    const db = getDb();
    const t = db.prepare("SELECT * FROM templates WHERE id = ?").get(req.params.id);
    if (!t) return res.status(404).json({ error: "Template not found" });

    db.prepare("UPDATE templates SET usage_count = usage_count + 1 WHERE id = ?").run(req.params.id);
    t.template_data = JSON.parse(t.template_data || "{}");
    res.json({ template: t });
  } catch (err) {
    res.status(500).json({ error: "Failed to use template" });
  }
});

export default router;
