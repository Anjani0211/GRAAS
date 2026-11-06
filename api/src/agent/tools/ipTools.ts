import { z } from "zod";
import { ConfidenceScore } from "../../types/confidence";
import type { AgentTool } from "../toolRegistry";
import { abuseIpDbLookup, regexIpAnalysis } from "../../services/osint/providers/ipProviders";

export const lookupIpTool: AgentTool<{ ip: string }, Record<string, unknown>> = {
  name: "lookup_ip",
  description:
    "Look up an IP address for geo/ASN and abuse reputation. Use when an IP is found in evidence, URLs, or APK strings.",
  inputSchema: z.object({
    ip: z.string().min(7).describe("IPv4 address"),
  }),
  execute: async (input) => {
    const [primary, fallback] = await Promise.all([
      abuseIpDbLookup(input.ip),
      Promise.resolve(regexIpAnalysis(input.ip)),
    ]);
    const best = primary.success ? primary : fallback;
    const flags = [
      ...(Array.isArray(primary.flags) ? primary.flags : []),
      ...(Array.isArray(fallback.flags) ? fallback.flags : []),
    ];
    return {
      success: Boolean(best.success),
      data: { ...(best.data as Record<string, unknown>), primary, fallback },
      rawText: `IP ${input.ip}: abuse_score=${String((primary.data as any)?.abuse_score ?? "n/a")} reports=${String((primary.data as any)?.total_reports ?? "n/a")} flags=${flags.join(",") || "none"}.`,
      confidence: best.confidence ?? ConfidenceScore.UNVERIFIED,
      error: best.success ? undefined : best.error,
    };
  },
  shouldScreenshot: false,
  tier: "API",
  // Has regex fallback even without key.
  requiresKey: null,
};
