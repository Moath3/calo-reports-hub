import { Router } from "express";
import { createHash } from "crypto";
import { requireAuth } from "../middleware/auth.js";
import { buildStandaloneHTML } from "../services/htmlBuilder.js";

const router = Router();

// HTML export — supports optional password protection
router.post("/html", requireAuth, (req, res) => {
  try {
    const { reportData, brandColor, title, password } = req.body;
    if (!reportData) return res.status(400).json({ error: "reportData is required" });
    const options = password ? { password } : {};
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

// Netlify publish — always password-protected for confidentiality
router.post("/netlify", requireAuth, async (req, res) => {
  try {
    const { html, siteName, netlifyToken } = req.body;
    const token = netlifyToken || process.env.NETLIFY_ACCESS_TOKEN;
    if (!html) return res.status(400).json({ error: "html is required" });
    if (!token) return res.status(400).json({ error: "Netlify token not configured. Set NETLIFY_ACCESS_TOKEN in server environment." });
    const slug = (siteName || "calo-report-" + Date.now()).toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 60);
    const sha1 = createHash("sha1").update(html).digest("hex");
    const hdrs = { "Authorization": "Bearer " + token, "Content-Type": "application/json" };

    const siteRes = await fetch("https://api.netlify.com/api/v1/sites", { method: "POST", headers: hdrs, body: JSON.stringify({ name: slug }) });
    if (!siteRes.ok) {
      const err = await siteRes.json().catch(() => ({}));
      throw new Error("Netlify site creation failed: " + (err.message || err.error || siteRes.statusText));
    }
    const site = await siteRes.json();
    const siteId = site.id || site.site_id;

    const deployRes = await fetch("https://api.netlify.com/api/v1/sites/" + siteId + "/deploys", { method: "POST", headers: hdrs, body: JSON.stringify({ files: { "/index.html": sha1 } }) });
    if (!deployRes.ok) {
      const err = await deployRes.json().catch(() => ({}));
      throw new Error("Netlify deploy creation failed: " + (err.message || err.error || deployRes.statusText));
    }
    const deploy = await deployRes.json();

    const uploadRes = await fetch("https://api.netlify.com/api/v1/deploys/" + deploy.id + "/files/index.html", {
      method: "PUT",
      headers: { "Authorization": "Bearer " + token, "Content-Type": "application/octet-stream" },
      body: html
    });
    if (!uploadRes.ok) {
      throw new Error("Netlify file upload failed: " + uploadRes.statusText);
    }

    res.json({ url: "https://" + slug + ".netlify.app", siteId, deployId: deploy.id });
  } catch (err) {
    console.error("Netlify error:", err);
    res.status(500).json({ error: "Netlify deploy failed: " + err.message });
  }
});

export default router;
