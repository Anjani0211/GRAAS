import OpenAI from "openai";
import { ChatOpenAI } from "@langchain/openai";
import { config } from "../config";
import { logger } from "../utils/logger";

/** llama.cpp / Ollama ignore the key; placeholder only. */
const LOCAL_LLM_DUMMY_KEY = "local";

let loggedProviderOnce = false;

function logProviderOnce(): void {
  if (loggedProviderOnce) return;
  loggedProviderOnce = true;
  logger.info(
    {
      provider: config.llmIsCloud ? "cloud" : "local",
      baseUrl: config.llmBaseUrl,
      model: config.llmModel,
      vision: config.localLlmVisionEnabled,
      tools: config.localLlmToolsEnabled,
    },
    "[LLM] Active inference backend",
  );
}

/** True when cloud API key is set, or a local OpenAI-compatible base URL is configured. */
export function isLlmConfigured(): boolean {
  return Boolean(config.llmApiKey) || Boolean(config.llmBaseUrl);
}

/** @deprecated use isLlmConfigured */
export function isLocalLlmConfigured(): boolean {
  return isLlmConfigured();
}

export function getLlmModel(): string {
  return config.llmModel;
}

/** @deprecated use getLlmModel */
export function getLocalLlmModel(): string {
  return getLlmModel();
}

function defaultHeaders(): Record<string, string> | undefined {
  if (!config.llmIsCloud) return undefined;
  // OpenRouter recommends these headers; harmless for other providers.
  if (config.llmBaseUrl.includes("openrouter.ai")) {
    return {
      "HTTP-Referer": config.openRouterHttpReferer,
      "X-Title": config.openRouterAppTitle,
    };
  }
  return undefined;
}

export function getOpenAIClient(): OpenAI {
  logProviderOnce();
  const apiKey = config.llmIsCloud ? config.llmApiKey : LOCAL_LLM_DUMMY_KEY;
  const headers = defaultHeaders();
  return new OpenAI({
    apiKey,
    baseURL: config.llmBaseUrl,
    ...(headers ? { defaultHeaders: headers } : {}),
  });
}

export function createChatModel(options?: { temperature?: number; timeout?: number }): ChatOpenAI {
  logProviderOnce();
  const apiKey = config.llmIsCloud ? config.llmApiKey : LOCAL_LLM_DUMMY_KEY;
  const headers = defaultHeaders();
  return new ChatOpenAI({
    model: config.llmModel,
    temperature: options?.temperature ?? 0,
    apiKey,
    configuration: {
      baseURL: config.llmBaseUrl,
      ...(headers ? { defaultHeaders: headers } : {}),
    },
    ...(options?.timeout !== undefined ? { timeout: options.timeout } : {}),
  });
}
