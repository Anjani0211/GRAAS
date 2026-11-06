import path from "path";
import { EvidenceHash, Case } from "../models";
import { storageService } from "../services/storageService";
import { extractTextFromImageBuffer, isImageFile } from "../services/ocrService";
import { extractTextFromPdfBuffer, isPdfFile } from "../services/pdfTextService";
import { transcribeAudioBuffer, isAudioFile } from "../services/whisperService";
import { logger } from "../utils/logger";

export interface EvidenceCorpusFile {
  fileName: string;
  mimeType: string;
  sha256: string;
}

export interface EvidenceTextEntry {
  fileName: string;
  text: string;
}

export interface EvidenceApkEntry {
  fileName: string;
  evidenceId: string;
}

export interface EvidenceCorpus {
  caseId: string;
  complaintText: string;
  imageOcrTexts: EvidenceTextEntry[];
  audioTranscripts: EvidenceTextEntry[];
  rawFileList: EvidenceCorpusFile[];
  apkFiles: EvidenceApkEntry[];
}

function isApk(fileName: string, mimeType: string): boolean {
  if (mimeType === "application/vnd.android.package-archive") return true;
  return fileName.toLowerCase().endsWith(".apk");
}

function isTextFile(fileName: string, mimeType: string): boolean {
  if (mimeType.startsWith("text/")) return true;
  if (mimeType === "application/json") return true;
  if (mimeType === "application/xml") return true;
  if (mimeType === "application/x-www-form-urlencoded") return true;
  const ext = path.extname(fileName).toLowerCase();
  return [".txt", ".log", ".json", ".csv", ".xml", ".md"].includes(ext);
}

export async function assembleEvidenceCorpus(caseId: string): Promise<EvidenceCorpus> {
  const doc = await Case.findOne({ caseNumber: caseId }).lean();
  const complaintText = doc?.description ? String(doc.description) : "";

  const hashes = await EvidenceHash.find({ caseId }).select("+minioPath").lean();
  const corpus: EvidenceCorpus = {
    caseId,
    complaintText,
    imageOcrTexts: [],
    audioTranscripts: [],
    rawFileList: [],
    apkFiles: [],
  };

  const ingestedSha = new Set<string>();

  // Include in-app evidence items; extract from storage when ocrText not yet populated.
  const invItems = doc?.osintInvestigation?.evidenceItems ?? [];
  for (const ev of invItems) {
    let text = (ev.ocrText ?? "").trim();

    if (!text && ev.storageKey) {
      try {
        const buf = await storageService.readEvidence(ev.storageKey);
        if (isPdfFile(ev.fileName, ev.fileType)) {
          const pdf = await extractTextFromPdfBuffer(buf);
          if (pdf.ok) text = pdf.text;
        } else if (isImageFile(ev.fileName, ev.fileType)) {
          const ocr = await extractTextFromImageBuffer(buf, ev.fileName, ev.fileType);
          if (ocr.ok) text = ocr.text;
        } else if (isTextFile(ev.fileName, ev.fileType)) {
          text = buf.toString("utf8").slice(0, 40_000);
        }
      } catch (err) {
        logger.warn({ caseId, file: ev.fileName, err }, "[Agent] Could not read evidence item bytes");
      }
    }

    if (ev.sha256) ingestedSha.add(ev.sha256);
    if (!text) continue;

    if (isImageFile(ev.fileName, ev.fileType)) {
      corpus.imageOcrTexts.push({ fileName: ev.fileName, text });
    } else if (isAudioFile(ev.fileName, ev.fileType)) {
      corpus.audioTranscripts.push({ fileName: ev.fileName, text });
    } else {
      corpus.complaintText += `\n\n--- Evidence: ${ev.fileName} ---\n${text}`;
    }
  }

  for (const h of hashes) {
    if (ingestedSha.has(h.sha256)) continue;
    corpus.rawFileList.push({
      fileName: h.fileName,
      mimeType: h.mimeType,
      sha256: h.sha256,
    });
    const invMatch = invItems.find((ev) => ev.sha256 && ev.sha256 === h.sha256);
    const key =
      h.minioPath?.startsWith("evidence/")
        ? h.minioPath
        : invMatch?.storageKey?.startsWith("evidence/")
          ? invMatch.storageKey
          : h.sha256
            ? `evidence/${caseId}/${h.sha256}/${h.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`
            : "";

    if (!key) continue;

    let buffer: Buffer | null = null;
    try {
      buffer = await storageService.readEvidence(key);
    } catch (err) {
      logger.warn({ caseId, file: h.fileName, err }, "[Agent] Failed to read evidence bytes");
      continue;
    }

    if (isApk(h.fileName, h.mimeType)) {
      corpus.apkFiles.push({ fileName: h.fileName, evidenceId: String(h._id) });
      continue;
    }

    if (isImageFile(h.fileName, h.mimeType)) {
      const ocr = await extractTextFromImageBuffer(buffer, h.fileName, h.mimeType);
      corpus.imageOcrTexts.push({
        fileName: h.fileName,
        text: ocr.ok ? ocr.text : "",
      });
      continue;
    }

    if (isAudioFile(h.fileName, h.mimeType)) {
      const tr = await transcribeAudioBuffer(buffer, h.fileName);
      corpus.audioTranscripts.push({
        fileName: h.fileName,
        text: tr.ok ? tr.text : "",
      });
      continue;
    }

    if (isPdfFile(h.fileName, h.mimeType)) {
      const pdf = await extractTextFromPdfBuffer(buffer);
      if (pdf.ok && pdf.text) {
        corpus.complaintText += `\n\n--- Evidence: ${h.fileName} ---\n${pdf.text}`;
      }
      continue;
    }

    if (isTextFile(h.fileName, h.mimeType)) {
      const text = buffer.toString("utf8").slice(0, 40_000);
      // Attach to complaint corpus as additional context (but keep separate for traceability).
      corpus.complaintText += `\n\n--- Evidence: ${h.fileName} ---\n${text}`;
    }
  }

  return corpus;
}
