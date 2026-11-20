/**
 * Threat-intelligence graph routes
 * ────────────────────────────────
 * Cross-case views layered on top of the per-case investigation graph
 * already exposed under /osint/case/:id/investigation/graph.
 *
 *   GET /threat-graph/global
 *     Whole-graph slice across all cases. Filters: from/to/entity types/
 *     minCaseCount/minConfidence/nodeLimit.
 *
 *   GET /threat-graph/entity/:type/:value
 *     Entity-centric view — the entity, every case touching it, every
 *     other entity that co-occurs in those cases. Co-occurrence edges on.
 *
 *   GET /threat-graph/top-threats
 *     Ranked list only (no graph) — for the dashboard widget.
 */
import { Router, Request, Response } from "express";
import { z } from "zod";
import { Case } from "../models";
import type { OsintConfidence, OsintEntityType } from "../models";
import {
  projectEntities,
  buildGraphSlice,
  type CaseTouch,
  type ThreatGraphFilters,
} from "../services/threatGraph";
import { logger } from "../utils/logger";

const router = Router();

const ENTITY_TYPES = ["phone", "upi", "email", "url", "domain", "ipv4", "wallet", "telegram", "username"] as const;
const CONFIDENCES = ["VERIFIED", "HIGH", "MEDIUM", "LOW", "UNVERIFIED"] as const;

/** Accept full ISO datetime or HTML date input (YYYY-MM-DD). Empty → undefined. */
const DateFilter = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z
    .string()
    .trim()
    .min(1)
    .refine(
      (v) =>
        /^\d{4}-\d{2}-\d{2}$/.test(v) ||
        !Number.isNaN(Date.parse(v)),
      { message: "Invalid date" },
    )
    .transform((v) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v}T00:00:00.000Z`;
      return new Date(v).toISOString();
    })
    .optional(),
);

const FiltersQ = z.object({
  from: DateFilter,
  to: DateFilter,
  entityTypes: z
    .union([z.array(z.enum(ENTITY_TYPES)), z.enum(ENTITY_TYPES)])
    .optional(),
  minCaseCount: z.coerce.number().int().min(1).max(100).optional(),
  minConfidence: z.enum(CONFIDENCES).optional(),
  nodeLimit: z.coerce.number().int().min(10).max(2000).optional(),
});

function asEntityTypeArray(
  v: OsintEntityType | OsintEntityType[] | readonly OsintEntityType[] | undefined,
): OsintEntityType[] | undefined {
  if (!v) return undefined;
  if (Array.isArray(v)) return [...v];
  return [v as OsintEntityType];
}

/** Agent tools often key enrichments by callId — also match on detail values. */
function resolveEntityConfidence(
  entityId: string,
  value: string,
  enrichments: Array<{ entityId: string; confidence: OsintConfidence; details?: Record<string, unknown> }> | undefined,
): OsintConfidence | undefined {
  if (!enrichments?.length) return undefined;
  const byId = enrichments.find((en) => en.entityId === entityId);
  if (byId) return byId.confidence;
  const needle = value.toLowerCase();
  for (const en of enrichments) {
    const d = en.details ?? {};
    for (const k of [
      "entity",
      "phone",
      "upi",
      "email",
      "domain",
      "url",
      "username",
      "value",
      "vpa",
      "handle",
    ]) {
      const raw = d[k];
      if (raw != null && String(raw).toLowerCase() === needle) return en.confidence;
    }
  }
  return undefined;
}

type RawRow = {
  type: OsintEntityType;
  value: string;
  touches: CaseTouch[];
};

/**
 * Aggregate every entity occurrence across all cases into RawRow[].
 * Bounded by date range when supplied (push the filter into Mongo to keep
 * the in-memory set tractable on large deployments).
 */
async function fetchEntityRows(filters: {
  from?: string;
  to?: string;
}): Promise<RawRow[]> {
  const match: Record<string, unknown> = {
    "osintInvestigation.entities.0": { $exists: true },
  };
  if (filters.from || filters.to) {
    const range: Record<string, Date> = {};
    if (filters.from) range.$gte = new Date(filters.from);
    if (filters.to) range.$lte = new Date(filters.to);
    match.$or = [{ incidentDate: range }, { createdAt: range }];
  }

  const cases = await Case.find(match)
    .select(
      "caseNumber severity status monetaryLoss incidentDate createdAt osintInvestigation.entities osintInvestigation.enrichments",
    )
    .lean();

  // Roll-up: (type,value) → [touches]
  const bucket = new Map<string, RawRow>();
  for (const c of cases) {
    const inv = c.osintInvestigation;
    if (!inv?.entities?.length) continue;
    for (const e of inv.entities) {
      if (!e.valid) continue;
      const key = `${e.type}::${e.value.toLowerCase()}`;
      let row = bucket.get(key);
      if (!row) {
        row = { type: e.type, value: e.value, touches: [] };
        bucket.set(key, row);
      }
      row.touches.push({
        caseNumber: c.caseNumber,
        caseSeverity: c.severity,
        caseStatus: c.status,
        lossInr: c.monetaryLoss ?? 0,
        incidentDate:
          (c.incidentDate ?? c.createdAt ?? new Date()).toISOString(),
        confidence: resolveEntityConfidence(e.id, e.value, inv.enrichments),
      });
    }
  }
  return [...bucket.values()];
}

router.get("/global", async (req: Request, res: Response) => {
  try {
    const parsed = FiltersQ.parse(req.query);
    const filters: ThreatGraphFilters = {
      from: parsed.from,
      to: parsed.to,
      entityTypes: asEntityTypeArray(parsed.entityTypes),
      // Default 1 so single-case deployments still render; UI can raise the floor.
      minCaseCount: parsed.minCaseCount ?? 1,
      minConfidence: parsed.minConfidence,
      nodeLimit: parsed.nodeLimit,
    };

    const raw = await fetchEntityRows({ from: parsed.from, to: parsed.to });
    const projected = projectEntities(raw, filters);
    const slice = buildGraphSlice(projected, {
      nodeLimit: filters.nodeLimit,
      coOccurMode: false,
    });

    res.json(slice);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Validation failed", details: err.issues });
      return;
    }
    logger.error({ err }, "[ThreatGraph] /global failed");
    res.status(500).json({ error: "Failed to build threat graph" });
  }
});

router.get(
  "/entity/:type/:value",
  async (req: Request<{ type: string; value: string }>, res: Response) => {
    try {
      const type = req.params.type as OsintEntityType;
      const value = req.params.value;
      if (!ENTITY_TYPES.includes(type)) {
        res.status(400).json({ error: "Unknown entity type" });
        return;
      }
      const parsed = FiltersQ.parse(req.query);
      const filters: ThreatGraphFilters = {
        from: parsed.from,
        to: parsed.to,
        nodeLimit: parsed.nodeLimit ?? 400,
        minCaseCount: 1,
        minConfidence: parsed.minConfidence,
      };

      // Find cases that touch this entity.
      const cases = await Case.find({
        "osintInvestigation.entities": {
          $elemMatch: { type, value: { $regex: `^${value}$`, $options: "i" } },
        },
      })
        .select(
          "caseNumber severity status monetaryLoss incidentDate createdAt osintInvestigation.entities osintInvestigation.enrichments",
        )
        .lean();

      // Roll up ALL entities seen in those cases (so the pivot view shows
      // every co-occurring indicator, not just the queried one).
      const bucket = new Map<string, RawRow>();
      for (const c of cases) {
        const inv = c.osintInvestigation;
        if (!inv?.entities?.length) continue;
        for (const e of inv.entities) {
          if (!e.valid) continue;
          const k = `${e.type}::${e.value.toLowerCase()}`;
          let row = bucket.get(k);
          if (!row) {
            row = { type: e.type, value: e.value, touches: [] };
            bucket.set(k, row);
          }
          row.touches.push({
            caseNumber: c.caseNumber,
            caseSeverity: c.severity,
            caseStatus: c.status,
            lossInr: c.monetaryLoss ?? 0,
            incidentDate: (c.incidentDate ?? c.createdAt ?? new Date()).toISOString(),
            confidence: resolveEntityConfidence(e.id, e.value, inv.enrichments),
          });
        }
      }

      const projected = projectEntities([...bucket.values()], filters);
      const slice = buildGraphSlice(projected, {
        nodeLimit: filters.nodeLimit,
        coOccurMode: true,
      });
      res.json({ ...slice, focus: { type, value } });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Validation failed", details: err.issues });
        return;
      }
      logger.error({ err }, "[ThreatGraph] /entity failed");
      res.status(500).json({ error: "Failed to build entity graph" });
    }
  },
);

router.get("/top-threats", async (req: Request, res: Response) => {
  try {
    const parsed = FiltersQ.parse(req.query);
    const filters: ThreatGraphFilters = {
      from: parsed.from,
      to: parsed.to,
      entityTypes: asEntityTypeArray(parsed.entityTypes),
      minCaseCount: parsed.minCaseCount ?? 1,
      minConfidence: parsed.minConfidence,
    };
    const raw = await fetchEntityRows({ from: parsed.from, to: parsed.to });
    const projected = projectEntities(raw, filters);
    res.json({ topThreats: projected.slice(0, 50) });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Validation failed", details: err.issues });
      return;
    }
    logger.error({ err }, "[ThreatGraph] /top-threats failed");
    res.status(500).json({ error: "Failed to compute top threats" });
  }
});

export default router;
