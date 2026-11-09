import dotenv from "dotenv";
dotenv.config();

const port = parseInt(process.env.PORT || "8000", 10);

/**
 * CORS_ORIGIN accepts a comma-separated allowlist. Defaults cover the two
 * common local URLs; add e.g. http://192.168.1.10:3000 for LAN access.
 */
const corsOrigins = (process.env.CORS_ORIGIN || "http://localhost:3000,http://127.0.0.1:3000")
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

/** Loopback + RFC1918 hostnames, used only to make local/LAN dev painless. */
function isPrivateNetworkHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]") {
    return true;
  }
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const [a, b] = [Number(match[1]), Number(match[2])];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * True when an Origin is safe to accept. In development we also allow
 * loopback/LAN origins so opening the web app via 127.0.0.1 or a LAN IP works
 * without editing CORS_ORIGIN. Production always uses the explicit allowlist.
 */
export function isOriginAllowed(origin?: string | null): boolean {
  if (!origin) return true; // non-browser clients (curl, server-to-server)
  const normalized = origin.replace(/\/$/, "");
  if (corsOrigins.includes(normalized)) return true;
  if ((process.env.NODE_ENV || "development") !== "production") {
    try {
      return isPrivateNetworkHost(new URL(normalized).hostname);
    } catch {
      return false;
    }
  }
  return false;
}

export const config = {
  port,
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/$/, ""),
  mongoUri: process.env.MONGODB_URI || "mongodb://localhost:27017/graas",
  jwtSecret:
    process.env.JWT_SECRET ||
    (process.env.NODE_ENV === "production" ? "" : "dev-secret-key-change-in-production"),
  jwtExpiry: process.env.JWT_EXPIRY || "8h",
  nodeEnv: process.env.NODE_ENV || "development",
  /** First allowed origin — kept for callers that expect a single value. */
  corsOrigin: corsOrigins[0] || "",
  /** Full allowlist parsed from CORS_ORIGIN. */
  corsOrigins,

  // OSINT — Phase 1 (live)
  whoisxmlApiKey: process.env.WHOISXML_API_KEY || "",
  virustotalApiKey: process.env.VIRUSTOTAL_API_KEY || "",
  shodanApiKey: process.env.SHODAN_API_KEY || "",

  /**
   * Shared HMAC secret used to authenticate inbound webhooks from banks /
   * CERT-In / NCRP / social platforms confirming dispatch receipt. Requests
   * must carry `X-GRASS-Signature: sha256=<hex>` of the raw body using this
   * secret. Empty value disables the webhook route (404).
   */
  dispatchWebhookSecret: process.env.DISPATCH_WEBHOOK_SECRET || "",

  // ── LLM (cloud OpenAI-compatible OR local llama.cpp) ──────────────
  // Priority: LLM_API_KEY | OPENROUTER_API_KEY | OPENAI_API_KEY | NVIDIA_API_KEY
  // then fall back to LOCAL_LLM_* (llama.cpp / Ollama).
  ...(() => {
    const openRouterKey = process.env.OPENROUTER_API_KEY || "";
    const openAiKey = process.env.OPENAI_API_KEY || "";
    const nvidiaKey = process.env.NVIDIA_API_KEY || "";
    const llmApiKey =
      process.env.LLM_API_KEY || openRouterKey || openAiKey || nvidiaKey || "";

    let llmBaseUrl = (process.env.LLM_BASE_URL || "").replace(/\/$/, "");
    if (!llmBaseUrl) {
      if (openRouterKey) llmBaseUrl = "https://openrouter.ai/api/v1";
      else if (nvidiaKey) llmBaseUrl = "https://integrate.api.nvidia.com/v1";
      else if (openAiKey || process.env.LLM_API_KEY) llmBaseUrl = "https://api.openai.com/v1";
      else llmBaseUrl = (process.env.LOCAL_LLM_BASE_URL || "http://127.0.0.1:8080/v1").replace(/\/$/, "");
    }

    const isCloud = Boolean(llmApiKey);
    const defaultCloudModel = openRouterKey
      ? "openai/gpt-4o-mini"
      : nvidiaKey
        ? "meta/llama-3.1-70b-instruct"
        : "gpt-4o-mini";

    const llmModel =
      process.env.LLM_MODEL ||
      process.env.LOCAL_LLM_MODEL ||
      (isCloud ? defaultCloudModel : "gemma2b-cyberpeace-victim-ocr-q4_k_m");

    const visionEnv = process.env.LLM_VISION_ENABLED ?? process.env.LOCAL_LLM_VISION_ENABLED;
    const toolsEnv = process.env.LLM_TOOLS_ENABLED ?? process.env.LOCAL_LLM_TOOLS_ENABLED;

    return {
      /** True when a cloud API key is set (OpenRouter / OpenAI / NVIDIA / LLM_API_KEY). */
      llmIsCloud: isCloud,
      llmApiKey,
      llmBaseUrl,
      llmModel,
      /** Optional OpenRouter attribution headers */
      openRouterHttpReferer: process.env.OPENROUTER_HTTP_REFERER || "https://graas.local",
      openRouterAppTitle: process.env.OPENROUTER_APP_TITLE || "GRAAS",
      /** Host path to the GGUF model file (llama-server / docker-compose). */
      localLlmModelPath: process.env.LOCAL_LLM_MODEL_PATH || "",
      /** @deprecated use llmBaseUrl — kept for callers/scripts */
      localLlmBaseUrl: llmBaseUrl,
      /** @deprecated use llmModel */
      localLlmModel: llmModel,
      /**
       * Vision OCR. Cloud defaults ON; local defaults OFF (text-only GGUF).
       * Override with LLM_VISION_ENABLED / LOCAL_LLM_VISION_ENABLED.
       */
      localLlmVisionEnabled:
        visionEnv !== undefined ? visionEnv !== "false" : isCloud,
      /**
       * LangChain tool-calling agent. Cloud defaults ON; local defaults OFF.
       * Override with LLM_TOOLS_ENABLED / LOCAL_LLM_TOOLS_ENABLED.
       */
      localLlmToolsEnabled:
        toolsEnv !== undefined ? toolsEnv === "true" : isCloud,
    };
  })(),
  /** Self-hosted Whisper ASR (port 9002 avoids MinIO on :9000). */
  whisperEndpoint: process.env.WHISPER_ENDPOINT || "http://localhost:9002/asr",

  // OSINT — Phase 3
  numVerifyApiKey: process.env.NUMVERIFY_API_KEY || "",
  abuseIpDbApiKey: process.env.ABUSEIPDB_API_KEY || "",
  haveIBeenPwnedApiKey: process.env.HAVEIBEENPWNED_API_KEY || "",
  hunterIoApiKey: process.env.HUNTER_IO_API_KEY || "",
  etherscanApiKey: process.env.ETHERSCAN_API_KEY || "",
  razorpayKeyId: process.env.RAZORPAY_KEY_ID || "",
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || "",
  urlScanApiKey: process.env.URLSCAN_API_KEY || "",

  // Graph DB — Phase 4
  neo4jUri:      process.env.NEO4J_URI      || "",
  neo4jUser:     process.env.NEO4J_USER     || "neo4j",
  neo4jPassword: process.env.NEO4J_PASSWORD || "",

  // Object storage — Phase 5
  minioEndpoint:  process.env.MINIO_ENDPOINT  || "",
  minioPort:      parseInt(process.env.MINIO_PORT || "9000", 10),
  minioUseSsl:    process.env.MINIO_USE_SSL === "true",
  minioAccessKey: process.env.MINIO_ACCESS_KEY || "",
  minioSecretKey: process.env.MINIO_SECRET_KEY || "",
  minioBucket:    process.env.MINIO_BUCKET || "grass-evidence",

  /** When false, SSRF checks in safeHttp are disabled (dev only — never in production). */
  ssrfProtectionEnabled: process.env.SSRF_PROTECTION !== "false",

  // Redis — Phase 7 (Bull + token blocklist)
  redisHost: process.env.REDIS_HOST || "localhost",
  redisPort: parseInt(process.env.REDIS_PORT || "6379", 10),
  redisPassword: process.env.REDIS_PASSWORD || undefined,

  /** TGStat Playwright sidecar (empty = telegram stub only). */
  playwrightWorkerUrl: (process.env.PLAYWRIGHT_WORKER_URL || "").replace(/\/$/, ""),

  // Phase 9 — Agent (uses localLlmModel)
  agentMaxIterations: parseInt(process.env.AGENT_MAX_ITERATIONS || "40", 10),
  agentIterationTimeoutMs: parseInt(process.env.AGENT_ITERATION_TIMEOUT_MS || "20000", 10),
  agentScreenshotQuality: parseInt(process.env.AGENT_SCREENSHOT_QUALITY || "85", 10),
  screenshotMaxWidthPx: parseInt(process.env.SCREENSHOT_MAX_WIDTH || "1024", 10),
  playwrightScreenshotWorkerUrl: (process.env.PLAYWRIGHT_SCREENSHOT_WORKER_URL || "").replace(/\/$/, ""),

  // Rate limiting
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10),
  rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "100", 10),

  // Outbound notifications
  resendApiKey: process.env.RESEND_API_KEY || "",
  emailFrom: process.env.EMAIL_FROM || "GRAAS <noreply@graas.local>",
  msg91AuthKey: process.env.MSG91_AUTH_KEY || "",
  msg91SenderId: process.env.MSG91_SENDER_ID || "GRAAS",
  msg91TemplateId: process.env.MSG91_TEMPLATE_ID || "",
  /** Require Redis in production (token blocklist / queues). */
  requireRedisInProduction: process.env.REQUIRE_REDIS !== "false",
} as const;
