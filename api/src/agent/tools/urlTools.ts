import { z } from "zod";
import { ConfidenceScore } from "../../types/confidence";
import type { AgentTool } from "../toolRegistry";
import { virusTotalUrlLookup, urlScanLookup, whoisXmlDomainLookup } from "../../services/osint/providers/urlProviders";

export const scanUrlTool: AgentTool<{ url: string }, Record<string, unknown>> = {
  name: "scan_url",
  description:
    "Scan a URL for reputation and indicators. Use when a suspicious URL appears in evidence or is discovered during investigation.",
  inputSchema: z.object({
    url: z.string().url().describe("Full URL including https://"),
  }),
  execute: async (input) => {
    const [vt, us] = await Promise.all([
      virusTotalUrlLookup(input.url),
      urlScanLookup(input.url),
    ]);
    const best = vt.success ? vt : us;
    const flags = [
      ...(Array.isArray(vt.flags) ? vt.flags : []),
      ...(Array.isArray(us.flags) ? us.flags : []),
    ];
    return {
      success: Boolean(best.success),
      data: { vt: vt.data ?? null, urlscan: us.data ?? null, flags },
      rawText: `URL ${input.url}: vt_malicious=${String((vt.data as any)?.malicious ?? "n/a")} urlscan_malicious=${String((us.data as any)?.malicious ?? "n/a")} flags=${flags.join(",") || "none"}.`,
      confidence: best.confidence ?? ConfidenceScore.UNVERIFIED,
      error: best.success ? undefined : best.error,
    };
  },
  shouldScreenshot: true,
  tier: "API",
  // Either VT or URLScan may be configured.
  requiresKey: null,
};

export const whoisDomainTool: AgentTool<{ domain: string }, Record<string, unknown>> = {
  name: "whois_domain",
  description:
    "Fetch WHOIS data for a domain (registrar, created/expiry dates, nameservers). Use for domains found in URLs or APK strings.",
  inputSchema: z.object({
    domain: z.string().min(3).describe("Domain name without scheme, e.g. example.com"),
  }),
  execute: async (input) => {
    const res = await whoisXmlDomainLookup(input.domain);
    return {
      success: Boolean(res.success),
      data: res.data ? ({ ...res.data, flags: res.flags, source: res.source } as Record<string, unknown>) : ({ domain: input.domain } as Record<string, unknown>),
      rawText: `WHOIS ${input.domain}: registrar=${String((res.data as any)?.registrar ?? "n/a")} created=${String((res.data as any)?.created_at ?? "n/a")} flags=${(res.flags ?? []).join(",") || "none"}.`,
      confidence: res.confidence ?? ConfidenceScore.UNVERIFIED,
      error: res.success ? undefined : res.error,
    };
  },
  shouldScreenshot: false,
  tier: "API",
  requiresKey: "WHOISXML_API_KEY",
};
