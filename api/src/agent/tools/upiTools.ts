import { z } from "zod";
import { ConfidenceScore } from "../../types/confidence";
import type { AgentTool } from "../toolRegistry";
import { razorpayVpaLookup, ifscBankLookup, ifscCodeLookup } from "../../services/osint/providers/upiProviders";
import { mask } from "../../utils/piiSanitizer";

export const lookupUpiTool: AgentTool<{ upi: string }, Record<string, unknown>> = {
  name: "lookup_upi",
  description:
    "Look up a UPI VPA to determine bank/handle and whether it appears active or suspicious. Use when a UPI ID appears in evidence or tool output. Also resolves IFSC if the value is CODE@ifsc.",
  inputSchema: z.object({
    upi: z.string().min(3).describe("UPI VPA like name@bank, or IFSC@ifsc"),
  }),
  execute: async (input) => {
    const masked = mask(input.upi);
    const isIfsc = input.upi.toLowerCase().endsWith("@ifsc");
    const [primary, fallback] = await Promise.all([
      isIfsc ? ifscCodeLookup(input.upi) : razorpayVpaLookup(input.upi),
      Promise.resolve(ifscBankLookup(input.upi)),
    ]);
    const best = primary.success ? primary : fallback;
    const flags = [
      ...(Array.isArray(primary.flags) ? primary.flags : []),
      ...(Array.isArray(fallback.flags) ? fallback.flags : []),
    ];
    return {
      success: Boolean(best.success),
      data: { ...(best.data as Record<string, unknown>), primary, fallback },
      rawText: `UPI ${masked}: primary=${primary.source} success=${primary.success}. bank_hint=${String((fallback.data as any)?.bank_name ?? (primary.data as any)?.bank ?? "")}. flags=${flags.join(",") || "none"}.`,
      confidence: best.confidence ?? ConfidenceScore.UNVERIFIED,
      error: best.success ? undefined : best.error,
    };
  },
  shouldScreenshot: false,
  tier: "API",
  // Has a no-key fallback mapping.
  requiresKey: null,
};
