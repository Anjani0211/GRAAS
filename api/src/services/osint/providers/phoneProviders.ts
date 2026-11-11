import { safeHttp } from "../../../utils/httpClient";
import { ConfidenceScore } from "../../../types/confidence";
import type { OsintResult } from "../providerInterface";
import { logger } from "../../../utils/logger";
import { mask } from "../../../utils/piiSanitizer";
import { secrets } from "../../runtimeSettings";

/**
 * NumVerify phone validation — carrier, country, line type.
 * PII rule: only sends last 7 digits to non-Indian APIs.
 */
export async function numVerifyLookup(phone: string): Promise<OsintResult> {
  const key = secrets.numVerify();
  if (!key) return noKey("NumVerify");

  try {
    const normalized = phone.replace(/\D/g, "");
    // PII: send only last 7 digits to non-Indian third-party API (prefix via country_code).
    const maskedForProvider = normalized.slice(-7);
    const response = await safeHttp.get<Record<string, unknown>>(
      "http://apilayer.net/api/validate",
      {
        params: { access_key: key, number: maskedForProvider, country_code: "IN", format: 1 },
        timeout: 12_000,
      },
    );
    const data = response.data;
    const valid = Boolean(data.valid);
    const lineType = String(data.line_type ?? "unknown");

    const flags: string[] = [];
    if (!valid) flags.push("INVALID_NUMBER");
    if (lineType === "voip") flags.push("VOIP");

    return {
      success: true,
      data: {
        carrier: data.carrier ?? null,
        line_type: lineType,
        country_code: data.country_code ?? null,
        valid,
      },
      confidence: valid ? ConfidenceScore.HIGH : ConfidenceScore.LOW,
      source: `NumVerify/${new Date().toISOString()}`,
      raw: data,
      flags,
    };
  } catch (err) {
    logger.warn({ err: errMsg(err), value: mask(phone) }, "[Phone/NumVerify] lookup failed");
    return fail("NumVerify", err);
  }
}

/**
 * Static phone regex analysis — no API key required.
 * Derives operator from Indian mobile prefix.
 */
export function regexPhoneAnalysis(phone: string): OsintResult {
  const digits = phone.replace(/\D/g, "");
  const cleaned = digits.replace(/^(91|0)/, "");
  const prefix = cleaned.slice(0, 4);
  const operator = INDIAN_PREFIX_MAP[prefix] ?? "Unknown";
  const valid = /^[6-9]\d{9}$/.test(cleaned);
  const flags: string[] = [];
  if (!valid) flags.push("INVALID_FORMAT");
  return {
    success: true,
    data: { operator, format_valid: valid, digits_cleaned: cleaned },
    confidence: valid ? ConfidenceScore.LOW : ConfidenceScore.UNVERIFIED,
    source: `regex-analysis/${new Date().toISOString()}`,
    flags,
  };
}

// Common Indian telecom prefix → operator map
const INDIAN_PREFIX_MAP: Record<string, string> = {
  "9999": "Airtel", "9990": "Airtel", "9818": "Airtel", "9810": "Airtel",
  "9811": "Airtel", "9871": "Airtel", "9868": "Airtel", "9870": "Airtel",
  "9876": "Jio", "9819": "Jio", "8826": "Jio", "8867": "Jio",
  "9800": "Vodafone Idea", "9843": "Vodafone Idea", "9867": "Vodafone Idea",
  "7000": "BSNL", "7001": "BSNL", "9415": "BSNL", "9452": "BSNL",
};

function noKey(provider: string): OsintResult {
  return {
    success: false,
    confidence: ConfidenceScore.UNVERIFIED,
    source: `${provider}/no-key`,
    flags: [],
    error: "API key not configured",
  };
}

function fail(provider: string, err: unknown): OsintResult {
  return {
    success: false,
    confidence: ConfidenceScore.UNVERIFIED,
    source: `${provider}/${new Date().toISOString()}`,
    flags: [],
    error: errMsg(err),
  };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
