import { z } from "zod";
import { ConfidenceScore } from "../../types/confidence";
import type { AgentTool } from "../toolRegistry";
import { cryptoLookup } from "../../services/osint/providers/cryptoProviders";
import { maskWallet } from "../../utils/piiSanitizer";

export const traceCryptoWalletTool: AgentTool<{ wallet: string }, Record<string, unknown>> = {
  name: "trace_crypto_wallet",
  description:
    "Trace a crypto wallet for basic metadata and public activity. Use when a wallet address is found in evidence or scam chats.",
  inputSchema: z.object({
    wallet: z.string().min(8).describe("Crypto wallet address (BTC/ETH/TRON etc.)"),
  }),
  execute: async (input) => {
    const masked = maskWallet(input.wallet);
    const res = await cryptoLookup(input.wallet);
    return {
      success: Boolean(res.success),
      data: res.data ? ({ ...res.data, flags: res.flags, source: res.source } as Record<string, unknown>) : ({ wallet: input.wallet } as Record<string, unknown>),
      rawText: `Wallet ${masked}: chain=${String((res.data as any)?.chain ?? "unknown")} tx=${String((res.data as any)?.tx_count ?? (res.data as any)?.recent_tx_count ?? "n/a")} flags=${(res.flags ?? []).join(",") || "none"}.`,
      confidence: res.confidence ?? ConfidenceScore.UNVERIFIED,
      error: res.success ? undefined : res.error,
    };
  },
  shouldScreenshot: false,
  tier: "API",
  requiresKey: null,
};
