import { safeHttp } from "../../../utils/httpClient";
import { ConfidenceScore } from "../../../types/confidence";
import type { OsintResult } from "../providerInterface";
import { logger } from "../../../utils/logger";
import { maskWallet } from "../../../utils/piiSanitizer";
import { secrets } from "../../runtimeSettings";

function detectChain(address: string): "BTC" | "ETH" | "TRX" | "UNKNOWN" {
  if (/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(address)) return "BTC";
  if (/^0x[a-fA-F0-9]{40}$/.test(address)) return "ETH";
  if (/^T[a-zA-Z0-9]{33}$/.test(address)) return "TRX";
  return "UNKNOWN";
}

/**
 * Blockstream.info — BTC address balance + transaction count (no key required).
 */
export async function blockstreamBtcLookup(address: string): Promise<OsintResult> {
  try {
    const response = await safeHttp.get<Record<string, unknown>>(
      `https://blockstream.info/api/address/${address}`,
      { timeout: 12_000 },
    );
    const d = response.data;
    const stats = (d.chain_stats ?? {}) as Record<string, number>;
    const mempoolStats = (d.mempool_stats ?? {}) as Record<string, number>;
    const txCount = (stats.tx_count ?? 0) + (mempoolStats.tx_count ?? 0);
    const balanceSat = Number(stats.funded_txo_sum ?? 0) - Number(stats.spent_txo_sum ?? 0);

    const flags: string[] = [];
    if (txCount > 100) flags.push("HIGH_TX_VOLUME");
    if (balanceSat > 0) flags.push("HAS_BALANCE");

    return {
      success: true,
      data: {
        chain: "BTC",
        address,
        tx_count: txCount,
        balance_sat: balanceSat,
        balance_btc: (balanceSat / 1e8).toFixed(8),
      },
      confidence: txCount > 0 ? ConfidenceScore.HIGH : ConfidenceScore.MEDIUM,
      source: `Blockstream/${new Date().toISOString()}`,
      raw: d,
      flags,
    };
  } catch (err) {
    logger.warn({ err: errMsg(err), address: maskWallet(address) }, "[Crypto/Blockstream] BTC lookup failed");
    return fail("Blockstream", err);
  }
}

/**
 * Etherscan — ETH/ERC-20 balance + transaction history.
 */
export async function etherscanLookup(address: string): Promise<OsintResult> {
  const key = secrets.etherscan();
  if (!key) return noKey("Etherscan");

  try {
    const [balanceRes, txRes] = await Promise.all([
      safeHttp.get<{ status: string; result: string }>(
        "https://api.etherscan.io/api",
        { params: { module: "account", action: "balance", address, tag: "latest", apikey: key }, timeout: 12_000 },
      ),
      safeHttp.get<{ status: string; result: unknown[] }>(
        "https://api.etherscan.io/api",
        { params: { module: "account", action: "txlist", address, sort: "desc", page: 1, offset: 10, apikey: key }, timeout: 12_000 },
      ),
    ]);

    const balanceWei = BigInt(balanceRes.data.result || "0");
    const balanceEth = Number(balanceWei) / 1e18;
    const txCount = Array.isArray(txRes.data.result) ? txRes.data.result.length : 0;

    const flags: string[] = [];
    if (txCount > 0) flags.push("HAS_TRANSACTIONS");
    if (balanceEth > 0) flags.push("HAS_ETH_BALANCE");

    return {
      success: true,
      data: {
        chain: "ETH",
        address,
        balance_eth: balanceEth.toFixed(6),
        recent_tx_count: txCount,
      },
      confidence: txCount > 0 ? ConfidenceScore.HIGH : ConfidenceScore.MEDIUM,
      source: `Etherscan/${new Date().toISOString()}`,
      flags,
    };
  } catch (err) {
    logger.warn({ err: errMsg(err), address: maskWallet(address) }, "[Crypto/Etherscan] lookup failed");
    return fail("Etherscan", err);
  }
}

/**
 * TRONScan — TRX address details (free tier available).
 */
export async function tronScanLookup(address: string): Promise<OsintResult> {
  try {
    const response = await safeHttp.get<Record<string, unknown>>(
      "https://apilist.tronscanapi.com/api/accountv2",
      {
        params: { address },
        timeout: 12_000,
      },
    );
    const d = response.data;
    const balance = Number((d.balances as Array<Record<string, unknown>>)?.[0]?.balance ?? 0);
    const txCount = Number(d.transactions_out ?? 0) + Number(d.transactions_in ?? 0);

    const flags: string[] = [];
    if (txCount > 0) flags.push("HAS_TRANSACTIONS");
    if (balance > 0) flags.push("HAS_TRX_BALANCE");

    return {
      success: true,
      data: { chain: "TRX", address, balance_trx: (balance / 1e6).toFixed(2), tx_count: txCount },
      confidence: txCount > 0 ? ConfidenceScore.HIGH : ConfidenceScore.MEDIUM,
      source: `TRONScan/${new Date().toISOString()}`,
      raw: d,
      flags,
    };
  } catch (err) {
    logger.warn({ err: errMsg(err), address: maskWallet(address) }, "[Crypto/TRONScan] lookup failed");
    return fail("TRONScan", err);
  }
}

/**
 * Dispatch to the correct chain based on address format.
 */
export async function cryptoLookup(address: string): Promise<OsintResult> {
  const chain = detectChain(address);
  switch (chain) {
    case "BTC": return blockstreamBtcLookup(address);
    case "ETH": return etherscanLookup(address);
    case "TRX": return tronScanLookup(address);
    default:
      return {
        success: false,
        data: { address, chain: "UNKNOWN" },
        confidence: ConfidenceScore.LOW,
        source: `chain-detection/${new Date().toISOString()}`,
        flags: ["UNKNOWN_CHAIN"],
        error: "Address format did not match BTC/ETH/TRX",
      };
  }
}

function noKey(p: string): OsintResult { return { success: false, confidence: ConfidenceScore.UNVERIFIED, source: `${p}/no-key`, flags: [], error: "API key not configured" }; }
function fail(p: string, e: unknown): OsintResult { return { success: false, confidence: ConfidenceScore.UNVERIFIED, source: `${p}/${new Date().toISOString()}`, flags: [], error: errMsg(e) }; }
function errMsg(e: unknown): string { return e instanceof Error ? e.message : String(e); }
