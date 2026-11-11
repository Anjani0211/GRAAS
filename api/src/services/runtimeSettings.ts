import { config } from "../config";
import { AI_PROVIDERS, KEY_CATALOG, type AiProviderId } from "../config/keyCatalog";
import {
  PlatformSettings,
  SETTINGS_DOC_ID,
  type IAiSettings,
  type IPlatformSettings,
  type IStoredKey,
} from "../models/PlatformSettings";
import { maskSecret, openSecret, sealSecret } from "../utils/secretBox";
import { logger } from "../utils/logger";

export interface EffectiveLlm {
  provider: AiProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
  isCloud: boolean;
  visionEnabled: boolean;
  toolsEnabled: boolean;
  /** True when Settings (not only .env) supplies AI config. */
  fromSettings: boolean;
  hasApiKey: boolean;
  apiKeyMasked: string;
}

export interface KeyStatus {
  id: string;
  label: string;
  group: string;
  configured: boolean;
  source: "settings" | "env" | "none";
  masked: string;
  custom?: boolean;
  hint?: string;
}

interface CacheState {
  ai: IAiSettings;
  /** Decrypted integration keys from Settings. */
  keyPlain: Record<string, string>;
  /** Labels for custom keys. */
  keyLabels: Record<string, string>;
}

let cache: CacheState | null = null;

const ENV_KEY_FALLBACKS: Record<string, () => string> = {
  VIRUSTOTAL_API_KEY: () => config.virustotalApiKey,
  WHOISXML_API_KEY: () => config.whoisxmlApiKey,
  SHODAN_API_KEY: () => config.shodanApiKey,
  ABUSEIPDB_API_KEY: () => config.abuseIpDbApiKey,
  URLSCAN_API_KEY: () => config.urlScanApiKey,
  NUMVERIFY_API_KEY: () => config.numVerifyApiKey,
  HAVEIBEENPWNED_API_KEY: () => config.haveIBeenPwnedApiKey,
  HUNTER_IO_API_KEY: () => config.hunterIoApiKey,
  ETHERSCAN_API_KEY: () => config.etherscanApiKey,
  RAZORPAY_KEY_ID: () => config.razorpayKeyId,
  RAZORPAY_KEY_SECRET: () => config.razorpayKeySecret,
  RESEND_API_KEY: () => config.resendApiKey,
  MSG91_AUTH_KEY: () => config.msg91AuthKey,
};

function keysFromDoc(doc: IPlatformSettings): {
  plain: Record<string, string>;
  labels: Record<string, string>;
} {
  const plain: Record<string, string> = {};
  const labels: Record<string, string> = {};
  const raw = doc.keys;
  const entries: [string, IStoredKey][] =
    raw instanceof Map
      ? Array.from(raw.entries())
      : Object.entries(raw || {});

  for (const [id, entry] of entries) {
    if (!entry?.valueEnc) continue;
    const opened = openSecret(entry.valueEnc);
    if (opened) {
      plain[id] = opened;
      if (entry.label) labels[id] = entry.label;
    } else {
      logger.warn({ id }, "[Settings] Failed to decrypt stored key");
    }
  }
  return { plain, labels };
}

function ensureCache(): CacheState {
  if (!cache) {
    cache = {
      ai: { provider: "env" },
      keyPlain: {},
      keyLabels: {},
    };
  }
  return cache;
}

/** Load Settings singleton into memory (call after Mongo connects / on save). */
export async function refreshRuntimeSettings(): Promise<void> {
  const doc = await PlatformSettings.findOne({ key: SETTINGS_DOC_ID }).lean<IPlatformSettings | null>();
  if (!doc) {
    cache = { ai: { provider: "env" }, keyPlain: {}, keyLabels: {} };
    return;
  }
  const { plain, labels } = keysFromDoc(doc as IPlatformSettings);
  // Legacy "local" (llama.cpp) provider → fall back to env.
  const rawProvider = String(doc.ai?.provider || "env");
  const provider: AiProviderId =
    rawProvider === "local" || !(["env", "openrouter", "openai", "nvidia", "custom"] as string[]).includes(rawProvider)
      ? "env"
      : (rawProvider as AiProviderId);
  if (rawProvider === "local") {
    await PlatformSettings.updateOne(
      { key: SETTINGS_DOC_ID },
      { $set: { "ai.provider": "env" } },
    ).catch(() => undefined);
  }
  cache = {
    ai: {
      provider,
      apiKeyEnc: doc.ai?.apiKeyEnc || "",
      baseUrl: doc.ai?.baseUrl || "",
      model: doc.ai?.model || "",
      visionEnabled: doc.ai?.visionEnabled ?? null,
      toolsEnabled: doc.ai?.toolsEnabled ?? null,
    },
    keyPlain: plain,
    keyLabels: labels,
  };
}

export async function getOrCreateSettingsDoc(): Promise<IPlatformSettings> {
  let doc = await PlatformSettings.findOne({ key: SETTINGS_DOC_ID });
  if (!doc) {
    doc = await PlatformSettings.create({
      key: SETTINGS_DOC_ID,
      ai: { provider: "env" },
      keys: {},
    });
  }
  return doc;
}

function resolveProviderBaseUrl(provider: AiProviderId, customBase?: string): string {
  if (customBase?.trim()) return customBase.trim().replace(/\/$/, "");
  const preset = AI_PROVIDERS.find((p) => p.id === provider);
  if (preset?.baseUrl) return preset.baseUrl.replace(/\/$/, "");
  return config.llmBaseUrl;
}

/** Effective LLM config: Settings override .env when provider !== env. */
export function getEffectiveLlm(): EffectiveLlm {
  const state = ensureCache();
  const ai = state.ai;

  if (!ai.provider || ai.provider === "env") {
    return {
      provider: "env",
      apiKey: config.llmApiKey,
      baseUrl: config.llmBaseUrl,
      model: config.llmModel,
      isCloud: config.llmIsCloud,
      visionEnabled: config.llmVisionEnabled,
      toolsEnabled: config.llmToolsEnabled,
      fromSettings: false,
      hasApiKey: Boolean(config.llmApiKey),
      apiKeyMasked: maskSecret(config.llmApiKey),
    };
  }

  const sealed = ai.apiKeyEnc || "";
  const apiKey = sealed ? openSecret(sealed) || "" : "";
  const baseUrl = resolveProviderBaseUrl(ai.provider, ai.baseUrl);
  const isCloud = Boolean(apiKey);
  const model =
    (ai.model || "").trim() ||
    config.llmModel ||
    (isCloud ? "gpt-4o-mini" : "");

  const visionEnabled =
    ai.visionEnabled !== null && ai.visionEnabled !== undefined
      ? Boolean(ai.visionEnabled)
      : isCloud;
  const toolsEnabled =
    ai.toolsEnabled !== null && ai.toolsEnabled !== undefined
      ? Boolean(ai.toolsEnabled)
      : isCloud;

  return {
    provider: ai.provider,
    apiKey,
    baseUrl,
    model,
    isCloud,
    visionEnabled,
    toolsEnabled,
    fromSettings: true,
    hasApiKey: Boolean(apiKey),
    apiKeyMasked: maskSecret(apiKey),
  };
}

/**
 * Resolve an integration secret: Settings override → .env/config fallback.
 * Accepts catalog ids like VIRUSTOTAL_API_KEY.
 */
export function getSecret(id: string): string {
  const state = ensureCache();
  if (state.keyPlain[id]) return state.keyPlain[id];
  const fallback = ENV_KEY_FALLBACKS[id];
  if (fallback) return fallback() || process.env[id] || "";
  return process.env[id] || "";
}

/** Convenience aliases used by existing services. */
export const secrets = {
  virustotal: () => getSecret("VIRUSTOTAL_API_KEY"),
  whoisxml: () => getSecret("WHOISXML_API_KEY"),
  shodan: () => getSecret("SHODAN_API_KEY"),
  abuseIpDb: () => getSecret("ABUSEIPDB_API_KEY"),
  urlScan: () => getSecret("URLSCAN_API_KEY"),
  numVerify: () => getSecret("NUMVERIFY_API_KEY"),
  hibp: () => getSecret("HAVEIBEENPWNED_API_KEY"),
  hunter: () => getSecret("HUNTER_IO_API_KEY"),
  etherscan: () => getSecret("ETHERSCAN_API_KEY"),
  razorpayKeyId: () => getSecret("RAZORPAY_KEY_ID"),
  razorpayKeySecret: () => getSecret("RAZORPAY_KEY_SECRET"),
  resend: () => getSecret("RESEND_API_KEY"),
  msg91: () => getSecret("MSG91_AUTH_KEY"),
};

export function listKeyStatuses(): KeyStatus[] {
  const state = ensureCache();
  const seen = new Set<string>();
  const rows: KeyStatus[] = [];

  for (const entry of KEY_CATALOG) {
    seen.add(entry.id);
    const fromSettings = Boolean(state.keyPlain[entry.id]);
    const fromEnv = Boolean(ENV_KEY_FALLBACKS[entry.id]?.() || process.env[entry.id]);
    const plain = getSecret(entry.id);
    rows.push({
      id: entry.id,
      label: entry.label,
      group: entry.group,
      configured: Boolean(plain),
      source: fromSettings ? "settings" : fromEnv ? "env" : "none",
      masked: maskSecret(plain),
      hint: entry.hint,
    });
  }

  for (const id of Object.keys(state.keyPlain)) {
    if (seen.has(id)) continue;
    rows.push({
      id,
      label: state.keyLabels[id] || id,
      group: "custom",
      configured: true,
      source: "settings",
      masked: maskSecret(state.keyPlain[id]),
      custom: true,
    });
  }

  return rows;
}

export async function updateAiSettings(input: {
  provider: AiProviderId;
  apiKey?: string;
  clearApiKey?: boolean;
  baseUrl?: string;
  model?: string;
  visionEnabled?: boolean | null;
  toolsEnabled?: boolean | null;
  updatedBy?: string;
}): Promise<EffectiveLlm> {
  const doc = await getOrCreateSettingsDoc();
  doc.ai = doc.ai || ({ provider: "env" } as IAiSettings);
  doc.ai.provider = input.provider;

  if (input.clearApiKey) {
    doc.ai.apiKeyEnc = "";
  } else if (input.apiKey && input.apiKey.trim() && !input.apiKey.includes("••••")) {
    doc.ai.apiKeyEnc = sealSecret(input.apiKey.trim());
  }

  if (input.baseUrl !== undefined) doc.ai.baseUrl = input.baseUrl.trim();
  if (input.model !== undefined) doc.ai.model = input.model.trim();
  if (input.visionEnabled !== undefined) doc.ai.visionEnabled = input.visionEnabled;
  if (input.toolsEnabled !== undefined) doc.ai.toolsEnabled = input.toolsEnabled;
  if (input.updatedBy) doc.updatedBy = input.updatedBy;

  await doc.save();
  await refreshRuntimeSettings();
  return getEffectiveLlm();
}

export async function upsertIntegrationKey(input: {
  id: string;
  value?: string;
  clear?: boolean;
  label?: string;
  updatedBy?: string;
}): Promise<void> {
  const id = input.id.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  if (!id || id.length > 64) throw new Error("Invalid key id");

  const doc = await getOrCreateSettingsDoc();
  const map =
    doc.keys instanceof Map
      ? doc.keys
      : new Map(Object.entries((doc.keys as Record<string, IStoredKey>) || {}));

  if (input.clear) {
    map.delete(id);
  } else if (input.value && input.value.trim() && !input.value.includes("••••")) {
    map.set(id, {
      valueEnc: sealSecret(input.value.trim()),
      label: input.label?.trim() || undefined,
      updatedAt: new Date(),
    });
  } else if (input.label && map.has(id)) {
    const existing = map.get(id)!;
    map.set(id, { ...existing, label: input.label.trim(), updatedAt: new Date() });
  }

  doc.keys = map;
  doc.markModified("keys");
  if (input.updatedBy) doc.updatedBy = input.updatedBy;
  await doc.save();
  await refreshRuntimeSettings();
}

export async function deleteIntegrationKey(id: string, updatedBy?: string): Promise<void> {
  await upsertIntegrationKey({ id, clear: true, updatedBy });
}
