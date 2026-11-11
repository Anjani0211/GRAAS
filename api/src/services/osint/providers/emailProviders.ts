import axios from "axios";
import { safeHttp } from "../../../utils/httpClient";
import dns from "dns/promises";
import { ConfidenceScore } from "../../../types/confidence";
import type { OsintResult } from "../providerInterface";
import { logger } from "../../../utils/logger";
import { maskEmail } from "../../../utils/piiSanitizer";
import { secrets } from "../../runtimeSettings";

/**
 * HaveIBeenPwned v3 — returns list of breaches the email was involved in.
 */
export async function hibpLookup(email: string): Promise<OsintResult> {
  const key = secrets.hibp();
  if (!key) return noKey("HIBP");

  try {
    const response = await safeHttp.get<Array<Record<string, unknown>>>(
      `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}`,
      {
        headers: { "hibp-api-key": key, "User-Agent": "GRASS-OSINT/1.0" },
        params: { truncateResponse: false },
        timeout: 12_000,
      },
    );
    const breaches = response.data;
    const count = breaches.length;
    const names = breaches.slice(0, 10).map((b) => b.Name ?? b.name ?? "?");

    const flags: string[] = [];
    if (count > 0) flags.push("BREACH_FOUND");
    if (count >= 5) flags.push("MULTIPLE_BREACHES");

    return {
      success: true,
      data: { breach_count: count, breach_names: names },
      confidence: count > 0 ? ConfidenceScore.HIGH : ConfidenceScore.LOW,
      source: `HIBP/${new Date().toISOString()}`,
      raw: breaches,
      flags,
    };
  } catch (err) {
    // 404 = email not in any breach (success case)
    if (axios.isAxiosError(err) && err.response?.status === 404) {
      return {
        success: true,
        data: { breach_count: 0, breach_names: [] },
        confidence: ConfidenceScore.LOW,
        source: `HIBP/${new Date().toISOString()}`,
        flags: [],
      };
    }
    logger.warn({ err: errMsg(err), email: maskEmail(email) }, "[Email/HIBP] lookup failed");
    return fail("HIBP", err);
  }
}

/**
 * Hunter.io — email deliverability, domain verification, role detection.
 */
export async function hunterEmailLookup(email: string): Promise<OsintResult> {
  const key = secrets.hunter();
  if (!key) return noKey("Hunter.io");

  try {
    const response = await safeHttp.get<{ data: Record<string, unknown> }>(
      "https://api.hunter.io/v2/email-verifier",
      {
        params: { email, api_key: key },
        timeout: 12_000,
      },
    );
    const data = response.data.data;
    const status = String(data.status ?? "unknown");
    const score = Number(data.score ?? 0);

    const flags: string[] = [];
    if (status === "invalid") flags.push("INVALID_EMAIL");
    if (data.disposable) flags.push("DISPOSABLE_EMAIL");
    if (data.role) flags.push("ROLE_BASED_EMAIL");
    if (score < 30) flags.push("LOW_DELIVERABILITY");

    return {
      success: true,
      data: { status, score, disposable: Boolean(data.disposable), role: Boolean(data.role) },
      confidence: status === "valid" ? ConfidenceScore.HIGH : ConfidenceScore.MEDIUM,
      source: `Hunter.io/${new Date().toISOString()}`,
      raw: data,
      flags,
    };
  } catch (err) {
    logger.warn({ err: errMsg(err), email: maskEmail(email) }, "[Email/Hunter] lookup failed");
    return fail("Hunter.io", err);
  }
}

/**
 * MX record DNS lookup — no API key required.
 * Verifies the email domain has valid MX records.
 */
export async function mxRecordLookup(email: string): Promise<OsintResult> {
  const domain = email.split("@")[1];
  if (!domain) return fail("MX-DNS", new Error("No domain in email"));

  try {
    const addresses = await dns.resolveMx(domain);
    const hasMx = addresses.length > 0;
    const topMx = addresses.sort((a, b) => a.priority - b.priority)[0]?.exchange ?? null;

    const flags: string[] = [];
    if (!hasMx) flags.push("NO_MX_RECORD");

    return {
      success: hasMx,
      data: { domain, has_mx: hasMx, mx_host: topMx, mx_count: addresses.length },
      confidence: hasMx ? ConfidenceScore.MEDIUM : ConfidenceScore.LOW,
      source: `MX-DNS/${new Date().toISOString()}`,
      flags,
    };
  } catch (err) {
    logger.warn({ err: errMsg(err), domain }, "[Email/MX-DNS] lookup failed");
    return fail("MX-DNS", err);
  }
}

function noKey(p: string): OsintResult { return { success: false, confidence: ConfidenceScore.UNVERIFIED, source: `${p}/no-key`, flags: [], error: "API key not configured" }; }
function fail(p: string, e: unknown): OsintResult { return { success: false, confidence: ConfidenceScore.UNVERIFIED, source: `${p}/${new Date().toISOString()}`, flags: [], error: errMsg(e) }; }
function errMsg(e: unknown): string { return e instanceof Error ? e.message : String(e); }
