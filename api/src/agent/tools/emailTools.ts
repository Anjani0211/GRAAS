import { z } from "zod";
import { ConfidenceScore } from "../../types/confidence";
import type { AgentTool } from "../toolRegistry";
import { hibpLookup, hunterEmailLookup, mxRecordLookup } from "../../services/osint/providers/emailProviders";
import { maskEmail } from "../../utils/piiSanitizer";

export const checkEmailBreachTool: AgentTool<{ email: string }, Record<string, unknown>> = {
  name: "check_email_breach",
  description:
    "Check whether an email appears in known breach datasets. Use when an email address is found in evidence or tool output.",
  inputSchema: z.object({
    email: z.string().email().describe("Email address"),
  }),
  execute: async (input) => {
    const masked = maskEmail(input.email);
    const [hibp, hunter, mx] = await Promise.all([
      hibpLookup(input.email),
      hunterEmailLookup(input.email),
      mxRecordLookup(input.email),
    ]);
    const best = hibp.success ? hibp : hunter.success ? hunter : mx;
    const flags = [
      ...(Array.isArray(hibp.flags) ? hibp.flags : []),
      ...(Array.isArray(hunter.flags) ? hunter.flags : []),
      ...(Array.isArray(mx.flags) ? mx.flags : []),
    ];
    return {
      success: Boolean(best.success),
      data: { hibp: hibp.data ?? null, hunter: hunter.data ?? null, mx: mx.data ?? null, flags },
      rawText: `Email ${masked}: hibp_breaches=${String((hibp.data as any)?.breach_count ?? "n/a")} hunter_status=${String((hunter.data as any)?.status ?? "n/a")} mx=${String((mx.data as any)?.has_mx ?? "n/a")} flags=${flags.join(",") || "none"}.`,
      confidence: best.confidence ?? ConfidenceScore.UNVERIFIED,
      error: best.success ? undefined : best.error,
    };
  },
  shouldScreenshot: false,
  tier: "API",
  // MX lookup works without key.
  requiresKey: null,
};
