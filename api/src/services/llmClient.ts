import OpenAI from "openai";
import { ChatOpenAI } from "@langchain/openai";
import { logger } from "../utils/logger";
import { getEffectiveLlm } from "./runtimeSettings";

/** llama.cpp / Ollama ignore the key; placeholder only. */
const LOCAL_LLM_DUMMY_KEY = "local";

let loggedFingerprint = "";

function logProviderOnce(): void {
  const llm = getEffectiveLlm();
  const fingerprint = `${llm.provider}|${llm.baseUrl}|${llm.model}|${llm.isCloud}`;
  if (loggedFingerprint === fingerprint) return;
  loggedFingerprint = fingerprint;
  logger.info(
    {
      provider: llm.isCloud ? "cloud" : "local",
      settingsProvider: llm.provider,
      baseUrl: llm.baseUrl,
      model: llm.model,
      vision: llm.visionEnabled,
      tools: llm.toolsEnabled,
      fromSettings: llm.fromSettings,
    },
    "[LLM] Active inference backend",
  );
}

/** True when cloud API key is set, or a local OpenAI-compatible base URL is configured. */
export function isLlmConfigured(): boolean {
  const llm = getEffectiveLlm();
  return Boolean(llm.apiKey) || Boolean(llm.baseUrl);
}

/** @deprecated use isLlmConfigured */
export function isLocalLlmConfigured(): boolean {
  return isLlmConfigured();
}

export function getLlmModel(): string {
  return getEffectiveLlm().model;
}

/** @deprecated use getLlmModel */
export function getLocalLlmModel(): string {
  return getLlmModel();
}

function defaultHeaders(): Record<string, string> | undefined {
  const llm = getEffectiveLlm();
  if (!llm.isCloud) return undefined;
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
  const apiKey = llm.isCloud || llm.apiKey ? llm.apiKey || LOCAL_LLM_DUMMY_KEY : LOCAL_LLM_DUMMY_KEY;
  const headers = defaultHeaders();
  return new OpenAI({
    apiKey,
    baseURL: llm.baseUrl,
    ...(headers ? { defaultHeaders: headers } : {}),
  });
}

export function createChatModel(options?: { temperature?: number; timeout?: number }): ChatOpenAI {
  logProviderOnce();
  const llm = getEffectiveLlm();
  const apiKey = llm.isCloud || llm.apiKey ? llm.apiKey || LOCAL_LLM_DUMMY_KEY : LOCAL_LLM_DUMMY_KEY;
  const headers = defaultHeaders();
  return new ChatOpenAI({
    model: llm.model,
    temperature: options?.temperature ?? 0,
    apiKey,
    configuration: {
      baseURL: llm.baseUrl,
      ...(headers ? { defaultHeaders: headers } : {}),
    },
    ...(options?.timeout !== undefined ? { timeout: options.timeout } : {}),
  });
}
