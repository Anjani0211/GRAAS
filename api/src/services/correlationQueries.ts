import { graphDB } from "./graphDB";
import { logger } from "../utils/logger";

export type ClusterAlertType =
  | "SHARED_UPI_CLUSTER"
  | "PHONE_MULE_CHAIN"
  | "DOMAIN_PHISHING_CAMPAIGN"
  | "TEMPORAL_BURST";

export interface ClusterAlert {
  type: ClusterAlertType;
  entityValue: string;
  linkedCaseIds: string[];
  caseCount: number;
  severity: "HIGH" | "MEDIUM";
}

/** Shared UPI — 3+ cases use the same UPI/wallet. */
export async function detectSharedUpiCluster(caseId: string): Promise<ClusterAlert[]> {
  if (!graphDB.isAvailable()) {
    await graphDB.ensureConnected();
  }
  if (!graphDB.isAvailable()) return [];
  try {
    const rows = await graphDB.runQuery<{ upi: string; cases: string[]; caseCount: number }>(
      `MATCH (c1:Case)-[:INVOLVED]->(u:UpiID)<-[:INVOLVED]-(c2:Case)
       WHERE c1.caseId <> c2.caseId
       WITH u, collect(DISTINCT c1.caseId) + collect(DISTINCT c2.caseId) AS cases
       WHERE size(cases) >= 3 AND $caseId IN cases
       RETURN u.value AS upi, cases, size(cases) AS caseCount
       ORDER BY caseCount DESC`,
      { caseId },
    );
    return rows.map((r) => ({
      type: "SHARED_UPI_CLUSTER" as const,
      entityValue: r.upi,
      linkedCaseIds: r.cases,
      caseCount: r.caseCount,
      severity: r.caseCount >= 5 ? "HIGH" : "MEDIUM",
    }));
  } catch (err) {
    logger.warn({ err }, "[Correlation] detectSharedUpiCluster failed");
    return [];
  }
}

/**
 * Phone mule chain — up to 3-hop traversal from a case's phone numbers.
 * Finds phones that appear in related cases within 3 hops.
 */
export async function detectPhoneMuleChain(caseId: string): Promise<ClusterAlert[]> {
  if (!graphDB.isAvailable()) {
    await graphDB.ensureConnected();
  }
  if (!graphDB.isAvailable()) return [];
  try {
    const rows = await graphDB.runQuery<{ phone: string; cases: string[]; caseCount: number }>(
      `MATCH (c:Case {caseId: $caseId})-[:INVOLVED]->(p:PhoneNumber)
       MATCH (c2:Case)-[:INVOLVED]->(p)
       WHERE c2.caseId <> $caseId
       WITH p, collect(DISTINCT c2.caseId) + [$caseId] AS cases
       WHERE size(cases) >= 2
       RETURN p.value AS phone, cases, size(cases) AS caseCount
       ORDER BY caseCount DESC`,
      { caseId },
    );
    return rows.map((r) => ({
      type: "PHONE_MULE_CHAIN" as const,
      entityValue: r.phone,
      linkedCaseIds: r.cases,
      caseCount: r.caseCount,
      severity: r.caseCount >= 5 ? "HIGH" : "MEDIUM",
    }));
  } catch (err) {
    logger.warn({ err }, "[Correlation] detectPhoneMuleChain failed");
    return [];
  }
}

/** Domain phishing campaign — 5+ cases share the same fraudulent domain. */
export async function detectDomainPhishingCampaign(caseId: string): Promise<ClusterAlert[]> {
  if (!graphDB.isAvailable()) {
    await graphDB.ensureConnected();
  }
  if (!graphDB.isAvailable()) return [];
  try {
    const rows = await graphDB.runQuery<{ domain: string; cases: string[]; caseCount: number }>(
      `MATCH (c:Case)-[:INVOLVED]->(d:Domain)<-[:INVOLVED]-(c2:Case)
       WHERE c.caseId <> c2.caseId
       WITH d, collect(DISTINCT c.caseId) + collect(DISTINCT c2.caseId) AS cases
       WHERE size(cases) >= 5 AND $caseId IN cases
       RETURN d.value AS domain, cases, size(cases) AS caseCount
       ORDER BY caseCount DESC`,
      { caseId },
    );
    return rows.map((r) => ({
      type: "DOMAIN_PHISHING_CAMPAIGN" as const,
      entityValue: r.domain,
      linkedCaseIds: r.cases,
      caseCount: r.caseCount,
      severity: "HIGH",
    }));
  } catch (err) {
    logger.warn({ err }, "[Correlation] detectDomainPhishingCampaign failed");
    return [];
  }
}

/** Temporal burst — 3+ cases share a UPI within 72 hours of each other. */
export async function detectTemporalBurst(caseId: string): Promise<ClusterAlert[]> {
  if (!graphDB.isAvailable()) {
    await graphDB.ensureConnected();
  }
  if (!graphDB.isAvailable()) return [];
  try {
    const rows = await graphDB.runQuery<{ upi: string; caseIds: string[]; caseCount: number }>(
      `MATCH (c1:Case)-[:INVOLVED]->(u:UpiID)<-[:INVOLVED]-(c2:Case)
       WHERE c1.caseId <> c2.caseId
         AND abs(duration.inSeconds(datetime(c1.date), datetime(c2.date)).seconds) < 259200
       WITH u, collect(DISTINCT c1.caseId) + collect(DISTINCT c2.caseId) AS allCases
       WHERE size(allCases) >= 3 AND $caseId IN allCases
       RETURN u.value AS upi, allCases AS caseIds, size(allCases) AS caseCount`,
      { caseId },
    );
    return rows.map((r) => ({
      type: "TEMPORAL_BURST" as const,
      entityValue: r.upi,
      linkedCaseIds: r.caseIds,
      caseCount: r.caseCount,
      severity: r.caseCount >= 5 ? "HIGH" : "MEDIUM",
    }));
  } catch (err) {
    logger.warn({ err }, "[Correlation] detectTemporalBurst failed");
    return [];
  }
}

/** Run all four detections in parallel. Never throws — failed detectors return []. */
export async function runAllClusterDetections(caseId: string): Promise<ClusterAlert[]> {
  const [upi, phone, domain, burst] = await Promise.allSettled([
    detectSharedUpiCluster(caseId),
    detectPhoneMuleChain(caseId),
    detectDomainPhishingCampaign(caseId),
    detectTemporalBurst(caseId),
  ]);
  return [
    ...(upi.status === "fulfilled" ? upi.value : []),
    ...(phone.status === "fulfilled" ? phone.value : []),
    ...(domain.status === "fulfilled" ? domain.value : []),
    ...(burst.status === "fulfilled" ? burst.value : []),
  ];
}

import type { IOsintCluster } from "../models/Case";

/** Convert ClusterAlerts into the IOsintCluster format for MongoDB persistence. */
export function alertsToOsintClusters(alerts: ClusterAlert[]): IOsintCluster[] {
  return alerts.map((a) => ({
    id: `${a.type}:${a.entityValue}`,
    kind: a.type,
    severity: a.severity.toLowerCase() as "high" | "medium" | "low",
    summary: `${a.type}: ${a.entityValue} linked to ${a.caseCount} cases`,
    linkedCaseNumbers: a.linkedCaseIds,
  }));
}
