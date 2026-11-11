/**
 * Known integration secrets manageable from Admin → Settings.
 * Custom keys (any id) are also allowed and stored alongside these.
 */
export type KeyGroup = "osint" | "payments" | "notifications" | "custom";

export interface KeyCatalogEntry {
  id: string;
  label: string;
  group: KeyGroup;
  /** Optional hint shown in the UI. */
  hint?: string;
}

export const KEY_CATALOG: KeyCatalogEntry[] = [
  { id: "VIRUSTOTAL_API_KEY", label: "VirusTotal", group: "osint" },
  { id: "WHOISXML_API_KEY", label: "WhoisXML", group: "osint" },
  { id: "SHODAN_API_KEY", label: "Shodan", group: "osint" },
  { id: "ABUSEIPDB_API_KEY", label: "AbuseIPDB", group: "osint" },
  { id: "URLSCAN_API_KEY", label: "URLScan", group: "osint" },
  { id: "NUMVERIFY_API_KEY", label: "NumVerify", group: "osint", hint: "Phone OSINT" },
  { id: "HAVEIBEENPWNED_API_KEY", label: "Have I Been Pwned", group: "osint" },
  { id: "HUNTER_IO_API_KEY", label: "Hunter.io", group: "osint" },
  { id: "ETHERSCAN_API_KEY", label: "Etherscan", group: "osint" },
  { id: "RAZORPAY_KEY_ID", label: "Razorpay Key ID", group: "payments" },
  { id: "RAZORPAY_KEY_SECRET", label: "Razorpay Key Secret", group: "payments" },
  { id: "RESEND_API_KEY", label: "Resend (email)", group: "notifications" },
  { id: "MSG91_AUTH_KEY", label: "MSG91 Auth Key", group: "notifications" },
];

export const AI_PROVIDERS = [
  {
    id: "env",
    label: "Use server .env (default)",
    baseUrl: "",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
  },
  {
    id: "nvidia",
    label: "NVIDIA NIM",
    baseUrl: "https://integrate.api.nvidia.com/v1",
  },
  {
    id: "custom",
    label: "Custom OpenAI-compatible",
    baseUrl: "",
  },
  {
    id: "local",
    label: "Local (llama.cpp / Ollama)",
    baseUrl: "http://127.0.0.1:8080/v1",
  },
] as const;

export type AiProviderId = (typeof AI_PROVIDERS)[number]["id"];

/** Env var → config field fallback for integration keys. */
export function envFallbackValue(id: string): string {
  const fromEnv = process.env[id];
  if (fromEnv) return fromEnv;
  // Lazy import avoided — map known ids to config at call site via getSecret.
  return "";
}
