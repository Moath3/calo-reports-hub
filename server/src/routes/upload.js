import { Router } from "express";
import multer from "multer";
import { v4 as uuid } from "uuid";
import { fileURLToPath } from "url";
import { dirname, join, extname } from "path";
import { unlinkSync, existsSync, mkdirSync } from "fs";
import { parseFile, createDataSummary } from "../services/fileParser.js";
import { requireAuth } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const UPLOAD_DIR = join(__dirname, "..", "..", "uploads");

if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_EXTENSIONS = [".xlsx", ".xls", ".csv", ".json", ".txt", ".md"];
const MAX_SIZE = (parseInt(process.env.MAX_FILE_SIZE_MB) || 25) * 1024 * 1024;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, uuid() + extname(file.originalname))
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.includes(ext)) return cb(null, true);
    cb(new Error("Unsupported file type: " + ext + ". Allowed: " + ALLOWED_EXTENSIONS.join(", ")));
  }
});

const router = Router();

router.post("/", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const filePath = req.file.path;
  try {
    const parsedData = parseFile(filePath, req.file.originalname, req.file.mimetype);
    const summary = createDataSummary(parsedData, 50);

    res.json({
      fileId: uuid(),
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      parsedData: summary,
      rawData: parsedData
    });
  } catch (err) {
    console.error("Parse error:", err);
    res.status(400).json({ error: "Failed to parse file: " + err.message });
  } finally {
    try { if (existsSync(filePath)) unlinkSync(filePath); } catch {}
  }
});

export default router;
