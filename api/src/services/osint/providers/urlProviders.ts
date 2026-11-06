import { safeHttp } from "../../../utils/httpClient";
import { ConfidenceScore } from "../../../types/confidence";
import type { OsintResult } from "../providerInterface";
import { logger } from "../../../utils/logger";
import { config } from "../../../config";
import { fetchVtUrlReputation, fetchWhoisXml } from "../../osintExternal";

/**
 * VirusTotal v3 — malicious/suspicious verdicts, WHOIS, DNS.
 * Already integrated in Phase 1; upgraded here to propagate flags.
 */
export async function virusTotalUrlLookup(url: string): Promise<OsintResult> {
  if (!config.virustotalApiKey) return noKey("VirusTotal");

  try {
    const res = await fetchVtUrlReputation(url);
    if (!res.ok) return fail("VirusTotal", new Error(res.error ?? "unknown"));

    const attrs = res.data as Record<string, unknown>;
    const stats = (attrs.last_analysis_stats ?? {}) as Record<string, number>;
    const malicious = Number(stats.malicious ?? 0);
    const suspicious = Number(stats.suspicious ?? 0);
    const harmless = Number(stats.harmless ?? 0);

    const flags: string[] = [];
    if (malicious >= 1) flags.push("MALICIOUS_URL");
    if (suspicious >= 2) flags.push("SUSPICIOUS_URL");
    if (harmless > 50 && malicious === 0) flags.push("TRUSTED_URL");

    const confidence =
      malicious >= 3 ? ConfidenceScore.VERIFIED
      : malicious >= 1 ? ConfidenceScore.HIGH
      : suspicious >= 2 ? ConfidenceScore.MEDIUM
      : ConfidenceScore.LOW;

    return {
      success: true,
      data: {
        malicious,
        suspicious,
        harmless,
        categories: attrs.categories ?? null,
        reputation: attrs.reputation ?? null,
        last_analysis_date: attrs.last_analysis_date ?? null,
      },
      confidence,
      source: `VirusTotal/${new Date().toISOString()}`,
      raw: attrs,
      flags,
    };
  } catch (err) {
    logger.warn({ err: errMsg(err) }, "[URL/VirusTotal] lookup failed");
    return fail("VirusTotal", err);
  }
}

/**
 * URLScan.io — scans URL and returns DOM, screenshot URL, DNS records.
 */
export async function urlScanLookup(url: string): Promise<OsintResult> {
  const key = config.urlScanApiKey;
  if (!key) return noKey("URLScan.io");

  try {
    // Submit scan
    const submitRes = await safeHttp.post<{ uuid: string; result: string }>(
      "https://urlscan.io/api/v1/scan/",
      { url, visibility: "private" },
      {
        headers: { "API-Key": key, "Content-Type": "application/json" },
        timeout: 15_000,
      },
    );
    const { uuid } = submitRes.data;

    // Poll for result (max 30s)
    await new Promise<void>((r) => setTimeout(r, 8_000));
    const resultRes = await safeHttp.get<Record<string, unknown>>(
      `https://urlscan.io/api/v1/result/${uuid}/`,
      { timeout: 15_000 },
    );
    const data = resultRes.data;
    const verdict = (data.verdicts as Record<string, unknown>) ?? {};
    const overall = (verdict.overall as Record<string, unknown>) ?? {};
    const malicious = Boolean(overall.malicious);
    const score = Number(overall.score ?? 0);

    const flags: string[] = [];
    if (malicious) flags.push("URLSCAN_MALICIOUS");
    if (score >= 50) flags.push("URLSCAN_HIGH_RISK");

    return {
      success: true,
      data: {
        uuid,
        result_url: `https://urlscan.io/result/${uuid}/`,
        page_title: (data.page as Record<string, unknown>)?.title ?? null,
        malicious,
        score,
      },
      confidence: malicious ? ConfidenceScore.HIGH : ConfidenceScore.MEDIUM,
      source: `URLScan.io/${new Date().toISOString()}`,
      raw: data,
      flags,
    };
  } catch (err) {
    logger.warn({ err: errMsg(err) }, "[URL/URLScan] lookup failed");
    return fail("URLScan.io", err);
  }
}

/**
 * WhoisXML — domain registrar, creation date, age.
 */
export async function whoisXmlDomainLookup(domain: string): Promise<OsintResult> {
  if (!config.whoisxmlApiKey) return noKey("WhoisXML");

  try {
    const res = await fetchWhoisXml(domain);
    if (!res.ok) return fail("WhoisXML", new Error(res.error ?? "unknown"));

    const data = res.data as Record<string, unknown>;
    const registrar = String((data.registrarName ?? data.registrar ?? "Unknown"));
    const createdAt = String(data.createdDateNormalized ?? data.createdDate ?? "");
    const age = createdAt ? Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000) : null;

    const flags: string[] = [];
    if (age !== null && age < 30) flags.push("NEW_DOMAIN");
    if (age !== null && age < 7) flags.push("VERY_NEW_DOMAIN");

    return {
      success: true,
      data: { registrar, created_at: createdAt, age_days: age },
      confidence: ConfidenceScore.MEDIUM,
      source: `WhoisXML/${new Date().toISOString()}`,
      raw: data,
      flags,
    };
  } catch (err) {
    logger.warn({ err: errMsg(err) }, "[URL/WhoisXML] lookup failed");
    return fail("WhoisXML", err);
  }
}

function noKey(p: string): OsintResult { return { success: false, confidence: ConfidenceScore.UNVERIFIED, source: `${p}/no-key`, flags: [], error: "API key not configured" }; }
function fail(p: string, e: unknown): OsintResult { return { success: false, confidence: ConfidenceScore.UNVERIFIED, source: `${p}/${new Date().toISOString()}`, flags: [], error: errMsg(e) }; }
function errMsg(e: unknown): string { return e instanceof Error ? e.message : String(e); }
