import crypto from "crypto";
import { TOOL_REGISTRY } from "./registry";
import { flattenCorpusForAnalysis } from "./flattenCorpus";
import { isToolAvailable, type AgentTool, type ToolContext } from "./toolRegistry";
import { InvestigationMemoryModel } from "../models";
import type { EvidenceCorpus } from "./evidenceCorpus";
import type { CaseClassification, InvestigationMemory, ToolCall } from "../types/investigationMemory";
import { InvestigationMemoryZ } from "../types/investigationMemory";
import { extractEntitiesWithGemini } from "../services/geminiService";
import { extractEntitiesFromCorpus } from "../services/osintPipeline";
import { validateExtractedEntities } from "../utils/entityValidator";
import type { IOsintEntity, OsintEntityType } from "../models";
import { ConfidenceScore } from "../types/confidence";
import type { EmitFn } from "../services/osintPipeline";
import { logger } from "../utils/logger";

const TOOL_INPUT: Partial<Record<OsintEntityType, (value: string) => Record<string, string>>> = {
  phone: (v) => ({ phone: v }),
  upi: (v) => ({ upi: v }),
  ipv4: (v) => ({ ip: v }),
  url: (v) => ({ url: v }),
  domain: (v) => ({ domain: v }),
  email: (v) => ({ email: v }),
  wallet: (v) => ({ wallet: v }),
  telegram: (v) => ({ telegramId: v }),
  username: (v) => ({ username: v.replace(/^@/, "") }),
};

const TOOL_NAME: Partial<Record<OsintEntityType, string>> = {
  phone: "lookup_phone",
  upi: "lookup_upi",
  ipv4: "lookup_ip",
  url: "scan_url",
  domain: "whois_domain",
  email: "check_email_breach",
  wallet: "trace_crypto_wallet",
  telegram: "lookup_telegram_id",
  username: "search_username",
};

const PUBLIC_TOOL_CAP = 5;
const CAPPED_PUBLIC_TOOLS = new Set(["crawl_site", "harvest_domain", "email_footprint", "search_username"]);

export interface ToolPlan {
  toolName: string;
  input: Record<string, string>;
}

/** Primary lookup plus the API-free public footprint tool for that entity. */
export function toolPlansForEntity(entity: { type: string; value: string }): ToolPlan[] {
  const plans: ToolPlan[] = [];
  const type = entity.type as OsintEntityType;
  const primary = TOOL_NAME[type];
  const buildInput = TOOL_INPUT[type];
  if (primary && buildInput) plans.push({ toolName: primary, input: buildInput(entity.value) });

  if (type === "url") plans.push({ toolName: "crawl_site", input: { url: entity.value } });
  if (type === "domain") plans.push({ toolName: "harvest_domain", input: { domain: entity.value } });
  if (type === "email") plans.push({ toolName: "email_footprint", input: { email: entity.value } });
  if (type === "telegram") {
    const handle = entity.value.replace(/^@/, "");
    if (/^[A-Za-z][A-Za-z0-9_.-]{2,31}$/.test(handle)) {
      plans.push({ toolName: "search_username", input: { username: handle } });
    }
  }
  return plans;
}

/** Dedupe identical calls and cap the public-network tools. */
export function selectToolPlans(
  entities: Array<{ type: string; value: string }>,
): Array<ToolPlan & { type: string; value: string }> {
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  const selected: Array<ToolPlan & { type: string; value: string }> = [];
  for (const entity of entities) {
    for (const plan of toolPlansForEntity(entity)) {
      const key = `${plan.toolName}:${JSON.stringify(plan.input).toLowerCase()}`;
      if (seen.has(key)) continue;
      if (CAPPED_PUBLIC_TOOLS.has(plan.toolName)) {
        const used = counts.get(plan.toolName) ?? 0;
        if (used >= PUBLIC_TOOL_CAP) continue;
        counts.set(plan.toolName, used + 1);
      }
      seen.add(key);
      selected.push({ type: entity.type, value: entity.value, ...plan });
    }
  }
  return selected;
}

async function persistMemorySnapshot(memory: InvestigationMemory): Promise<void> {
  const validated = InvestigationMemoryZ.parse(memory);
  await InvestigationMemoryModel.updateOne(
    { caseId: validated.caseId, runId: validated.runId },
    { $set: validated },
    { upsert: true },
  );
}

async function extractEntitiesFromEvidence(
  corpus: EvidenceCorpus,
  emit: EmitFn | null,
): Promise<{ entities: IOsintEntity[]; summary: string }> {
  const entries = flattenCorpusForAnalysis(corpus);
  emit?.({
    type: "stage_log",
    stage: "osint",
    level: "info",
    message: `Analyzing ${entries.length} evidence source(s) with victim-OCR model (text)`,
    at: new Date().toISOString(),
  });

  let llmEntities: IOsintEntity[] = [];
  let summary = "";

  const gemini = await extractEntitiesWithGemini(entries);
  if (!gemini.usedFallback) {
    const validated = validateExtractedEntities(gemini.extraction);
    llmEntities = validated.valid;
    summary = gemini.extraction.summary || "";
    emit?.({
      type: "stage_log",
      stage: "osint",
      level: "info",
      message: `LLM extracted ${llmEntities.length} entities`,
      at: new Date().toISOString(),
    });
  } else {
    emit?.({
      type: "stage_log",
      stage: "osint",
      level: "warn",
      message: `LLM extraction fallback: ${gemini.reason}`,
      at: new Date().toISOString(),
    });
  }

  const regexEntities = extractEntitiesFromCorpus(entries);
  const seen = new Set(llmEntities.map((e) => `${e.type}:${e.value.toLowerCase()}`));
  for (const e of regexEntities) {
    const k = `${e.type}:${e.value.toLowerCase()}`;
    if (!seen.has(k)) {
      seen.add(k);
      llmEntities.push(e);
    }
  }

  return { entities: llmEntities, summary };
}

function seedMemoryEntities(memory: InvestigationMemory, entities: IOsintEntity[], callId: string): void {
  for (const e of entities) {
    const key = `${e.type}:${e.value.toLowerCase()}`;
    if (memory.entitiesFound[key]) continue;
    memory.entitiesFound[key] = {
      type: e.type,
      value: e.value,
      firstSeenIn: callId,
      leadSource: e.sourceFile,
      enrichments: [],
      confidence: e.valid ? ConfidenceScore.LOW : ConfidenceScore.UNVERIFIED,
      flags: [],
    };
  }
}

/**
 * Victim-OCR / text-only path: analyze PDF+image text corpus with local LLM,
 * extract entities, then run OSINT tools programmatically (no LangChain tool binding).
 */
export async function runTextOnlyInvestigation(
  caseId: string,
  runId: string,
  corpus: EvidenceCorpus,
  classification: CaseClassification,
  emitter: EmitFn | null,
): Promise<InvestigationMemory> {
  const memory: InvestigationMemory = {
    caseId,
    runId,
    classification,
    iterations: [],
    entitiesFound: {},
    totalToolCalls: 0,
    startedAt: new Date(),
    exitReason: "ERROR",
    exitStatement: "",
  };

  const extractCallId = crypto.randomUUID();
  const { entities, summary } = await extractEntitiesFromEvidence(corpus, emitter);
  seedMemoryEntities(memory, entities, extractCallId);

  const toolsByName = new Map(
    TOOL_REGISTRY.filter((t) => isToolAvailable(t, process.env)).map((t) => [t.name, t]),
  );

  let iterNum = 0;
  for (const plan of selectToolPlans(entities)) {
    const tool = toolsByName.get(plan.toolName) as AgentTool<unknown, unknown> | undefined;
    if (!tool) continue;

    iterNum++;
    const callId = crypto.randomUUID();
    const ctx: ToolContext = { caseId, runId, callId, iterNum };

    emitter?.({
      type: "stage_log",
      stage: "osint",
      level: "info",
      message: `Enriching ${plan.type}: ${plan.value.slice(0, 40)}… via ${plan.toolName}`,
      at: new Date().toISOString(),
    });

    try {
      const start = Date.now();
      const result = await tool.execute(plan.input as never, ctx);
      const tc: ToolCall = {
        callId,
        iterationNum: iterNum,
        toolName: plan.toolName,
        input: plan.input,
        output: (result.data ?? {}) as Record<string, unknown>,
        confidence: result.confidence,
        durationMs: Date.now() - start,
        timestamp: new Date(),
        newLeadsFound: [],
        reasoning: "",
        screenshotPath: result.screenshotPath,
      };
      memory.iterations.push(tc);
      memory.totalToolCalls++;

      const key = `${plan.type}:${plan.value.toLowerCase()}`;
      const ent = memory.entitiesFound[key];
      if (ent) {
        ent.enrichments.push(tc);
        if (result.confidence > ent.confidence) ent.confidence = result.confidence;
      }
    } catch (err) {
      logger.warn({ err, toolName: plan.toolName, entity: plan.value }, "[TextInvestigation] Tool failed");
    }
  }

  memory.exitReason = "COMPLETE";
  memory.exitStatement =
    summary ||
    classification.strategy ||
    `Analyzed ${entities.length} entities from victim evidence (PDF, images, complaint).`;
  memory.completedAt = new Date();

  emitter?.({
    type: "agent_complete",
    exitReason: memory.exitReason,
    totalCalls: memory.totalToolCalls,
    summary: memory.exitStatement,
    at: new Date().toISOString(),
  });

  await persistMemorySnapshot(memory);
  return memory;
}
