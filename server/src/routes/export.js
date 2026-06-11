import { Router } from "express";
import { createHash } from "crypto";
import { requireAuth } from "../middleware/auth.js";
import { buildStandaloneHTML } from "../services/htmlBuilder.js";
import { getDb } from "../db/database.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError, badRequest, notFound, forbidden } from "../utils/httpError.js";

const router = Router();

// HTML export — supports optional password protection + full tweak options
router.post("/html", requireAuth, asyncHandler((req, res) => {
  const { reportData, brandColor, title, password, variant, tweaks } = req.body;
  if (!reportData) throw badRequest("reportData is required");
  const options = {};
  if (password) options.password = password;
  if (variant) options.variant = variant;
  // Merge explicit tweaks into options (density, pageWidth, showHero, showKpis, etc.)
  if (tweaks && typeof tweaks === 'object') Object.assign(options, tweaks);
  res.json({ html: buildStandaloneHTML(reportData, brandColor, title, options) });
}));

// PDF generation is handled client-side via browser print
router.post("/pdf", requireAuth, (req, res) => {
  res.status(501).json({ error: "PDF export is available via browser Print (Ctrl+P) in the preview page." });
});

// Netlify publish — owner/admin only; rebuilds the HTML server-side from the
// stored report so a caller can never push arbitrary markup to (or hijack) a
// site. Reuses the report's existing site on republish, creates one only first.
router.post("/netlify", requireAuth, asyncHandler(async (req, res) => {
  const { siteName, reportId, password, variant, tweaks, brandColor, title } = req.body;
  const token = process.env.NETLIFY_ACCESS_TOKEN;
  if (!reportId) throw badRequest("reportId is required");
  if (!token) throw badRequest("Netlify token not configured. Set NETLIFY_ACCESS_TOKEN in server environment.");

  // Ownership gate — only the report's owner (or an admin) may publish it.
  const db = getDb();
  const report = db.prepare("SELECT user_id, report_data, title, netlify_site_id, netlify_url FROM reports WHERE id = ?").get(reportId);
  if (!report) throw notFound("Report not found");
  if (report.user_id !== req.user.id && req.user.role !== "admin") {
    throw forbidden("You can only publish your own reports");
  }

  // Rebuild the standalone HTML from STORED report data — never trust a
  // caller-supplied html body (that was the hijack vector).
  let reportData;
  try { reportData = JSON.parse(report.report_data || "{}"); }
  catch { throw badRequest("Stored report data is invalid"); }
  const options = {};
  if (password) options.password = password;
  if (variant) options.variant = variant;
  if (tweaks && typeof tweaks === "object") Object.assign(options, tweaks);
  const html = buildStandaloneHTML(reportData, brandColor, title || report.title, options);

  const sha1 = createHash("sha1").update(html).digest("hex");
  const hdrs = { "Authorization": "Bearer " + token, "Content-Type": "application/json" };

  // Reuse the report's existing Netlify site if it still exists.
  let siteId = null;
  let siteUrl = null;
  if (report.netlify_site_id) {
    const checkRes = await fetch("https://api.netlify.com/api/v1/sites/" + report.netlify_site_id, { headers: hdrs });
    if (checkRes.ok) {
      siteId = report.netlify_site_id;
      siteUrl = report.netlify_url;
    }
    // If site was deleted on Netlify, fall through to create a new one
  }

  try {
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

    // Store the site ID on the report for future reuse (reportId is required
    // and ownership was already verified above).
    db.prepare("UPDATE reports SET netlify_site_id = ?, netlify_url = ?, status = 'published', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(siteId, siteUrl, reportId);

    res.json({ url: siteUrl, siteId, deployId: deploy.id });
  } catch (err) {
    // Preserve original behavior: surface Netlify error message in the response
    throw new HttpError(500, "Netlify deploy failed: " + err.message);
  }
}));

export default router;
