import { z } from "zod";
import { ConfidenceScore } from "../../types/confidence";
import type { AgentTool } from "../toolRegistry";
import { ifscCodeLookup } from "../../services/osint/providers/upiProviders";
import { waybackLookup } from "../../services/osint/public/wayback";
import {
  phoneAssistLinks,
  merchantAssistLinks,
  lookupPinAssist,
  escalationDeepLinks,
} from "../../services/osint/public/indiaAssist";
import { lookupCertificateHosts } from "../../services/osint/public/certTransparency";
import { mask } from "../../utils/piiSanitizer";

export const lookupIfscTool: AgentTool<{ ifsc: string }, Record<string, unknown>> = {
  name: "lookup_ifsc",
  description:
    "Resolve an IFSC code to bank/branch/district via the public IFSC directory. Use when an IFSC appears in UPI settlement trails or bank details.",
  inputSchema: z.object({
    ifsc: z.string().min(11).describe("11-character IFSC e.g. UTIB0CCH274"),
  }),
  execute: async (input) => {
    const res = await ifscCodeLookup(input.ifsc);
    return {
      success: Boolean(res.success),
      data: (res.data as Record<string, unknown>) ?? { ifsc: input.ifsc },
      rawText: `IFSC ${input.ifsc.toUpperCase()}: bank=${String((res.data as any)?.bank ?? "n/a")} branch=${String((res.data as any)?.branch ?? "n/a")} flags=${(res.flags ?? []).join(",") || "none"}.`,
      confidence: res.confidence ?? ConfidenceScore.UNVERIFIED,
      error: res.success ? undefined : res.error,
    };
  },
  shouldScreenshot: false,
  tier: "API",
  requiresKey: null,
};

export const archiveUrlTool: AgentTool<{ url: string }, Record<string, unknown>> = {
  name: "archive_url",
  description:
    "Check Internet Archive (Wayback) for an archived snapshot of a URL or domain. Use to preserve phishing/fraud landing pages as evidence.",
  inputSchema: z.object({
    url: z.string().min(4).describe("URL or domain to look up in Wayback Machine"),
  }),
  execute: async (input) => {
    const res = await waybackLookup(input.url);
    return {
      success: Boolean(res.success),
      data: (res.data as Record<string, unknown>) ?? { url: input.url },
      rawText: `Wayback ${input.url}: available=${String((res.data as any)?.available ?? false)} archive=${String((res.data as any)?.archive_url ?? "none")} flags=${(res.flags ?? []).join(",") || "none"}.`,
      confidence: res.confidence ?? ConfidenceScore.UNVERIFIED,
      error: res.success ? undefined : res.error,
    };
  },
  shouldScreenshot: false,
  tier: "API",
  requiresKey: null,
};

export const certTransparencyTool: AgentTool<{ domain: string }, Record<string, unknown>> = {
  name: "cert_transparency",
  description:
    "List related hostnames from Certificate Transparency (crt.sh) for a domain. Use to discover phishing sibling hosts.",
  inputSchema: z.object({
    domain: z.string().min(3).describe("Apex domain e.g. example.com"),
  }),
  execute: async (input) => {
    const cert = await lookupCertificateHosts(input.domain);
    const hosts = cert.hosts;
    return {
      success: !cert.error || hosts.length > 0,
      data: { domain: input.domain, hosts, error: cert.error ?? null },
      rawText: `CT ${input.domain}: ${hosts.length} hosts${hosts.length ? ` sample=${hosts.slice(0, 5).join(",")}` : ""}${cert.error ? ` err=${cert.error}` : ""}.`,
      confidence: hosts.length ? ConfidenceScore.MEDIUM : ConfidenceScore.LOW,
      error: cert.error,
    };
  },
  shouldScreenshot: false,
  tier: "API",
  requiresKey: null,
};

export const indiaAssistLinksTool: AgentTool<
  { kind: "phone" | "merchant" | "pin" | "escalation"; value: string },
  Record<string, unknown>
> = {
  name: "india_assist_links",
  description:
    "Generate analyst deep-links for Indian cyber-fraud workflows (Sanchar Saathi, Truecaller, GST/MCA, NCRP, PIN district hints). Does not bypass CAPTCHAs — opens portals for manual verification.",
  inputSchema: z.object({
    kind: z.enum(["phone", "merchant", "pin", "escalation"]),
    value: z.string().min(1).describe("Phone digits, GSTIN/merchant name, PIN, or case number"),
  }),
  execute: async (input) => {
    if (input.kind === "phone") {
      const assist = phoneAssistLinks(input.value);
      return {
        success: true,
        data: assist as unknown as Record<string, unknown>,
        rawText: `Phone assist ${mask(input.value)}: links=${Object.keys(assist.links).join(",")} flags=${assist.flags.join(",") || "none"}.`,
        confidence: ConfidenceScore.LOW,
      };
    }
    if (input.kind === "merchant") {
      const links = merchantAssistLinks(input.value);
      return {
        success: true,
        data: { query: input.value, assist_links: links },
        rawText: `Merchant assist ${input.value}: ${Object.keys(links).join(",")}.`,
        confidence: ConfidenceScore.LOW,
      };
    }
    if (input.kind === "pin") {
      const assist = lookupPinAssist(input.value);
      return {
        success: true,
        data: assist as unknown as Record<string, unknown>,
        rawText: `PIN ${assist.pin}: ${assist.district ?? "unknown"} / ${assist.state ?? "?"} watch=${assist.watchBelt}.`,
        confidence: assist.watchBelt ? ConfidenceScore.MEDIUM : ConfidenceScore.LOW,
      };
    }
    const links = escalationDeepLinks(input.value);
    return {
      success: true,
      data: { caseNumber: input.value, portals: links },
      rawText: `Escalation portals for ${input.value}: ${links.map((l) => l.id).join(",")}.`,
      confidence: ConfidenceScore.LOW,
    };
  },
  shouldScreenshot: false,
  tier: "INTERNAL",
  requiresKey: null,
};
