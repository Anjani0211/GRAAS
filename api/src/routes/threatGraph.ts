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

const FiltersQ = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
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
    const confByEntityId = new Map<string, OsintConfidence>();
    for (const en of inv.enrichments ?? []) {
      confByEntityId.set(en.entityId, en.confidence);
    }
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
        confidence: confByEntityId.get(e.id),
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
      minCaseCount: parsed.minCaseCount ?? 2, // global view: at least 2 cases by default
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
        const confByEntityId = new Map<string, OsintConfidence>();
        for (const en of inv.enrichments ?? []) {
          confByEntityId.set(en.entityId, en.confidence);
        }
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
            confidence: confByEntityId.get(e.id),
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
      minCaseCount: parsed.minCaseCount ?? 2,
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
