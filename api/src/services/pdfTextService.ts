import pdfParse from "pdf-parse";
import { logger } from "../utils/logger";

export interface PdfTextResult {
  ok: boolean;
  text: string;
  pages?: number;
  error?: string;
}

/** Extract plain text from a PDF buffer (embedded text layer via pdf-parse). */
export async function extractTextFromPdfBuffer(buffer: Buffer): Promise<PdfTextResult> {
  try {
    const parsed = await pdfParse(buffer);
    const text = (parsed.text ?? "").trim().slice(0, 80_000);
    return { ok: text.length > 0, text, pages: parsed.numpages };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err: message }, "[PDF] Text extraction failed");
    return { ok: false, text: "", error: message };
  }
}

export function isPdfFile(fileName: string, mimeType: string): boolean {
  if (mimeType === "application/pdf") return true;
  return fileName.toLowerCase().endsWith(".pdf");
}
