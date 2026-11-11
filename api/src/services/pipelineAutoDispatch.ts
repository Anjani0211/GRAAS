/**
 * Pipeline auto-dispatch helper
 * ─────────────────────────────
 * Builds the strict GRASSReport from in-memory pipeline outputs and persists
 * a Dispatch document so analysts see the per-entity routing the moment the
 * pipeline completes. Pure async function — never throws (the caller catches
 * and logs at WARN level, since this step is non-blocking).
 */
import crypto from "crypto";
import { Dispatch } from "../models";
import type {
  ICase,
  IOsintEntity,
  IOsintEnrichment,
  IOsintCluster,
  IOsintHashRecord,
  IOsintInvestigation,
} from "../models";
import { GRASSReportZ, type GRASSReport } from "../types/grassReport";
import { buildDispatchPlan } from "./entityDispatch";

const SCAM_MAP: Record<string, GRASSReport["scam_category"]> = {
  financial_fraud: "INVESTMENT_FRAUD",
  phishing: "PHISHING",
  sextortion: "SEXTORTION",
  identity_theft: "IMPERSONATION",
  account_hacking: "OTP_FRAUD",
  deepfake: "IMPERSONATION",
  cyberbullying: "OTHER",
  corporate: "OTHER",
};

type AutoActionableRequest = {
  priority: "URGENT" | "HIGH" | "NORMAL";
  targetEntity: string;
  action:
    | "FREEZE_ACCOUNT"
    | "PRESERVE_DATA"
    | "SEIZE_DOMAIN"
    | "FLAG_WALLET"
    | "REQUEST_KYC"
    | "OTHER";
  justification: string;
};

function buildAutoActionableRequests(
  entities: IOsintEntity[],
  caseNumber: string,
): AutoActionableRequest[] {
  const out: AutoActionableRequest[] = [
    {
      priority: "NORMAL",
      targetEntity: caseNumber,
      action: "OTHER",
      justification:
        "Auto-drafted dispatch plan pending HITL review for " + caseNumber + ".",
    },
  ];
  for (const e of entities) {
    if (!e.valid) continue;
    if (e.type === "upi") {
      out.push({
        priority: "HIGH",
        targetEntity: e.value,
        action: "FREEZE_ACCOUNT",
        justification: "UPI " + e.value + " flagged in " + caseNumber + ".",
      });
    } else if (e.type === "domain") {
      out.push({
        priority: "HIGH",
        targetEntity: e.value,
        action: "SEIZE_DOMAIN",
        justification:
          "Domain " + e.value + " flagged in " + caseNumber + ".",
      });
    }
  }
  return out;
}

export interface AutoDispatchInputs {
  caseDoc: ICase;
  runId: string;
  analystId: string;
  entities: IOsintEntity[];
  enrichments: IOsintEnrichment[];
  clusters: IOsintCluster[];
  hashManifest: IOsintHashRecord[];
  invalidEntities: IOsintInvestigation["invalidEntities"];
  geminiSummary: string;
  modusOperandiCode?: string;
  modusOperandiConfidence?: number;
}

export interface AutoDispatchResult {
  ok: boolean;
  recipients: number;
  error?: string;
}

export async function autoDraftDispatchPlan(
  args: AutoDispatchInputs,
): Promise<AutoDispatchResult> {
  try {
    const {
      caseDoc,
      runId,
      analystId,
      entities,
      enrichments,
      clusters,
      hashManifest,
      invalidEntities,
      geminiSummary,
      modusOperandiCode,
      modusOperandiConfidence,
    } = args;

    const fallbackSummary =
      "Auto-drafted GRASSReport/1.0 for " +
      caseDoc.caseNumber +
      ". HITL review pending before dispatch.";
    const execSummary = (
      geminiSummary && geminiSummary.length >= 50 ? geminiSummary : fallbackSummary
    ).slice(0, 1500);

    const extracted = entities
      .filter((e) => e.valid)
      .map((e) => {
        const en = enrichments.find((x) => x.entityId === e.id);
        const typeOut =
          e.type === "ipv4"
            ? ("ip" as const)
            : (e.type as
                | "phone"
                | "upi"
                | "url"
                | "email"
                | "wallet"
                | "telegram"
                | "domain"
                | "username");
        return {
          value: e.value,
          type: typeOut,
          source_file: e.sourceFile,
          confidence: en?.confidence ?? "UNVERIFIED",
          osint_summary: en?.source
            ? "Auto-summary from " + en.source + " at " + en.confidence + "."
            : "No OSINT enrichment recorded yet.",
          flags: [] as string[],
        };
      });

    const cluster_alerts = clusters.map((c) => ({
      type: c.kind,
      entityValue: c.summary && c.summary.trim() ? c.summary.slice(0, 500) : c.id,
      linkedCaseIds: c.linkedCaseNumbers,
      caseCount: c.linkedCaseNumbers.length,
      severity: c.severity === "high" ? ("HIGH" as const) : ("MEDIUM" as const),
    }));

    const candidate = {
      schema_version: "GRASSReport/1.0" as const,
      case_id: caseDoc.caseNumber,
      generated_at: new Date().toISOString(),
      analyst_id: analystId || "system",
      analyst_name: "System (auto-draft)",
      analyst_signature_hash: crypto
        .createHash("sha256")
        .update(analystId + ":" + caseDoc.caseNumber + ":" + runId)
        .digest("hex"),
      incident_date_range: {
        start: (caseDoc.incidentDate ?? caseDoc.createdAt).toISOString(),
        end: (caseDoc.updatedAt ?? caseDoc.createdAt).toISOString(),
      },
      scam_category: SCAM_MAP[caseDoc.category] ?? ("OTHER" as const),
      total_loss_inr: Math.max(0, Math.round(caseDoc.monetaryLoss ?? 0)),
      evidence_manifest: hashManifest.map((h) => ({
        fileName: h.fileName,
        sha256: h.sha256,
        fileSizeBytes: Math.max(1, h.sizeBytes || 1),
        mimeType:
          h.fileType && h.fileType.trim() ? h.fileType : "application/octet-stream",
        ingestedAt: h.ingestedAt.toISOString(),
      })),
      extracted_entities: extracted,
      invalid_entities: (invalidEntities ?? []).map((e) => ({
        value: e.value,
        type: e.type,
        reason: "Failed parser or policy validation",
      })),
      timeline: [],
      executive_summary: execSummary,
      modus_operandi_detail: modusOperandiCode
        ? "Code " +
          modusOperandiCode +
          " (auto, confidence " +
          Math.round((modusOperandiConfidence ?? 0) * 100) +
          "%)."
        : undefined,
      victim_statement: caseDoc.description ?? "",
      cluster_alerts,
      actionable_requests: buildAutoActionableRequests(entities, caseDoc.caseNumber),
      legal_drafts: [],
      is_redacted: false,
    };

    const draftReport = GRASSReportZ.parse(candidate);
    const plan = buildDispatchPlan(draftReport, caseDoc);

    await Dispatch.findOneAndUpdate(
      { caseId: caseDoc.caseNumber, runId },
      {
        $set: {
          caseId: caseDoc.caseNumber,
          runId,
          generatedAt: new Date(),
          generatedBy: "pipeline:auto",
          recipients: plan.recipients,
          rollupStatus: "DRAFT",
        },
      },
      { upsert: true, new: true },
    );

    return { ok: true, recipients: plan.recipients.length };
  } catch (err) {
    return {
      ok: false,
      recipients: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
