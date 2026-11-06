import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { AuditLog, Case, RetentionAudit, type AuditAction, type RetentionAuditAction } from "../models";
import { runRetentionCycle, getRetentionPreview } from "../jobs/retentionJob";

const router = Router();

const ListAuditQuerySchema = z.object({
  action: z.string().optional(),
  userId: z.string().optional(),
  resourceId: z.string().optional(),
  outcome: z.enum(["SUCCESS", "FAILURE", "ALL"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

function escapeCsv(value: unknown): string {
  const raw = String(value ?? "");
  if (raw.includes(",") || raw.includes("\"") || raw.includes("\n")) {
    return `"${raw.replace(/"/g, "\"\"")}"`;
  }
  return raw;
}

function buildAuditFilter(query: z.infer<typeof ListAuditQuerySchema>): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (query.action) filter.action = query.action as AuditAction;
  if (query.userId) filter.userId = { $regex: new RegExp(query.userId, "i") };
  if (query.resourceId) filter.resourceId = { $regex: new RegExp(query.resourceId, "i") };
  if (query.outcome && query.outcome !== "ALL") filter.outcome = query.outcome;
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) (filter.createdAt as Record<string, unknown>).$gte = new Date(query.from);
    if (query.to) (filter.createdAt as Record<string, unknown>).$lte = new Date(query.to);
  }
  return filter;
}

router.get("/audit", async (req: Request, res: Response) => {
  try {
    const query = ListAuditQuerySchema.parse(req.query);
    const filter = buildAuditFilter(query);
    const [rows, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      AuditLog.countDocuments(filter),
    ]);
    res.json({ rows, total, page: query.page, limit: query.limit });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid query", details: err.issues });
      return;
    }
    res.status(500).json({ error: "Failed to list audit logs" });
  }
});

router.get("/audit/export/csv", async (req: Request, res: Response) => {
  try {
    const query = ListAuditQuerySchema.parse(req.query);
    const filter = buildAuditFilter(query);
    const filename = `audit_export_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.write("timestamp,action,userId,resourceId,outcome,ipHash\n");

    const cursor = AuditLog.find(filter).sort({ createdAt: -1 }).cursor();
    for await (const row of cursor) {
      const line = [
        escapeCsv(row.createdAt?.toISOString?.() ?? ""),
        escapeCsv(row.action),
        escapeCsv(row.userId),
        escapeCsv(row.resourceId || ""),
        escapeCsv(row.outcome),
        escapeCsv(row.ip),
      ].join(",");
      res.write(`${line}\n`);
    }
    res.end();
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid query", details: err.issues });
      return;
    }
    res.status(500).json({ error: "Failed to export audit CSV" });
  }
});

router.get("/retention-log", async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10)));
    const filter: Record<string, unknown> = {};
    if (req.query.from || req.query.to) {
      filter.timestamp = {};
      if (req.query.from) (filter.timestamp as Record<string, unknown>).$gte = new Date(String(req.query.from));
      if (req.query.to) (filter.timestamp as Record<string, unknown>).$lte = new Date(String(req.query.to));
    }
    const [rows, total] = await Promise.all([
      RetentionAudit.find(filter).sort({ timestamp: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      RetentionAudit.countDocuments(filter),
    ]);
    res.json({ rows, total, page, limit });
  } catch {
    res.status(500).json({ error: "Failed to list retention log" });
  }
});

router.get("/erasure-requests", async (req: Request, res: Response) => {
  try {
    const status = String(req.query.status ?? "ALL");
    const filter: Record<string, unknown> =
      status === "ALL"
        ? { erasureRequestStatus: { $ne: "NONE" } }
        : { erasureRequestStatus: status };
    const rows = await Case.find(filter)
      .select("caseNumber erasureRequestStatus erasureRequestedAt erasureResolvedAt activeProsecution retentionDeletedAt")
      .sort({ updatedAt: -1 })
      .limit(300)
      .lean();
    res.json({ rows });
  } catch {
    res.status(500).json({ error: "Failed to list erasure requests" });
  }
});

const ResolveBody = z.object({
  decision: z.enum(["APPROVED", "DENIED"]),
  reason: z.string().optional(),
});

router.patch("/erasure-requests/:caseId/resolve", async (req: Request<{ caseId: string }>, res: Response) => {
  try {
    const body = ResolveBody.parse(req.body);
    const apiBase = `${req.protocol}://${req.get("host")}/api`;
    const response = await fetch(`${apiBase}/cases/${encodeURIComponent(req.params.caseId)}/erasure-request/resolve`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: req.headers.authorization || "",
        cookie: req.headers.cookie || "",
      },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    res.status(response.status).json(data);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Validation failed", details: err.issues });
      return;
    }
    res.status(500).json({ error: "Failed to resolve erasure request" });
  }
});

router.post("/retention/run", async (_req: Request, res: Response) => {
  try {
    const result = await runRetentionCycle();
    res.json({ ok: true, result });
  } catch {
    res.status(500).json({ error: "Retention cycle failed" });
  }
});

router.get("/retention/preview", async (_req: Request, res: Response) => {
  try {
    const preview = await getRetentionPreview();
    const lastCycle = await RetentionAudit.findOne({ action: "CYCLE_COMPLETE" as RetentionAuditAction })
      .sort({ timestamp: -1 })
      .lean();
    res.json({ preview, lastCycle });
  } catch {
    res.status(500).json({ error: "Failed to build retention preview" });
  }
});

export default router;
