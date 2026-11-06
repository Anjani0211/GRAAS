import { z } from "zod";
import { ConfidenceScore } from "../../types/confidence";
import type { AgentTool } from "../toolRegistry";
import { numVerifyLookup, regexPhoneAnalysis } from "../../services/osint/providers/phoneProviders";
import { mask } from "../../utils/piiSanitizer";

export const lookupPhoneTool: AgentTool<{ phone: string }, Record<string, unknown>> = {
  name: "lookup_phone",
  description:
    "Look up a phone number for carrier/operator + spam/fraud indicators. Use when a phone number appears in evidence. Returns carrier/spam signals when available.",
  inputSchema: z.object({
    phone: z.string().min(6).describe("Phone number in +91XXXXXXXXXX or 10-digit format"),
  }),
  execute: async (input) => {
    const masked = mask(input.phone);
    const [primary, fallback] = await Promise.all([
      numVerifyLookup(input.phone),
      Promise.resolve(regexPhoneAnalysis(input.phone)),
    ]);

    const best = primary.success ? primary : fallback;
    const combined: Record<string, unknown> = { primary, fallback };

    const flags = [
      ...(Array.isArray(primary.flags) ? primary.flags : []),
      ...(Array.isArray(fallback.flags) ? fallback.flags : []),
    ];

    return {
      success: Boolean(best.success),
      data: combined,
      rawText: `Phone ${masked}: primary=${primary.source} success=${primary.success} flags=${flags.join(",") || "none"}.`,
      confidence: best.confidence ?? ConfidenceScore.UNVERIFIED,
      error: best.success ? undefined : best.error,
    };
  },
  shouldScreenshot: false,
  tier: "API",
  // Can fall back to regex even without API key.
  requiresKey: null,
};
