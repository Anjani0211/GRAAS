import { safeHttp } from "../../../utils/httpClient";
import { ConfidenceScore } from "../../../types/confidence";
import type { OsintResult } from "../providerInterface";
import { logger } from "../../../utils/logger";
import { mask } from "../../../utils/piiSanitizer";
import { config } from "../../../config";

/**
 * Razorpay VPA Validation API — live bank/holder status check.
 * Requires Razorpay key_id + key_secret.
 */
export async function razorpayVpaLookup(upi: string): Promise<OsintResult> {
  const keyId = config.razorpayKeyId;
  const keySecret = config.razorpayKeySecret;
  if (!keyId || !keySecret) return noKey("Razorpay");

  try {
    const response = await safeHttp.get<Record<string, unknown>>(
      `https://api.razorpay.com/v1/payments/validate/vpa`,
      {
        params: { vpa: upi },
        auth: { username: keyId, password: keySecret },
        timeout: 12_000,
      },
    );
    const data = response.data;
    const success = Boolean(data.success);
    const flags = success ? [] : ["VPA_NOT_FOUND"];
    return {
      success,
      data: { vpa: data.vpa ?? upi, customer_name: data.customer_name ?? null, success },
      confidence: success ? ConfidenceScore.HIGH : ConfidenceScore.LOW,
      source: `Razorpay/${new Date().toISOString()}`,
      raw: data,
      flags,
    };
  } catch (err) {
    logger.warn({ err: errMsg(err), value: mask(upi) }, "[UPI/Razorpay] lookup failed");
    return fail("Razorpay", err);
  }
}

/**
 * IFSC suffix → bank name fallback.
 * Free; no API key required. Identifies the bank from the UPI handle suffix.
 */
export function ifscBankLookup(upi: string): OsintResult {
  const suffix = (upi.split("@")[1] ?? "").toLowerCase();
  const bank = UPI_BANK_MAP[suffix] ?? "Unknown Bank";
  const known = bank !== "Unknown Bank";
  return {
    success: true,
    data: { upi_suffix: suffix, bank_name: bank },
    confidence: known ? ConfidenceScore.MEDIUM : ConfidenceScore.LOW,
    source: `ifsc-directory/${new Date().toISOString()}`,
    flags: known ? [] : ["UNKNOWN_BANK_SUFFIX"],
  };
}

/** Common UPI handle suffix → bank name mapping */
const UPI_BANK_MAP: Record<string, string> = {
  ybl: "Yes Bank (PhonePe)",
  ibl: "IDFC Bank",
  axl: "Axis Bank",
  oksbi: "SBI (Google Pay)",
  okaxis: "Axis Bank (Google Pay)",
  okicici: "ICICI Bank (Google Pay)",
  okhdfcbank: "HDFC Bank (Google Pay)",
  paytm: "Paytm Payments Bank",
  ptaxis: "Axis Bank (Paytm)",
  upi: "NPCI",
  icici: "ICICI Bank",
  hdfcbank: "HDFC Bank",
  sbi: "State Bank of India",
  kotak: "Kotak Mahindra Bank",
  indus: "IndusInd Bank",
  pnb: "Punjab National Bank",
  boi: "Bank of India",
  bob: "Bank of Baroda",
  unionbank: "Union Bank of India",
  canarabank: "Canara Bank",
  fbl: "Federal Bank",
  rbl: "RBL Bank",
  apl: "Amazon Pay",
  jupiteraxis: "Jupiter (Axis)",
  fifederal: "Fi (Federal Bank)",
};

function noKey(provider: string): OsintResult {
  return { success: false, confidence: ConfidenceScore.UNVERIFIED, source: `${provider}/no-key`, flags: [], error: "API key not configured" };
}

function fail(provider: string, err: unknown): OsintResult {
  return { success: false, confidence: ConfidenceScore.UNVERIFIED, source: `${provider}/${new Date().toISOString()}`, flags: [], error: errMsg(err) };
}

function errMsg(e: unknown): string { return e instanceof Error ? e.message : String(e); }
