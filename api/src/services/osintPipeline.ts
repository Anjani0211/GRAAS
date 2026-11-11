import crypto from "crypto";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import mongoose from "mongoose";
import { Case, PipelineRun, EvidenceHash } from "../models";
import type {
  ICase,
  IOsintEntity,
  IOsintEvidenceItem,
  IOsintEnrichment,
  IOsintCluster,
  IOsintHashRecord,
  IOsintInvestigation,
  IOsintStageState,
  OsintEntityType,
  OsintConfidence,
  CaseCategory,
} from "../models";
import type { IPipelineStageResult } from "../models/PipelineRun";
import {
  fetchWhoisXml,
  fetchVtIp,
  fetchVtUrlReputation,
  summarizeVtDomainRecord,
  summarizeVtIpRecord,
} from "./osintExternal";
import { getEffectiveLlm, secrets } from "./runtimeSettings";
import { logger } from "../utils/logger";
import { extractEntitiesWithGemini } from "./geminiService";
import { validateExtractedEntities } from "../utils/entityValidator";
import { transcribeAudioBuffer, isAudioFile } from "./whisperService";
import { extractTextFromImageBuffer, isImageFile } from "./ocrService";
import { storageService } from "./storageService";
import { withCircuitBreaker, Semaphore } from "../utils/circuitBreaker";
import { ingestCaseEntities } from "./graphIngestion";
import { runAllClusterDetections, alertsToOsintClusters } from "./correlationQueries";
import { ConfidenceScore, confidenceToLabel } from "../types/confidence";
import type { OsintResult } from "./osint/providerInterface";
import { numVerifyLookup, regexPhoneAnalysis } from "./osint/providers/phoneProviders";
import { razorpayVpaLookup, ifscBankLookup } from "./osint/providers/upiProviders";
import { abuseIpDbLookup, regexIpAnalysis } from "./osint/providers/ipProviders";
import { virusTotalUrlLookup, urlScanLookup, whoisXmlDomainLookup } from "./osint/providers/urlProviders";
import { hibpLookup, hunterEmailLookup, mxRecordLookup } from "./osint/providers/emailProviders";
import { cryptoLookup } from "./osint/providers/cryptoProviders";
import { enrichTelegramEntity } from "./osint/providers/telegramProviders";
import { runWithRetry } from "../utils/stageRunner";
import { mask } from "../utils/piiSanitizer";
import { assembleEvidenceCorpus, type EvidenceCorpus } from "../agent/evidenceCorpus";
import { classifyCase } from "../agent/caseClassifier";
import { runInvestigationLoop } from "../agent/investigationLoop";
import { runTextOnlyInvestigation } from "../agent/textOnlyInvestigation";
import type { CaseClassification, InvestigationMemory } from "../types/investigationMemory";
import { autoDraftDispatchPlan } from "./pipelineAutoDispatch";

async function loadEvidenceBytes(ev: IOsintEvidenceItem): Promise<Buffer | null> {
  if (ev.storageKey) {
    try {
      return await storageService.readEvidence(ev.storageKey);
    } catch (err) {
      logger.warn({ err, storageKey: ev.storageKey }, "[Pipeline] readEvidence failed");
      return null;
    }
  }
  const legacy = path.join(process.cwd(), "uploads", ev.fileName);
  if (fs.existsSync(legacy)) {
    return fs.readFileSync(legacy);
  }
  return null;
}

/** Pipeline stream event shapes (NDJSON) */
export type RunStage = "intake" | "parse" | "osint" | "correlation" | "report";

export type RunEvent =
  | { type: "run_started"; runId: string; at: string }
  | { type: "stage_started"; stage: RunStage; at: string }
  | { type: "stage_log"; stage: RunStage; level: "info" | "success" | "warn" | "error"; message: string; fallback?: boolean; at: string }
  | { type: "stage_completed"; stage: RunStage; at: string; data?: Record<string, unknown> }
  | { type: "stage_failed"; stage: RunStage; at: string; message: string }
  | { type: "stage_skipped"; stage: RunStage; reason: string; at: string }
  | { type: "entity_enriched"; entityId: string; result: IOsintEnrichment; at: string }
  | { type: "agent_iteration"; iterNum: number; toolName: string; reasoning: string; at: string }
  | { type: "agent_screenshot"; callId: string; toolName: string; thumbnailB64: string; at: string }
  | { type: "agent_new_lead"; entity: string; entityType: string; foundIn: string; at: string }
  | { type: "agent_complete"; exitReason: string; totalCalls: number; summary: string; at: string }
  | {
      type: "done";
      runId: string;
      at: string;
      investigation: IOsintInvestigation;
    }
  | { type: "error"; message: string; at: string };

export type EmitFn = (event: RunEvent) => void;

// ─────────────────────── regexes & validators ───────────────────────

const PHONE_RE = /(?:\+?91|0)?[6-9]\d{9}/g;
const UPI_RE = /\b[a-zA-Z0-9._-]+@[a-zA-Z]{3,}\b/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const URL_RE = /\bhttps?:\/\/[^\s<>"{}|\\^`[\]]+/g;
const DOMAIN_RE = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}\b/gi;
const IPV4_RE = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b/g;
const ETH_RE = /\b0x[a-fA-F0-9]{40}\b/g;
const BTC_RE = /\b(?:bc1|[13])[a-zA-HJ-NP-Z0-9]{25,39}\b/g;
const TELEGRAM_RE = /(?<![a-zA-Z0-9])@[A-Za-z0-9_]{5,32}\b/g;
const USERNAME_LABEL_RE = /\b(?:username|user\s*name|handle|alias)\s*[:=]\s*@?([A-Za-z][A-Za-z0-9_.-]{2,31})\b/gi;
const USERNAME_SKIP = new Set(["admin", "user", "test", "null", "undefined", "http", "https", "www"]);
const IFSC_RE = /\b[A-Z]{4}0[A-Z0-9]{6}\b/g;

const PHONE_VALID = /^(?:\+91|0)?[6-9]\d{9}$/;
const UPI_VALID = /^[a-zA-Z0-9._-]+@[a-zA-Z]{3,}$/;
const EMAIL_VALID = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

// ─────────────────────── helpers ───────────────────────

function nowIso() {
  return new Date().toISOString();
}

function sha256OfString(input: string): { sha256: string; size: number } {
  const hash = crypto.createHash("sha256").update(input, "utf8").digest("hex");
  return { sha256: hash, size: Buffer.byteLength(input, "utf8") };
}

function uniqKey(type: OsintEntityType, value: string) {
  return `${type}:${value.toLowerCase()}`;
}

/** Strict parsing + Pydantic-style firewall per PRD §3.3.3 */
export function extractEntitiesFromCorpus(
  corpus: Array<{ text: string; sourceFile: string }>,
): IOsintEntity[] {
  const entities: IOsintEntity[] = [];
  const seen = new Set<string>();

  const push = (type: OsintEntityType, raw: string, sourceFile: string, valid: boolean) => {
    const value = raw.trim();
    const key = uniqKey(type, value);
    if (seen.has(key)) return;
    seen.add(key);
    entities.push({
      id: `${type}-${uuidv4().slice(0, 8)}`,
      type,
      value,
      sourceFile,
      valid,
    });
  };

  for (const { text, sourceFile } of corpus) {
    if (!text) continue;
    (text.match(URL_RE) ?? []).forEach((v) => {
      const clean = v.replace(/[.,;]+$/, "");
      try {
        const u = new URL(clean);
        push("url", clean, sourceFile, !!u.hostname);
      } catch {
        push("url", clean, sourceFile, false);
      }
    });
    (text.match(EMAIL_RE) ?? []).forEach((v) => push("email", v.toLowerCase(), sourceFile, EMAIL_VALID.test(v)));
    (text.match(UPI_RE) ?? []).forEach((v) => {
      const s = v.toLowerCase();
      if (seen.has(`email:${s}`)) return;
      push("upi", s, sourceFile, UPI_VALID.test(v));
    });
    (text.match(PHONE_RE) ?? []).forEach((v) => {
      const clean = v.replace(/\s+/g, "");
      push("phone", clean, sourceFile, PHONE_VALID.test(clean));
    });
    (text.match(IPV4_RE) ?? []).forEach((v) => push("ipv4", v, sourceFile, true));
    (text.match(DOMAIN_RE) ?? []).forEach((v) => {
      const s = v.toLowerCase();
      const isPartOfUrlOrEmail = [...seen].some(
        (k) => (k.startsWith("url:") || k.startsWith("email:")) && k.includes(s),
      );
      if (isPartOfUrlOrEmail) return;
      push("domain", s, sourceFile, true);
    });
    (text.match(ETH_RE) ?? []).forEach((v) => push("wallet", v, sourceFile, true));
    (text.match(BTC_RE) ?? []).forEach((v) => push("wallet", v, sourceFile, true));
    (text.match(TELEGRAM_RE) ?? []).forEach((v) => push("telegram", v, sourceFile, true));
    for (const match of text.matchAll(new RegExp(USERNAME_LABEL_RE.source, "gi"))) {
      const handle = match[1];
      if (!handle || USERNAME_SKIP.has(handle.toLowerCase())) continue;
      push("username", handle, sourceFile, true);
    }
    // IFSC codes often appear in UPI settlement trails — route through UPI enrichment (bank lookup).
    (text.match(IFSC_RE) ?? []).forEach((v) => {
      const pseudo = `${v.toLowerCase()}@ifsc`;
      if (!seen.has(`upi:${pseudo}`)) push("upi", pseudo, sourceFile, UPI_VALID.test(pseudo));
    });
  }

  return entities;
}

// ─────────────────────── Phase 3: multi-provider enrichment ───────────────────────

/** Semaphore limits concurrent provider calls to 5 per entity type. */
const enrichSemaphore = new Semaphore(5);

/**
 * Run a single provider call, guarded by circuit breaker + semaphore.
 * Never throws — returns a failed OsintResult on any error.
 */
async function safeProviderCall(
  providerName: string,
  fn: () => Promise<OsintResult>,
): Promise<OsintResult> {
  await enrichSemaphore.acquire();
  try {
    return await withCircuitBreaker(providerName, fn, 15_000);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      confidence: ConfidenceScore.UNVERIFIED,
      source: `${providerName}/error`,
      flags: [],
      error: msg,
    };
  } finally {
    enrichSemaphore.release();
  }
}

/**
 * Pick the highest-confidence result from a list. Falls back to the last
 * result if all are UNVERIFIED.
 */
function bestResult(results: OsintResult[]): OsintResult {
  return (
    results.reduce<OsintResult | null>((best, r) => {
      if (!best || r.confidence > best.confidence) return r;
      return best;
    }, null) ?? results[results.length - 1]
  );
}

/** Convert OsintResult confidence score to the IOsintEnrichment confidence string. */
function scoreToLabel(score: ConfidenceScore): OsintConfidence {
  return confidenceToLabel(score) as OsintConfidence;
}

/**
 * Enrich one entity using the tiered provider stack for its type.
 * Runs providers in parallel (PRIMARY + SECONDARY + FALLBACK simultaneously),
 * picks the best confidence result for storage.
 */
async function enrichOneEntity(entity: IOsintEntity): Promise<{ enrichment: IOsintEnrichment; flags: string[] }> {
  const ts = new Date();
  let results: OsintResult[] = [];

  logger.debug({ type: entity.type, value: mask(entity.value) }, "[Enrich] start");

  switch (entity.type) {
    case "phone":
      results = await Promise.all([
        safeProviderCall("NumVerify", () => numVerifyLookup(entity.value)),
        safeProviderCall("phone-regex", () => Promise.resolve(regexPhoneAnalysis(entity.value))),
      ]);
      break;

    case "upi":
      results = await Promise.all([
        safeProviderCall("Razorpay", () => razorpayVpaLookup(entity.value)),
        safeProviderCall("IFSC-directory", () => Promise.resolve(ifscBankLookup(entity.value))),
      ]);
      break;

    case "ipv4":
      results = await Promise.all([
        safeProviderCall("AbuseIPDB", () => abuseIpDbLookup(entity.value)),
        safeProviderCall("ip-regex", () => Promise.resolve(regexIpAnalysis(entity.value))),
      ]);
      break;

    case "url":
      results = await Promise.all([
        safeProviderCall("VirusTotal", () => virusTotalUrlLookup(entity.value)),
        safeProviderCall("URLScan.io", () => urlScanLookup(entity.value)),
      ]);
      break;

    case "domain":
      results = await Promise.all([
        safeProviderCall("VirusTotal", () => virusTotalUrlLookup(entity.value)),
        safeProviderCall("WhoisXML", () => whoisXmlDomainLookup(entity.value)),
      ]);
      break;

    case "email":
      results = await Promise.all([
        safeProviderCall("HIBP", () => hibpLookup(entity.value)),
        safeProviderCall("Hunter.io", () => hunterEmailLookup(entity.value)),
        safeProviderCall("MX-DNS", () => mxRecordLookup(entity.value)),
      ]);
      break;

    case "wallet":
      results = await Promise.all([
        safeProviderCall("crypto-dispatch", () => cryptoLookup(entity.value)),
      ]);
      break;

    case "telegram":
      results = [await safeProviderCall("telegram", () => enrichTelegramEntity(entity.value))];
      break;

    default:
      results = [{
        success: false,
        confidence: ConfidenceScore.UNVERIFIED,
        source: "unhandled-type",
        flags: [],
        error: `No provider for entity type: ${String(entity.type)}`,
      }];
  }

  const best = bestResult(results);
  const allFlags = [...new Set(results.flatMap((r) => r.flags))];

  const enrichment: IOsintEnrichment = {
    entityId: entity.id,
    source: best.source,
    confidence: scoreToLabel(best.confidence),
    details: {
      ...(best.data ?? {}),
      provider_results: results.map((r) => ({ source: r.source, confidence: r.confidence, flags: r.flags, error: r.error })),
    },
    timestamp: ts,
  };

  return { enrichment, flags: allFlags };
}

/** Simple correlation via Mongo: find other cases sharing entity values. */
async function detectClusters(currentCase: ICase, entities: IOsintEntity[]): Promise<IOsintCluster[]> {
  const clusters: IOsintCluster[] = [];
  if (entities.length === 0) return clusters;

  const upiValues = entities.filter((e) => e.type === "upi").map((e) => e.value);
  const phoneValues = entities.filter((e) => e.type === "phone").map((e) => e.value);
  const domainValues = entities.filter((e) => e.type === "domain").map((e) => e.value);

  const currentId = (currentCase._id as mongoose.Types.ObjectId).toString();

  async function neighborsFor(values: string[]): Promise<string[]> {
    if (values.length === 0) return [];
    const filter = {
      _id: { $ne: currentId },
      $or: [
        { "osintInvestigation.entities.value": { $in: values } },
        { description: { $regex: values.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), $options: "i" } },
      ],
    };
    const hits = await Case.find(filter).select("caseNumber").limit(50).lean();
    return hits.map((h) => h.caseNumber);
  }

  if (upiValues.length > 0) {
    const linked = await neighborsFor(upiValues);
    clusters.push({
      id: `cl-upi-${uuidv4().slice(0, 8)}`,
      kind: "SHARED_UPI_CLUSTER",
      severity: linked.length >= 3 ? "high" : linked.length >= 1 ? "medium" : "low",
      summary:
        linked.length > 0
          ? `${upiValues.length} UPI handle(s) also observed in ${linked.length} other case(s).`
          : `${upiValues.length} UPI handle(s); no cross-case overlap yet.`,
      linkedCaseNumbers: linked,
    });
  }

  if (phoneValues.length >= 1) {
    const linked = await neighborsFor(phoneValues);
    clusters.push({
      id: `cl-phone-${uuidv4().slice(0, 8)}`,
      kind: "PHONE_MULE_CHAIN",
      severity: linked.length >= 2 ? "high" : linked.length >= 1 ? "medium" : "low",
      summary:
        linked.length > 0
          ? `${phoneValues.length} phone(s) observed in ${linked.length} other case(s).`
          : `${phoneValues.length} phone(s); no mule-chain neighbours yet.`,
      linkedCaseNumbers: linked,
    });
  }

  if (domainValues.length >= 1) {
    const linked = await neighborsFor(domainValues);
    clusters.push({
      id: `cl-dom-${uuidv4().slice(0, 8)}`,
      kind: "DOMAIN_PHISHING_CAMPAIGN",
      severity: linked.length >= 2 ? "high" : linked.length >= 1 ? "medium" : "low",
      summary:
        linked.length > 0
          ? `Domain(s) observed in ${linked.length} other case(s) — potential campaign.`
          : `${domainValues.length} domain(s); no other victims yet.`,
      linkedCaseNumbers: linked,
    });
  }

  // Temporal burst: any recent case (last 72h) sharing UPI/phone/domain with us
  const burstWindow = new Date(Date.now() - 72 * 3600 * 1000);
  if (upiValues.length > 0 || phoneValues.length > 0) {
    const recent = await Case.find({
      _id: { $ne: currentId },
      createdAt: { $gte: burstWindow },
      "osintInvestigation.entities.value": { $in: [...upiValues, ...phoneValues] },
    })
      .select("caseNumber")
      .limit(50)
      .lean();
    if (recent.length >= 2) {
      clusters.push({
        id: `cl-burst-${uuidv4().slice(0, 8)}`,
        kind: "TEMPORAL_BURST",
        severity: "high",
        summary: `${recent.length} case(s) in the last 72h share a phone/UPI with this case — active running scam.`,
        linkedCaseNumbers: recent.map((r) => r.caseNumber),
      });
    }
  }

  return clusters;
}

const MO_MAP: Partial<Record<CaseCategory, string>> = {
  financial_fraud: "INVESTMENT_FRAUD",
  phishing: "PHISHING",
  sextortion: "SEXTORTION",
  identity_theft: "IMPERSONATION",
  account_hacking: "OTP_FRAUD",
  deepfake: "IMPERSONATION",
  cyberbullying: "OTHER",
  corporate: "OTHER",
};

function classifyModusOperandi(c: ICase): { code: string; confidence: number } {
  const code = MO_MAP[c.category] ?? "OTHER";
  return { code, confidence: code === "OTHER" ? 0.5 : 0.78 };
}

// ─────────────────────── report composition ───────────────────────

const ENTITY_LABEL: Record<OsintEntityType, string> = {
  phone: "Phone",
  upi: "UPI ID",
  email: "Email",
  url: "URL",
  domain: "Domain",
  ipv4: "IPv4",
  wallet: "Crypto wallet",
  telegram: "Telegram handle",
  username: "Username",
};

function shortHash(h: string): string {
  return h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h;
}

async function persistHashManifestToEvidenceHashes(
  caseNumber: string,
  hashes: IOsintHashRecord[],
): Promise<void> {
  for (const h of hashes) {
    try {
      await EvidenceHash.create({
        caseId: caseNumber,
        fileName: h.fileName,
        originalName: h.fileName,
        sha256: h.sha256,
        fileSizeBytes: Math.max(1, h.sizeBytes || 1),
        mimeType: h.fileType?.trim() ? h.fileType : "application/octet-stream",
        ingestedAt: h.ingestedAt,
        ingestedByIpHash: "",
        isLocked: false,
        minioPath: "",
      });
    } catch (err: unknown) {
      const code = (err as { code?: number })?.code;
      if (code !== 11000) throw err;
    }
  }
}

function composeReportMarkdown(args: {
  caseDoc: ICase;
  hashes: IOsintHashRecord[];
  entities: IOsintEntity[];
  enrichments: IOsintEnrichment[];
  clusters: IOsintCluster[];
  modusOperandi: { code: string; confidence: number };
  runId: string;
  classification?: CaseClassification;
  investigationMemory?: InvestigationMemory | null;
}): string {
  const {
    caseDoc,
    hashes,
    entities,
    enrichments,
    clusters,
    modusOperandi,
    runId,
    classification,
    investigationMemory,
  } = args;
  const generatedAt = new Date().toISOString();
  const enrichMap = new Map(enrichments.map((e) => [e.entityId, e]));
  const loss = caseDoc.monetaryLoss != null ? `₹${Math.round(caseDoc.monetaryLoss).toLocaleString("en-IN")}` : "—";

  const manifest = hashes.length
    ? hashes.map((h) => `- \`${h.fileName}\` · SHA-256 \`${h.sha256}\` · ${h.sizeBytes} bytes`).join("\n")
    : "_No evidence files attached — complaint description used as primary source._";

  const entityRows = entities.length
    ? entities
        .map((e) => {
          const r = enrichMap.get(e.id);
          return `| ${ENTITY_LABEL[e.type]} | \`${e.value}\` | ${e.sourceFile} | ${r?.source ?? "—"} | ${r?.confidence ?? "UNVERIFIED"} |`;
        })
        .join("\n")
    : "| — | — | — | — | — |";

  const clusterBlock = clusters.length
    ? clusters
        .map(
          (c) =>
            `- **${c.kind}** [${c.severity.toUpperCase()}] — ${c.summary}${
              c.linkedCaseNumbers.length ? ` Linked: ${c.linkedCaseNumbers.slice(0, 10).join(", ")}` : ""
            }`,
        )
        .join("\n")
    : "_No cross-case correlations detected._";

  const classifierBlock = classification
    ? [
        `## 2. AI Case Classification`,
        `- **Primary type:** ${classification.primaryType}`,
        `- **Confidence:** ${Math.round(classification.confidence * 100)}%`,
        `- **Strategy:** ${classification.strategy || "—"}`,
        classification.indicators.length
          ? `- **Indicators:**\n${classification.indicators.map((i) => `  - ${i}`).join("\n")}`
          : `- **Indicators:** _(none)_`,
        ``,
      ].join("\n")
    : "";

  const agentBlock = investigationMemory
    ? [
        `## Agentic Investigation Summary`,
        `- **Exit:** ${investigationMemory.exitReason}`,
        `- **Tool calls:** ${investigationMemory.totalToolCalls}`,
        `- **Findings:** ${investigationMemory.exitStatement || "—"}`,
        investigationMemory.iterations.length
          ? `- **Tools executed:** ${[...new Set(investigationMemory.iterations.map((i) => i.toolName))].join(", ")}`
          : "",
        ``,
      ].join("\n")
    : "";

  const execSummary =
    [classification?.strategy, investigationMemory?.exitStatement, caseDoc.description]
      .filter((s) => s && s.trim())
      .join(" ")
      .slice(0, 1500) || caseDoc.description.slice(0, 1500);

  return [
    `# GRASS Investigation Report`,
    ``,
    `**Classification:** CONFIDENTIAL — Law Enforcement Use Only`,
    `**Schema:** GRASSReport/1.0`,
    ``,
    `**Case:** ${caseDoc.caseNumber}`,
    `**Victim:** ${caseDoc.victimName}`,
    `**Loss:** ${loss}`,
    `**Category:** ${caseDoc.category}`,
    `**Location:** ${caseDoc.district ?? "—"}, ${caseDoc.state ?? "—"}`,
    `**Generated:** ${generatedAt}`,
    `**Run ID:** \`${runId}\``,
    ``,
    `## 1. Executive Summary`,
    execSummary + (execSummary.length >= 1500 ? "…" : ""),
    ``,
    classifierBlock,
    `## Victim Statement (verbatim)`,
    caseDoc.description.slice(0, 4000) + (caseDoc.description.length > 4000 ? "…" : ""),
    ``,
    `## Evidence Hash Manifest (BSA §63)`,
    manifest,
    ``,
    `## Extracted Entities & OSINT Findings`,
    `| Type | Value | Source evidence | API / Tool | Confidence |`,
    `|------|-------|-----------------|------------|------------|`,
    entityRows,
    ``,
    `## Cross-Case Correlation`,
    clusterBlock,
    ``,
    `## Modus Operandi`,
    `- Code: \`${modusOperandi.code}\``,
    `- Confidence: ${Math.round(modusOperandi.confidence * 100)}%`,
    ``,
    agentBlock,
    `## Actionable Recommendations (draft)`,
    `- Freeze Layer-1 UPI / bank accounts where confidence is HIGH or VERIFIED.`,
    `- Issue BNSS §94 preservation to telecom and payment operators.`,
    `- File BNSS §457 freeze where beneficiary account is identified.`,
    `- Export final package via **DOCX / PDF** after HITL badge review.`,
    ``,
    `## Legal Appendix`,
    `- BSA §63: hash manifest above.`,
    `- BNSS §94 / §457 / BSA §63 certificate: generated on signed export (DOCX/PDF).`,
    ``,
    `## Analyst Certification`,
    `- Analyst name: _pending HITL_`,
    `- Analyst badge ID: _pending HITL_`,
    `- Export filename: \`GRASS_Investigation_Report_${caseDoc.caseNumber}.docx\``,
  ]
    .filter(Boolean)
    .join("\n");
}

function composeReportJson(args: {
  caseDoc: ICase;
  hashes: IOsintHashRecord[];
  entities: IOsintEntity[];
  enrichments: IOsintEnrichment[];
  clusters: IOsintCluster[];
  modusOperandi: { code: string; confidence: number };
  runId: string;
}): Record<string, unknown> {
  const { caseDoc, hashes, entities, enrichments, clusters, modusOperandi, runId } = args;
  return {
    schema_version: "GRASSReport/1.0",
    case_id: caseDoc.caseNumber,
    run_id: runId,
    generated_at: new Date().toISOString(),
    victim: {
      name: caseDoc.victimName,
      state: caseDoc.state ?? null,
      district: caseDoc.district ?? null,
    },
    scam_category: caseDoc.category.toUpperCase(),
    total_loss_inr: caseDoc.monetaryLoss ?? 0,
    evidence_manifest: hashes.map((h) => ({
      fileName: h.fileName,
      fileType: h.fileType,
      sha256: h.sha256,
      sizeBytes: h.sizeBytes,
      ingestedAt: h.ingestedAt,
    })),
    extracted_entities: entities.map((e) => {
      const r = enrichments.find((x) => x.entityId === e.id);
      return {
        id: e.id,
        type: e.type,
        value: e.value,
        source_file: e.sourceFile,
        valid: e.valid,
        osint: r
          ? {
              source: r.source,
              confidence: r.confidence,
              timestamp: r.timestamp,
            }
          : null,
      };
    }),
    cluster_alerts: clusters,
    modus_operandi: modusOperandi,
  };
}

// ─────────────────────── orchestrator ───────────────────────

export type RunInvestigationOptions = {
  analystId: string;
  /** Replay from this stage onward; earlier stages use persisted investigation data. */
  replayFromStage?: RunStage;
  parentRunId?: string;
};

function upsertStageState(inv: IOsintInvestigation, stageId: string, patch: Partial<IOsintStageState>): void {
  inv.stageStates ??= [];
  const i = inv.stageStates.findIndex((s) => s.stageId === stageId);
  const prev: IOsintStageState =
    i >= 0 ? inv.stageStates[i] : { stageId, status: "PENDING", retryCount: 0 };
  const next: IOsintStageState = { ...prev, ...patch, stageId };
  if (i >= 0) inv.stageStates[i] = next;
  else inv.stageStates.push(next);
}

function mapAgentTypeToOsintType(type: string): OsintEntityType | null {
  switch (type) {
    case "phone":
    case "upi":
    case "email":
    case "url":
    case "domain":
    case "ipv4":
    case "wallet":
    case "telegram":
    case "username":
      return type;
    default:
      return null;
  }
}

function buildEntitiesFromMemory(memory: InvestigationMemory): IOsintEntity[] {
  const entities: IOsintEntity[] = [];
  let idx = 0;
  for (const entry of Object.values(memory.entitiesFound)) {
    const mappedType = mapAgentTypeToOsintType(entry.type);
    if (!mappedType) continue;
    idx++;
    entities.push({
      id: `agent-${idx}`,
      type: mappedType,
      value: entry.value,
      sourceFile: `agent:${entry.firstSeenIn}`,
      valid: true,
    });
  }
  return entities;
}

export async function runInvestigation(
  caseDoc: ICase,
  opts: RunInvestigationOptions,
  emit: EmitFn,
): Promise<IOsintInvestigation> {
  const runId = uuidv4();
  const startedAt = nowIso();
  const stageOrder: RunStage[] = ["intake", "parse", "osint", "correlation", "report"];
  const skipUntil =
    opts.replayFromStage !== undefined ? stageOrder.indexOf(opts.replayFromStage) : 0;
  if (opts.replayFromStage !== undefined && skipUntil < 0) {
    throw new Error(`Invalid replayFromStage: ${opts.replayFromStage}`);
  }

  const inv = ensureInvestigation(caseDoc);
  inv.lastRunId = runId;
  inv.lastRunStatus = "running";
  inv.lastRunAt = new Date();
  await caseDoc.save();

  await PipelineRun.create({
    runId,
    caseId: caseDoc.caseNumber,
    triggeredBy: opts.analystId,
    status: "RUNNING",
    startedAt: new Date(),
    stageResults: [],
    totalEntities: 0,
    totalEnrichments: 0,
    parentRunId: opts.parentRunId,
  });

  const stageResults: IPipelineStageResult[] = [];
  let failedAtStage: RunStage | undefined;

  emit({ type: "run_started", runId, at: startedAt });

  try {
    let hashManifest: IOsintHashRecord[] = [];

    // ── STAGE 1 — Secure Intake & Hashing ──
    if (skipUntil <= 0) {
      const t0 = Date.now();
      upsertStageState(inv, "STAGE_1", { status: "RUNNING", startedAt: new Date() });
      emit({ type: "stage_started", stage: "intake", at: nowIso() });
      for (const ev of inv.evidenceItems) {
        const payload = `${ev.fileName}|${ev.ocrText ?? ""}|${ev.createdAt.toISOString()}`;
        const { sha256, size } = sha256OfString(payload);
        const record: IOsintHashRecord = {
          evidenceId: ev.id,
          fileName: ev.fileName,
          fileType: ev.fileType,
          sha256,
          sizeBytes: size,
          ingestedAt: ev.createdAt,
        };
        hashManifest.push(record);
        emit({
          type: "stage_log",
          stage: "intake",
          level: "info",
          message: `Hashed ${ev.fileName} → ${shortHash(sha256)}`,
          at: nowIso(),
        });
      }
      if (hashManifest.length === 0) {
        emit({
          type: "stage_log",
          stage: "intake",
          level: "warn",
          message: "No evidence files; description used as the only source.",
          at: nowIso(),
        });
      }
      inv.hashManifest = hashManifest;
      if (hashManifest.length > 0) {
        await persistHashManifestToEvidenceHashes(caseDoc.caseNumber, hashManifest);
      }
      emit({
        type: "stage_completed",
        stage: "intake",
        at: nowIso(),
        data: { count: hashManifest.length },
      });
      upsertStageState(inv, "STAGE_1", { status: "COMPLETE", completedAt: new Date() });
      stageResults.push({
        stageId: "intake",
        status: "COMPLETE",
        durationMs: Date.now() - t0,
        retryCount: 0,
        entitiesFound: hashManifest.length,
      });
    } else {
      emit({ type: "stage_skipped", stage: "intake", reason: "replay_skip", at: nowIso() });
      hashManifest = inv.hashManifest ?? [];
      stageResults.push({ stageId: "intake", status: "SKIPPED", durationMs: 0, retryCount: 0 });
    }

    let entities: IOsintEntity[] = [];
    let invalidEntities: IOsintEntity[] = [];
    let geminiSummary = "";
    let parserUsed: "gemini" | "regex" = "gemini";
    let enrichments: IOsintEnrichment[] = [];
    let mergedClusters: IOsintCluster[] = [];
    let modusOperandi = classifyModusOperandi(caseDoc);
    let evidenceCorpus: EvidenceCorpus | null = null;
    let investigationMemory: InvestigationMemory | null = null;
    let pipelineClassification: CaseClassification | undefined;

    // ── STAGE 2 — Case classification + strategy (Phase 9) ──
    if (skipUntil <= 1) {
      const t1 = Date.now();
      upsertStageState(inv, "STAGE_2", { status: "RUNNING", startedAt: new Date() });
      failedAtStage = "parse";
      emit({ type: "stage_started", stage: "parse", at: nowIso() });
      evidenceCorpus = await assembleEvidenceCorpus(caseDoc.caseNumber);
      const classification = await classifyCase(evidenceCorpus);
      pipelineClassification = classification;
      parserUsed = "gemini";
      geminiSummary = classification.strategy || "";
      inv.geminiSummary = geminiSummary;
      inv.parserUsed = parserUsed;
      inv.invalidEntities = [];

      emit({
        type: "stage_log",
        stage: "parse",
        level: "info",
        message: `Classification: ${classification.primaryType} (${classification.confidence.toFixed(2)})`,
        at: nowIso(),
      });
      emit({
        type: "stage_log",
        stage: "parse",
        level: "info",
        message: `Priority tools: ${(classification.priorityTools || []).join(", ") || "none"}`,
        at: nowIso(),
      });
      emit({
        type: "stage_completed",
        stage: "parse",
        at: nowIso(),
        data: {
          parser: "gemini-classifier",
          category: classification.primaryType,
          confidence: classification.confidence,
          indicators: classification.indicators.length,
          priorityTools: classification.priorityTools,
        },
      });
      upsertStageState(inv, "STAGE_2", { status: "COMPLETE", completedAt: new Date() });
      stageResults.push({
        stageId: "parse",
        status: "COMPLETE",
        durationMs: Date.now() - t1,
        retryCount: 0,
        entitiesFound: classification.indicators.length,
      });
    } else {
      emit({ type: "stage_skipped", stage: "parse", reason: "replay_skip", at: nowIso() });
      geminiSummary = inv.geminiSummary ?? "";
      parserUsed = inv.parserUsed ?? "gemini";
      stageResults.push({
        stageId: "parse",
        status: "SKIPPED",
        durationMs: 0,
        retryCount: 0,
        entitiesFound: 0,
      });
    }

    // ── STAGE 3 — Agentic investigation loop (Phase 9) ──
    if (skipUntil <= 2) {
      const t2 = Date.now();
      upsertStageState(inv, "STAGE_3", { status: "RUNNING", startedAt: new Date() });
      failedAtStage = "osint";
      emit({ type: "stage_started", stage: "osint", at: nowIso() });
      if (!evidenceCorpus) {
        evidenceCorpus = await assembleEvidenceCorpus(caseDoc.caseNumber);
      }
      const classification = await classifyCase(evidenceCorpus);
      pipelineClassification = classification;
      const toolsEnabled = getEffectiveLlm().toolsEnabled;
      const runOsintStage = toolsEnabled
        ? () => runInvestigationLoop(caseDoc.caseNumber, runId, evidenceCorpus as EvidenceCorpus, classification, emit)
        : () => runTextOnlyInvestigation(caseDoc.caseNumber, runId, evidenceCorpus as EvidenceCorpus, classification, emit);

      emit({
        type: "stage_log",
        stage: "osint",
        level: "info",
        message: toolsEnabled
          ? "OSINT mode: agent tool-calling loop"
          : "OSINT mode: victim-OCR text analysis + programmatic enrichment",
        at: nowIso(),
      });

      investigationMemory = await runWithRetry(runOsintStage, {
        maxRetries: toolsEnabled ? 2 : 0,
        backoffMs: 1000,
        stageName: toolsEnabled ? "osint-agent-loop" : "osint-text-analysis",
        emitLog: (msg) =>
          emit({
            type: "stage_log",
            stage: "osint",
            level: "warn",
            message: msg,
            at: nowIso(),
          }),
      });

      entities = buildEntitiesFromMemory(investigationMemory);
      enrichments = investigationMemory.iterations.map((it) => ({
        entityId: it.callId,
        source: it.toolName,
        confidence: confidenceToLabel(it.confidence) as OsintConfidence,
        details: it.output,
        timestamp: it.timestamp,
      }));
      inv.entities = entities;
      inv.enrichments = enrichments;
      // Store a compact memory summary for downstream report sections.
      inv.reportJson = {
        ...(inv.reportJson ?? {}),
        agentMemory: {
          runId: investigationMemory.runId,
          totalToolCalls: investigationMemory.totalToolCalls,
          exitReason: investigationMemory.exitReason,
          exitStatement: investigationMemory.exitStatement,
        },
      };
      caseDoc.markModified("osintInvestigation.reportJson");

      emit({
        type: "stage_completed",
        stage: "osint",
        at: nowIso(),
        data: {
          calls: investigationMemory.totalToolCalls,
          entities: entities.length,
          exitReason: investigationMemory.exitReason,
        },
      });

      ingestCaseEntities(
        caseDoc.caseNumber,
        caseDoc.createdAt ?? new Date(),
        Number(caseDoc.monetaryLoss ?? 0),
        entities,
      ).catch((err) => logger.warn({ err }, "[Pipeline] Neo4j ingestion non-fatal error"));

      upsertStageState(inv, "STAGE_3", { status: "COMPLETE", completedAt: new Date() });
      stageResults.push({
        stageId: "osint",
        status: "COMPLETE",
        durationMs: Date.now() - t2,
        retryCount: 0,
        entitiesFound: entities.length,
      });
    } else {
      emit({ type: "stage_skipped", stage: "osint", reason: "replay_skip", at: nowIso() });
      entities = inv.entities ?? [];
      enrichments = inv.enrichments ?? [];
      stageResults.push({
        stageId: "osint",
        status: "SKIPPED",
        durationMs: 0,
        retryCount: 0,
        entitiesFound: enrichments.length,
      });
    }

    // ── STAGE 4 — Correlation & Graph ──
    if (skipUntil <= 3) {
      const t3 = Date.now();
      upsertStageState(inv, "STAGE_4", { status: "RUNNING", startedAt: new Date() });
      failedAtStage = "correlation";
      emit({ type: "stage_started", stage: "correlation", at: nowIso() });

      const [neo4jAlerts, mongodbClusters] = await Promise.all([
        runAllClusterDetections(caseDoc.caseNumber),
        detectClusters(caseDoc, entities),
      ]);

      const neo4jClusters = alertsToOsintClusters(neo4jAlerts);
      const seenIds = new Set(neo4jClusters.map((c) => c.id));
      mergedClusters = [...neo4jClusters, ...mongodbClusters.filter((c) => !seenIds.has(c.id))];

      modusOperandi = classifyModusOperandi(caseDoc);
      inv.clusters = mergedClusters;
      inv.modusOperandi = modusOperandi;

      const clusterSource = neo4jAlerts.length > 0 ? "Neo4j" : "MongoDB";
      emit({
        type: "stage_log",
        stage: "correlation",
        level: "info",
        message: `Clusters: ${mergedClusters.length} (${neo4jAlerts.length} Neo4j + ${mongodbClusters.length} MongoDB). Modus: ${modusOperandi.code}. Source: ${clusterSource}.`,
        at: nowIso(),
      });
      emit({
        type: "stage_completed",
        stage: "correlation",
        at: nowIso(),
        data: { clusters: mergedClusters.length, modusOperandi, neo4jAlerts: neo4jAlerts.length },
      });
      upsertStageState(inv, "STAGE_4", { status: "COMPLETE", completedAt: new Date() });
      stageResults.push({
        stageId: "correlation",
        status: "COMPLETE",
        durationMs: Date.now() - t3,
        retryCount: 0,
        entitiesFound: mergedClusters.length,
      });
    } else {
      emit({ type: "stage_skipped", stage: "correlation", reason: "replay_skip", at: nowIso() });
      mergedClusters = inv.clusters ?? [];
      modusOperandi = inv.modusOperandi ?? classifyModusOperandi(caseDoc);
      stageResults.push({
        stageId: "correlation",
        status: "SKIPPED",
        durationMs: 0,
        retryCount: 0,
        entitiesFound: mergedClusters.length,
      });
    }

    // ── STAGE 5 — Report Generation & HITL draft ──
    failedAtStage = "report";
    const t4 = Date.now();
    upsertStageState(inv, "STAGE_5", { status: "RUNNING", startedAt: new Date() });
    emit({ type: "stage_started", stage: "report", at: nowIso() });
    const md = composeReportMarkdown({
      caseDoc,
      hashes: hashManifest,
      entities,
      enrichments,
      clusters: mergedClusters,
      modusOperandi,
      runId,
      classification: pipelineClassification,
      investigationMemory,
    });
    const reportJson = composeReportJson({
      caseDoc,
      hashes: hashManifest,
      entities,
      enrichments,
      clusters: mergedClusters,
      modusOperandi,
      runId,
    });
    inv.draftReport = md;
    inv.reportMarkdown = md;
    inv.reportJson = reportJson;
    // Mixed-type field: Mongoose requires explicit markModified for change detection.
    caseDoc.markModified("osintInvestigation.reportJson");
    if (inv.phase === "evidence") inv.phase = "draft_report";
    emit({
      type: "stage_log",
      stage: "report",
      level: "success",
      message: "GRASSReport v1.0 draft composed and persisted.",
      at: nowIso(),
    });
    emit({ type: "stage_completed", stage: "report", at: nowIso() });
    upsertStageState(inv, "STAGE_5", { status: "COMPLETE", completedAt: new Date() });
    stageResults.push({
      stageId: "report",
      status: "COMPLETE",
      durationMs: Date.now() - t4,
      retryCount: 0,
    });

    inv.lastRunStatus = "completed";
    await caseDoc.save();

    await PipelineRun.findOneAndUpdate(
      { runId },
      {
        $set: {
          status: "COMPLETE",
          completedAt: new Date(),
          stageResults,
          totalEntities: entities.length,
          totalEnrichments: enrichments.length,
        },
      },
    );

    // ── Auto-draft entity dispatch plan (non-blocking) ──
    // Builds a strict GRASSReport from in-memory pipeline state and persists
    // a Dispatch document. Failures are logged at WARN and do not fail the
    // pipeline — the UI offers a "Generate dispatch plan" button as fallback.
    try {
      const auto = await autoDraftDispatchPlan({
        caseDoc,
        runId,
        analystId: opts.analystId,
        entities,
        enrichments,
        clusters: mergedClusters,
        hashManifest,
        invalidEntities: inv.invalidEntities ?? [],
        geminiSummary: inv.geminiSummary ?? "",
        modusOperandiCode: modusOperandi?.code,
        modusOperandiConfidence: modusOperandi?.confidence,
      });
      if (auto.ok) {
        emit({
          type: "stage_log",
          stage: "report",
          level: "info",
          message:
            "Dispatch plan auto-drafted: " +
            String(auto.recipients) +
            (auto.recipients === 1 ? " recipient" : " recipients") +
            " routed.",
          at: nowIso(),
        });
      } else {
        logger.warn(
          { caseId: caseDoc.caseNumber, runId, error: auto.error },
          "[Pipeline] auto dispatch-plan skipped",
        );
      }
    } catch (autoErr) {
      logger.warn(
        { err: autoErr, caseId: caseDoc.caseNumber, runId },
        "[Pipeline] auto dispatch-plan threw (non-fatal)",
      );
    }

    emit({ type: "done", runId, at: nowIso(), investigation: inv });
    return inv;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Pipeline crashed";
    inv.lastRunStatus = "failed";
    try {
      await caseDoc.save();
    } catch {
      /* ignore save errors during failure */
    }
    await PipelineRun.findOneAndUpdate(
      { runId },
      {
        $set: {
          status: "FAILED",
          completedAt: new Date(),
          stageResults,
          failedAtStage: failedAtStage ?? "unknown",
        },
      },
    ).catch(() => {
      /* non-fatal */
    });
    emit({ type: "error", message, at: nowIso() });
    throw err;
  }
}

/** Replay helper — same as `runInvestigation` with lineage + optional stage skip. */
export async function replayInvestigation(
  caseDoc: ICase,
  parentRunId: string,
  fromStage: RunStage | undefined,
  analystId: string,
  emit: EmitFn,
): Promise<IOsintInvestigation> {
  return runInvestigation(caseDoc, { analystId, replayFromStage: fromStage, parentRunId }, emit);
}

export function ensureInvestigation(caseDoc: ICase): IOsintInvestigation {
  if (!caseDoc.osintInvestigation) {
    caseDoc.osintInvestigation = {
      evidenceItems: [],
      draftReport: "",
      finalReport: "",
      leAgency: "",
      leDistrict: "",
      leReferenceNumber: "",
      phase: "evidence",
      hashManifest: [],
      entities: [],
      invalidEntities: [],
      enrichments: [],
      clusters: [],
      geminiSummary: "",
      parserUsed: "regex",
      reportMarkdown: "",
      customTools: [],
      exifArtifacts: [],
      stageStates: [],
      lastRunId: "",
      lastRunStatus: "idle",
    };
  } else {
    // Back-fill any newly-added fields for pre-existing docs
    const i = caseDoc.osintInvestigation;
    i.hashManifest ??= [];
    i.entities ??= [];
    i.invalidEntities ??= [];
    i.enrichments ??= [];
    i.clusters ??= [];
    i.stageStates ??= [];
    i.customTools ??= [];
    i.exifArtifacts ??= [];
    i.geminiSummary ??= "";
    i.parserUsed ??= "regex";
    i.reportMarkdown ??= "";
    i.lastRunId ??= "";
    i.lastRunStatus ??= "idle";
  }
  return caseDoc.osintInvestigation;
}

// ─────────────────────── ad-hoc tool runner (analyst-initiated) ───────────────────────

export type ToolKind = "whois" | "ip" | "urlscan" | "shodan";

export async function runAdHocTool(kind: ToolKind, query: string): Promise<
  | { ok: true; data: Record<string, unknown>; provider: string }
  | { ok: false; status: number; error: string }
> {
  if (kind === "whois") {
    if (!secrets.whoisxml()) {
      return {
        ok: true,
        provider: "mock",
        data: {
          mock: true,
          note: "Set WHOISXML_API_KEY for live data",
          domain: query,
        },
      };
    }
    const res = await fetchWhoisXml(query);
    if (!res.ok) return res;
    return { ok: true, data: res.data as Record<string, unknown>, provider: "whoisxml" };
  }

  if (kind === "ip") {
    if (!secrets.virustotal()) {
      return {
        ok: true,
        provider: "mock",
        data: { mock: true, note: "Set VIRUSTOTAL_API_KEY for live data", ip: query },
      };
    }
    const res = await fetchVtIp(query);
    if (!res.ok) return res;
    return { ok: true, data: res.data, provider: "virustotal" };
  }

  if (kind === "urlscan") {
    if (!secrets.virustotal()) {
      return {
        ok: true,
        provider: "mock",
        data: { mock: true, note: "Set VIRUSTOTAL_API_KEY for live data", url: query },
      };
    }
    const res = await fetchVtUrlReputation(query);
    if (!res.ok) return res;
    return { ok: true, data: res.data, provider: "virustotal" };
  }

  // shodan
  if (!secrets.shodan()) {
    return {
      ok: true,
      provider: "mock",
      data: {
        mock: true,
        query,
        note: "Set SHODAN_API_KEY for live Shodan data",
      },
    };
  }
  try {
    const url = `https://api.shodan.io/shodan/host/search?key=${encodeURIComponent(secrets.shodan())}&query=${encodeURIComponent(query)}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!resp.ok) {
      return { ok: false, status: resp.status, error: `Shodan HTTP ${resp.status}` };
    }
    const body = (await resp.json()) as Record<string, unknown>;
    return { ok: true, provider: "shodan", data: { mock: false, query, ...body } };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: err instanceof Error ? err.message : "Shodan request failed",
    };
  }
}

export function appendToolToReport(
  inv: IOsintInvestigation,
  tool: { kind: ToolKind; query: string; result: Record<string, unknown>; provider: string },
): void {
  const block = [
    ``,
    "### Analyst-added OSINT lookup — " + tool.kind.toUpperCase() + " on `" + tool.query + "`",
    "- Provider: " + tool.provider,
    "- Time: " + new Date().toISOString(),
    ``,
    "```json",
    JSON.stringify(tool.result, null, 2).slice(0, 4000),
    "```",
    ``,
  ].join("\n");
  inv.reportMarkdown = (inv.reportMarkdown || "") + block;
  inv.draftReport = (inv.draftReport || "") + block;
}

// Preserve export used by summarizeVtIpRecord (some enrichment paths use unsummarised `attributes`).
export { summarizeVtDomainRecord, summarizeVtIpRecord };
