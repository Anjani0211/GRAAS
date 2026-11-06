import crypto from "crypto";
import fs from "fs";
import path from "path";
import { GRASSReport, GRASSReportZ } from "../types/grassReport";
import type {
  ICase,
  IOsintEnrichment,
  IOsintInvestigation,
  CaseCategory,
  OsintEntityType,
  OsintConfidence,
} from "../models/Case";
import { EvidenceHash } from "../models/EvidenceHash";
import { InvestigationMemoryModel } from "../models/InvestigationMemory";
import type { AgentReportAppendix } from "./docxService";

const CASE_TO_SCAM: Partial<Record<CaseCategory, GRASSReport["scam_category"]>> = {
  financial_fraud: "INVESTMENT_FRAUD",
  phishing: "PHISHING",
  sextortion: "SEXTORTION",
  identity_theft: "IMPERSONATION",
  account_hacking: "OTP_FRAUD",
  deepfake: "IMPERSONATION",
  cyberbullying: "OTHER",
  corporate: "OTHER",
};

function resolveScamCategory(inv: IOsintInvestigation, caseDoc: ICase): GRASSReport["scam_category"] {
  const code = inv.modusOperandi?.code;
  const parsed = GRASSReportZ.shape.scam_category.safeParse(code);
  if (parsed.success) return parsed.data;
  return CASE_TO_SCAM[caseDoc.category] ?? "OTHER";
}

function mapEntityType(t: OsintEntityType): GRASSReport["extracted_entities"][number]["type"] {
  if (t === "ipv4") return "ip";
  return t;
}

function summariseEnrichment(enrich: IOsintEnrichment, entityValue: string): string {
  const d = enrich.details;
  const note =
    typeof d?.summary === "string"
      ? d.summary
      : typeof d?.message === "string"
        ? d.message
        : "";
  const base = note.trim()
    ? note.trim()
    : `OSINT source ${enrich.source} graded this indicator at ${enrich.confidence} confidence.`;
  return `${base} (Entity: ${entityValue.slice(0, 80)}${entityValue.length > 80 ? "…" : ""})`.slice(0, 800);
}

function enrichmentFlags(enrich: IOsintEnrichment): string[] {
  const d = enrich.details;
  if (d && Array.isArray(d.flags)) return d.flags.filter((x): x is string => typeof x === "string");
  return [];
}

function buildTimeline(inv: IOsintInvestigation): GRASSReport["timeline"] {
  const rows: GRASSReport["timeline"] = [];
  for (const h of inv.hashManifest ?? []) {
    rows.push({
      timestamp: h.ingestedAt.toISOString(),
      description: `Evidence ingested: ${h.fileName}`,
      evidence_reference: h.sha256.slice(0, 16) + "…",
    });
  }
  for (const e of inv.enrichments ?? []) {
    rows.push({
      timestamp: e.timestamp.toISOString(),
      description: `OSINT enrichment completed via ${e.source}`,
      evidence_reference: e.entityId,
    });
  }
  rows.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return rows;
}

function buildActionRequests(inv: IOsintInvestigation, caseNumber: string): GRASSReport["actionable_requests"] {
  const out: GRASSReport["actionable_requests"] = [];
  const seen = new Set<string>();
  for (const ent of inv.entities ?? []) {
    if (!ent.valid) continue;
    const key = `${ent.type}:${ent.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (ent.type === "upi") {
      out.push({
        priority: "HIGH",
        targetEntity: ent.value,
        action: "FREEZE_ACCOUNT",
        justification: `UPI identifier linked to suspected fraud proceeds in ${caseNumber}.`,
      });
    } else if (ent.type === "domain") {
      out.push({
        priority: "HIGH",
        targetEntity: ent.value,
        action: "SEIZE_DOMAIN",
        justification: `Domain appears in phishing or impersonation infrastructure for ${caseNumber}.`,
      });
    } else if (ent.type === "phone") {
      out.push({
        priority: "NORMAL",
        targetEntity: ent.value,
        action: "PRESERVE_DATA",
        justification: `Subscriber detail records (CDR/IPDR) may support mule-chain analysis.`,
      });
    } else if (ent.type === "wallet") {
      out.push({
        priority: "HIGH",
        targetEntity: ent.value,
        action: "FLAG_WALLET",
        justification: `On-chain wallet flagged for virtual-asset tracing and compliance review.`,
      });
    } else if (ent.type === "email") {
      out.push({
        priority: "NORMAL",
        targetEntity: ent.value,
        action: "REQUEST_KYC",
        justification: `Email account may tie to identity or platform KYC for ${caseNumber}.`,
      });
    }
  }
  if (out.length === 0) {
    out.push({
      priority: "NORMAL",
      targetEntity: caseNumber,
      action: "OTHER",
      justification: `Preservation and supervisory review requested for ${caseNumber} pending further technical findings.`,
    });
  }
  return out;
}

function readLegalFragment(name: string): string {
  const p = path.join(__dirname, "..", "templates", "legal", name);
  return fs.readFileSync(p, "utf-8");
}

function fillLegal(
  fragment: string,
  vars: Record<string, string>,
): string {
  let html = fragment;
  for (const [k, v] of Object.entries(vars)) {
    html = html.split(`[${k}]`).join(v);
  }
  return html;
}

function buildLegalDrafts(
  caseDoc: ICase,
  inv: IOsintInvestigation,
  analystName: string,
  analystBadgeId: string,
): GRASSReport["legal_drafts"] {
  const requests = buildActionRequests(inv, caseDoc.caseNumber);
  const freezeUpi = requests.find((r) => r.action === "FREEZE_ACCOUNT");
  const bankName = freezeUpi?.targetBank ?? "Concerned Bank / Payment Provider";
  const entityForPreservation = freezeUpi?.targetEntity ?? (inv.entities.find((e) => e.valid)?.value ?? "—");
  const start = (caseDoc.incidentDate ?? caseDoc.createdAt).toISOString().slice(0, 10);
  const end = caseDoc.createdAt.toISOString().slice(0, 10);
  const loss = String(Math.round(caseDoc.monetaryLoss ?? 0));
  const ifsc =
    (typeof inv.enrichments[0]?.details?.ifsc === "string" ? inv.enrichments[0].details.ifsc : null) ?? "[IFSC pending]";
  const accountNo = freezeUpi?.targetEntity ?? "[Account / UPI pending]";

  const s94 = fillLegal(readLegalFragment("sec94_bnss_preservation.html"), {
    BANK_NAME: bankName,
    CASE_ID: caseDoc.caseNumber,
    ENTITY_VALUE: entityForPreservation,
    START_DATE: start,
    END_DATE: end,
  });

  const s457 = fillLegal(readLegalFragment("sec457_bnss_freeze.html"), {
    BANK_NAME: bankName,
    ACCOUNT_NO: accountNo,
    IFSC_CODE: ifsc,
    LOSS_AMOUNT: loss,
  });

  const s63 = fillLegal(readLegalFragment("sec63_bsa_certificate.html"), {
    ANALYST_NAME: analystName,
    BADGE_ID: analystBadgeId,
  });

  return [
    { section: "94 BNSS", template: "sec94_bnss_preservation", content: s94 },
    { section: "457 BNSS", template: "sec457_bnss_freeze", content: s457 },
    { section: "63 BSA", template: "sec63_bsa_certificate", content: s63 },
  ];
}

function ensureExecutiveSummary(raw: string, caseNumber: string, scam: string): string {
  const t = raw.trim();
  const filler = `This GRASSReport/1.0 package summarises OSINT and correlation findings for ${caseNumber} (${scam.replace(/_/g, " ")}). Analyst review and HITL verification remain mandatory before external dissemination.`;
  if (t.length >= 50) return t.slice(0, 1500);
  const merged = t ? `${t} ${filler}` : filler;
  return merged.slice(0, 1500);
}

export class ReportBuildError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ReportBuildError";
  }
}

/** Agent + classifier context for DOCX / extended exports. */
export async function loadAgentReportAppendix(caseDoc: ICase): Promise<AgentReportAppendix | null> {
  const inv = caseDoc.osintInvestigation;
  if (!inv?.lastRunId) return null;

  const memory = await InvestigationMemoryModel.findOne({
    caseId: caseDoc.caseNumber,
    runId: inv.lastRunId,
  }).lean();

  if (!memory) {
    const compact = inv.reportJson as { agentMemory?: Record<string, unknown> } | undefined;
    if (!compact?.agentMemory) return null;
    return {
      exitReason: String(compact.agentMemory.exitReason ?? ""),
      exitStatement: String(compact.agentMemory.exitStatement ?? ""),
      totalToolCalls: Number(compact.agentMemory.totalToolCalls ?? 0),
    };
  }

  return {
    classificationType: memory.classification?.primaryType,
    classificationConfidence: memory.classification?.confidence,
    indicators: memory.classification?.indicators ?? [],
    strategy: memory.classification?.strategy ?? inv.geminiSummary ?? "",
    exitReason: memory.exitReason,
    exitStatement: memory.exitStatement,
    totalToolCalls: memory.totalToolCalls,
    toolSummaries: (memory.iterations ?? []).map((it) => ({
      toolName: it.toolName,
      callId: it.callId,
      confidence: String(it.confidence),
    })),
  };
}

/**
 * Assembles and validates `GRASSReport` from MongoDB. Does not render PDF/DOCX.
 */
export async function buildReport(
  caseDoc: ICase,
  analystId: string,
  analystName: string,
  options: { redacted?: boolean } = {},
): Promise<GRASSReport> {
  if (!analystId || analystId.trim().length === 0) {
    throw new Error("HITL_GATE: analyst badge ID required for report generation");
  }

  const inv = caseDoc.osintInvestigation;
  if (!inv) throw new ReportBuildError("No investigation found on case", 400);

  const hashes = await EvidenceHash.find({ caseId: caseDoc.caseNumber }).lean();
  if (hashes.length === 0) {
    throw new ReportBuildError(
      "No evidence_hashes records for this case — upload evidence before exporting GRASSReport.",
      400,
    );
  }

  const generatedAt = new Date().toISOString();
  const analystSigHash = crypto
    .createHash("sha256")
    .update(`${analystId}:${caseDoc.caseNumber}:${generatedAt}`)
    .digest("hex");

  const enrichByEntity = new Map(inv.enrichments.map((e) => [e.entityId, e]));

  const extracted_entities: GRASSReport["extracted_entities"] = (inv.entities ?? [])
    .filter((e) => e.valid)
    .map((e) => {
      const en = enrichByEntity.get(e.id);
      const conf: OsintConfidence = en?.confidence ?? "UNVERIFIED";
      return {
        value: e.value,
        type: mapEntityType(e.type),
        source_file: e.sourceFile,
        confidence: conf,
        osint_summary: en ? summariseEnrichment(en, e.value) : "No OSINT enrichment recorded for this entity yet.",
        flags: en ? enrichmentFlags(en) : [],
      };
    });

  const incidentStart = caseDoc.incidentDate ?? caseDoc.createdAt;
  const incidentEnd = caseDoc.updatedAt ?? caseDoc.createdAt;

  const legal_drafts = buildLegalDrafts(caseDoc, inv, analystName, analystId);

  const scam = resolveScamCategory(inv, caseDoc);
  const appendix = await loadAgentReportAppendix(caseDoc);
  const agentNarrative = appendix?.exitStatement?.trim() ?? "";
  const summarySeed = [inv.geminiSummary ?? "", agentNarrative].filter(Boolean).join(" ");
  const execSummary = ensureExecutiveSummary(summarySeed, caseDoc.caseNumber, scam);

  const cluster_alerts: NonNullable<GRASSReport["cluster_alerts"]> = (inv.clusters ?? []).map((c) => ({
    type: c.kind,
    entityValue: c.summary?.trim() ? c.summary.slice(0, 500) : c.id,
    linkedCaseIds: c.linkedCaseNumbers,
    caseCount: c.linkedCaseNumbers.length,
    severity: c.severity === "high" ? "HIGH" : "MEDIUM",
  }));

  const report: GRASSReport = {
    schema_version: "GRASSReport/1.0",
    case_id: caseDoc.caseNumber,
    generated_at: generatedAt,
    analyst_id: analystId,
    analyst_name: analystName,
    analyst_signature_hash: analystSigHash,
    incident_date_range: {
      start: incidentStart.toISOString(),
      end: incidentEnd.toISOString(),
    },
    scam_category: scam,
    total_loss_inr: Math.max(0, Math.round(caseDoc.monetaryLoss ?? 0)),
    evidence_manifest: hashes.map((h) => ({
      fileName: h.fileName,
      sha256: h.sha256,
      fileSizeBytes: Math.max(1, h.fileSizeBytes || 1),
      mimeType: h.mimeType?.trim() ? h.mimeType : "application/octet-stream",
      ingestedAt: h.ingestedAt.toISOString(),
    })),
    extracted_entities,
    invalid_entities: (inv.invalidEntities ?? []).map((e) => ({
      value: e.value,
      type: e.type,
      reason: e.valid === false ? "Failed parser or policy validation" : "Invalid entity",
    })),
    timeline: buildTimeline(inv),
    executive_summary: execSummary,
    modus_operandi_detail: inv.modusOperandi
      ? `Code ${inv.modusOperandi.code} (model confidence ${Math.round(inv.modusOperandi.confidence * 100)}%).`
      : undefined,
    victim_statement: caseDoc.description ?? "",
    cluster_alerts: options.redacted ? undefined : cluster_alerts.length ? cluster_alerts : undefined,
    financial_flow: undefined,
    actionable_requests: buildActionRequests(inv, caseDoc.caseNumber),
    legal_drafts,
    graph_image_base64: undefined,
    is_redacted: options.redacted ?? false,
  };

  return GRASSReportZ.parse(report);
}
