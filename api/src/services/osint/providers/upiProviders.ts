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
    const flags = success ? ["VPA_ACTIVE"] : ["VPA_NOT_FOUND"];
    if (success) flags.push("PSP_IDENTIFIED");
    return {
      success,
      data: {
        vpa: data.vpa ?? upi,
        customer_name: data.customer_name ?? null,
        success,
        psp: (upi.split("@")[1] ?? "").toLowerCase(),
      },
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
 * UPI handle suffix → bank / PSP mapping (offline).
 */
export function ifscBankLookup(upi: string): OsintResult {
  const raw = upi.trim().toLowerCase();
  // Pseudo-entity from pipeline: UTIB0CCH274@ifsc
  if (raw.endsWith("@ifsc")) {
    const code = raw.replace(/@ifsc$/, "").toUpperCase();
    return {
      success: true,
      data: { ifsc: code, note: "Use ifscCodeLookup for branch metadata" },
      confidence: ConfidenceScore.MEDIUM,
      source: `ifsc-extract/${new Date().toISOString()}`,
      flags: ["IFSC_CODE_EXTRACTED"],
    };
  }

  const suffix = (raw.split("@")[1] ?? "").toLowerCase();
  const bank = UPI_BANK_MAP[suffix] ?? "Unknown Bank";
  const known = bank !== "Unknown Bank";
  const flags: string[] = [];
  if (known) flags.push("PSP_IDENTIFIED");
  else flags.push("UNKNOWN_BANK_SUFFIX");

  return {
    success: true,
    data: {
      upi_suffix: suffix,
      bank_name: bank,
      psp: suffix,
      complaint_search: `https://www.google.com/search?q=${encodeURIComponent(`"${raw}" scam OR fraud OR cheated OR UPI`)}`,
    },
    confidence: known ? ConfidenceScore.MEDIUM : ConfidenceScore.LOW,
    source: `upi-psp-map/${new Date().toISOString()}`,
    flags,
  };
}

/**
 * Public IFSC metadata via Razorpay's free IFSC directory (no key).
 * https://ifsc.razorpay.com/{IFSC}
 */
export async function ifscCodeLookup(ifscOrUpi: string): Promise<OsintResult> {
  const code = extractIfsc(ifscOrUpi);
  if (!code) {
    return {
      success: false,
      confidence: ConfidenceScore.UNVERIFIED,
      source: `ifsc-api/${new Date().toISOString()}`,
      flags: [],
      error: "no-ifsc",
    };
  }

  try {
    const response = await safeHttp.get<Record<string, unknown>>(
      `https://ifsc.razorpay.com/${encodeURIComponent(code)}`,
      {
        timeout: 12_000,
        headers: { Accept: "application/json", "User-Agent": "GRAAS-OSINT/1.0" },
        validateStatus: (s) => s >= 200 && s < 300,
      },
    );
    const data = response.data;
    const flags: string[] = ["IFSC_RESOLVED"];
    const branch = String(data.BRANCH ?? "");
    if (/CH\d+|CLEARING|NEFT|RTGS|CORP/i.test(branch) || /CH\d+/i.test(code)) {
      flags.push("IFSC_CORPORATE_CLEARING");
    }

    return {
      success: true,
      data: {
        ifsc: code,
        bank: data.BANK ?? null,
        branch: data.BRANCH ?? null,
        centre: data.CENTRE ?? null,
        district: data.DISTRICT ?? null,
        state: data.STATE ?? null,
        address: data.ADDRESS ?? null,
        contact: data.CONTACT ?? null,
        neft: data.NEFT ?? null,
        rtgs: data.RTGS ?? null,
        imps: data.IMPS ?? null,
        upi: data.UPI ?? null,
      },
      confidence: ConfidenceScore.HIGH,
      source: `ifsc.razorpay.com/${new Date().toISOString()}`,
      raw: data,
      flags,
    };
  } catch (err) {
    logger.warn({ err: errMsg(err), ifsc: code }, "[IFSC] lookup failed");
    // Offline prefix fallback
    const prefix = code.slice(0, 4);
    const bank = IFSC_PREFIX_BANK[prefix];
    if (bank) {
      return {
        success: true,
        data: { ifsc: code, bank, branch: null, note: "prefix-fallback" },
        confidence: ConfidenceScore.LOW,
        source: `ifsc-prefix/${new Date().toISOString()}`,
        flags: ["IFSC_PREFIX_ONLY"],
      };
    }
    return fail("IFSC", err);
  }
}

export function extractIfsc(value: string): string | null {
  const upper = value.trim().toUpperCase();
  const fromPseudo = upper.replace(/@IFSC$/, "");
  const m = fromPseudo.match(/\b([A-Z]{4}0[A-Z0-9]{6})\b/);
  return m?.[1] ?? null;
}

/** Common UPI handle suffix → bank / PSP name */
const UPI_BANK_MAP: Record<string, string> = {
  ybl: "Yes Bank (PhonePe)",
  ibl: "IDFC First Bank",
  axl: "Axis Bank",
  axisbank: "Axis Bank",
  oksbi: "SBI (Google Pay)",
  okaxis: "Axis Bank (Google Pay)",
  okicici: "ICICI Bank (Google Pay)",
  okhdfcbank: "HDFC Bank (Google Pay)",
  okbizaxis: "Axis Bank Business (Google Pay)",
  paytm: "Paytm Payments Bank",
  ptybl: "Yes Bank (Paytm)",
  ptaxis: "Axis Bank (Paytm)",
  upi: "NPCI Generic",
  icici: "ICICI Bank",
  hdfcbank: "HDFC Bank",
  sbi: "State Bank of India",
  kotak: "Kotak Mahindra Bank",
  indus: "IndusInd Bank",
  pnb: "Punjab National Bank",
  boi: "Bank of India",
  bob: "Bank of Baroda",
  barodampay: "Bank of Baroda",
  unionbank: "Union Bank of India",
  uboi: "Union Bank of India",
  canarabank: "Canara Bank",
  cbin: "Central Bank of India",
  fbl: "Federal Bank",
  federal: "Federal Bank",
  rbl: "RBL Bank",
  yesbank: "Yes Bank",
  yesbankltd: "Yes Bank",
  apl: "Amazon Pay",
  amazonpay: "Amazon Pay",
  jupiteraxis: "Jupiter (Axis)",
  fifederal: "Fi (Federal Bank)",
  sliceaxis: "Slice (Axis)",
  freecharge: "Freecharge",
  mobikwik: "MobiKwik",
  naviaxis: "Navi (Axis)",
  yblaxl: "Yes/Axis bridge",
  kbl: "Karnataka Bank",
  kvb: "Karur Vysya Bank",
  tmb: "Tamilnad Mercantile Bank",
  cub: "City Union Bank",
  idbi: "IDBI Bank",
  indianbank: "Indian Bank",
  indianbk: "Indian Bank",
  mahabank: "Bank of Maharashtra",
  utbi: "Uttar Bihar / related",
  jsbp: "Janata Sahakari",
  dbss: "DBS Bank",
  hsbc: "HSBC",
  citi: "Citibank",
  standardchartered: "Standard Chartered",
};

const IFSC_PREFIX_BANK: Record<string, string> = {
  SBIN: "State Bank of India",
  HDFC: "HDFC Bank",
  ICIC: "ICICI Bank",
  UTIB: "Axis Bank",
  PUNB: "Punjab National Bank",
  BARB: "Bank of Baroda",
  CNRB: "Canara Bank",
  UBIN: "Union Bank of India",
  IDFB: "IDFC First Bank",
  KKBK: "Kotak Mahindra Bank",
  YESB: "Yes Bank",
  FDRL: "Federal Bank",
  RATN: "RBL Bank",
  INDB: "IndusInd Bank",
  BKID: "Bank of India",
  CBIN: "Central Bank of India",
  IOBA: "Indian Overseas Bank",
  IDIB: "Indian Bank",
  MAHB: "Bank of Maharashtra",
};

function noKey(provider: string): OsintResult {
  return {
    success: false,
    confidence: ConfidenceScore.UNVERIFIED,
    source: `${provider}/no-key`,
    flags: [],
    error: "API key not configured",
  };
}

function fail(provider: string, err: unknown): OsintResult {
  return {
    success: false,
    confidence: ConfidenceScore.UNVERIFIED,
    source: `${provider}/${new Date().toISOString()}`,
    flags: [],
    error: errMsg(err),
  };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
