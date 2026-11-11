import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import { Router, Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import {
  Case,
  User,
  Notification,
  ANALYST_ROLES,
  SENIOR_ANALYST_ROLES,
  CATEGORIES,
  STATUSES,
  type ICase,
  type IEvidenceFile,
  type ICaseMessage,
} from "../models";
import { authenticate, authorize, requireRole } from "../middleware/auth";
import { caseEvidenceUpload } from "../middleware/caseUpload";
import { config } from "../config";
import { logEvent } from "../services/auditLog";
import { logRetentionEvent } from "../jobs/retentionJob";
import { storageService } from "../services/storageService";
import { logger } from "../utils/logger";
import { sendEmail } from "../services/notificationDelivery";

const router = Router();
const staffOnly = [authenticate, authorize(...ANALYST_ROLES)] as const;
const victimOnly = [authenticate, authorize("victim")] as const;

function isStaffRole(role: string): boolean {
  return (ANALYST_ROLES as readonly string[]).includes(role as (typeof ANALYST_ROLES)[number]);
}

/** Victims only see victim-visible messages (never internal notes). */
function caseJsonForViewer(doc: ICase, role: string): Record<string, unknown> {
  const json = doc.toJSON() as Record<string, unknown>;
  const messages = (Array.isArray(json.messages) ? json.messages : []) as ICaseMessage[];
  if (role === "victim") {
    json.messages = messages.filter((m) => m.visibility === "victim");
  }
  return json;
}

const CreateCaseSchema = z
  .object({
    victimName: z.string().min(1),
    victimEmail: z.string().email(),
    victimPhone: z.string().min(1),
    category: z.enum(CATEGORIES),
    description: z.string().min(1),
    monetaryLoss: z.number().optional(),
    incidentDate: z.string().optional(),
    state: z.string().optional(),
    district: z.string().optional(),
    complainantIsMinor: z.boolean().optional().default(false),
    involvesMinor: z.boolean().optional().default(false),
    guardianName: z.string().optional(),
    guardianContact: z.string().optional(),
    triageFlags: z.array(z.string()).optional().default([]),
  })
  .superRefine((val, ctx) => {
    if (val.complainantIsMinor) {
      if (!val.guardianName?.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["guardianName"],
          message: "Guardian name is required when complainant is a minor",
        });
      }
      if (!val.guardianContact?.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["guardianContact"],
          message: "Guardian contact is required when complainant is a minor",
        });
      }
    }
  });

const AssignCaseSchema = z.object({
  /** Staff user id; null/empty clears assignment. */
  officerId: z.string().nullable().optional(),
});

function parseBoolField(raw: unknown): boolean {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") {
    const v = raw.trim().toLowerCase();
    return v === "true" || v === "1" || v === "yes" || v === "on";
  }
  return false;
}

const StatusUpdateSchema = z.object({
  status: z.enum(STATUSES),
  note: z.string().optional(),
});

function generateCaseNumber(): string {
  const year = new Date().getFullYear();
  const suffix = uuidv4().replace(/-/g, "").slice(0, 5).toUpperCase();
  return `GRS-${year}-${suffix}`;
}

const uploadsRoot = path.join(process.cwd(), "uploads");

function buildEvidenceApiUrl(caseId: string, storedFilename: string): string {
  return `${config.publicBaseUrl}/api/cases/${encodeURIComponent(caseId)}/evidence/${encodeURIComponent(storedFilename)}`;
}

async function victimOwnsCase(userId: string, caseDoc: ICase): Promise<boolean> {
  const user = await User.findById(userId);
  if (!user) return false;
  const email = user.email.toLowerCase();
  return (
    (caseDoc.victimUserId != null && caseDoc.victimUserId.toString() === userId) ||
    caseDoc.victimEmail.toLowerCase() === email
  );
}

async function canAccessCaseEvidence(req: Request, caseDoc: ICase): Promise<boolean> {
  if (!req.auth) return false;
  if (isStaffRole(req.auth.role)) return true;
  if (req.auth.role !== "victim") return false;
  return victimOwnsCase(req.auth.userId, caseDoc);
}

async function softDeleteCaseEvidence(caseDoc: ICase): Promise<void> {
  const evidenceItems = caseDoc.osintInvestigation?.evidenceItems ?? [];
  for (const item of evidenceItems) {
    if (!item.storageKey) continue;
    await storageService.deleteObject(item.storageKey).catch(() => undefined);
  }
  const inv = caseDoc.osintInvestigation;
  if (inv) {
    inv.evidenceItems = [];
    inv.entities = [];
    inv.invalidEntities = [];
    inv.enrichments = [];
    inv.customTools = [];
    inv.reportMarkdown = "[DELETED — retention policy]";
    inv.reportJson = undefined;
    caseDoc.markModified("osintInvestigation");
  }
  caseDoc.retentionDeletedAt = new Date();
}

function multipartEvidenceOnly(req: Request, res: Response, next: NextFunction): void {
  const ct = req.headers["content-type"] || "";
  if (ct.includes("multipart/form-data")) {
    caseEvidenceUpload.array("evidence", 20)(req, res, (err: unknown) => {
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
}

router.post("/", multipartEvidenceOnly, async (req: Request, res: Response) => {
  try {
    const raw = req.body as Record<string, unknown>;
    const complainantIsMinor = parseBoolField(raw.complainantIsMinor);
    const involvesMinor = parseBoolField(raw.involvesMinor) || complainantIsMinor;
    let triageFlags: string[] = [];
    if (typeof raw.triageFlags === "string" && raw.triageFlags.trim()) {
      try {
        const parsed = JSON.parse(raw.triageFlags) as unknown;
        if (Array.isArray(parsed)) triageFlags = parsed.map(String);
      } catch {
        triageFlags = String(raw.triageFlags)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }
    } else if (Array.isArray(raw.triageFlags)) {
      triageFlags = raw.triageFlags.map(String);
    }
    if (involvesMinor && !triageFlags.includes("possible_minor_involved")) {
      triageFlags.push("possible_minor_involved");
    }
    if (complainantIsMinor && !triageFlags.includes("complainant_is_minor")) {
      triageFlags.push("complainant_is_minor");
    }

    const data = CreateCaseSchema.parse({
      victimName: raw.victimName,
      victimEmail: raw.victimEmail,
      victimPhone: raw.victimPhone,
      category: raw.category,
      description: raw.description,
      monetaryLoss:
        raw.monetaryLoss === undefined || raw.monetaryLoss === "" || raw.monetaryLoss === null
          ? undefined
          : Number(raw.monetaryLoss),
      incidentDate: raw.incidentDate ? String(raw.incidentDate) : undefined,
      state: raw.state ? String(raw.state) : undefined,
      district: raw.district ? String(raw.district) : undefined,
      complainantIsMinor,
      involvesMinor,
      guardianName: raw.guardianName ? String(raw.guardianName) : undefined,
      guardianContact: raw.guardianContact ? String(raw.guardianContact) : undefined,
      triageFlags,
    });

    const evidenceFiles: IEvidenceFile[] = [];
    const uploaded = req.files as Express.Multer.File[] | undefined;
    if (uploaded?.length) {
      for (const f of uploaded) {
        evidenceFiles.push({
          fileUrl: `${config.publicBaseUrl}/uploads/cases/${f.filename}`,
          fileName: f.originalname,
          fileType: f.mimetype || "application/octet-stream",
          fileSize: f.size,
          uploadedAt: new Date(),
        });
      }
    }

    const evidenceUrlRaw = raw.evidenceUrl != null ? String(raw.evidenceUrl).trim() : "";
    if (evidenceUrlRaw.length >= 8) {
      try {
        const u = new URL(evidenceUrlRaw);
        if (u.protocol === "http:" || u.protocol === "https:") {
          evidenceFiles.push({
            fileUrl: evidenceUrlRaw,
            fileName: "Submitted URL",
            fileType: "text/uri-list",
            uploadedAt: new Date(),
          });
        }
      } catch {
        // ignore invalid URL
      }
    }

    let victimUserId: mongoose.Types.ObjectId | undefined;
    if (req.auth?.role === "victim") {
      const user = await User.findById(req.auth.userId);
      if (!user) {
        res.status(401).json({ error: "User not found" });
        return;
      }
      if (user.email.toLowerCase() !== data.victimEmail.toLowerCase().trim()) {
        res.status(400).json({ error: "Complaint email must match your account email" });
        return;
      }
      victimUserId = user._id as mongoose.Types.ObjectId;
    }

    const severity = data.involvesMinor || data.complainantIsMinor ? "high" : "medium";

    const newCase = await Case.create({
      caseNumber: generateCaseNumber(),
      ...data,
      severity,
      victimUserId,
      incidentDate: data.incidentDate ? new Date(data.incidentDate) : undefined,
      evidenceFiles,
    });

    if (uploaded?.length) {
      const caseId = newCase._id.toString();
      newCase.evidenceFiles = newCase.evidenceFiles.map((ef) => {
        const storedName = ef.fileUrl.split("/").pop();
        if (!storedName || ef.fileType === "text/uri-list") return ef;
        return { ...ef, fileUrl: buildEvidenceApiUrl(caseId, storedName) };
      });
      await newCase.save();
    }

    res.status(201).json(newCase.toJSON());
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Validation failed", details: err.issues });
      return;
    }
    res.status(500).json({ error: "Failed to create case" });
  }
});

router.get("/mine", ...victimOnly, async (req: Request, res: Response) => {
  try {
    const user = await User.findById(req.auth!.userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const email = user.email.toLowerCase();

    const cases = await Case.find({
      $or: [{ victimUserId: user._id }, { victimEmail: { $regex: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") } }],
    })
      .sort({ createdAt: -1 })
      .limit(100);

    res.json(cases.map((c) => c.toJSON()));
  } catch {
    res.status(500).json({ error: "Failed to fetch your cases" });
  }
});

router.get("/mine/:id", ...victimOnly, async (req: Request<{ id: string }>, res: Response) => {
  try {
    const user = await User.findById(req.auth!.userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const email = user.email.toLowerCase();
    const id = req.params.id;
    const isObjectId = /^[a-f\d]{24}$/i.test(id);
    const found = isObjectId ? await Case.findById(id) : await Case.findOne({ caseNumber: id });

    if (!found) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    const owns =
      (found.victimUserId && found.victimUserId.toString() === user._id.toString()) ||
      found.victimEmail.toLowerCase() === email;

    if (!owns) {
      res.status(403).json({ error: "You do not have access to this case" });
      return;
    }

    res.json(caseJsonForViewer(found, "victim"));
  } catch {
    res.status(500).json({ error: "Failed to fetch case" });
  }
});

router.get("/", ...staffOnly, async (req: Request, res: Response) => {
  try {
    const { status, severity, category, q, unassigned, limit = "50", offset = "0" } = req.query;

    const filter: Record<string, unknown> = {};
    const andClauses: Record<string, unknown>[] = [];
    if (status && typeof status === "string") filter.status = status;
    if (severity && typeof severity === "string") filter.severity = severity;
    if (category && typeof category === "string") filter.category = category;

    if (unassigned === "1" || unassigned === "true") {
      andClauses.push({
        $or: [
          { assignedOfficerId: null },
          { assignedOfficerId: { $exists: false } },
          { assignedOfficerId: "" },
        ],
      });
      if (!filter.status) andClauses.push({ status: { $ne: "closed" } });
    }

    if (q && typeof q === "string" && q.trim()) {
      const escaped = q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rx = new RegExp(escaped, "i");
      andClauses.push({
        $or: [
          { caseNumber: rx },
          { victimName: rx },
          { victimEmail: rx },
          { description: rx },
        ],
      });
    }

    if (andClauses.length === 1) Object.assign(filter, andClauses[0]);
    else if (andClauses.length > 1) filter.$and = andClauses;

    const cases = await Case.find(filter)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit as string, 10))
      .skip(parseInt(offset as string, 10));

    res.json(cases.map((c) => c.toJSON()));
  } catch {
    res.status(500).json({ error: "Failed to fetch cases" });
  }
});

/** Closed cases that count as “resolved” in the calendar month (closed this month, or legacy: closed with no closedAt but filed this month). */
function resolvedThisMonthFilter(monthStart: Date) {
  return {
    status: "closed" as const,
    $or: [
      { closedAt: { $gte: monthStart } },
      {
        $and: [
          { $or: [{ closedAt: null }, { closedAt: { $exists: false } }] },
          { createdAt: { $gte: monthStart } },
        ],
      },
    ],
  };
}

router.get("/stats", ...staffOnly, async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const resolvedFilter = resolvedThisMonthFilter(monthStart);
    const prevResolvedFilter = {
      status: "closed" as const,
      $or: [
        { closedAt: { $gte: prevMonthStart, $lt: monthStart } },
        {
          $and: [
            { $or: [{ closedAt: null }, { closedAt: { $exists: false } }] },
            { createdAt: { $gte: prevMonthStart, $lt: monthStart } },
          ],
        },
      ],
    };

    const avgMs = (rows: Array<{ closedAt?: Date | null; updatedAt: Date; createdAt: Date }>) =>
      rows.length > 0
        ? rows.reduce((sum, c) => {
            const endMs = c.closedAt
              ? new Date(c.closedAt).getTime()
              : new Date(c.updatedAt).getTime();
            return sum + (endMs - new Date(c.createdAt).getTime());
          }, 0) / rows.length
        : 0;

    const [
      totalThisMonth,
      resolved,
      highSeverity,
      allCases,
      closedResolvedThisMonth,
      prevTotal,
      prevResolved,
      prevHighSeverity,
      prevClosedResolved,
    ] = await Promise.all([
      Case.countDocuments({ createdAt: { $gte: monthStart } }),
      Case.countDocuments(resolvedFilter),
      Case.countDocuments({ severity: "high", createdAt: { $gte: monthStart } }),
      Case.find({ createdAt: { $gte: monthStart } }).lean(),
      Case.find(resolvedFilter).lean(),
      Case.countDocuments({ createdAt: { $gte: prevMonthStart, $lt: monthStart } }),
      Case.countDocuments(prevResolvedFilter),
      Case.countDocuments({
        severity: "high",
        createdAt: { $gte: prevMonthStart, $lt: monthStart },
      }),
      Case.find(prevResolvedFilter).lean(),
    ]);

    const avgResolutionMs = avgMs(closedResolvedThisMonth);
    const avgResolutionDays = +(avgResolutionMs / (1000 * 60 * 60 * 24)).toFixed(1);
    const prevAvgResolutionDays = +(avgMs(prevClosedResolved) / (1000 * 60 * 60 * 24)).toFixed(1);

    const delta = (current: number, previous: number) => current - previous;

    const severityCounts = { high: 0, medium: 0, low: 0 };
    const categoryCounts: Record<string, number> = {};
    const stateCounts: Record<string, number> = {};

    for (const c of allCases) {
      severityCounts[c.severity as keyof typeof severityCounts]++;
      categoryCounts[c.category] = (categoryCounts[c.category] || 0) + 1;
      if (c.state) stateCounts[c.state] = (stateCounts[c.state] || 0) + 1;
    }

    const unassigned = allCases.filter((c) => !c.assignedOfficerId && c.status !== "closed").length;
    const pendingTriage = allCases.filter((c) => c.status === "submitted").length;

    // Last 30 days reported vs resolved (for analytics chart)
    const days = 30;
    const seriesStart = new Date(now);
    seriesStart.setHours(0, 0, 0, 0);
    seriesStart.setDate(seriesStart.getDate() - (days - 1));
    const seriesCases = await Case.find({
      $or: [
        { createdAt: { $gte: seriesStart } },
        { closedAt: { $gte: seriesStart } },
      ],
    })
      .select("createdAt closedAt status")
      .lean();

    const byDay: Record<string, { reported: number; resolved: number }> = {};
    for (let i = 0; i < days; i++) {
      const d = new Date(seriesStart);
      d.setDate(seriesStart.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      byDay[key] = { reported: 0, resolved: 0 };
    }
    for (const c of seriesCases) {
      const createdKey = new Date(c.createdAt).toISOString().slice(0, 10);
      if (byDay[createdKey]) byDay[createdKey].reported += 1;
      if (c.status === "closed" && c.closedAt) {
        const closedKey = new Date(c.closedAt).toISOString().slice(0, 10);
        if (byDay[closedKey]) byDay[closedKey].resolved += 1;
      }
    }
    const casesOverTime = Object.entries(byDay).map(([date, v]) => ({
      date,
      reported: v.reported,
      resolved: v.resolved,
    }));

    res.json({
      kpis: {
        totalThisMonth,
        resolved,
        avgResolutionDays,
        highSeverity,
        deltas: {
          totalThisMonth: delta(totalThisMonth, prevTotal),
          resolved: delta(resolved, prevResolved),
          avgResolutionDays: +(avgResolutionDays - prevAvgResolutionDays).toFixed(1),
          highSeverity: delta(highSeverity, prevHighSeverity),
        },
      },
      severityCounts,
      categoryCounts,
      stateCounts,
      unassigned,
      pendingTriage,
      casesOverTime,
    });
  } catch {
    res.status(500).json({ error: "Failed to compute stats" });
  }
});

/** Victim appends evidence to an existing owned case. */
router.post(
  "/:caseId/evidence",
  ...victimOnly,
  (req: Request, res: Response, next: NextFunction) => {
    caseEvidenceUpload.array("evidence", 10)(req, res, (err: unknown) => {
      if (err) {
        const message = err instanceof Error ? err.message : "File upload failed";
        res.status(400).json({ error: message });
        return;
      }
      next();
    });
  },
  async (req: Request<{ caseId: string }>, res: Response) => {
    try {
      const caseId = req.params.caseId;
      const isObjectId = /^[a-f\d]{24}$/i.test(caseId);
      const caseDoc = isObjectId
        ? await Case.findById(caseId)
        : await Case.findOne({ caseNumber: caseId });

      if (!caseDoc) {
        res.status(404).json({ error: "Case not found" });
        return;
      }
      if (!(await victimOwnsCase(req.auth!.userId, caseDoc))) {
        res.status(403).json({ error: "You do not have access to this case" });
        return;
      }
      if (caseDoc.erasureRequestStatus === "APPROVED" || caseDoc.retentionDeletedAt) {
        res.status(409).json({ error: "Cannot upload evidence after erasure/retention delete" });
        return;
      }

      const uploaded = req.files as Express.Multer.File[] | undefined;
      if (!uploaded?.length) {
        res.status(400).json({ error: "No evidence files provided (field name: evidence)" });
        return;
      }

      const added: IEvidenceFile[] = [];
      const caseKey = caseDoc._id.toString();
      for (const f of uploaded) {
        const storedName = f.filename;
        added.push({
          fileUrl: buildEvidenceApiUrl(caseKey, storedName),
          fileName: f.originalname,
          fileType: f.mimetype || "application/octet-stream",
          fileSize: f.size,
          uploadedAt: new Date(),
        });
      }
      caseDoc.evidenceFiles.push(...added);
      await caseDoc.save();

      await logEvent({
        userId: req.auth!.userId,
        action: "EVIDENCE_UPLOAD",
        resourceId: caseDoc.caseNumber,
        outcome: "SUCCESS",
        ip: req.ip ?? "unknown",
        metadata: { count: added.length },
      });

      res.status(201).json({
        message: "Evidence uploaded",
        caseId: caseDoc.caseNumber,
        evidenceFiles: caseDoc.evidenceFiles,
        added,
      });
    } catch {
      res.status(500).json({ error: "Failed to upload evidence" });
    }
  },
);

/** Authenticated evidence download — replaces public /uploads access. */
router.get("/:caseId/evidence/:filename", authenticate, async (req: Request<{ caseId: string; filename: string }>, res: Response) => {
  try {
    const caseId = req.params.caseId;
    const filename = req.params.filename;
    if (!filename || filename.includes("..")) {
      res.status(400).json({ error: "Invalid filename" });
      return;
    }

    const isObjectId = /^[a-f\d]{24}$/i.test(caseId);
    const caseDoc = isObjectId
      ? await Case.findById(caseId)
      : await Case.findOne({ caseNumber: caseId });

    if (!caseDoc) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    if (!(await canAccessCaseEvidence(req, caseDoc))) {
      res.status(403).json({ error: "You do not have access to this evidence" });
      return;
    }

    const match = caseDoc.evidenceFiles.find((ef) => ef.fileUrl.includes(filename));
    if (!match) {
      res.status(404).json({ error: "Evidence file not found" });
      return;
    }

    const abs = path.join(uploadsRoot, "cases", filename);
    if (!abs.startsWith(path.join(uploadsRoot, "cases")) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      res.status(404).json({ error: "File not found on disk" });
      return;
    }

    await logEvent({
      userId: req.auth!.userId,
      action: "EVIDENCE_ACCESS",
      resourceId: `${caseDoc.caseNumber}/${filename}`,
      outcome: "SUCCESS",
      ip: req.ip ?? "unknown",
      metadata: { method: "GET", path: req.path },
    });

    res.sendFile(abs);
  } catch {
    res.status(500).json({ error: "Failed to download evidence" });
  }
});

/** Case detail: staff (any case) or victim (own case only). Not public. */
router.get("/:id", authenticate, async (req: Request<{ id: string }>, res: Response) => {
  try {
    const role = req.auth!.role;
    const id = req.params.id;
    const isObjectId = /^[a-f\d]{24}$/i.test(id);
    const found = isObjectId
      ? await Case.findById(id)
      : await Case.findOne({ caseNumber: id });

    if (!found) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    if (isStaffRole(role)) {
      res.json(caseJsonForViewer(found, role));
      return;
    }

    if (role === "victim") {
      const user = await User.findById(req.auth!.userId);
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      const email = user.email.toLowerCase();
      const owns =
        (found.victimUserId && found.victimUserId.toString() === user._id.toString()) ||
        found.victimEmail.toLowerCase() === email;
      if (!owns) {
        res.status(403).json({ error: "You do not have access to this case" });
        return;
      }
      res.json(caseJsonForViewer(found, "victim"));
      return;
    }

    res.status(403).json({ error: "Insufficient permissions" });
  } catch {
    res.status(500).json({ error: "Failed to fetch case" });
  }
});

const MessageBodySchema = z.object({
  body: z.string().min(1).max(5000),
  /** Staff: internal (default) or victim-visible. Victims always create victim-visible. */
  visibility: z.enum(["internal", "victim"]).optional(),
});

/** POST /cases/:id/messages — staff notes or victim messages */
router.post("/:id/messages", authenticate, async (req: Request<{ id: string }>, res: Response) => {
  try {
    const data = MessageBodySchema.parse(req.body);
    const role = req.auth!.role;
    const id = req.params.id;
    const isObjectId = /^[a-f\d]{24}$/i.test(id);
    const found = isObjectId ? await Case.findById(id) : await Case.findOne({ caseNumber: id });
    if (!found) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    const user = req.user ?? (await User.findById(req.auth!.userId));
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (role === "victim") {
      const owns = await victimOwnsCase(req.auth!.userId, found);
      if (!owns) {
        res.status(403).json({ error: "You do not have access to this case" });
        return;
      }
    } else if (!isStaffRole(role)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }

    const visibility: ICaseMessage["visibility"] =
      role === "victim" ? "victim" : (data.visibility ?? "internal");

    const msg: ICaseMessage = {
      id: uuidv4(),
      body: data.body.trim(),
      visibility,
      authorId: String(user._id),
      authorName: user.name,
      authorRole: user.role,
      createdAt: new Date(),
    };
    found.messages = found.messages ?? [];
    found.messages.push(msg);
    found.markModified("messages");
    await found.save();

    await logEvent({
      userId: req.auth!.userId,
      action: "CASE_VIEW",
      resourceId: found.caseNumber,
      outcome: "SUCCESS",
      ip: req.ip ?? "unknown",
      metadata: { messageId: msg.id, visibility, kind: "message_posted" },
    }).catch(() => undefined);

    res.status(201).json({ message: msg });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Validation failed", details: err.issues });
      return;
    }
    logger.error({ err }, "[Cases] message create failed");
    res.status(500).json({ error: "Failed to post message" });
  }
});

/** Assign / unassign a staff officer on a case. */
router.patch(
  "/:id/assign",
  authenticate,
  requireRole(...SENIOR_ANALYST_ROLES),
  async (req: Request<{ id: string }>, res: Response) => {
    try {
      const data = AssignCaseSchema.parse(req.body);
      const id = req.params.id;
      const isOid = /^[a-f\d]{24}$/i.test(id);
      const caseDoc = isOid ? await Case.findById(id) : await Case.findOne({ caseNumber: id });
      if (!caseDoc) {
        res.status(404).json({ error: "Case not found" });
        return;
      }

      const officerId = data.officerId?.trim() || null;
      if (!officerId) {
        caseDoc.assignedOfficerId = undefined;
        caseDoc.assignedOfficerName = undefined;
        caseDoc.assignedAt = undefined;
        await caseDoc.save();
        await logEvent({
          userId: req.auth!.userId,
          action: "CASE_ASSIGNED",
          resourceId: caseDoc.caseNumber,
          outcome: "SUCCESS",
          ip: req.ip ?? "unknown",
          metadata: { cleared: true },
        });
        res.json({
          message: "Assignment cleared",
          caseId: caseDoc.caseNumber,
          assignedOfficerId: null,
          assignedOfficerName: null,
        });
        return;
      }

      if (!/^[a-f\d]{24}$/i.test(officerId)) {
        res.status(400).json({ error: "officerId must be a valid user id" });
        return;
      }

      const officer = await User.findById(officerId);
      if (!officer || !officer.isActive) {
        res.status(404).json({ error: "Officer not found or inactive" });
        return;
      }
      if (officer.role === "victim") {
        res.status(400).json({ error: "Cannot assign a victim account as officer" });
        return;
      }

      caseDoc.assignedOfficerId = String(officer._id);
      caseDoc.assignedOfficerName = officer.name;
      caseDoc.assignedAt = new Date();
      await caseDoc.save();

      await logEvent({
        userId: req.auth!.userId,
        action: "CASE_ASSIGNED",
        resourceId: caseDoc.caseNumber,
        outcome: "SUCCESS",
        ip: req.ip ?? "unknown",
        metadata: { officerId: String(officer._id), officerName: officer.name },
      });

      res.json({
        message: "Case assigned",
        caseId: caseDoc.caseNumber,
        assignedOfficerId: caseDoc.assignedOfficerId,
        assignedOfficerName: caseDoc.assignedOfficerName,
        assignedAt: caseDoc.assignedAt,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Validation failed", details: err.issues });
        return;
      }
      res.status(500).json({ error: "Failed to assign case" });
    }
  },
);

router.patch("/:id/status", ...staffOnly, async (req: Request<{ id: string }>, res: Response) => {
  try {
    const data = StatusUpdateSchema.parse(req.body);
    const id = req.params.id;
    const isObjectId = /^[a-f\d]{24}$/i.test(id);
    const filter = isObjectId ? { _id: id } : { caseNumber: id };

    const prev = await Case.findOne(filter);
    if (!prev) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    const $set: Record<string, unknown> = { status: data.status, updatedAt: new Date() };
    if (data.status === "closed" && prev.status !== "closed") {
      $set.closedAt = new Date();
    }

    const update: mongoose.UpdateQuery<ICase> = { $set };
    if (data.status !== "closed" && prev.status === "closed") {
      update.$unset = { closedAt: 1 };
    }

    const updated = await Case.findOneAndUpdate(filter, update, { new: true });

    if (!updated) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    res.json({
      message: "Status updated",
      caseId: updated._id,
      newStatus: data.status,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Validation failed", details: err.issues });
      return;
    }
    res.status(500).json({ error: "Failed to update status" });
  }
});

router.post("/:caseId/erasure-request", ...victimOnly, async (req: Request<{ caseId: string }>, res: Response) => {
  try {
    const doc = await Case.findOne({ caseNumber: req.params.caseId });
    if (!doc) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    const user = await User.findById(req.auth!.userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const owns =
      (doc.victimUserId && doc.victimUserId.toString() === user._id.toString()) ||
      doc.victimEmail.toLowerCase() === user.email.toLowerCase();
    if (!owns) {
      res.status(403).json({ error: "You do not have access to this case" });
      return;
    }
    if (doc.activeProsecution) {
      res.status(409).json({
        error: "Erasure request cannot be processed while case has active prosecution flag.",
        code: "ACTIVE_PROSECUTION",
      });
      return;
    }
    if (doc.erasureRequestStatus === "PENDING") {
      res.status(409).json({ error: "Erasure request already pending.", code: "ALREADY_PENDING" });
      return;
    }
    doc.erasureRequestStatus = "PENDING";
    doc.erasureRequestedAt = new Date();
    await doc.save();
    await logEvent({
      userId: req.auth!.userId,
      action: "ERASURE_REQUESTED",
      resourceId: doc.caseNumber,
      outcome: "SUCCESS",
      ip: req.ip ?? "unknown",
      metadata: { caseNumber: doc.caseNumber },
    });
    const acknowledgementDeadline = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    const ackText =
      `We acknowledge your data erasure request for GRAAS case ${doc.caseNumber}.\n\n` +
      `Under DPDP, we will respond by ${acknowledgementDeadline}.\n` +
      `If the case has an active prosecution hold, erasure may be deferred.\n\n` +
      `— GRAAS Privacy Desk`;
    const emailResult = await sendEmail({
      to: doc.victimEmail,
      subject: `Erasure request acknowledged — ${doc.caseNumber}`,
      text: ackText,
    });
    await Notification.create({
      caseId: doc._id,
      channel: "email",
      recipient: doc.victimEmail,
      message: ackText,
      status: emailResult.delivered ? "sent" : "queued",
    }).catch(() => undefined);

    logger.info(
      {
        caseId: doc.caseNumber,
        deadline: acknowledgementDeadline,
        emailDelivery: emailResult.delivered ? emailResult.provider : "queued",
        reason: emailResult.delivered ? undefined : emailResult.reason,
      },
      "[Erasure] Request received — DPDP 72h acknowledgement",
    );
    res.status(202).json({
      message: `Erasure request received. Reference: ${doc.caseNumber}`,
      acknowledgementDeadline,
      emailAck: emailResult.delivered ? "sent" : "queued",
      note: emailResult.delivered
        ? "Acknowledgement email sent to the case contact address."
        : `Acknowledgement recorded; email queued (${emailResult.reason}).`,
    });
  } catch {
    res.status(500).json({ error: "Failed to create erasure request" });
  }
});

const ResolveErasureBody = z.object({
  decision: z.enum(["APPROVED", "DENIED"]),
  reason: z.string().trim().optional(),
});

router.patch(
  "/:caseId/erasure-request/resolve",
  authenticate,
  requireRole(...SENIOR_ANALYST_ROLES),
  async (req: Request<{ caseId: string }>, res: Response) => {
    try {
      const body = ResolveErasureBody.parse(req.body);
      const doc = await Case.findOne({ caseNumber: req.params.caseId });
      if (!doc) {
        res.status(404).json({ error: "Case not found" });
        return;
      }
      if (doc.activeProsecution) {
        res.status(409).json({
          error: "Erasure request cannot be resolved while active prosecution is enabled.",
          code: "ACTIVE_PROSECUTION",
        });
        return;
      }
      doc.erasureRequestStatus = body.decision;
      doc.erasureResolvedAt = new Date();
      if (body.decision === "APPROVED") {
        await softDeleteCaseEvidence(doc);
        await logRetentionEvent({
          caseId: doc.caseNumber,
          action: "ERASURE_COMPLETED",
          reason: "MANUAL_APPROVAL",
        });
      } else {
        await logRetentionEvent({
          caseId: doc.caseNumber,
          action: "ERASURE_DENIED",
          reason: body.reason || "NO_REASON_PROVIDED",
        });
      }
      await doc.save();
      await logEvent({
        userId: req.auth!.userId,
        action: "ERASURE_RESOLVED",
        resourceId: doc.caseNumber,
        outcome: "SUCCESS",
        ip: req.ip ?? "unknown",
        metadata: { decision: body.decision, reason: body.reason || "" },
      });
      res.json({ caseId: doc.caseNumber, status: doc.erasureRequestStatus });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Validation failed", details: err.issues });
        return;
      }
      res.status(500).json({ error: "Failed to resolve erasure request" });
    }
  },
);

export default router;
