import { safeHttp } from "../../../utils/httpClient";
import { isIPv4, isIPv6 } from "net";
import { ConfidenceScore } from "../../../types/confidence";
import type { OsintResult } from "../providerInterface";
import { logger } from "../../../utils/logger";
import { secrets } from "../../runtimeSettings";

/**
 * AbuseIPDB — abuse score, report count, usage type.
 */
export async function abuseIpDbLookup(ip: string): Promise<OsintResult> {
  const key = secrets.abuseIpDb();
  if (!key) return noKey("AbuseIPDB");

  try {
    const response = await safeHttp.get<{ data: Record<string, unknown> }>(
      "https://api.abuseipdb.com/api/v2/check",
      {
        params: { ipAddress: ip, maxAgeInDays: 90, verbose: false },
        headers: { Key: key, Accept: "application/json" },
        timeout: 12_000,
      },
    );
    const d = response.data.data;
    const score = Number(d.abuseConfidenceScore ?? 0);
    const reports = Number(d.totalReports ?? 0);

    const flags: string[] = [];
    if (score >= 75) flags.push("HIGH_ABUSE_SCORE");
    if (d.isWhitelisted) flags.push("WHITELISTED");
    if (d.isTor) flags.push("TOR_EXIT_NODE");
    if (d.usageType === "Data Center/Web Hosting/Transit") flags.push("HOSTING_IP");

    const confidence =
      score >= 75 ? ConfidenceScore.VERIFIED
      : score >= 30 ? ConfidenceScore.HIGH
      : reports > 0 ? ConfidenceScore.MEDIUM
      : ConfidenceScore.LOW;

    return {
      success: true,
      data: {
        abuse_score: score,
        total_reports: reports,
        country: d.countryCode ?? null,
        isp: d.isp ?? null,
        usage_type: d.usageType ?? null,
        domain: d.domain ?? null,
      },
      confidence,
      source: `AbuseIPDB/${new Date().toISOString()}`,
      raw: d,
      flags,
    };
  } catch (err) {
    logger.warn({ err: errMsg(err), ip }, "[IP/AbuseIPDB] lookup failed");
    return fail("AbuseIPDB", err);
  }
}

/**
 * Regex-based IP classification — no API required.
 * Classifies private, loopback, multicast, public addresses.
 */
export function regexIpAnalysis(ip: string): OsintResult {
  const v4 = isIPv4(ip);
  const v6 = isIPv6(ip);
  const flags: string[] = [];

  if (PRIVATE_RANGES.some((r) => r.test(ip))) {
    flags.push("PRIVATE_IP");
  } else if (LOOPBACK_RANGES.test(ip)) {
    flags.push("LOOPBACK");
  } else if (ip.startsWith("224.") || ip.startsWith("ff")) {
    flags.push("MULTICAST");
  } else {
    flags.push("PUBLIC_IP");
  }

  return {
    success: true,
    data: { ip, version: v4 ? "IPv4" : v6 ? "IPv6" : "unknown", classification: flags[0] },
    confidence: ConfidenceScore.LOW,
    source: `regex-analysis/${new Date().toISOString()}`,
    flags,
  };
}

const PRIVATE_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^fd[0-9a-f]{2}:/i,
];
const LOOPBACK_RANGES = /^(127\.|::1$)/;

function noKey(p: string): OsintResult { return { success: false, confidence: ConfidenceScore.UNVERIFIED, source: `${p}/no-key`, flags: [], error: "API key not configured" }; }
function fail(p: string, e: unknown): OsintResult { return { success: false, confidence: ConfidenceScore.UNVERIFIED, source: `${p}/${new Date().toISOString()}`, flags: [], error: errMsg(e) }; }
function errMsg(e: unknown): string { return e instanceof Error ? e.message : String(e); }
