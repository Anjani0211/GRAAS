/**
 * Threat-intelligence graph service
 * ─────────────────────────────────
 * Builds a cross-case threat graph from MongoDB / Neo4j data. Three views:
 *
 *   1. Global  — every entity that appears in 2+ cases (or that is part of
 *                a cluster alert), with edges to the cases that touch it.
 *   2. Entity  — one entity at the center, with every case that touches it,
 *                and every other entity that co-occurs in those cases.
 *   3. Ranking — top-N entities ranked by case-count × severity-weight, so
 *                analysts see "the wallet that's running the show" first.
 *
 * Pure functions over typed inputs; routes layer feeds them with Mongo
 * aggregation results. Keeps DB queries isolated from the ranking logic
 * so the algorithm is unit-testable without spinning up Mongo.
 */
import type { OsintEntityType, OsintConfidence } from "../models";

// ── Public types ───────────────────────────────────────────────────────

export interface ThreatEntityKey {
  type: OsintEntityType;
  value: string;
}

export interface CaseTouch {
  caseNumber: string;
  caseSeverity?: "high" | "medium" | "low";
  caseStatus?: string;
  lossInr?: number;
  incidentDate?: string;
  confidence?: OsintConfidence;
}

export interface EntityRow extends ThreatEntityKey {
  touches: CaseTouch[];
  /** Highest-confidence label across all enrichments. */
  bestConfidence: OsintConfidence;
  /** Aggregated risk score (0-100) — used by the ranker. */
  riskScore: number;
  /** Sum of monetary loss across all linked cases. */
  totalLossInr: number;
  /** Per-confidence-bucket counts. */
  confidenceMix: Record<OsintConfidence, number>;
}

export type ThreatGraphNodeType = "Case" | "Entity";

export interface ThreatGraphNode {
  id: string;
  type: ThreatGraphNodeType;
  entityType?: OsintEntityType;
  label: string;
  caseCount?: number;
  riskScore?: number;
  totalLossInr?: number;
  severity?: "high" | "medium" | "low";
  confidence?: OsintConfidence;
}

export interface ThreatGraphLink {
  source: string;
  target: string;
  relationship: "INVOLVED" | "CO_OCCURS";
  weight?: number;
}

export interface ThreatGraphSlice {
  nodes: ThreatGraphNode[];
  links: ThreatGraphLink[];
  /** Top-N ranked entities (for the side panel). */
  topThreats: EntityRow[];
  /** Counters useful for the dashboard. */
  stats: {
    totalEntities: number;
    totalCases: number;
    totalEdges: number;
    highRiskEntities: number;
    earliestIncident?: string;
    latestIncident?: string;
  };
}

export interface ThreatGraphFilters {
  /** ISO date inclusive lower bound. */
  from?: string;
  to?: string;
  entityTypes?: OsintEntityType[];
  /** Only include entities with at least this many distinct case touches. */
  minCaseCount?: number;
  /** Only include entities meeting at least this confidence level. */
  minConfidence?: OsintConfidence;
  /** Hard cap on rendered nodes — keeps the force graph snappy. */
  nodeLimit?: number;
}

// ── Internal helpers ───────────────────────────────────────────────────

const CONFIDENCE_RANK: Record<OsintConfidence, number> = {
  VERIFIED: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  UNVERIFIED: 0,
};

const ENTITY_TYPE_WEIGHT: Record<OsintEntityType, number> = {
  upi: 1.4, // freezable money rail — most actionable
  wallet: 1.3,
  phone: 1.1,
  email: 1.0,
  url: 1.0,
  domain: 1.05,
  ipv4: 0.9,
  telegram: 0.95,
  username: 0.85,
};

const SEVERITY_WEIGHT: Record<NonNullable<CaseTouch["caseSeverity"]>, number> =
  { high: 1.5, medium: 1.0, low: 0.6 };

function bestConfidenceOf(touches: CaseTouch[]): OsintConfidence {
  let best: OsintConfidence = "UNVERIFIED";
  for (const t of touches) {
    const conf = t.confidence ?? "UNVERIFIED";
    if (CONFIDENCE_RANK[conf] > CONFIDENCE_RANK[best]) best = conf;
  }
  return best;
}

function confidenceMix(touches: CaseTouch[]): Record<OsintConfidence, number> {
  const mix: Record<OsintConfidence, number> = {
    VERIFIED: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    UNVERIFIED: 0,
  };
  for (const t of touches) mix[t.confidence ?? "UNVERIFIED"]++;
  return mix;
}

function meetsMinConfidence(c: OsintConfidence, floor?: OsintConfidence): boolean {
  if (!floor) return true;
  return CONFIDENCE_RANK[c] >= CONFIDENCE_RANK[floor];
}

function withinDateRange(touch: CaseTouch, from?: string, to?: string): boolean {
  if (!from && !to) return true;
  const d = touch.incidentDate ? new Date(touch.incidentDate).getTime() : 0;
  if (from && d < new Date(from).getTime()) return false;
  if (to && d > new Date(to).getTime()) return false;
  return true;
}

// ── Public functions ───────────────────────────────────────────────────

/**
 * Compute the EntityRow projection (with derived risk score) for a list of
 * raw (entity, caseTouches) tuples. Pure — no I/O. The caller passes the
 * already-aggregated Mongo data.
 */
export function projectEntities(
  rows: Array<{ type: OsintEntityType; value: string; touches: CaseTouch[] }>,
  filters: ThreatGraphFilters = {},
): EntityRow[] {
  const projected: EntityRow[] = [];
  for (const row of rows) {
    if (filters.entityTypes && !filters.entityTypes.includes(row.type)) continue;
    const touches = row.touches.filter((t) => withinDateRange(t, filters.from, filters.to));
    if (touches.length === 0) continue;
    if (filters.minCaseCount && touches.length < filters.minCaseCount) continue;

    const conf = bestConfidenceOf(touches);
    if (!meetsMinConfidence(conf, filters.minConfidence)) continue;

    const totalLossInr = touches.reduce((acc, t) => acc + (t.lossInr ?? 0), 0);
    const severityFactor = touches.reduce(
      (acc, t) => acc + (t.caseSeverity ? SEVERITY_WEIGHT[t.caseSeverity] : 1.0),
      0,
    ) / Math.max(1, touches.length);

    // Risk: log-shape over case count + confidence + entity-type weight + severity.
    const lossLog = Math.log10(1 + totalLossInr / 1000);
    const raw =
      touches.length * 10 +
      CONFIDENCE_RANK[conf] * 4 +
      ENTITY_TYPE_WEIGHT[row.type] * 6 +
      severityFactor * 6 +
      lossLog * 2;
    const riskScore = Math.min(100, Math.round(raw));

    projected.push({
      type: row.type,
      value: row.value,
      touches,
      bestConfidence: conf,
      riskScore,
      totalLossInr,
      confidenceMix: confidenceMix(touches),
    });
  }
  return projected.sort((a, b) => b.riskScore - a.riskScore);
}

/**
 * Convert projected entity rows into a force-graph-compatible slice.
 * Node IDs:
 *   - entity nodes  → `${type}:${value}`
 *   - case nodes    → caseNumber
 * Edges are entity → case (INVOLVED). For ENTITY-centric view, the caller
 * can additionally request co-occurrence (entity ↔ entity through shared
 * cases) by passing `coOccurMode: true`.
 */
export function buildGraphSlice(
  rows: EntityRow[],
  options: { nodeLimit?: number; coOccurMode?: boolean } = {},
): ThreatGraphSlice {
  const nodeLimit = options.nodeLimit ?? 250;
  const trimmed = rows.slice(0, nodeLimit);
  const nodes = new Map<string, ThreatGraphNode>();
  const links: ThreatGraphLink[] = [];

  // Build entity nodes
  for (const r of trimmed) {
    const id = entityNodeId(r);
    nodes.set(id, {
      id,
      type: "Entity",
      entityType: r.type,
      label: r.value,
      caseCount: r.touches.length,
      riskScore: r.riskScore,
      totalLossInr: r.totalLossInr,
      confidence: r.bestConfidence,
    });
  }

  // Build case nodes + INVOLVED edges
  for (const r of trimmed) {
    const eid = entityNodeId(r);
    for (const t of r.touches) {
      if (!nodes.has(t.caseNumber)) {
        nodes.set(t.caseNumber, {
          id: t.caseNumber,
          type: "Case",
          label: t.caseNumber,
          severity: t.caseSeverity,
        });
      }
      links.push({
        source: eid,
        target: t.caseNumber,
        relationship: "INVOLVED",
        weight: t.confidence ? CONFIDENCE_RANK[t.confidence] / 4 : 0.25,
      });
    }
  }

  // Co-occurrence edges (entity ↔ entity through shared cases). Only for
  // entity-pivot mode — otherwise the global graph becomes too dense.
  if (options.coOccurMode) {
    const caseToEntities = new Map<string, string[]>();
    for (const r of trimmed) {
      const eid = entityNodeId(r);
      for (const t of r.touches) {
        const list = caseToEntities.get(t.caseNumber) ?? [];
        list.push(eid);
        caseToEntities.set(t.caseNumber, list);
      }
    }
    const seenPair = new Set<string>();
    for (const ents of caseToEntities.values()) {
      const unique = [...new Set(ents)];
      for (let i = 0; i < unique.length; i++) {
        for (let j = i + 1; j < unique.length; j++) {
          const [a, b] = [unique[i], unique[j]].sort();
          const k = `${a}|${b}`;
          if (seenPair.has(k)) continue;
          seenPair.add(k);
          links.push({
            source: a,
            target: b,
            relationship: "CO_OCCURS",
            weight: 0.4,
          });
        }
      }
    }
  }

  const incidentDates = rows
    .flatMap((r) => r.touches.map((t) => t.incidentDate))
    .filter((d): d is string => !!d)
    .sort();

  const stats = {
    totalEntities: rows.length,
    totalCases: new Set(rows.flatMap((r) => r.touches.map((t) => t.caseNumber))).size,
    totalEdges: links.length,
    highRiskEntities: rows.filter((r) => r.riskScore >= 70).length,
    earliestIncident: incidentDates[0],
    latestIncident: incidentDates[incidentDates.length - 1],
  };

  return {
    nodes: [...nodes.values()],
    links,
    topThreats: rows.slice(0, 20),
    stats,
  };
}

export function entityNodeId(e: ThreatEntityKey): string {
  return `${e.type}:${e.value.toLowerCase()}`;
}
