import OpenAI from "openai";
import { ChatOpenAI } from "@langchain/openai";
import { logger } from "../utils/logger";
import { getEffectiveLlm } from "./runtimeSettings";

let loggedFingerprint = "";

function logProviderOnce(): void {
  const llm = getEffectiveLlm();
  const fingerprint = `${llm.provider}|${llm.baseUrl}|${llm.model}|${llm.isCloud}`;
  if (loggedFingerprint === fingerprint) return;
  loggedFingerprint = fingerprint;
  logger.info(
    {
      provider: llm.provider,
      baseUrl: llm.baseUrl,
      model: llm.model,
      vision: llm.visionEnabled,
      tools: llm.toolsEnabled,
      fromSettings: llm.fromSettings,
    },
    "[LLM] Active inference backend",
  );
}

/** True when a cloud / OpenAI-compatible API key and base URL are configured. */
export function isLlmConfigured(): boolean {
  const llm = getEffectiveLlm();
  return Boolean(llm.apiKey) && Boolean(llm.baseUrl);
}

export function getLlmModel(): string {
  return getEffectiveLlm().model;
}

function defaultHeaders(): Record<string, string> | undefined {
  const llm = getEffectiveLlm();
  if (!llm.apiKey) return undefined;
  if (llm.baseUrl.includes("openrouter.ai")) {
    return {
      "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER || "https://graas.local",
      "X-Title": process.env.OPENROUTER_APP_TITLE || "GRAAS",
    };
  }
  return undefined;
}

export function getOpenAIClient(): OpenAI {
  logProviderOnce();
  const llm = getEffectiveLlm();
  if (!llm.apiKey || !llm.baseUrl) {
    throw new Error("LLM is not configured — set a cloud API key in Settings or api/.env");
  }
  const headers = defaultHeaders();
  return new OpenAI({
    apiKey: llm.apiKey,
    baseURL: llm.baseUrl,
    ...(headers ? { defaultHeaders: headers } : {}),
  });
}

export function createChatModel(options?: { temperature?: number; timeout?: number }): ChatOpenAI {
  logProviderOnce();
  const llm = getEffectiveLlm();
  if (!llm.apiKey || !llm.baseUrl) {
    throw new Error("LLM is not configured — set a cloud API key in Settings or api/.env");
  }
  const headers = defaultHeaders();
  return new ChatOpenAI({
    model: llm.model,
    temperature: options?.temperature ?? 0,
    apiKey: llm.apiKey,
    configuration: {
      baseURL: llm.baseUrl,
      ...(headers ? { defaultHeaders: headers } : {}),
    },
    ...(options?.timeout !== undefined ? { timeout: options.timeout } : {}),
  });
}
