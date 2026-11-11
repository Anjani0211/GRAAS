import fs from "fs";
import path from "path";
import { Router, Request, Response } from "express";
import multer from "multer";
import mongoose from "mongoose";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { Case, EvidenceHash, type IOsintInvestigation, SENIOR_ANALYST_ROLES, PipelineRun, InvestigationMemoryModel } from "../models";
import { buildReport, loadAgentReportAppendix, ReportBuildError } from "../services/reportBuilder";
import { generatePdf } from "../services/pdfService";
import { generateDocx, investigationReportFilename } from "../services/docxService";
import { secrets } from "../services/runtimeSettings";
import { fetchWhoisXml, fetchVtIp, fetchVtUrlReputation } from "../services/osintExternal";
import {
  runInvestigation as runPipeline,
  replayInvestigation,
  ensureInvestigation as ensureInvestigationService,
  runAdHocTool,
  appendToolToReport,
  type RunEvent,
  type ToolKind,
} from "../services/osintPipeline";
import { enqueuePipelineJob, derivePriority } from "../queues/pipelineQueue";
import { graphDB } from "../services/graphDB";
import { storageService } from "../services/storageService";
import { mask, maskEmail, hashValue } from "../utils/piiSanitizer";
import { extractExifTags } from "../utils/exifArtifact";
import { isImageFile } from "../services/ocrService";
import { extractTextFromPdfBuffer, isPdfFile } from "../services/pdfTextService";
import { generateMtgxXml, type GraphResponse } from "../utils/maltegoExport";
import { requireRole, requireBadge } from "../middleware/auth";
import { logEvent } from "../services/auditLog";
import { logger } from "../utils/logger";
import { pipelineLimiter } from "../middleware/rateLimiter";
import dispatchRouter from "./dispatch";

const router = Router();

// Entity-routing endpoints (plan / patch recipient / .eml export) live under the
// same /osint auth boundary so they inherit ANALYST role + audit logging.
router.use(dispatchRouter);

const ProsecutionFlagBody = z.object({
  active: z.boolean(),
  notes: z.string().trim().optional(),
});

const osintEvidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

function hashIp(ip: string): string {
  return hashValue(ip).slice(0, 16);
}

function findCaseByParam(id: string) {
  const isObjectId = /^[a-f\d]{24}$/i.test(id);
  return isObjectId ? Case.findById(id) : Case.findOne({ caseNumber: id });
}

function ensureInvestigation(doc: InstanceType<typeof Case>): IOsintInvestigation {
  return ensureInvestigationService(doc);
}

/** Cases ready for or in OSINT pipeline */
router.get("/queue", async (_req: Request, res: Response) => {
  try {
    const cases = await Case.find({
      status: { $in: ["triaged", "osint"] },
    })
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean();

    res.json(
      cases.map((c) => ({
        id: c._id.toString(),
        caseNumber: c.caseNumber,
        category: c.category,
        severity: c.severity,
        status: c.status,
        victimName: c.victimName,
        district: c.district,
        state: c.state,
        updatedAt: c.updatedAt,
        phase: c.osintInvestigation?.phase ?? "evidence",
      })),
    );
  } catch {
    res.status(500).json({ error: "Failed to fetch OSINT queue" });
  }
});

router.get("/case/:caseId/investigation", async (req: Request<{ caseId: string }>, res: Response) => {
  try {
    const doc = await findCaseByParam(req.params.caseId);
    if (!doc) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    const inv: IOsintInvestigation = ensureInvestigation(doc);
    await doc.save();
    res.json({
      case: doc.toJSON(),
      investigation: inv,
    });
  } catch {
    res.status(500).json({ error: "Failed to load investigation" });
  }
});

router.get("/case/:caseId/investigation/agent-screenshots", async (req: Request<{ caseId: string }>, res: Response) => {
  try {
    const doc = await findCaseByParam(req.params.caseId);
    if (!doc) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    const inv: IOsintInvestigation = ensureInvestigation(doc);
    const runId = (req.query.runId as string | undefined)?.trim() || inv.lastRunId;
    if (!runId) {
      res.json({ runId: "", screenshots: [] });
      return;
    }

    const mem = await InvestigationMemoryModel.findOne({ caseId: doc.caseNumber, runId }).lean();
    const screenshots = (mem?.iterations ?? [])
      .filter((it) => !!it.screenshotPath)
      .map((it) => ({
        callId: it.callId,
        toolName: it.toolName,
        timestamp: it.timestamp,
        downloadPath: `/osint/case/${encodeURIComponent(doc.caseNumber)}/investigation/agent-screenshots/${encodeURIComponent(it.callId)}/download?runId=${encodeURIComponent(runId)}`,
      }));

    res.json({ runId, screenshots });
  } catch (err) {
    logger.error({ err }, "[OSINT] list agent screenshots failed");
    res.status(500).json({ error: "Failed to list agent screenshots" });
  }
});

router.get(
  "/case/:caseId/investigation/agent-screenshots/:callId/download",
  async (req: Request<{ caseId: string; callId: string }>, res: Response) => {
    try {
      const doc = await findCaseByParam(req.params.caseId);
      if (!doc) {
        res.status(404).json({ error: "Case not found" });
        return;
      }
      const inv: IOsintInvestigation = ensureInvestigation(doc);
      const runId = (req.query.runId as string | undefined)?.trim() || inv.lastRunId;
      if (!runId) {
        res.status(404).json({ error: "Run not found" });
        return;
      }
      const mem = await InvestigationMemoryModel.findOne({ caseId: doc.caseNumber, runId }).lean();
      const iter = (mem?.iterations ?? []).find((it) => it.callId === req.params.callId);
      const screenshotPath = iter?.screenshotPath;
      if (!screenshotPath) {
        res.status(404).json({ error: "Screenshot not found" });
        return;
      }

      if (storageService.isAvailable()) {
        const presignedUrl = await storageService.getPresignedUrl(screenshotPath);
        res.redirect(presignedUrl);
        return;
      }

      const image = await storageService.readEvidence(screenshotPath);
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "private, max-age=60");
      res.send(image);
    } catch (err) {
      logger.error({ err }, "[OSINT] download agent screenshot failed");
      res.status(500).json({ error: "Failed to download screenshot" });
    }
  },
);

router.patch(
  "/case/:caseId/prosecution-flag",
  requireRole(...SENIOR_ANALYST_ROLES),
  async (req: Request<{ caseId: string }>, res: Response) => {
    try {
      const body = ProsecutionFlagBody.parse(req.body);
      const doc = await findCaseByParam(req.params.caseId);
      if (!doc) {
        res.status(404).json({ error: "Case not found" });
        return;
      }
      doc.activeProsecution = body.active;
      doc.prosecutionSetAt = new Date();
      doc.prosecutionSetBy = req.auth?.userId ?? "system";
      doc.prosecutionNotes = body.notes ?? "";
      await doc.save();
      await logEvent({
        userId: req.auth!.userId,
        action: "PROSECUTION_FLAG_SET",
        resourceId: doc.caseNumber,
        outcome: "SUCCESS",
        ip: req.ip ?? "unknown",
        metadata: { active: body.active, notes: body.notes ?? "" },
      });
      res.json({
        caseId: doc.caseNumber,
        activeProsecution: doc.activeProsecution,
        prosecutionSetAt: doc.prosecutionSetAt,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Validation failed", details: err.issues });
        return;
      }
      res.status(500).json({ error: "Failed to update prosecution flag" });
    }
  },
);

const EvidenceBody = z.object({
  fileName: z.string().min(1),
  fileType: z.string().optional(),
  ocrText: z.string().optional(),
  analystNotes: z.string().optional(),
});

router.post(
  "/case/:caseId/investigation/evidence",
  (req, res, next) => {
    if ((req.headers["content-type"] || "").includes("multipart/form-data")) {
      osintEvidenceUpload.single("file")(req, res, (err: unknown) => {
        if (err) {
          const message = err instanceof Error ? err.message : "File upload failed";
          res.status(400).json({ error: message });
          return;
        }
        next();
      });
      return;
    }
    next();
  },
  async (req: Request<{ caseId: string }>, res: Response) => {
    try {
      const doc = await findCaseByParam(req.params.caseId);
      if (!doc) {
        res.status(404).json({ error: "Case not found" });
        return;
      }
      const inv = ensureInvestigation(doc);
      const caseNum = doc.caseNumber;

      const file = req.file;
      if (file?.buffer) {
        const mime = file.mimetype || "application/octet-stream";
        const stored = await storageService.upload({
          caseId: caseNum,
          fileName: file.originalname,
          mimeType: mime,
          buffer: file.buffer,
        });

        let evidenceHashDoc;
        try {
          evidenceHashDoc = await EvidenceHash.create({
            caseId: caseNum,
            fileName: file.originalname,
            originalName: file.originalname,
            minioPath: stored.minioPath,
            sha256: stored.sha256,
            fileSizeBytes: stored.fileSizeBytes,
            mimeType: stored.mimeType,
            ingestedAt: new Date(),
            ingestedByIpHash: hashIp(req.ip ?? "unknown"),
            isLocked: storageService.isAvailable(),
          });
        } catch (createErr: unknown) {
          const code = (createErr as { code?: number })?.code;
          if (code === 11000) {
            res.status(409).json({ error: "Duplicate evidence (same SHA-256 for this case)" });
            return;
          }
          throw createErr;
        }

        let ocrText = "";
        if (isPdfFile(file.originalname, mime)) {
          const pdf = await extractTextFromPdfBuffer(file.buffer);
          if (pdf.ok) ocrText = pdf.text;
        }

        const itemId = uuidv4();
        inv.evidenceItems.push({
          id: itemId,
          fileName: file.originalname,
          fileType: mime,
          ocrText,
          analystNotes: "",
          createdAt: new Date(),
          storageKey: stored.minioPath,
          evidenceHashId: evidenceHashDoc.id as string,
          sha256: stored.sha256,
        });

        inv.hashManifest.push({
          evidenceId: itemId,
          fileName: file.originalname,
          fileType: mime,
          sha256: stored.sha256,
          sizeBytes: stored.fileSizeBytes,
          ingestedAt: new Date(),
        });

        if (isImageFile(file.originalname, mime)) {
          const exif = extractExifTags(file.buffer);
          if (exif) {
            inv.exifArtifacts.push({ evidenceSha256: stored.sha256, exif });
            const gps = exif.GPSLatitude ?? exif.gpsLatitude;
            if (gps != null) {
              logger.info(
                { sha256: stored.sha256.slice(0, 8) },
                "[Evidence] GPS-related EXIF present in uploaded image",
              );
            }
          }
        }

        await logEvent({
          userId: req.auth!.userId,
          action: "EVIDENCE_UPLOAD",
          resourceId: caseNum,
          outcome: "SUCCESS",
          ip: req.ip ?? "unknown",
          metadata: { fileName: file.originalname, sha256: stored.sha256 },
        });

        await doc.save();
        const last = inv.evidenceItems[inv.evidenceItems.length - 1];
        res.status(201).json({ evidence: last, investigation: inv });
        return;
      }

      const data = EvidenceBody.parse(req.body);
      const item = {
        id: uuidv4(),
        fileName: data.fileName,
        fileType: data.fileType || "application/octet-stream",
        ocrText: data.ocrText ?? "",
        analystNotes: data.analystNotes ?? "",
        createdAt: new Date(),
      };
      inv.evidenceItems.push(item);
      await doc.save();
      res.status(201).json({ evidence: item, investigation: inv });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Validation failed", details: err.issues });
        return;
      }
      logger.error({ err }, "[OSINT] evidence upload failed");
      res.status(500).json({ error: "Failed to add evidence" });
    }
  },
);

/** Presigned URL or local file path for chain-of-custody downloads (never exposes raw minio key in logs). */
router.get(
  "/case/:caseId/investigation/evidence/:evidenceId/download",
  async (req: Request<{ caseId: string; evidenceId: string }>, res: Response) => {
    try {
      const doc = await findCaseByParam(req.params.caseId);
      if (!doc) {
        res.status(404).json({ error: "Case not found" });
        return;
      }
      if (!mongoose.Types.ObjectId.isValid(req.params.evidenceId)) {
        res.status(400).json({ error: "Invalid evidence id" });
        return;
      }
      const caseNum = doc.caseNumber;
      const hash = await EvidenceHash.findOne({
        _id: req.params.evidenceId,
        caseId: caseNum,
      }).select("+minioPath");
      if (!hash) {
        res.status(404).json({ error: "Evidence not found" });
        return;
      }

      await logEvent({
        userId: req.auth!.userId,
        action: "EVIDENCE_ACCESS",
        resourceId: req.params.evidenceId,
        outcome: "SUCCESS",
        ip: req.ip ?? "unknown",
        metadata: { caseId: caseNum, sha256: hash.sha256 },
      });

      if (storageService.isAvailable()) {
        const presignedUrl = await storageService.getPresignedUrl(hash.minioPath);
        res.json({ presignedUrl, expiresInSeconds: 900 });
        return;
      }

      const localAbs = path.join(process.cwd(), "uploads", hash.minioPath);
      if (!fs.existsSync(localAbs)) {
        res.status(404).json({ error: "File not found on server" });
        return;
      }
      res.sendFile(localAbs);
    } catch (err) {
      logger.error({ err }, "[OSINT] evidence download failed");
      res.status(500).json({ error: "Download failed" });
    }
  },
);

router.patch("/case/:caseId/investigation/evidence/:evidenceId", async (req: Request<{ caseId: string; evidenceId: string }>, res: Response) => {
  try {
    const body = z
      .object({
        ocrText: z.string().optional(),
        analystNotes: z.string().optional(),
      })
      .parse(req.body);
    const doc = await findCaseByParam(req.params.caseId);
    if (!doc) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    const inv = ensureInvestigation(doc);
    const ev = inv.evidenceItems.find((e) => e.id === req.params.evidenceId);
    if (!ev) {
      res.status(404).json({ error: "Evidence not found" });
      return;
    }
    if (body.ocrText !== undefined) ev.ocrText = body.ocrText;
    if (body.analystNotes !== undefined) ev.analystNotes = body.analystNotes;
    await doc.save();
    res.json({ evidence: ev, investigation: inv });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Validation failed", details: err.issues });
      return;
    }
    res.status(500).json({ error: "Failed to update evidence" });
  }
});

router.delete("/case/:caseId/investigation/evidence/:evidenceId", async (req: Request<{ caseId: string; evidenceId: string }>, res: Response) => {
  try {
    const doc = await findCaseByParam(req.params.caseId);
    if (!doc) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    const inv = ensureInvestigation(doc);
    inv.evidenceItems = inv.evidenceItems.filter((e) => e.id !== req.params.evidenceId);
    await doc.save();
    res.json({ investigation: inv });
  } catch {
    res.status(500).json({ error: "Failed to remove evidence" });
  }
});

const DraftBody = z.object({
  draftReport: z.string().optional(),
  finalReport: z.string().optional(),
  phase: z.enum(["evidence", "draft_report", "final_review", "submitted_to_le"]).optional(),
});

router.patch("/case/:caseId/investigation/draft", async (req: Request<{ caseId: string }>, res: Response) => {
  try {
    const data = DraftBody.parse(req.body);
    if (data.draftReport === undefined && data.finalReport === undefined && data.phase === undefined) {
      res.status(400).json({ error: "Provide draftReport, finalReport, and/or phase" });
      return;
    }
    const doc = await findCaseByParam(req.params.caseId);
    if (!doc) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    const inv = ensureInvestigation(doc);
    if (data.draftReport !== undefined) inv.draftReport = data.draftReport;
    if (data.finalReport !== undefined) inv.finalReport = data.finalReport;
    if (data.phase) inv.phase = data.phase;
    await doc.save();
    res.json({ investigation: inv });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Validation failed", details: err.issues });
      return;
    }
    res.status(500).json({ error: "Failed to save draft" });
  }
});

router.post(
  "/case/:caseId/investigation/finalize",
  requireRole(...SENIOR_ANALYST_ROLES),
  requireBadge,
  async (req: Request<{ caseId: string }>, res: Response) => {
    try {
      const doc = await findCaseByParam(req.params.caseId);
      if (!doc) {
        res.status(404).json({ error: "Case not found" });
        return;
      }
      const inv = ensureInvestigation(doc);
      const body = z.object({ finalReport: z.string().optional() }).parse(req.body);
      inv.finalReport = body.finalReport ?? inv.draftReport;
      inv.phase = "final_review";
      await doc.save();

      await logEvent({
        userId: req.auth!.userId,
        action: "REPORT_FINALIZE",
        resourceId: doc.id as string,
        outcome: "SUCCESS",
        ip: req.ip ?? "unknown",
        metadata: { caseNumber: doc.caseNumber },
      });

      logger.info({ userId: req.auth?.userId, caseId: doc.id }, "[OSINT] Report finalized");
      res.json({ investigation: inv });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Validation failed", details: err.issues });
        return;
      }
      logger.error({ err }, "[OSINT] finalize error");
      res.status(500).json({ error: "Failed to finalize report" });
    }
  },
);

const SubmitLeBody = z.object({
  leAgency: z.string().min(1),
  leDistrict: z.string().optional(),
  leReferenceNumber: z.string().optional(),
  advanceCaseStatus: z.boolean().optional(),
});

router.post(
  "/case/:caseId/investigation/submit-le",
  requireRole(...SENIOR_ANALYST_ROLES),
  requireBadge,
  async (req: Request<{ caseId: string }>, res: Response) => {
    try {
      const data = SubmitLeBody.parse(req.body);
      const doc = await findCaseByParam(req.params.caseId);
      if (!doc) {
        res.status(404).json({ error: "Case not found" });
        return;
      }
      const inv = ensureInvestigation(doc);
      if (!inv.finalReport.trim()) {
        res.status(400).json({ error: "Finalize the investigation report before LE submission" });
        return;
      }
      inv.leAgency = data.leAgency;
      inv.leDistrict = data.leDistrict ?? "";
      inv.leReferenceNumber = data.leReferenceNumber ?? "";
      inv.submittedToLeAt = new Date();
      inv.phase = "submitted_to_le";

      doc.actions.push({
        actionType: "osint_le_submission",
        platformTarget: data.leAgency,
        templateUsed: data.leReferenceNumber || "N/A",
        sentBy: req.auth?.userId ?? "system",
        sentAt: new Date(),
      });

      if (data.advanceCaseStatus !== false) {
        doc.status = "action_taken";
      }

      await doc.save();

      await logEvent({
        userId: req.auth!.userId,
        action: "LE_SUBMIT",
        resourceId: doc.id as string,
        outcome: "SUCCESS",
        ip: req.ip ?? "unknown",
        metadata: { caseNumber: doc.caseNumber, leAgency: data.leAgency },
      });

      logger.info(
        { userId: req.auth?.userId, caseId: doc.id, leAgency: data.leAgency },
        "[OSINT] Submitted to LE",
      );

      res.json({
        message: "Report recorded for law enforcement handoff",
        case: doc.toJSON(),
        investigation: inv,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Validation failed", details: err.issues });
        return;
      }
      logger.error({ err }, "[OSINT] submit-le error");
      res.status(500).json({ error: "Failed to submit to LE" });
    }
  },
);

// —— OSINT tools: WhoisXML + VirusTotal when API keys are set; else demo mock ——

router.get("/whois", async (req: Request, res: Response) => {
  const { domain } = req.query;
  if (!domain || typeof domain !== "string") {
    res.status(400).json({ error: "domain query parameter required" });
    return;
  }

  if (secrets.whoisxml()) {
    const result = await fetchWhoisXml(domain);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error, provider: "whoisxml" });
      return;
    }
    res.json({
      ...(typeof result.data === "object" && result.data !== null ? (result.data as object) : { payload: result.data }),
      provider: "whoisxml",
      mock: false,
    });
    return;
  }

  res.json({
    mock: true,
    domain,
    note: "Set WHOISXML_API_KEY for live WhoisXML data",
    registrar: "Example Registrar Inc.",
    createdDate: "2024-01-15",
    expiryDate: "2025-01-15",
    nameServers: ["ns1.example.com", "ns2.example.com"],
    registrantCountry: "IN",
    status: "active",
    riskFlags: ["newly_registered"],
  });
});

router.get("/ip", async (req: Request, res: Response) => {
  const { ip } = req.query;
  if (!ip || typeof ip !== "string") {
    res.status(400).json({ error: "ip query parameter required" });
    return;
  }

  if (secrets.virustotal()) {
    const result = await fetchVtIp(ip);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error, provider: "virustotal" });
      return;
    }
    res.json(result.data);
    return;
  }

  res.json({
    mock: true,
    ip,
    note: "Set VIRUSTOTAL_API_KEY for live VirusTotal data",
    country: "India",
    city: "Mumbai",
    isp: "Reliance Jio",
    latitude: 19.076,
    longitude: 72.8777,
    isProxy: false,
    isVpn: false,
    threatScore: 25,
    blacklisted: false,
  });
});

router.get("/urlscan", async (req: Request, res: Response) => {
  const { url } = req.query;
  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "url query parameter required" });
    return;
  }

  if (secrets.virustotal()) {
    const result = await fetchVtUrlReputation(url);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error, provider: "virustotal" });
      return;
    }
    res.json(result.data);
    return;
  }

  res.json({
    mock: true,
    url,
    note: "Set VIRUSTOTAL_API_KEY for live VirusTotal domain/IP reputation",
    safe: false,
    score: 72,
    categories: ["phishing", "suspicious"],
    screenshotUrl: null,
    server: "nginx",
    tags: ["disposable_domain", "newly_registered"],
  });
});

router.get("/shodan", async (req: Request, res: Response) => {
  const { query } = req.query;
  if (!query || typeof query !== "string") {
    res.status(400).json({ error: "query parameter required" });
    return;
  }
  if (!secrets.shodan()) {
    res.json({
      mock: true,
      note: "Set SHODAN_API_KEY for live Shodan data — demo payload only",
      query,
      totalResults: 0,
      results: [],
    });
    return;
  }
  try {
    const url = `https://api.shodan.io/shodan/host/search?key=${encodeURIComponent(secrets.shodan())}&query=${encodeURIComponent(query)}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!resp.ok) {
      res.status(502).json({ error: `Shodan HTTP ${resp.status}`, mock: false });
      return;
    }
    const body = (await resp.json()) as { total?: number; matches?: unknown[] };
    res.json({
      mock: false,
      query,
      totalResults: body.total ?? 0,
      results: body.matches ?? [],
    });
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : "Shodan request failed",
      mock: false,
    });
  }
});

// ──────────────────────────────────────────────────────────────
// GRASS Pipeline: NDJSON streaming runner
// POST /osint/case/:caseId/investigation/run
// Streams RunEvent objects (one JSON per newline) as stages complete.
// Rate limited: 5 pipeline runs per user per minute.
// ──────────────────────────────────────────────────────────────
router.use("/case/:caseId/investigation/run", pipelineLimiter);
router.post("/case/:caseId/investigation/run", async (req: Request<{ caseId: string }>, res: Response) => {
  let closed = false;
  let heartbeat: NodeJS.Timeout | null = null;
  try {
    const doc = await findCaseByParam(req.params.caseId);
    if (!doc) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    // Advance case status into "osint" the first time a pipeline is kicked off.
    if (doc.status === "triaged" || doc.status === "submitted") {
      doc.status = "osint";
      await doc.save();
    }

    const priority = derivePriority(doc.monetaryLoss ?? 0);
    const jobId = await enqueuePipelineJob({
      caseId: doc.caseNumber,
      triggeredBy: req.auth?.userId ?? "system",
      priority,
    });
    if (jobId) {
      res.status(202).json({
        mode: "queued",
        jobId,
        priority,
        message: "Pipeline job queued. Poll investigation or GET .../investigation/runs for status.",
      });
      return;
    }

    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const emit = (event: RunEvent) => {
      if (closed) return;
      try {
        res.write(JSON.stringify(event) + "\n");
      } catch {
        closed = true;
      }
    };

    // Keep connection alive during slow enrichment waits on some proxies.
    heartbeat = setInterval(() => {
      if (!closed) res.write(":\n");
    }, 15_000);

    req.on("close", () => {
      closed = true;
    });

    await runPipeline(doc, { analystId: req.auth?.userId ?? "system" }, emit);
  } catch (err) {
    if (!closed) {
      try {
        res.write(
          JSON.stringify({
            type: "error",
            message: err instanceof Error ? err.message : "Pipeline failed",
            at: new Date().toISOString(),
          }) + "\n",
        );
      } catch {
        /* no-op */
      }
    }
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    try {
      res.end();
    } catch {
      /* no-op */
    }
  }
});

const ReplayBody = z.object({
  fromStage: z.enum(["intake", "parse", "osint", "correlation", "report"]).optional(),
});

router.get("/case/:caseId/investigation/runs", async (req: Request<{ caseId: string }>, res: Response) => {
  try {
    const doc = await findCaseByParam(req.params.caseId);
    if (!doc) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? "10"), 10)));
    const filter = { caseId: doc.caseNumber };
    const [runs, total] = await Promise.all([
      PipelineRun.find(filter).sort({ startedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      PipelineRun.countDocuments(filter),
    ]);
    res.json({ runs, total, page, limit });
  } catch {
    res.status(500).json({ error: "Failed to list pipeline runs" });
  }
});

router.post(
  "/case/:caseId/investigation/runs/:runId/replay",
  pipelineLimiter,
  async (req: Request<{ caseId: string; runId: string }>, res: Response) => {
    let body: z.infer<typeof ReplayBody>;
    try {
      body = ReplayBody.parse(req.body ?? {});
    } catch (e) {
      if (e instanceof z.ZodError) {
        res.status(400).json({ error: "Validation failed", details: e.issues });
        return;
      }
      throw e;
    }
    let closed = false;
    let heartbeat: NodeJS.Timeout | null = null;
    try {
      const doc = await findCaseByParam(req.params.caseId);
      if (!doc) {
        res.status(404).json({ error: "Case not found" });
        return;
      }
      const parent = await PipelineRun.findOne({ runId: req.params.runId, caseId: doc.caseNumber }).lean();
      if (!parent) {
        res.status(404).json({ error: "Pipeline run not found" });
        return;
      }

      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();

      const emit = (event: RunEvent) => {
        if (closed) return;
        try {
          res.write(JSON.stringify(event) + "\n");
        } catch {
          closed = true;
        }
      };

      heartbeat = setInterval(() => {
        if (!closed) res.write(":\n");
      }, 15_000);

      req.on("close", () => {
        closed = true;
      });

      await replayInvestigation(doc, parent.runId, body.fromStage, req.auth?.userId ?? "system", emit);
    } catch (err) {
      if (!closed) {
        try {
          res.write(
            JSON.stringify({
              type: "error",
              message: err instanceof Error ? err.message : "Replay failed",
              at: new Date().toISOString(),
            }) + "\n",
          );
        } catch {
          /* no-op */
        }
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      try {
        res.end();
      } catch {
        /* no-op */
      }
    }
  },
);

// Analyst-added OSINT tool (WHOIS / VT-IP / VT-URL / shodan). Persists to customTools.
const ToolBody = z.object({
  kind: z.enum(["whois", "ip", "urlscan", "shodan"]),
  query: z.string().min(1),
  attach: z.boolean().optional(),
});

router.post("/case/:caseId/investigation/tool", async (req: Request<{ caseId: string }>, res: Response) => {
  try {
    const body = ToolBody.parse(req.body);
    const doc = await findCaseByParam(req.params.caseId);
    if (!doc) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    const inv = ensureInvestigation(doc);
    const run = await runAdHocTool(body.kind as ToolKind, body.query);
    if (!run.ok) {
      res.status(run.status).json({ error: run.error });
      return;
    }
    const record = {
      id: uuidv4(),
      kind: body.kind,
      query: body.query,
      result: run.data,
      runAt: new Date(),
      runBy: req.auth?.userId ?? "system",
      attachedToReport: !!body.attach,
    };
    inv.customTools.push(record);
    // Mixed-type fields require explicit markModified.
    doc.markModified("osintInvestigation.customTools");
    if (body.attach) {
      appendToolToReport(inv, {
        kind: body.kind as ToolKind,
        query: body.query,
        result: run.data,
        provider: run.provider,
      });
    }
    await doc.save();
    res.json({ tool: record, investigation: inv, provider: run.provider });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Validation failed", details: err.issues });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : "Tool failed" });
  }
});

router.delete(
  "/case/:caseId/investigation/tool/:toolId",
  async (req: Request<{ caseId: string; toolId: string }>, res: Response) => {
    try {
      const doc = await findCaseByParam(req.params.caseId);
      if (!doc) {
        res.status(404).json({ error: "Case not found" });
        return;
      }
      const inv = ensureInvestigation(doc);
      const before = inv.customTools.length;
      inv.customTools = inv.customTools.filter((t) => t.id !== req.params.toolId);
      if (inv.customTools.length === before) {
        res.status(404).json({ error: "Tool record not found" });
        return;
      }
      await doc.save();
      res.json({ investigation: inv });
    } catch {
      res.status(500).json({ error: "Failed to remove tool record" });
    }
  },
);

router.get("/case/:caseId/investigation/report", async (req: Request<{ caseId: string }>, res: Response) => {
  try {
    const doc = await findCaseByParam(req.params.caseId);
    if (!doc) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    const inv = ensureInvestigation(doc);
    res.json({
      caseNumber: doc.caseNumber,
      generatedAt: inv.lastRunAt,
      runId: inv.lastRunId,
      status: inv.lastRunStatus,
      markdown: inv.reportMarkdown ?? "",
      json: inv.reportJson ?? null,
      finalReport: inv.finalReport ?? "",
      phase: inv.phase,
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch report" });
  }
});

function handleGrassReportExportError(res: Response, err: unknown): void {
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: "Report validation failed", details: err.flatten() });
    return;
  }
  if (err instanceof ReportBuildError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof Error && err.message.includes("HITL_GATE")) {
    res.status(403).json({ error: err.message });
    return;
  }
  logger.error({ err }, "[OSINT] GRASSReport export failed");
  res.status(500).json({ error: "Report export failed" });
}

/** Redacted PDF — all analysts with badge (HITL). */
router.get(
  "/case/:caseId/investigation/report/pdf/redacted",
  requireBadge,
  async (req: Request<{ caseId: string }>, res: Response) => {
    try {
      const doc = await findCaseByParam(req.params.caseId);
      if (!doc) {
        res.status(404).json({ error: "Case not found" });
        return;
      }
      const u = req.user!;
      const report = await buildReport(doc, u.badgeId!, u.name, { redacted: true });
      const pdfBuffer = await generatePdf(report);
      await logEvent({
        userId: req.auth!.userId,
        action: "REPORT_EXPORT",
        resourceId: doc.id as string,
        outcome: "SUCCESS",
        ip: req.ip ?? "",
        metadata: { format: "pdf", redacted: true, caseNumber: doc.caseNumber },
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${investigationReportFilename(doc.caseNumber, "pdf", true)}"`,
      );
      res.send(pdfBuffer);
    } catch (err: unknown) {
      handleGrassReportExportError(res, err);
    }
  },
);

/** Full PDF — senior tier + badge. */
router.get(
  "/case/:caseId/investigation/report/pdf",
  requireRole(...SENIOR_ANALYST_ROLES),
  requireBadge,
  async (req: Request<{ caseId: string }>, res: Response) => {
    try {
      const doc = await findCaseByParam(req.params.caseId);
      if (!doc) {
        res.status(404).json({ error: "Case not found" });
        return;
      }
      const u = req.user!;
      const report = await buildReport(doc, u.badgeId!, u.name, { redacted: false });
      const pdfBuffer = await generatePdf(report);
      await logEvent({
        userId: req.auth!.userId,
        action: "REPORT_EXPORT",
        resourceId: doc.id as string,
        outcome: "SUCCESS",
        ip: req.ip ?? "",
        metadata: { format: "pdf", redacted: false, caseNumber: doc.caseNumber },
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${investigationReportFilename(doc.caseNumber, "pdf")}"`,
      );
      res.send(pdfBuffer);
    } catch (err: unknown) {
      handleGrassReportExportError(res, err);
    }
  },
);

/** Investigation report DOCX — senior tier + badge (full package). */
router.get(
  "/case/:caseId/investigation/report/docx",
  requireRole(...SENIOR_ANALYST_ROLES),
  requireBadge,
  async (req: Request<{ caseId: string }>, res: Response) => {
    try {
      const doc = await findCaseByParam(req.params.caseId);
      if (!doc) {
        res.status(404).json({ error: "Case not found" });
        return;
      }
      const u = req.user!;
      const report = await buildReport(doc, u.badgeId!, u.name, { redacted: false });
      const appendix = await loadAgentReportAppendix(doc);
      const docxBuffer = await generateDocx(report, appendix);
      await logEvent({
        userId: req.auth!.userId,
        action: "REPORT_EXPORT",
        resourceId: doc.id as string,
        outcome: "SUCCESS",
        ip: req.ip ?? "",
        metadata: { format: "docx", redacted: false, caseNumber: doc.caseNumber },
      });
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${investigationReportFilename(doc.caseNumber, "docx")}"`,
      );
      res.send(docxBuffer);
    } catch (err: unknown) {
      handleGrassReportExportError(res, err);
    }
  },
);

/** Redacted DOCX — all analysts with badge. */
router.get(
  "/case/:caseId/investigation/report/docx/redacted",
  requireBadge,
  async (req: Request<{ caseId: string }>, res: Response) => {
    try {
      const doc = await findCaseByParam(req.params.caseId);
      if (!doc) {
        res.status(404).json({ error: "Case not found" });
        return;
      }
      const u = req.user!;
      const report = await buildReport(doc, u.badgeId!, u.name, { redacted: true });
      const appendix = await loadAgentReportAppendix(doc);
      const docxBuffer = await generateDocx(report, appendix);
      await logEvent({
        userId: req.auth!.userId,
        action: "REPORT_EXPORT",
        resourceId: doc.id as string,
        outcome: "SUCCESS",
        ip: req.ip ?? "",
        metadata: { format: "docx", redacted: true, caseNumber: doc.caseNumber },
      });
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${investigationReportFilename(doc.caseNumber, "docx", true)}"`,
      );
      res.send(docxBuffer);
    } catch (err: unknown) {
      handleGrassReportExportError(res, err);
    }
  },
);

/**
 * GET /osint/case/:caseId/investigation/graph
 * Returns a D3-compatible graph JSON for the case's entities and their links.
 * Falls back to building graph from MongoDB enrichment data when Neo4j is unavailable.
 */
router.get("/case/:caseId/investigation/graph", async (req: Request<{ caseId: string }>, res: Response) => {
  try {
    const doc = await findCaseByParam(req.params.caseId);
    if (!doc) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    const inv = ensureInvestigation(doc);

    if (!graphDB.isAvailable()) {
      await graphDB.ensureConnected();
    }

    if (graphDB.isAvailable()) {
      // Build graph from Neo4j
      const rows = await graphDB.runQuery<{
        entityValue: string;
        entityType: string;
        confidence: string;
        caseId: string;
      }>(
        `MATCH (c:Case {caseId: $caseId})-[r:INVOLVED]->(e)
         RETURN e.value AS entityValue,
                head(labels(e)) AS entityType,
                r.confidence AS confidence,
                c.caseId AS caseId`,
        { caseId: doc.caseNumber },
      );

      // Also find other cases sharing entities with this case
      const linkedRows = await graphDB.runQuery<{
        entityValue: string;
        linkedCaseId: string;
        confidence: string;
      }>(
        `MATCH (c:Case {caseId: $caseId})-[:INVOLVED]->(e)<-[r:INVOLVED]-(c2:Case)
         WHERE c2.caseId <> $caseId
         RETURN e.value AS entityValue, c2.caseId AS linkedCaseId, r.confidence AS confidence`,
        { caseId: doc.caseNumber },
      );

      const nodes: GraphResponse["nodes"] = [
        { id: doc.caseNumber, type: "Case", label: doc.caseNumber, confidence: "VERIFIED", flags: [] },
      ];
      const links: GraphResponse["links"] = [];
      const seenEntities = new Set<string>();

      for (const row of rows) {
        if (!seenEntities.has(row.entityValue)) {
          seenEntities.add(row.entityValue);
          nodes.push({
            id: row.entityValue,
            type: row.entityType ?? "Entity",
            label: row.entityType === "Email" ? maskEmail(row.entityValue) : mask(row.entityValue),
            confidence: row.confidence ?? "UNVERIFIED",
            flags: [],
          });
        }
        links.push({
          source: doc.caseNumber,
          target: row.entityValue,
          relationship: "INVOLVED",
          confidence: row.confidence ?? "UNVERIFIED",
        });
      }

      // Add linked cases as nodes
      const seenLinkedCases = new Set<string>();
      for (const row of linkedRows) {
        if (!seenLinkedCases.has(row.linkedCaseId)) {
          seenLinkedCases.add(row.linkedCaseId);
          nodes.push({
            id: row.linkedCaseId,
            type: "Case",
            label: row.linkedCaseId,
            confidence: "VERIFIED",
            flags: ["LINKED_CASE"],
          });
        }
        links.push({
          source: row.linkedCaseId,
          target: row.entityValue,
          relationship: "INVOLVED",
          confidence: row.confidence ?? "UNVERIFIED",
        });
      }

      res.json({ nodes, links, fallback: false } satisfies GraphResponse);
      return;
    }

    // MongoDB fallback — build graph from stored enrichments
    const fallbackNodes: GraphResponse["nodes"] = [
      { id: doc.caseNumber, type: "Case", label: doc.caseNumber, confidence: "VERIFIED", flags: [] },
    ];
    const fallbackLinks: GraphResponse["links"] = [];
    const entities = inv.entities ?? [];

    for (const entity of entities) {
      // Look up enrichment for this entity to get confidence
      const enrichment = (inv.enrichments ?? []).find((e) => e.entityId === entity.id);
      const confidence = enrichment?.confidence ?? (entity.valid ? "LOW" : "UNVERIFIED");
      fallbackNodes.push({
        id: entity.value,
        type: entity.type,
        label: entity.type === "email" ? maskEmail(entity.value) : mask(entity.value),
        confidence,
        flags: [],
      });
      fallbackLinks.push({
        source: doc.caseNumber,
        target: entity.value,
        relationship: "INVOLVED",
        confidence,
      });
    }

    res.json({ nodes: fallbackNodes, links: fallbackLinks, fallback: true } satisfies GraphResponse);
  } catch (err) {
    res.status(500).json({ error: "Failed to build graph", detail: String(err) });
  }
});

/**
 * GET /osint/case/:caseId/investigation/maltego-export
 * Downloads a Maltego-compatible XML file with all entities.
 */
router.get("/case/:caseId/investigation/maltego-export", async (req: Request<{ caseId: string }>, res: Response) => {
  try {
    const doc = await findCaseByParam(req.params.caseId);
    if (!doc) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    // Fetch graph data (reuse the same logic, now we call the graph builder inline)
    const inv = ensureInvestigation(doc);
    const entities = inv.entities ?? [];
    const nodes: GraphResponse["nodes"] = [
      { id: doc.caseNumber, type: "Case", label: doc.caseNumber, confidence: "VERIFIED", flags: [] },
    ];
    const links: GraphResponse["links"] = [];
    for (const entity of entities) {
      const enrichment = (inv.enrichments ?? []).find((e) => e.entityId === entity.id);
      const confidence = enrichment?.confidence ?? (entity.valid ? "LOW" : "UNVERIFIED");
      nodes.push({
        id: entity.value,
        type: entity.type,
        label: entity.type === "email" ? maskEmail(entity.value) : mask(entity.value),
        confidence,
        flags: [],
      });
      links.push({
        source: doc.caseNumber,
        target: entity.value,
        relationship: "INVOLVED",
        confidence,
      });
    }
    const graph: GraphResponse = { nodes, links, fallback: !graphDB.isAvailable() };
    const xml = generateMtgxXml(graph, doc.caseNumber);

    const filename = `${doc.caseNumber}-maltego-export.mtgx`;
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(xml);
  } catch (err) {
    res.status(500).json({ error: "Failed to generate Maltego export", detail: String(err) });
  }
});

export default router;
