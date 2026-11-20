import type { ICase, IOsintEntity, IOsintEnrichment } from "../models";
import { escalationDeepLinks, phoneAssistLinks, merchantAssistLinks, lookupPinAssist } from "./osint/public/indiaAssist";

export type EscalationPack = {
  caseNumber: string;
  category: string;
  status: string;
  generatedAt: string;
  entities: Array<{ type: string; value: string; flags?: string[] }>;
  evidenceHashes: Array<{ fileName: string; sha256: string; sizeBytes?: number }>;
  enrichmentsSummary: Array<{ entityId: string; source: string; confidence: string; highlight: string }>;
  relatedCases: string[];
  assistPortals: ReturnType<typeof escalationDeepLinks>;
  analystChecklist: string[];
  deepLinks: Record<string, string>;
};

function highlightFromDetails(details: Record<string, unknown> | undefined): string {
  if (!details) return "";
  const parts: string[] = [];
  for (const key of ["bank", "bank_name", "carrier", "operator", "archive_url", "gstin", "district", "psp"]) {
    if (details[key] != null && details[key] !== "") parts.push(`${key}=${String(details[key])}`);
  }
  if (Array.isArray(details.flags)) parts.push(`flags=${(details.flags as string[]).join(",")}`);
  return parts.slice(0, 6).join("; ");
}

/**
 * Build a LE-ready escalation pack from case + OSINT investigation (no outbound send).
 */
export function buildEscalationPack(caseDoc: ICase): EscalationPack {
  const inv = caseDoc.osintInvestigation;
  const entities = (inv?.entities ?? []) as IOsintEntity[];
  const enrichments = (inv?.enrichments ?? []) as IOsintEnrichment[];
  const hashes = (inv?.hashManifest ?? []).map((h) => ({
    fileName: h.fileName,
    sha256: h.sha256,
    sizeBytes: h.sizeBytes,
  }));

  const related = new Set<string>();
  for (const c of inv?.clusters ?? []) {
    for (const n of c.linkedCaseNumbers ?? []) related.add(n);
  }

  const deepLinks: Record<string, string> = {};
  for (const e of entities) {
    if (e.type === "phone") {
      Object.assign(deepLinks, phoneAssistLinks(e.value).links);
    } else if (e.type === "username" && e.value.toUpperCase().startsWith("GSTIN:")) {
      Object.assign(deepLinks, merchantAssistLinks(e.value.slice(6)));
    } else if (e.type === "username" && e.value.toUpperCase().startsWith("PIN:")) {
      const pin = lookupPinAssist(e.value.slice(4));
      if (pin.district) deepLinks[`pin_${pin.pin}`] = `https://www.google.com/search?q=${encodeURIComponent(`${pin.pin} ${pin.district} pincode`)}`;
    } else if (e.type === "url" || e.type === "domain") {
      deepLinks[`wayback_${e.value}`] = `https://web.archive.org/web/*/${encodeURIComponent(e.value)}`;
    }
  }

  const entityFlags = new Map<string, string[]>();
  for (const en of enrichments) {
    const flags = (en.details as { provider_results?: Array<{ flags?: string[] }> })?.provider_results
      ?.flatMap((p) => p.flags ?? []) ?? [];
    if (flags.length) entityFlags.set(en.entityId, [...new Set(flags)]);
  }

  const checklist = [
    "Verify UPI/IFSC via bank channel before freeze request",
    "Confirm phone on Sanchar Saathi / Chakshu (manual)",
    "Preserve URL snapshots (Wayback + local capture)",
    "Attach SHA-256 evidence manifest to NCRP/I4C filing",
    "Cross-check related cases before escalation",
  ];
  if (entities.some((e) => e.type === "upi")) checklist.unshift("Draft bank freeze with beneficiary VPA + IFSC");
  if (entities.some((e) => e.value.toUpperCase().startsWith("GSTIN:"))) {
    checklist.push("Verify merchant GSTIN on GST portal (manual CAPTCHA)");
  }

  return {
    caseNumber: caseDoc.caseNumber,
    category: caseDoc.category,
    status: caseDoc.status,
    generatedAt: new Date().toISOString(),
    entities: entities.map((e) => ({
      type: e.type,
      value: e.value,
      flags: entityFlags.get(e.id),
    })),
    evidenceHashes: hashes,
    enrichmentsSummary: enrichments.map((r) => ({
      entityId: r.entityId,
      source: r.source,
      confidence: r.confidence,
      highlight: highlightFromDetails(r.details as Record<string, unknown>),
    })),
    relatedCases: [...related],
    assistPortals: escalationDeepLinks(caseDoc.caseNumber),
    analystChecklist: checklist,
    deepLinks,
  };
}
