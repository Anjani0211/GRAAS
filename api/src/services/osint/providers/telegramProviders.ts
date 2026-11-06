import { ConfidenceScore } from "../../../types/confidence";
import type { OsintResult } from "../providerInterface";
import { config } from "../../../config";
import { internalHttp } from "../../../utils/httpClient";
import { logger } from "../../../utils/logger";

/**
 * Telegram handle / ID — LOW confidence when no TGStat worker.
 */
export function telegramIdFallback(id: string): OsintResult {
  const cleaned = id.replace(/^@/, "");
  return {
    success: true,
    data: {
      telegram_id: cleaned,
      lookup_method: "extracted-from-evidence",
      note: "TGStat worker not configured — set PLAYWRIGHT_WORKER_URL",
    },
    confidence: ConfidenceScore.LOW,
    source: `telegram-fallback/${new Date().toISOString()}`,
    flags: ["MANUAL_VERIFICATION_RECOMMENDED"],
  };
}

/**
 * TGStat sidecar (Playwright) when `PLAYWRIGHT_WORKER_URL` is set; else stub.
 */
export async function enrichTelegramEntity(handle: string): Promise<OsintResult> {
  const cleaned = handle.replace(/^@/, "").trim();
  if (!cleaned) {
    return {
      success: false,
      confidence: ConfidenceScore.UNVERIFIED,
      source: "telegram-validator",
      flags: [],
      error: "Empty Telegram identifier",
    };
  }

  if (!config.playwrightWorkerUrl) {
    return telegramIdFallback(handle);
  }

  try {
    // Worker URL is env-configured (trusted) — use internalHttp so localhost is allowed.
    const res = await internalHttp.post<{ found?: boolean; title?: string; subscribers?: number; channels?: string[] }>(
      `${config.playwrightWorkerUrl}/tgstat`,
      { id: cleaned },
      { timeout: 12_000, headers: { "Content-Type": "application/json" } },
    );
    const data = res.data;
    if (data.found) {
      return {
        success: true,
        confidence: ConfidenceScore.MEDIUM,
        data: { ...data, telegramId: cleaned } as Record<string, unknown>,
        source: "tgstat-playwright",
        flags: [],
      };
    }
    return {
      success: true,
      confidence: ConfidenceScore.LOW,
      data: { telegramId: cleaned, ...data },
      source: "tgstat-playwright",
      flags: [],
    };
  } catch (err) {
    logger.warn({ err }, "[Telegram] TGStat worker failed");
    return {
      success: false,
      confidence: ConfidenceScore.UNVERIFIED,
      source: "tgstat-playwright",
      flags: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
