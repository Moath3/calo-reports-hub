import { Router } from "express";
import multer from "multer";
import { v4 as uuid } from "uuid";
import { fileURLToPath } from "url";
import { dirname, join, extname, basename } from "path";
import { unlinkSync, existsSync, mkdirSync } from "fs";
import { runPeriod } from "../services/tna/runService.js";
import { buildScheduleIndex } from "../services/tna/scheduleParser.js";
import { generateTnaNarrative } from "../services/aiService.js";
import { getRosterForEntities } from "../services/zeltCompute.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { badRequest, HttpError } from "../utils/httpError.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const UPLOAD_DIR = join(__dirname, "..", "..", "uploads");
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED = [".xlsx", ".xls", ".csv"];
const MAX_SIZE = (parseInt(process.env.MAX_FILE_SIZE_MB) || 25) * 1024 * 1024;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, uuid() + extname(file.originalname)),
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE, files: 10 },
  fileFilter: (req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    if (ALLOWED.includes(ext)) return cb(null, true);
    cb(new Error("Unsupported file type: " + ext + ". Allowed: " + ALLOWED.join(", ")));
  },
}).fields([{ name: "attendance", maxCount: 1 }, { name: "masters", maxCount: 8 }, { name: "schedule", maxCount: 1 }]);

const router = Router();

// POST /api/time-attendance/run
// multipart: attendance (1 file, required), masters (0-8 files, optional),
// month ('YYYY-MM', optional), masterSheets (JSON array of sheet names aligned
// to the masters order, optional — pin a tab to dodge contaminated sheets).
router.post("/run", requireAuth, (req, res, next) => {
  upload(req, res, (err) => {
    if (err) return next(new HttpError(400, err.message));
    next();
  });
}, asyncHandler(async (req, res) => {
  const attendance = req.files?.attendance?.[0];
  const masterFiles = req.files?.masters || [];
  const scheduleFile = req.files?.schedule?.[0] || null;
  // Build the cleanup list from everything multer wrote to disk, BEFORE any
  // validation throw, so a missing-attendance request can't orphan files.
  const paths = [...(attendance ? [attendance.path] : []), ...masterFiles.map((f) => f.path), ...(scheduleFile ? [scheduleFile.path] : [])];
  try {
    if (!attendance) throw badRequest("No attendance file uploaded (field 'attendance')");

    let sheets = [];
    if (req.body.masterSheets) {
      try { sheets = JSON.parse(req.body.masterSheets); } catch { sheets = []; }
    }
    const month = (req.body.month || "").trim() || null;
    const masters = masterFiles.map((f, i) => ({
      label: basename(f.originalname, extname(f.originalname)),
      path: f.path,
      sheet: (Array.isArray(sheets) && sheets[i]) ? String(sheets[i]).trim() || null : null,
    }));

    // Optional Zelt roster — entities picked in the UI. Fetched live and used as
    // a master alongside any uploaded files. A Zelt failure is surfaced clearly
    // (the user explicitly asked for it) rather than silently producing no roster.
    let entities = [];
    if (req.body.entities) {
      try { const p = JSON.parse(req.body.entities); entities = Array.isArray(p) ? p.filter(Boolean) : []; } catch { entities = []; }
    }
    let rosterRecords = [];
    let zeltAuto = false, zeltAutoError = null;
    if (entities.length) {
      try {
        rosterRecords = await getRosterForEntities(entities);
      } catch (err) {
        throw new HttpError(502, "Couldn't load the Zelt roster — is Zelt connected? (" + err.message + ")");
      }
    } else if (masters.length === 0) {
      // No master files and no entity selection: fall back to the WHOLE Zelt
      // roster so the run still gets scoping + dept/title accuracy checks.
      // Soft-fail (the user didn't ask for Zelt explicitly) — the run proceeds
      // unmatched and the UI says why.
      try {
        rosterRecords = await getRosterForEntities('*');
        zeltAuto = rosterRecords.length > 0;
      } catch (err) {
        zeltAutoError = err.message;
      }
    }

    // Optional HR Ops schedule (Kuwait monthly format). Link names to a Zelt
    // roster; if none was fetched above, pull the whole roster just for linking.
    let schedule = null;
    if (scheduleFile) {
      let linkRoster = rosterRecords;
      if (!linkRoster.length) {
        try { linkRoster = await getRosterForEntities('*'); } catch { linkRoster = []; }
      }
      let window = {};
      if (month && /^\d{4}-\d{2}$/.test(month)) {
        const [y, mo] = month.split('-').map(Number);
        window = { periodStart: `${month}-01`, periodEnd: `${month}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}` };
      }
      try {
        schedule = buildScheduleIndex(scheduleFile.path, linkRoster, window);
      } catch (err) {
        if (err.userError) throw new HttpError(400, "Schedule file: " + err.message);
        throw new HttpError(400, "Couldn't read the schedule file — expected the monthly roster format with a Name/Position header and dated day columns. (" + err.message + ")");
      }
    }

    const result = runPeriod({ attendancePath: attendance.path, masters, rosterRecords, month, schedule });
    // Claude writes the exec summary + insights from aggregate figures only
    // (no names/PII). Falls back to a templated summary if the API call fails.
    const narrative = await generateTnaNarrative(result.aggregates);
    // The Excel/CSV are built client-side from this result so they honor the
    // user's in-scope toggle; the AI-only `aggregates` bundle isn't needed there.
    const { aggregates, ...rest } = result;
    res.json({ ...rest, narrative, attendanceName: attendance.originalname, zeltAuto, zeltAutoError });
  } catch (err) {
    if (err instanceof HttpError) throw err;        // explicit 400s pass through
    if (err.userError) throw new HttpError(400, err.message); // expected input problems
    throw new HttpError(500, "Failed to run report: " + err.message); // real failures -> logged + sanitized in prod
  } finally {
    for (const p of paths) { try { if (p && existsSync(p)) unlinkSync(p); } catch {} }
  }
}));

export default router;
