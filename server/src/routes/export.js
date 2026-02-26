import { Router } from "express";
import { createHash } from "crypto";
import { requireAuth } from "../middleware/auth.js";
import { buildStandaloneHTML } from "../services/htmlBuilder.js";

const router = Router();

router.post("/html", requireAuth, (req, res) => {
  try {
    const { reportData, brandColor, title } = req.body;
    if (!reportData) return res.status(400).json({ error: "reportData is required" });
    res.json({ html: buildStandaloneHTML(reportData, brandColor, title) });
  } catch (err) {
    console.error("HTML export error:", err);
    res.status(500).json({ error: "HTML export failed" });
  }
});

router.post("/pdf", requireAuth, (req, res) => {
  // PDF generation is handled client-side via browser print
  res.status(501).json({ error: "PDF export is available via browser Print (Ctrl+P) in the preview page." });
});

router.post("/netlify", requireAuth, async (req, res) => {
  try {
    const { html, siteName, netlifyToken } = req.body;
    if (!html || !netlifyToken) return res.status(400).json({ error: "html and netlifyToken required" });
    const slug = (siteName || "calo-report-" + Date.now()).toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 60);
    const sha1 = createHash("sha1").update(html).digest("hex");
    const hdrs = { "Authorization": "Bearer " + netlifyToken, "Content-Type": "application/json" };

    const siteRes = await fetch("https://api.netlify.com/api/v1/sites", { method: "POST", headers: hdrs, body: JSON.stringify({ name: slug }) });
    const site = await siteRes.json();
    const siteId = site.id || site.site_id;

    const deployRes = await fetch("https://api.netlify.com/api/v1/sites/" + siteId + "/deploys", { method: "POST", headers: hdrs, body: JSON.stringify({ files: { "/index.html": sha1 } }) });
    const deploy = await deployRes.json();

    await fetch("https://api.netlify.com/api/v1/deploys/" + deploy.id + "/files/index.html", {
      method: "PUT",
      headers: { "Authorization": "Bearer " + netlifyToken, "Content-Type": "application/octet-stream" },
      body: html
    });

    res.json({ url: "https://" + slug + ".netlify.app", siteId, deployId: deploy.id });
  } catch (err) {
    console.error("Netlify error:", err);
    res.status(500).json({ error: "Netlify deploy failed: " + err.message });
  }
});

export default router;
