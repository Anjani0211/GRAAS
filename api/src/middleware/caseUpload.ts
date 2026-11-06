import fs from "fs";
import path from "path";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";

const uploadsDir = path.join(process.cwd(), "uploads", "cases");
fs.mkdirSync(uploadsDir, { recursive: true });

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "video/mp4",
  "application/zip",
  "application/vnd.android.package-archive",
]);

const ALLOWED_EXT = new Set([
  ".jpg", ".jpeg", ".png", ".webp", ".gif",
  ".pdf", ".txt",
  ".mp3", ".wav", ".m4a",
  ".mp4",
  ".zip", ".apk",
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
    cb(null, `${uuidv4()}-${safe || "file"}`);
  },
});

/** Intake evidence on case creation (field name `evidence`, max 10 files, 15MB each). */
export const caseEvidenceUpload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const mimeOk = ALLOWED_MIME.has(file.mimetype);
    const extOk = ALLOWED_EXT.has(ext);
    if (mimeOk || extOk) {
      cb(null, true);
      return;
    }
    cb(new Error(`File type not allowed: ${file.mimetype || ext || "unknown"}`));
  },
});
