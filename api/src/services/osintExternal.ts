import { secrets } from "./runtimeSettings";

const WHOIS_XML_URL = "https://www.whoisxmlapi.com/whoisserver/WhoisService";
const VT_BASE = "https://www.virustotal.com/api/v3";

function isProbablyIpv4(s: string): boolean {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(s.trim());
}

function isProbablyIpv6(s: string): boolean {
  return s.includes(":") && s.length >= 2;
}

/** Hostname from full URL or bare domain */
export function extractHostFromUrlOrDomain(input: string): string {
  const t = input.trim();
  try {
    if (t.includes("://")) {
      const u = new URL(t);
      return u.hostname || t;
    }
  } catch {
    /* fall through */
  }
  return t.replace(/^\/+/, "").split("/")[0] ?? t;
}

export async function fetchWhoisXml(domain: string): Promise<{ ok: true; data: unknown } | { ok: false; status: number; error: string }> {
  const apiKey = secrets.whoisxml();
  if (!apiKey) {
    return { ok: false, status: 503, error: "WHOISXML_API_KEY is not configured" };
  }

  const domainName = domain.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0] ?? domain;

  const res = await fetch(WHOIS_XML_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      domainName,
      apiKey,
      outputFormat: "JSON",
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, error: text.slice(0, 500) || res.statusText };
  }

  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: true, data: { raw: text, note: "Response was not JSON" } };
  }
}

async function vtGet(path: string): Promise<{ ok: true; data: unknown } | { ok: false; status: number; error: string }> {
  const apiKey = secrets.virustotal();
  if (!apiKey) {
    return { ok: false, status: 503, error: "VIRUSTOTAL_API_KEY is not configured" };
  }

  const res = await fetch(`${VT_BASE}${path}`, {
    headers: { "x-apikey": apiKey },
  });
  const text = await res.text();
  if (!res.ok) {
    let err = text.slice(0, 500) || res.statusText;
    try {
      const j = JSON.parse(text) as { error?: { message?: string } };
      if (j?.error?.message) err = j.error.message;
    } catch {
      /* keep err */
    }
    return { ok: false, status: res.status, error: err };
  }
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, status: 502, error: "Invalid JSON from VirusTotal" };
  }
}

/** Summarize VT IP response for UI / reports */
export function summarizeVtIpRecord(data: unknown): Record<string, unknown> {
  const d = data as {
    data?: {
      id?: string;
      attributes?: Record<string, unknown>;
    };
  };
  const a = d?.data?.attributes ?? {};
  return {
    source: "virustotal",
    type: "ip",
    id: d?.data?.id,
    reputation: a.reputation,
    last_analysis_stats: a.last_analysis_stats,
    as_owner: a.as_owner,
    country: a.country,
    network: a.network,
    whois: typeof a.whois === "string" ? (a.whois as string).slice(0, 2000) : a.whois,
  };
}

export function summarizeVtDomainRecord(data: unknown): Record<string, unknown> {
  const d = data as {
    data?: {
      id?: string;
      attributes?: Record<string, unknown>;
    };
  };
  const a = d?.data?.attributes ?? {};
  return {
    source: "virustotal",
    type: "domain",
    id: d?.data?.id,
    reputation: a.reputation,
    last_analysis_stats: a.last_analysis_stats,
    registrar: a.registrar,
    creation_date: a.creation_date,
    last_dns_records: Array.isArray(a.last_dns_records) ? (a.last_dns_records as unknown[]).slice(0, 15) : a.last_dns_records,
    whois: typeof a.whois === "string" ? (a.whois as string).slice(0, 2000) : a.whois,
  };
}

export async function fetchVtIp(ip: string): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; status: number; error: string }> {
  const trimmed = ip.trim();
  const encoded = encodeURIComponent(trimmed);
  const result = await vtGet(`/ip_addresses/${encoded}`);
  if (!result.ok) return result;
  return { ok: true, data: summarizeVtIpRecord(result.data) };
}

export async function fetchVtDomain(domain: string): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; status: number; error: string }> {
  const host = extractHostFromUrlOrDomain(domain).toLowerCase();
  const encoded = encodeURIComponent(host);
  const result = await vtGet(`/domains/${encoded}`);
  if (!result.ok) return result;
  return { ok: true, data: summarizeVtDomainRecord(result.data) };
}

/**
 * URL / domain reputation: uses VT domain report for hostname, or IP report if host is an IP.
 */
export async function fetchVtUrlReputation(
  url: string,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; status: number; error: string }> {
  const host = extractHostFromUrlOrDomain(url);
  if (isProbablyIpv4(host) || isProbablyIpv6(host)) {
    const ipRes = await fetchVtIp(host);
    if (!ipRes.ok) return ipRes;
    return {
      ok: true,
      data: {
        input_url: url,
        resolved_target: host,
        target_type: "ip",
        ...ipRes.data,
      },
    };
  }

  const domRes = await fetchVtDomain(host);
  if (!domRes.ok) return domRes;
  return {
    ok: true,
    data: {
      input_url: url,
      resolved_host: host,
      target_type: "domain",
      ...domRes.data,
    },
  };
}
