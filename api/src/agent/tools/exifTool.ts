import { z } from "zod";
import { ConfidenceScore } from "../../types/confidence";
import type { AgentTool } from "../toolRegistry";
import { EvidenceHash } from "../../models/EvidenceHash";
import { storageService } from "../../services/storageService";
import { extractExifTags } from "../../utils/exifArtifact";
import { extractPdfInfo } from "../../utils/pdfMeta";
import { isPdfFile } from "../../services/pdfTextService";

export const extractExifTool: AgentTool<{ evidenceId: string }, Record<string, unknown>> = {
  name: "extract_exif",
  description:
    "Extract metadata from image or PDF evidence. Images yield EXIF (GPS, device, timestamps). PDFs yield Info fields (author, creator, timestamps). Local file only, no network.",
  inputSchema: z.object({
    evidenceId: z.string().min(1).describe("Evidence ID of an image or PDF file"),
  }),
  execute: async (input, ctx) => {
    const ev = await EvidenceHash.findOne({
      _id: input.evidenceId,
      caseId: ctx.caseId,
    }).select("+minioPath");
    if (!ev) {
      return {
        success: false,
        rawText: `EXIF extraction failed: evidence ${input.evidenceId} not found for case ${ctx.caseId}.`,
        confidence: ConfidenceScore.UNVERIFIED,
        error: "EVIDENCE_NOT_FOUND",
        data: { evidenceId: input.evidenceId, caseId: ctx.caseId },
      };
    }
    const bytes = await storageService.readEvidence(ev.minioPath);
    if (isPdfFile(ev.fileName, ev.mimeType)) {
      const info = extractPdfInfo(bytes);
      const keys = Object.keys(info);
      return {
        success: true,
        rawText: keys.length
          ? `Extracted ${keys.length} PDF info fields from ${ev.fileName}.`
          : `No PDF info dictionary found in ${ev.fileName}.`,
        confidence: keys.length ? ConfidenceScore.MEDIUM : ConfidenceScore.LOW,
        data: {
          evidenceId: input.evidenceId,
          fileName: ev.fileName,
          mimeType: ev.mimeType,
          kind: "pdf",
          hasGps: false,
          pdfInfo: info,
        },
      };
    }
    if (!ev.mimeType.startsWith("image/") && !/\.(jpg|jpeg|tif|tiff|heic)$/i.test(ev.fileName)) {
      return {
        success: false,
        rawText: `EXIF extraction skipped: ${ev.fileName} is not a supported image format.`,
        confidence: ConfidenceScore.UNVERIFIED,
        error: "UNSUPPORTED_MEDIA_TYPE",
        data: { evidenceId: input.evidenceId, fileName: ev.fileName, mimeType: ev.mimeType },
      };
    }
    const exif = extractExifTags(bytes);
    if (!exif) {
      return {
        success: true,
        rawText: `No EXIF tags found in ${ev.fileName}.`,
        confidence: ConfidenceScore.LOW,
        data: { evidenceId: input.evidenceId, fileName: ev.fileName, exif: {}, hasGps: false },
      };
    }
    const hasGps = Boolean(exif.GPSLatitude ?? exif.GPSLongitude ?? exif.gpsLatitude ?? exif.gpsLongitude);
    return {
      success: true,
      rawText: `Extracted ${Object.keys(exif).length} EXIF tags from ${ev.fileName}${hasGps ? " (GPS present)" : ""}.`,
      confidence: hasGps ? ConfidenceScore.HIGH : ConfidenceScore.MEDIUM,
      data: {
        evidenceId: input.evidenceId,
        fileName: ev.fileName,
        mimeType: ev.mimeType,
        hasGps,
        exif,
      },
    };
  },
  shouldScreenshot: false,
  tier: "INTERNAL",
  requiresKey: null,
};
