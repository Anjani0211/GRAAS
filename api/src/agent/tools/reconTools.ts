import { z } from "zod";
import { ConfidenceScore } from "../../types/confidence";
import type { AgentTool } from "../toolRegistry";
import { isSsrfTargetAsync } from "../../utils/httpClient";
import { crawlPublicSite } from "../../services/osint/public/siteCrawl";
import { publicEmailFootprint } from "../../services/osint/public/emailFootprint";
import { lookupCertificateHosts } from "../../services/osint/public/certTransparency";
import { maskEmail } from "../../utils/piiSanitizer";

const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

function apexFromInput(input: string): string | null {
  const trimmed = input.trim();
  try {
    const host = trimmed.includes("://") ? new URL(trimmed).hostname : trimmed.split("/")[0] ?? trimmed;
    const apex = host.toLowerCase().replace(/\.$/, "");
    if (!DOMAIN_RE.test(apex)) return null;
    return apex;
  } catch {
    return null;
  }
}

export const crawlSiteTool: AgentTool<{ url: string }, Record<string, unknown>> = {
  name: "crawl_site",
  description:
    "Crawl a few public pages of a website and extract emails, social links, document URLs, and subdomains. No API key. Use on a phishing or scam URL.",
  inputSchema: z.object({
    url: z.string().url().describe("Full http(s) URL of the suspicious site"),
  }),
  execute: async (input) => {
    let parsed: URL;
    try {
      parsed = new URL(input.url);
    } catch {
      return {
        success: false,
        rawText: `Invalid URL: ${input.url}`,
        confidence: ConfidenceScore.UNVERIFIED,
        error: "INVALID_URL",
        data: { url: input.url },
      };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return {
        success: false,
        rawText: `Unsupported protocol for crawl: ${parsed.protocol}`,
        confidence: ConfidenceScore.UNVERIFIED,
        error: "UNSUPPORTED_PROTOCOL",
        data: { url: input.url },
      };
    }
    if (await isSsrfTargetAsync(parsed.href)) {
      return {
        success: false,
        rawText: `Blocked private or local target: ${parsed.hostname}`,
        confidence: ConfidenceScore.UNVERIFIED,
        error: "BLOCKED_HOST",
        data: { url: input.url },
      };
    }
    const crawled = await crawlPublicSite(parsed.href, 4);
    const hits = crawled.emails.length + crawled.socialLinks.length + crawled.files.length + crawled.subdomains.length;
    return {
      success: crawled.pagesFetched.length > 0,
      rawText: `Crawled ${crawled.pagesFetched.length} page(s) on ${crawled.seedHost}: emails=${crawled.emails.length} social=${crawled.socialLinks.length} files=${crawled.files.length} subdomains=${crawled.subdomains.length}.`,
      confidence: hits >= 3 ? ConfidenceScore.MEDIUM : crawled.pagesFetched.length > 0 ? ConfidenceScore.LOW : ConfidenceScore.UNVERIFIED,
      error: crawled.pagesFetched.length > 0 ? undefined : crawled.errors[0] ?? "CRAWL_EMPTY",
      data: crawled as unknown as Record<string, unknown>,
    };
  },
  shouldScreenshot: false,
  tier: "INTERNAL",
  requiresKey: null,
};

export const emailFootprintTool: AgentTool<{ email: string }, Record<string, unknown>> = {
  name: "email_footprint",
  description:
    "Public footprint for an email: Gravatar existence and whether the local-part matches public usernames. No API key and no Google session cookie.",
  inputSchema: z.object({
    email: z.string().email().describe("Email address from evidence"),
  }),
  execute: async (input) => {
    const footprint = await publicEmailFootprint(input.email.trim());
    const masked = maskEmail(input.email);
    const profileCount = footprint.likelyProfiles.length;
    return {
      success: true,
      rawText: `Email ${masked}: gravatar=${footprint.hasGravatar === null ? "unknown" : footprint.hasGravatar ? "yes" : "no"} local_part=${footprint.localPart ?? "n/a"} public_profiles=${profileCount}.`,
      confidence: profileCount >= 1 || footprint.hasGravatar ? ConfidenceScore.MEDIUM : ConfidenceScore.LOW,
      data: {
        gravatarHash: footprint.gravatarHash,
        gravatarUrl: footprint.gravatarUrl,
        hasGravatar: footprint.hasGravatar,
        localPart: footprint.localPart,
        likelyProfiles: footprint.likelyProfiles,
        checks: footprint.profileChecks,
      },
    };
  },
  shouldScreenshot: false,
  tier: "INTERNAL",
  requiresKey: null,
};

export const harvestDomainTool: AgentTool<{ domain: string }, Record<string, unknown>> = {
  name: "harvest_domain",
  description:
    "Public domain footprint: hostnames from certificate transparency (crt.sh) plus emails and links from the site homepage. No API key.",
  inputSchema: z.object({
    domain: z.string().min(3).describe("Domain or URL, e.g. example.com"),
  }),
  execute: async (input) => {
    const apex = apexFromInput(input.domain);
    if (!apex) {
      return {
        success: false,
        rawText: `Domain ${input.domain} failed format checks.`,
        confidence: ConfidenceScore.UNVERIFIED,
        error: "INVALID_DOMAIN",
        data: { domain: input.domain },
      };
    }
    const homepage = `https://${apex}/`;
    if (await isSsrfTargetAsync(homepage)) {
      return {
        success: false,
        rawText: `Blocked private or local domain: ${apex}`,
        confidence: ConfidenceScore.UNVERIFIED,
        error: "BLOCKED_HOST",
        data: { domain: apex },
      };
    }
    const [certs, crawled] = await Promise.all([
      lookupCertificateHosts(apex),
      crawlPublicSite(homepage, 1),
    ]);
    const hosts = [...new Set([apex, ...certs.hosts, ...crawled.subdomains])].slice(0, 40);
    const ok = hosts.length > 1 || crawled.pagesFetched.length > 0;
    return {
      success: ok,
      rawText: `Domain ${apex}: cert_hosts=${certs.hosts.length} homepage_emails=${crawled.emails.length} pages=${crawled.pagesFetched.length}.`,
      confidence: certs.hosts.length >= 2 || crawled.emails.length > 0 ? ConfidenceScore.MEDIUM : ConfidenceScore.LOW,
      error: ok ? undefined : certs.error ?? crawled.errors[0],
      data: {
        domain: apex,
        certificateHosts: certs.hosts,
        certificateError: certs.error ?? null,
        emails: crawled.emails,
        socialLinks: crawled.socialLinks,
        files: crawled.files,
        hosts,
      },
    };
  },
  shouldScreenshot: false,
  tier: "INTERNAL",
  requiresKey: null,
};
