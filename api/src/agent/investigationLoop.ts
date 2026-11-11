import crypto from "crypto";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { config } from "../config";
import { logger } from "../utils/logger";
import { createChatModel } from "../services/llmClient";
import { TOOL_REGISTRY } from "./registry";
import { isToolAvailable, type AgentTool, type ToolContext } from "./toolRegistry";
import { InvestigationMemoryModel } from "../models";
import { ConfidenceScore } from "../types/confidence";
import type { EvidenceCorpus } from "./evidenceCorpus";
import type { CaseClassification, EntityWithHistory, InvestigationMemory, ToolCall } from "../types/investigationMemory";
import { InvestigationMemoryZ } from "../types/investigationMemory";
import { buildAgentSystemPrompt } from "./prompts/investigatorPrompt";
import type { EmitFn } from "../services/osintPipeline";
import { captureToolScreenshot } from "./screenshotCapture";

async function persistMemorySnapshot(memory: InvestigationMemory): Promise<void> {
  const validated = InvestigationMemoryZ.parse(memory);
  await InvestigationMemoryModel.updateOne(
    { caseId: validated.caseId, runId: validated.runId },
    { $set: validated },
    { upsert: true },
  );
}

function extractEntitiesFromToolResult(data: unknown, toolName: string): Array<{ type: string; value: string }> {
  const out: Array<{ type: string; value: string }> = [];
  const seen = new Set<string>();
  const looksLikeBase64Blob = (text: string): boolean => {
    if (text.length < 256) return false;
    if (text.startsWith("data:image/")) return true;
    return /^[A-Za-z0-9+/=\r\n]+$/.test(text) && !/\s/.test(text) && text.length > 512;
  };
  const normalizeUrl = (raw: string): string | null => {
    const v = raw.replace(/[),.;]+$/, "").trim();
    try {
      const u = new URL(v);
      if (!["http:", "https:"].includes(u.protocol)) return null;
      if (!u.hostname || u.hostname.length < 3) return null;
      return u.toString();
    } catch {
      return null;
    }
  };
  const normalizeDomain = (raw: string): string | null => {
    const d = raw.toLowerCase().replace(/[),.;]+$/, "").trim();
    if (d.length < 4 || d.length > 253) return null;
    if (d.includes("@")) return null;
    if (!/^[a-z0-9.-]+$/.test(d)) return null;
    if (d.startsWith("-") || d.endsWith("-") || d.startsWith(".") || d.endsWith(".")) return null;
    const parts = d.split(".");
    if (parts.length < 2) return null;
    const tld = parts[parts.length - 1] || "";
    if (!/^[a-z]{2,24}$/.test(tld)) return null;
    return d;
  };
  const normalizeUpi = (raw: string): string | null => {
    const v = raw.toLowerCase().trim();
    if (!/^[a-z0-9._-]+@[a-z]{3,}$/.test(v)) return null;
    return v;
  };
  const normalizeEmail = (raw: string): string | null => {
    const v = raw.toLowerCase().trim();
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(v)) return null;
    return v;
  };
  const normalizePhone = (raw: string): string | null => {
    const v = raw.replace(/\s+/g, "");
    if (!/^(?:\+91|0)?[6-9]\d{9}$/.test(v)) return null;
    return v;
  };
  const normalizeTelegram = (raw: string): string | null => {
    const v = raw.trim();
    if (!/^@[A-Za-z0-9_]{5,32}$/.test(v)) return null;
    return v;
  };
  const normalizeIpv4 = (raw: string): string | null => {
    const v = raw.trim();
    if (!/^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)$/.test(v)) return null;
    return v;
  };
  const normalizeWallet = (raw: string): string | null => {
    const v = raw.trim();
    if (/^0x[a-fA-F0-9]{40}$/.test(v)) return v;
    if (/^(?:bc1|[13])[a-zA-HJ-NP-Z0-9]{25,39}$/.test(v)) return v;
    return null;
  };
  const add = (type: string, value: string) => {
    const v =
      type === "url" ? normalizeUrl(value)
      : type === "domain" ? normalizeDomain(value)
      : type === "upi" ? normalizeUpi(value)
      : type === "email" ? normalizeEmail(value)
      : type === "phone" ? normalizePhone(value)
      : type === "telegram" ? normalizeTelegram(value)
      : type === "ipv4" ? normalizeIpv4(value)
      : type === "wallet" ? normalizeWallet(value)
      : value.trim();
    if (!v) return;
    // Avoid promoting massive blobs (e.g. screenshot/image base64) as leads.
    if (v.length > 220) return;
    const k = `${type}:${v.toLowerCase()}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ type, value: v });
  };
  const harvest = (v: unknown, keyHint = "") => {
    if (typeof v === "string") {
      if (looksLikeBase64Blob(v)) return;
      // Skip known high-noise fields that usually contain rendered blobs or huge free text.
      if (/(screenshot|thumbnail|imagebase64|raw|html|markdown|body)/i.test(keyHint) && v.length > 600) return;
      (v.match(/(?:\+?91|0)?[6-9]\d{9}/g) ?? []).forEach((x) => add("phone", x));
      (v.match(/\b[a-zA-Z0-9._-]+@[a-zA-Z]{3,}\b/g) ?? []).forEach((x) => add("upi", x));
      (v.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g) ?? []).forEach((x) => add("email", x));
      (v.match(/\bhttps?:\/\/[^\s<>"{}|\\^`[\]]+/g) ?? []).forEach((x) => add("url", x));
      (v.match(/\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}\b/gi) ?? []).forEach((x) => add("domain", x));
      (v.match(/\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b/g) ?? []).forEach((x) => add("ipv4", x));
      (v.match(/\b0x[a-fA-F0-9]{40}\b/g) ?? []).forEach((x) => add("wallet", x));
      (v.match(/\b(?:bc1|[13])[a-zA-HJ-NP-Z0-9]{25,39}\b/g) ?? []).forEach((x) => add("wallet", x));
      (v.match(/(?<![a-zA-Z0-9])@[A-Za-z0-9_]{5,32}\b/g) ?? []).forEach((x) => add("telegram", x));
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) harvest(item, keyHint);
      return;
    }
    if (v && typeof v === "object") {
      for (const [k, value] of Object.entries(v as Record<string, unknown>)) harvest(value, k);
    }
  };
  harvest(data);

  const rec = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  if (rec) {
    if (toolName === "lookup_phone" && typeof rec.phone === "string") add("phone", rec.phone);
    if (toolName === "lookup_upi" && typeof rec.upi === "string") add("upi", rec.upi);
    if (toolName === "lookup_ip" && typeof rec.ip === "string") add("ipv4", rec.ip);
    if (toolName === "whois_domain" && typeof rec.domain === "string") add("domain", rec.domain);
    if (toolName === "scan_url" && typeof rec.url === "string") add("url", rec.url);
    if (toolName === "search_username" && typeof rec.username === "string") add("username", rec.username);
    if (toolName === "lookup_telegram_id" && typeof rec.telegramId === "string") add("telegram", rec.telegramId);
    if (toolName === "trace_crypto_wallet" && typeof rec.wallet === "string") add("wallet", rec.wallet);
    if (toolName === "analyze_apk" && typeof rec.evidenceId === "string") add("apk", rec.evidenceId);
  }
  return out.slice(0, 60);
}

function updateEntityHistory(
  memory: InvestigationMemory,
  entity: { type: string; value: string },
  callId: string,
): boolean {
  const key = entity.value;
  const prev = memory.entitiesFound[key];
  if (prev) return false;
  memory.entitiesFound[key] = {
    value: entity.value,
    type: (entity.type as EntityWithHistory["type"]) ?? "username",
    firstSeenIn: callId,
    leadSource: callId,
    enrichments: [],
    confidence: ConfidenceScore.LOW,
    flags: [],
  };
  return true;
}

export async function runInvestigationLoop(
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

  const availableTools = TOOL_REGISTRY.filter((t) => isToolAvailable(t, process.env));

  /** Produce a clean JSON Schema object (no $schema wrapper) for tool binding. */
  function cleanJsonSchema(zodSchema: unknown): z.ZodObject<Record<string, z.ZodTypeAny>> {
    // LangChain @langchain/openai tool binding works best with raw Zod schemas
    return zodSchema as z.ZodObject<Record<string, z.ZodTypeAny>>;
  }

  const lcTools = availableTools.map((t: AgentTool<unknown, unknown>) =>
    tool(
      async (input: unknown) => {
        const callId = crypto.randomUUID();
        const iterNum = memory.iterations.length + 1;
        const start = Date.now();
        const ctx: ToolContext = { caseId, runId, callId, iterNum };

        emitter?.({
          type: "agent_iteration",
          iterNum,
          toolName: t.name,
          reasoning: `Agent selected ${t.name} for current lead`,
          at: new Date().toISOString(),
        });

        const result = await t.execute(input as never, ctx);
        let screenshotPath = result.screenshotPath;
        let thumbnailB64: string | undefined;
        if (t.shouldScreenshot) {
          try {
            const captured = await captureToolScreenshot(t.name, result, ctx);
            screenshotPath = captured.screenshotPath ?? screenshotPath;
            thumbnailB64 = captured.thumbnailB64;
          } catch {
            // Non-fatal: investigation must continue even if screenshot capture fails.
          }
        }
        const durationMs = Date.now() - start;

        const tc: ToolCall = {
          callId,
          iterationNum: iterNum,
          toolName: t.name,
          input: (input as Record<string, unknown>) ?? {},
          output: (result.data ?? {}) as Record<string, unknown>,
          confidence: result.confidence,
          durationMs,
          timestamp: new Date(),
          newLeadsFound: [],
          reasoning: "",
          screenshotPath,
        };

        memory.iterations.push(tc);
        memory.totalToolCalls++;

        if (result.data) {
          const newEntities = extractEntitiesFromToolResult(result.data, t.name);
          for (const e of newEntities) {
            const isNew = updateEntityHistory(memory, e, callId);
            if (isNew) {
              emitter?.({
                type: "agent_new_lead",
                entity: e.value,
                entityType: e.type,
                foundIn: callId,
                at: new Date().toISOString(),
              });
            }
          }
        }

        if (screenshotPath) {
          emitter?.({
            type: "agent_screenshot",
            callId,
            toolName: t.name,
            thumbnailB64: thumbnailB64 ?? "",
            at: new Date().toISOString(),
          });
        }

        await persistMemorySnapshot(memory);

        return result.rawText || JSON.stringify(result.data ?? {});
      },
      {
        name: t.name,
        description: t.description,
        schema: cleanJsonSchema(t.inputSchema),
      },
    ),
  );

  const completeTool = tool(
    async ({ summary }: { summary: string }) => {
      memory.exitReason = "COMPLETE";
      memory.exitStatement = summary;
      memory.completedAt = new Date();
      await persistMemorySnapshot(memory);
      return "Investigation marked complete.";
    },
    {
      name: "investigation_complete",
      description:
        "Call this when all investigative leads are exhausted and you can summarise key findings. Provide a 3-5 sentence summary.",
      schema: z.object({ summary: z.string() }),
    },
  );

  const model = createChatModel({ timeout: config.agentIterationTimeoutMs }).bindTools([
    ...lcTools,
    completeTool,
  ]);

  const systemMessage = buildAgentSystemPrompt(corpus, classification);
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system" as const, content: systemMessage },
    {
      role: "user" as const,
      content: `Begin investigating case ${caseId}. Start with: ${(classification.priorityTools || []).join(", ")}`,
    },
  ];

  let iteration = 0;
  const maxIter = config.agentMaxIterations;

  await persistMemorySnapshot(memory);

  while (iteration < maxIter && memory.exitReason === "ERROR") {
    iteration++;
    emitter?.({
      type: "stage_log",
      stage: "osint",
      level: "info",
      message: `[Agent] Iteration ${iteration}/${maxIter}`,
      at: new Date().toISOString(),
    });

    let response: unknown;
    try {
      response = await model.invoke(messages, { timeout: config.agentIterationTimeoutMs });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      memory.exitReason = "TIMEOUT";
      memory.exitStatement = `Stopped after ${memory.totalToolCalls} tool calls: ${message.slice(0, 400)}`;
      memory.completedAt = new Date();
      logger.warn({ err, caseId, runId, toolCalls: memory.totalToolCalls }, "[Agent] Model call failed");
      break;
    }
    const assistantText = String((response as unknown as { content?: unknown }).content ?? "");
    messages.push({ role: "assistant", content: assistantText });

    // model.invoke does not run tools by itself. Dispatch each call into the
    // registered tool so the callback records the result on the case.
    const toolCalls = (response as unknown as { tool_calls?: unknown[] }).tool_calls ?? [];
    if (toolCalls.length === 0) {
      memory.exitReason = "COMPLETE";
      memory.exitStatement = assistantText;
      memory.completedAt = new Date();
      break;
    }

    const runnable = [...lcTools, completeTool];
    const resultLines: string[] = [];
    for (const call of toolCalls) {
      const rec = call as { name?: string; args?: unknown; id?: string };
      const name = rec.name ?? "";
      const lc = runnable.find((item) => item.name === name);
      let args: unknown = rec.args ?? {};
      if (typeof args === "string") {
        try {
          args = JSON.parse(args);
        } catch {
          args = {};
        }
      }
      if (!lc) {
        resultLines.push(`${name || "unknown"}: tool is not available.`);
        continue;
      }
      try {
        const output = await lc.invoke(args as never);
        resultLines.push(`${name}: ${String(output).slice(0, 2000)}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        resultLines.push(`${name}: failed (${message.slice(0, 300)})`);
        logger.warn({ err, toolName: name, caseId }, "[Agent] Tool invocation failed");
      }
    }
    if (memory.exitReason !== "ERROR") break;
    messages.push({
      role: "user",
      content: `Tool results:\n${resultLines.join("\n")}`,
    });
  }

  if (iteration >= maxIter && memory.exitReason === "ERROR") {
    memory.exitReason = "MAX_ITERATIONS";
    memory.exitStatement = `Hit maximum iteration limit (${maxIter}). Investigation partial.`;
    memory.completedAt = new Date();
    logger.warn({ caseId, runId, iteration }, "[Agent] Max iterations reached");
  }

  emitter?.({
    type: "agent_complete",
    exitReason: memory.exitReason,
    totalCalls: memory.totalToolCalls,
    summary: memory.exitStatement || "Investigation completed.",
    at: new Date().toISOString(),
  });

  await persistMemorySnapshot(memory);
  return memory;
}

