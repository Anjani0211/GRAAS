import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import type { ICase, IOsintEvidenceItem, IOsintInvestigation } from "../models";
import { EvidenceHash } from "../models";
import { storageService } from "./storageService";
import { extractTextFromPdfBuffer, isPdfFile } from "./pdfTextService";
import { extractTextFromImageBuffer, isImageFile } from "./ocrService";
import { logger } from "../utils/logger";
import { hashIp } from "./auditLog";

/**
 * Complaint submit stores files under uploads/cases/ as `evidenceFiles`.
 * The OSINT pipeline only reads `osintInvestigation.evidenceItems` + EvidenceHash/MinIO.
 * Promote any missing complaint uploads into the investigation so PDFs get text-extracted.
 */
export async function ingestComplaintEvidenceIntoInvestigation(
  caseDoc: ICase,
  inv: IOsintInvestigation,
): Promise<{ ingested: number; extractedChars: number }> {
  const files = caseDoc.evidenceFiles ?? [];
  if (files.length === 0) return { ingested: 0, extractedChars: 0 };

  const existingNames = new Set(
    (inv.evidenceItems ?? []).map((e) => e.fileName.trim().toLowerCase()),
  );
  const existingSha = new Set(
    (inv.evidenceItems ?? []).map((e) => (e.sha256 || "").toLowerCase()).filter(Boolean),
  );

  let ingested = 0;
  let extractedChars = 0;
  const caseNum = caseDoc.caseNumber;
  const uploadsCasesDir = path.join(process.cwd(), "uploads", "cases");

  for (const ef of files) {
    if (ef.fileType === "text/uri-list") continue;
    const nameKey = (ef.fileName || "").trim().toLowerCase();
    if (nameKey && existingNames.has(nameKey)) continue;

    const storedName = extractStoredFilename(ef.fileUrl);
    if (!storedName) {
      logger.warn({ caseNum, fileUrl: ef.fileUrl }, "[Ingest] Could not resolve local evidence path");
      continue;
    }
    const localPath = path.join(uploadsCasesDir, storedName);
    if (!fs.existsSync(localPath)) {
      logger.warn({ caseNum, localPath }, "[Ingest] Complaint evidence file missing on disk");
      continue;
    }

    let buffer: Buffer;
    try {
      buffer = fs.readFileSync(localPath);
    } catch (err) {
      logger.warn({ err, localPath }, "[Ingest] Failed to read complaint evidence");
      continue;
    }

    const mime = ef.fileType || "application/octet-stream";
    const fileName = ef.fileName || storedName;

    let stored;
    try {
      stored = await storageService.upload({
        caseId: caseNum,
        fileName,
        mimeType: mime,
        buffer,
      });
    } catch (err) {
      logger.warn({ err, fileName, caseNum }, "[Ingest] storage upload failed");
      continue;
    }

    if (existingSha.has(stored.sha256.toLowerCase())) continue;

    let evidenceHashId = "";
    try {
      const hashDoc = await EvidenceHash.create({
        caseId: caseNum,
        fileName,
        originalName: fileName,
        minioPath: stored.minioPath,
        sha256: stored.sha256,
        fileSizeBytes: stored.fileSizeBytes,
        mimeType: stored.mimeType,
        ingestedAt: new Date(),
        ingestedByIpHash: hashIp("complaint-submit"),
        isLocked: storageService.isAvailable(),
      });
      evidenceHashId = String(hashDoc.id ?? hashDoc._id);
    } catch (createErr: unknown) {
      const code = (createErr as { code?: number })?.code;
      if (code === 11000) {
        const existing = await EvidenceHash.findOne({ caseId: caseNum, sha256: stored.sha256 });
        evidenceHashId = existing ? String(existing.id ?? existing._id) : "";
      } else {
        logger.warn({ err: createErr, fileName }, "[Ingest] EvidenceHash create failed");
      }
    }

    let ocrText = "";
    try {
      if (isPdfFile(fileName, mime)) {
        const pdf = await extractTextFromPdfBuffer(buffer);
        if (pdf.ok) ocrText = pdf.text;
        else {
          logger.warn(
            { fileName, error: pdf.error, pages: pdf.pages },
            "[Ingest] PDF had no extractable text layer (may be scanned images only)",
          );
        }
      } else if (isImageFile(fileName, mime)) {
        const ocr = await extractTextFromImageBuffer(buffer, fileName, mime);
        if (ocr.ok) ocrText = ocr.text;
      } else if (mime.startsWith("text/") || fileName.toLowerCase().endsWith(".txt")) {
        ocrText = buffer.toString("utf8").slice(0, 40_000);
      }
    } catch (err) {
      logger.warn({ err, fileName }, "[Ingest] Text extraction failed");
    }

    const item: IOsintEvidenceItem = {
      id: uuidv4(),
      fileName,
      fileType: mime,
      ocrText,
      analystNotes: ocrText
        ? "Ingested from complaint upload"
        : "Ingested from complaint upload — no text layer extracted",
      createdAt: ef.uploadedAt ? new Date(ef.uploadedAt) : new Date(),
      storageKey: stored.minioPath,
      evidenceHashId: evidenceHashId || undefined,
      sha256: stored.sha256,
    };
    inv.evidenceItems.push(item);
    existingNames.add(nameKey);
    existingSha.add(stored.sha256.toLowerCase());
    ingested += 1;
    extractedChars += ocrText.length;
    logger.info(
      { caseNum, fileName, sha256: stored.sha256.slice(0, 12), chars: ocrText.length },
      "[Ingest] Complaint evidence promoted into OSINT investigation",
    );
  }

  return { ingested, extractedChars };
}

function extractStoredFilename(fileUrl: string): string | null {
  if (!fileUrl) return null;
  try {
    const u = new URL(fileUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1];
    return last ? decodeURIComponent(last) : null;
  } catch {
    const parts = fileUrl.split("/").filter(Boolean);
    const last = parts[parts.length - 1];
    return last || null;
  }
}
