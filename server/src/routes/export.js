import { Router } from "express";
import { createHash } from "crypto";
import { requireAuth } from "../middleware/auth.js";
import { buildStandaloneHTML } from "../services/htmlBuilder.js";
import { getDb } from "../db/database.js";

const router = Router();

// HTML export — supports optional password protection + variant
router.post("/html", requireAuth, (req, res) => {
  try {
    const { reportData, brandColor, title, password, variant } = req.body;
    if (!reportData) return res.status(400).json({ error: "reportData is required" });
    const options = {};
    if (password) options.password = password;
    if (variant) options.variant = variant;
    res.json({ html: buildStandaloneHTML(reportData, brandColor, title, options) });
  } catch (err) {
    console.error("HTML export error:", err);
    res.status(500).json({ error: "HTML export failed" });
  }
});

// PDF generation is handled client-side via browser print
router.post("/pdf", requireAuth, (req, res) => {
  res.status(501).json({ error: "PDF export is available via browser Print (Ctrl+P) in the preview page." });
});

// Netlify publish — reuses existing site on republish, creates new site only on first publish
router.post("/netlify", requireAuth, async (req, res) => {
  try {
    const { html, siteName, reportId } = req.body;
    const token = process.env.NETLIFY_ACCESS_TOKEN;
    if (!html) return res.status(400).json({ error: "html is required" });
    if (!token) return res.status(400).json({ error: "Netlify token not configured. Set NETLIFY_ACCESS_TOKEN in server environment." });

    const sha1 = createHash("sha1").update(html).digest("hex");
    const hdrs = { "Authorization": "Bearer " + token, "Content-Type": "application/json" };

    // Check if this report already has a Netlify site
    let siteId = null;
    let siteUrl = null;
    if (reportId) {
      const db = getDb();
      const row = db.prepare("SELECT netlify_site_id, netlify_url FROM reports WHERE id = ?").get(reportId);
      if (row?.netlify_site_id) {
        // Verify the site still exists on Netlify
        const checkRes = await fetch("https://api.netlify.com/api/v1/sites/" + row.netlify_site_id, { headers: hdrs });
        if (checkRes.ok) {
          siteId = row.netlify_site_id;
          siteUrl = row.netlify_url;
        }
        // If site was deleted on Netlify, fall through to create a new one
      }
    }

    // Create a new site if needed
    if (!siteId) {
      const ts = Date.now().toString(36);
      const slug = ((siteName || "calo-report") + "-" + ts).toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 60);
      const siteRes = await fetch("https://api.netlify.com/api/v1/sites", {
        method: "POST", headers: hdrs, body: JSON.stringify({ name: slug })
      });
      if (!siteRes.ok) {
        const err = await siteRes.json().catch(() => ({}));
        throw new Error("Netlify site creation failed: " + (err.message || err.error || siteRes.statusText));
      }
      const site = await siteRes.json();
      siteId = site.id || site.site_id;
      siteUrl = "https://" + slug + ".netlify.app";
    }

    // Deploy to the site
    const deployRes = await fetch("https://api.netlify.com/api/v1/sites/" + siteId + "/deploys", {
      method: "POST", headers: hdrs, body: JSON.stringify({ files: { "/index.html": sha1 } })
    });
    if (!deployRes.ok) {
      const err = await deployRes.json().catch(() => ({}));
      throw new Error("Netlify deploy failed: " + (err.message || err.error || deployRes.statusText));
    }
    const deploy = await deployRes.json();

    // Upload the HTML file
    const uploadRes = await fetch("https://api.netlify.com/api/v1/deploys/" + deploy.id + "/files/index.html", {
      method: "PUT",
      headers: { "Authorization": "Bearer " + token, "Content-Type": "application/octet-stream" },
      body: html
    });
    if (!uploadRes.ok) {
      throw new Error("Netlify file upload failed: " + uploadRes.statusText);
    }

    // Store the site ID on the report for future reuse
    if (reportId) {
      const db = getDb();
      db.prepare("UPDATE reports SET netlify_site_id = ?, netlify_url = ?, status = 'published', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(siteId, siteUrl, reportId);
    }

    res.json({ url: siteUrl, siteId, deployId: deploy.id });
  } catch (err) {
    console.error("Netlify error:", err);
    res.status(500).json({ error: "Netlify deploy failed: " + err.message });
  }
});

export default router;
