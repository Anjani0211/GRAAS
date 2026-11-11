import fs from "fs";
import path from "path";
import { ocrImageWithGemini } from "./geminiService";
import { logger } from "../utils/logger";
import { stripExif } from "../utils/piiSanitizer";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

const MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export function isImageFile(fileName: string, mimeType?: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return true;
  if (mimeType?.startsWith("image/")) return true;
  return false;
}

export interface OcrResult {
  ok: true;
  text: string;
}

export interface OcrSkipped {
  ok: false;
  reason: string;
}

export type OcrServiceResult = OcrResult | OcrSkipped;

function mimeFor(fileName: string, mimeType?: string): string {
  const ext = path.extname(fileName).toLowerCase();
  return mimeType ?? MIME_MAP[ext] ?? "image/jpeg";
}

/**
 * Extract visible text using local LLM vision (CyberPeace victim-OCR GGUF).
 * EXIF is stripped from the buffer copy sent to the model only; forensic originals
 * in MinIO/local storage retain full metadata.
 */
export async function extractTextFromImageBuffer(
  imageBuffer: Buffer,
  fileName: string,
  mimeType?: string,
): Promise<OcrServiceResult> {
  const mt = mimeFor(fileName, mimeType);
  try {
    const strippedBuffer = stripExif(imageBuffer);
    const text = await ocrImageWithGemini(strippedBuffer, mt);
    if (!text) {
      return { ok: false, reason: "LLM OCR returned empty text (check vision-capable model and LLM_VISION_ENABLED)" };
    }
    logger.info({ file: fileName, chars: text.length }, "[OCR] Text extracted from image");
    return { ok: true, text };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn({ fileName, reason }, "[OCR] Failed to extract text from image buffer");
    return { ok: false, reason };
  }
}

/**
 * Read file from disk, then run local LLM vision on an EXIF-stripped copy.
 */
export async function extractTextFromImage(filePath: string): Promise<OcrServiceResult> {
  if (!fs.existsSync(filePath)) {
    return { ok: false, reason: `File not found: ${filePath}` };
  }
  const buffer = fs.readFileSync(filePath);
  return extractTextFromImageBuffer(buffer, path.basename(filePath));
}
