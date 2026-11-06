/**
 * Entity Dispatch Router
 * ──────────────────────
 * Takes a validated GRASSReport (+ live Case context) and computes the
 * per-entity dispatch plan: which BANK / TELECOM / CERT-In / LE / SOCIAL /
 * EXCHANGE / REGISTRAR / PAYMENT_OPS recipients should receive a packet,
 * with priority, legal basis, subject and body fully interpolated.
 *
 * This is the missing piece between "report finalised" and "report
 * dispatched to the respective entity": no analyst should have to type
 * 9 emails by hand — the system derives them deterministically from the
 * actionable_requests + extracted_entities the pipeline already produced.
 */
import { createHash } from "crypto";
import type { GRASSReport } from "../types/grassReport";
import type {
  ICase,
  IOsintInvestigation,
  IOsintEntity,
  IOsintEnrichment,
} from "../models";
import type {
  IDispatchRecipient,
  RecipientType,
  RecipientPriority,
} from "../models/Dispatch";

// ── Lookup tables ────────────────────────────────────────────────────

/** Best-effort mapping of UPI handle suffix → bank nodal cell. */
const UPI_SUFFIX_BANK: Record<string, { name: string; email?: string }> = {
  okhdfcbank: { name: "HDFC Bank — Nodal Cyber Cell", email: "nodal.cyber@hdfcbank.com" },
  hdfc: { name: "HDFC Bank — Nodal Cyber Cell", email: "nodal.cyber@hdfcbank.com" },
  okaxis: { name: "Axis Bank — Nodal Cyber Cell", email: "nodal.cyber@axisbank.com" },
  axis: { name: "Axis Bank — Nodal Cyber Cell", email: "nodal.cyber@axisbank.com" },
  utib: { name: "Axis Bank — Nodal Cyber Cell", email: "nodal.cyber@axisbank.com" },
  okicici: { name: "ICICI Bank — Nodal Cyber Cell", email: "nodalofficer@icicibank.com" },
  icici: { name: "ICICI Bank — Nodal Cyber Cell", email: "nodalofficer@icicibank.com" },
  oksbi: { name: "State Bank of India — Nodal Cyber Cell", email: "nodalofficer@sbi.co.in" },
  sbi: { name: "State Bank of India — Nodal Cyber Cell", email: "nodalofficer@sbi.co.in" },
  ybl: { name: "YES Bank — Nodal Cyber Cell", email: "nodal.cyber@yesbank.in" },
  yesbank: { name: "YES Bank — Nodal Cyber Cell", email: "nodal.cyber@yesbank.in" },
  paytm: { name: "Paytm Payments Bank — Grievance Cell", email: "grievance-officer@paytmbank.com" },
  ptys: { name: "Paytm Payments Bank — Grievance Cell", email: "grievance-officer@paytmbank.com" },
  ptaxis: { name: "Paytm via Axis — Joint Nodal Cell", email: "nodal.cyber@axisbank.com" },
  pnb: { name: "Punjab National Bank — Nodal Cyber Cell", email: "nodalofficer@pnb.co.in" },
  kotak: { name: "Kotak Mahindra Bank — Nodal Cyber Cell", email: "nodalofficer@kotak.com" },
  fbl: { name: "Federal Bank — Nodal Cyber Cell", email: "fednodal@federalbank.co.in" },
  ibl: { name: "IDFC FIRST Bank — Nodal Cyber Cell", email: "nodal.cyber@idfcfirstbank.com" },
  rbl: { name: "RBL Bank — Nodal Cyber Cell", email: "nodalofficer@rblbank.com" },
  apl: { name: "Amazon Pay (ICICI) — Nodal Cell", email: "nodalofficer@icicibank.com" },
  ifsc: { name: "Reserve Bank of India — IFSC Routing Helpdesk", email: "ifschelpdesk@rbi.org.in" },
};

const IFSC_PREFIX_BANK: Record<string, string> = {
  HDFC: "HDFC Bank",
  ICIC: "ICICI Bank",
  SBIN: "State Bank of India",
  UTIB: "Axis Bank",
  PUNB: "Punjab National Bank",
  KKBK: "Kotak Mahindra Bank",
  YESB: "YES Bank",
  IDFB: "IDFC FIRST Bank",
  FDRL: "Federal Bank",
  RATN: "RBL Bank",
  BARB: "Bank of Baroda",
  IBKL: "IDBI Bank",
  CNRB: "Canara Bank",
  UBIN: "Union Bank of India",
  PYTM: "Paytm Payments Bank",
};

/** Indian telecom prefix (first 4 digits, 10-digit form) → operator. */
const TELECOM_PREFIX: Array<{ re: RegExp; name: string; email: string }> = [
  { re: /^[6-9]0(0[0-4]|0[5-9]|1[0-9])/, name: "Reliance Jio", email: "nodalofficer@jio.com" },
  { re: /^(70|80|81|82|83|84|85|86|87|88|89|90|91|92|93|94|95|96|97|98|99)/, name: "Pan-India Mobile Operator", email: "cybercell@dot.gov.in" },
];

const SOCIAL_DOMAIN_MAP: Record<string, { name: string; email: string }> = {
  "t.me": { name: "Telegram FZ-LLC — Law Enforcement Portal", email: "abuse@telegram.org" },
  "telegram.org": { name: "Telegram FZ-LLC — Law Enforcement Portal", email: "abuse@telegram.org" },
  "whatsapp.com": { name: "WhatsApp / Meta — LE Portal", email: "lawenforcement@meta.com" },
  "facebook.com": { name: "Meta Platforms — LE Online Request System", email: "lawenforcement@meta.com" },
  "instagram.com": { name: "Instagram (Meta) — LE Portal", email: "lawenforcement@meta.com" },
  "youtube.com": { name: "YouTube / Google — LERS Portal", email: "lers-support@google.com" },
  "x.com": { name: "X Corp — LE Online Portal", email: "le-portal@x.com" },
  "twitter.com": { name: "X Corp — LE Online Portal", email: "le-portal@x.com" },
};

const EXCHANGE_NETWORK: Record<string, { name: string; email: string }> = {
  BTC: { name: "Binance Compliance (BTC) — LE Request", email: "le-request@binance.com" },
  ETH: { name: "Binance Compliance (ETH) — LE Request", email: "le-request@binance.com" },
  TRX: { name: "Binance Compliance (TRX) — LE Request", email: "le-request@binance.com" },
};

// ── Helpers ──────────────────────────────────────────────────────────

function nowISO(): string {
  return new Date().toISOString();
}

function formatINR(n: number): string {
  return `₹${Math.max(0, Math.round(n)).toLocaleString("en-IN")}`;
}

/**
 * Deterministic recipient ID — sha256 over (caseNumber, recipientType, key)
 * so a regenerate produces the same ID for the same recipient. Lets the
 * UI preserve open/expanded state and the API merge-by-ID across replays
 * without losing chain-of-custody-relevant fields (confirmationRef etc.).
 */
function rid(prefix: string, caseNumber: string, key: string): string {
  const h = createHash("sha256")
    .update(caseNumber + ":" + prefix + ":" + key)
    .digest("hex")
    .slice(0, 12);
  return `${prefix}-${h}`;
}

function priorityFromLoss(lossInr: number): RecipientPriority {
  if (lossInr >= 100_000) return "URGENT";
  if (lossInr >= 10_000) return "HIGH";
  return "NORMAL";
}

function maxPriority(...ps: RecipientPriority[]): RecipientPriority {
  if (ps.includes("URGENT")) return "URGENT";
  if (ps.includes("HIGH")) return "HIGH";
  return "NORMAL";
}

function domainFromUrl(raw: string): string | null {
  try {
    const u = new URL(raw.includes("://") ? raw : `http://${raw}`);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function upiSuffix(upi: string): string {
  return upi.split("@")[1]?.toLowerCase() ?? "";
}

function ifscFromEnrichments(
  enrichments: IOsintEnrichment[],
  entityId?: string,
): { ifsc: string; bank?: string } | null {
  for (const en of enrichments) {
    if (entityId && en.entityId !== entityId) continue;
    const ifsc =
      (typeof en.details?.ifsc === "string" ? (en.details.ifsc as string) : "") ||
      (typeof en.details?.IFSC === "string" ? (en.details.IFSC as string) : "");
    if (ifsc && /^[A-Z]{4}0[A-Z0-9]{6}$/i.test(ifsc)) {
      const prefix = ifsc.toUpperCase().slice(0, 4);
      return { ifsc: ifsc.toUpperCase(), bank: IFSC_PREFIX_BANK[prefix] };
    }
  }
  return null;
}

function bankFromText(text: string): string | undefined {
  const upper = text.toUpperCase();
  for (const [prefix, name] of Object.entries(IFSC_PREFIX_BANK)) {
    if (upper.includes(prefix)) return name;
  }
  return undefined;
}

function detectChainFromAddress(value: string): "BTC" | "ETH" | "TRX" | "UNKNOWN" {
  if (/^0x[a-fA-F0-9]{40}$/.test(value)) return "ETH";
  if (/^T[a-zA-Z0-9]{33}$/.test(value)) return "TRX";
  if (/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(value)) return "BTC";
  return "UNKNOWN";
}

// ── Template renderers ───────────────────────────────────────────────

function bankFreezeBody(args: {
  bankName: string;
  caseNumber: string;
  upi: string;
  ifsc?: string;
  lossInr: number;
  state?: string;
  district?: string;
  victimName: string;
  incidentISO: string;
}): string {
  const { bankName, caseNumber, upi, ifsc, lossInr, state, district, victimName, incidentISO } = args;
  return [
    `To,`,
    `The Nodal Officer (Cyber)`,
    bankName,
    ``,
    `Subject: Urgent — Freeze beneficiary account / UPI VPA under BNSS §457`,
    `         Case Reference: ${caseNumber}`,
    ``,
    `Sir/Madam,`,
    ``,
    `An active cybercrime investigation has identified a beneficiary UPI ID`,
    `held within your institution as the proceeds-of-crime receiver in the`,
    `following matter:`,
    ``,
    `  • Case ID         : ${caseNumber}`,
    `  • Victim          : ${victimName}`,
    `  • Jurisdiction    : ${district ?? "—"}, ${state ?? "—"}`,
    `  • Incident date   : ${incidentISO.slice(0, 10)}`,
    `  • Suspect VPA     : ${upi}`,
    `  • Linked IFSC     : ${ifsc ?? "(to be confirmed by you)"}`,
    `  • Disputed amount : ${formatINR(lossInr)}`,
    ``,
    `Under BNSS §457 read with the RBI Master Direction on Customer Service`,
    `(Annexure to circular DPSS.CO.PD No. 1810/02.14.008/2019-20), you are`,
    `requested to:`,
    `  1) Immediately freeze the above VPA / linked account for outgoing debits.`,
    `  2) Preserve the customer KYC, account opening kit and transaction logs`,
    `     for the last 90 days under BNSS §94.`,
    `  3) Provide the beneficiary KYC + last-known IP/device log to the`,
    `     undersigned investigating cell within 72 hours.`,
    ``,
    `Kindly acknowledge by return email with your internal reference number.`,
    `A signed BNSS §457 packet (PDF) and BSA §63 evidence certificate are`,
    `attached for your records.`,
    ``,
    `Regards,`,
    `GRASS Investigation Cell`,
    `Government Reporting & Analytics for Cybercrime`,
  ].join("\n");
}

function telecomPreservationBody(args: {
  telecomName: string;
  caseNumber: string;
  phone: string;
  incidentISO: string;
}): string {
  const { telecomName, caseNumber, phone, incidentISO } = args;
  return [
    `To,`,
    `The Nodal Officer (Law Enforcement Liaison)`,
    telecomName,
    ``,
    `Subject: Preservation request under BNSS §94 — Case ${caseNumber}`,
    ``,
    `Sir/Madam,`,
    ``,
    `Pursuant to BNSS §94 and the Information Technology Act §69B procedures,`,
    `you are requested to preserve the following subscriber and connection`,
    `data for an active cybercrime investigation:`,
    ``,
    `  • Suspect MSISDN  : ${phone}`,
    `  • Case ID         : ${caseNumber}`,
    `  • Incident date   : ${incidentISO.slice(0, 10)}`,
    ``,
    `Data to preserve (90-day window from the incident date):`,
    `  1) CAF / KYC documents and acquisition channel`,
    `  2) Call Detail Records (CDR) and IPDR for the period above`,
    `  3) Last 30 IMEI / handset bindings to the MSISDN`,
    `  4) Last-mile tower (Cell-ID) data when active during incident window`,
    ``,
    `A formal §91 production order will follow. Until then, please ensure`,
    `the above is not auto-purged by your retention policy.`,
    ``,
    `Regards,`,
    `GRASS Investigation Cell`,
  ].join("\n");
}

function certInBody(args: {
  caseNumber: string;
  domains: string[];
  urls: string[];
  category: string;
  state?: string;
}): string {
  const { caseNumber, domains, urls, category, state } = args;
  const targets = [...new Set([...domains, ...urls])].slice(0, 20);
  return [
    `To,`,
    `The Director General`,
    `Indian Computer Emergency Response Team (CERT-In)`,
    `Electronics Niketan, New Delhi — 110003`,
    ``,
    `Subject: Cyber incident report under §70B of the IT Act, 2000`,
    `         Case Reference: ${caseNumber}`,
    ``,
    `Sir/Madam,`,
    ``,
    `Pursuant to CERT-In directive 20(3)/2022, we report the following`,
    `cybercrime incident for inclusion in the national threat advisory and`,
    `requested coordinated takedown action:`,
    ``,
    `  • Case ID          : ${caseNumber}`,
    `  • Incident class   : ${category.replace(/_/g, " ")}`,
    `  • Victim region    : ${state ?? "—"}`,
    `  • Indicators (IoCs):`,
    ...targets.map((t) => `      - ${t}`),
    ``,
    `Requested action:`,
    `  1) Add the above indicators to the CERT-In phishing/abuse advisory.`,
    `  2) Initiate registrar / hosting takedown via the Indian Cybercrime`,
    `     Coordination Centre (I4C) channel.`,
    `  3) Acknowledge with a CERT-In incident reference number.`,
    ``,
    `A signed evidence packet (BSA §63 certified) is attached.`,
    ``,
    `Regards,`,
    `GRASS Investigation Cell`,
  ].join("\n");
}

function ncrpBody(args: {
  caseNumber: string;
  lossInr: number;
  category: string;
  state?: string;
  district?: string;
  victimName: string;
}): string {
  const { caseNumber, lossInr, category, state, district, victimName } = args;
  return [
    `To,`,
    `The National Cybercrime Reporting Portal (NCRP) / 1930 Helpline`,
    `Indian Cybercrime Coordination Centre (I4C), MHA`,
    ``,
    `Subject: Cross-reference of investigated case — ${caseNumber}`,
    ``,
    `Sir/Madam,`,
    ``,
    `Please find below the consolidated GRASS investigation summary for`,
    `coordination with the existing NCRP / 1930 complaint thread:`,
    ``,
    `  • Case ID         : ${caseNumber}`,
    `  • Victim          : ${victimName}`,
    `  • Jurisdiction    : ${district ?? "—"}, ${state ?? "—"}`,
    `  • Category        : ${category.replace(/_/g, " ")}`,
    `  • Reported loss   : ${formatINR(lossInr)}`,
    ``,
    `The attached GRASSReport/1.0 PDF carries the full evidence manifest`,
    `(BSA §63 hashed), extracted indicators, OSINT enrichments, and a`,
    `pre-filled BNSS §457 / §94 packet for the concerned bank/telecom.`,
    `Requesting NCRP cross-link with this case for case-tracker continuity.`,
    ``,
    `Regards,`,
    `GRASS Investigation Cell`,
  ].join("\n");
}

function leCyberBody(args: {
  caseNumber: string;
  district?: string;
  state?: string;
  lossInr: number;
  category: string;
  victimName: string;
}): string {
  const { caseNumber, district, state, lossInr, category, victimName } = args;
  return [
    `To,`,
    `The Superintendent of Police (Cyber Cell)`,
    `${district ?? "—"}, ${state ?? "—"}`,
    ``,
    `Subject: Priority cybercrime escalation — ${caseNumber}`,
    ``,
    `Sir/Madam,`,
    ``,
    `The attached GRASSReport/1.0 packet documents a${category.match(/^[aeiou]/i) ? "n" : ""}`,
    `${category.replace(/_/g, " ")} matter affecting ${victimName}.`,
    `Disputed monetary value: ${formatINR(lossInr)}.`,
    ``,
    `The packet includes:`,
    `  • Full evidence hash manifest (BSA §63 compliant)`,
    `  • OSINT-enriched indicators with confidence grading`,
    `  • Cross-case correlation (cluster alerts where applicable)`,
    `  • Pre-filled BNSS §94 / §457 / BSA §63 legal fragments`,
    `  • Modus-operandi classification`,
    ``,
    `Requested action: registration of FIR / continuation of investigation`,
    `under the appropriate sections, and acknowledgement of receipt.`,
    ``,
    `Regards,`,
    `GRASS Investigation Cell`,
  ].join("\n");
}

function socialTakedownBody(args: {
  platform: string;
  caseNumber: string;
  url: string;
  category: string;
}): string {
  const { platform, caseNumber, url, category } = args;
  return [
    `To,`,
    `Law-Enforcement Response Team`,
    platform,
    ``,
    `Subject: Content takedown & data preservation — Case ${caseNumber}`,
    ``,
    `Sir/Madam,`,
    ``,
    `The following URL has been identified as material evidence in an`,
    `active ${category.replace(/_/g, " ")} investigation in India:`,
    ``,
    `  ${url}`,
    ``,
    `Pursuant to your published Law-Enforcement Guidelines and §79 of the`,
    `Information Technology Act, 2000 we request:`,
    `  1) Preserve the account, content, and access logs for 180 days.`,
    `  2) Remove / restrict access to the above URL pending judicial order.`,
    `  3) Provide the registered email / phone / IP-of-creation under MLAT or`,
    `     your LE portal mechanism upon receipt of the §91 production order.`,
    ``,
    `Regards,`,
    `GRASS Investigation Cell — Case ${caseNumber}`,
  ].join("\n");
}

function exchangeBody(args: {
  chain: "BTC" | "ETH" | "TRX";
  caseNumber: string;
  wallet: string;
  lossInr: number;
}): string {
  const { chain, caseNumber, wallet, lossInr } = args;
  return [
    `To,`,
    `Compliance / Law Enforcement Response`,
    EXCHANGE_NETWORK[chain].name,
    ``,
    `Subject: Wallet flag & trace request — ${chain} ${wallet.slice(0, 10)}…`,
    ``,
    `Sir/Madam,`,
    ``,
    `An active cybercrime investigation in India (Case ${caseNumber}) has`,
    `traced proceeds of crime to the following on-chain address:`,
    ``,
    `  • Network         : ${chain}`,
    `  • Wallet address  : ${wallet}`,
    `  • Reported loss   : ${formatINR(lossInr)}`,
    ``,
    `We request:`,
    `  1) Flag the above address as part of an active investigation.`,
    `  2) Apply enhanced monitoring on inbound/outbound transactions.`,
    `  3) Preserve KYC + transaction logs of any associated exchange`,
    `     account for 365 days, pending an MLAT request.`,
    ``,
    `Regards,`,
    `GRASS Investigation Cell`,
  ].join("\n");
}

function registrarBody(args: {
  registrar: string;
  caseNumber: string;
  domain: string;
}): string {
  const { registrar, caseNumber, domain } = args;
  return [
    `To,`,
    registrar,
    ``,
    `Subject: Domain abuse — takedown request for ${domain} (Case ${caseNumber})`,
    ``,
    `Sir/Madam,`,
    ``,
    `The domain ${domain} is the subject of an active phishing/impersonation`,
    `investigation in India under Case ${caseNumber}.`,
    ``,
    `Pursuant to ICANN's Registrar Accreditation Agreement §3.18 (abuse) we`,
    `request immediate suspension of the domain, preservation of the WHOIS`,
    `record and registrant payment instrument, and acknowledgement of`,
    `receipt with your internal ticket reference.`,
    ``,
    `Regards,`,
    `GRASS Investigation Cell`,
  ].join("\n");
}

// ── Recipient builders ───────────────────────────────────────────────

function pickTelecomOperator(phone: string): { name: string; email: string } {
  const norm = phone.replace(/^\+?91/, "").replace(/^0/, "");
  for (const t of TELECOM_PREFIX) {
    if (t.re.test(norm)) return { name: t.name, email: t.email };
  }
  return { name: "Telecom Operator (per MSISDN routing)", email: "cybercell@dot.gov.in" };
}

function pickBank(
  upi: string,
  enrichments: IOsintEnrichment[],
  entityId?: string,
): { name: string; email?: string; ifsc?: string } {
  const ifscHit = ifscFromEnrichments(enrichments, entityId);
  if (ifscHit) {
    return {
      name: `${ifscHit.bank ?? "Concerned Bank"} — Nodal Cyber Cell`,
      email: undefined,
      ifsc: ifscHit.ifsc,
    };
  }
  const suffix = upiSuffix(upi);
  const direct = UPI_SUFFIX_BANK[suffix];
  if (direct) return { name: direct.name, email: direct.email };
  // Suffix not in our table — keep entry but mark for analyst confirmation.
  const heuristic =
    Object.keys(UPI_SUFFIX_BANK).find((k) => suffix.includes(k)) ?? "";
  if (heuristic) {
    const m = UPI_SUFFIX_BANK[heuristic];
    return { name: m.name, email: m.email };
  }
  return { name: `Concerned Bank for VPA suffix @${suffix || "?"}`, email: undefined };
}

function findEntity(
  inv: IOsintInvestigation,
  value: string,
): { entity?: IOsintEntity; enrichment?: IOsintEnrichment } {
  const entity = inv.entities?.find((e) => e.value === value);
  if (!entity) return {};
  const enrichment = inv.enrichments?.find((en) => en.entityId === entity.id);
  return { entity, enrichment };
}

// ── Public API ───────────────────────────────────────────────────────

export interface BuildDispatchPlanResult {
  recipients: IDispatchRecipient[];
  /** Set of entity values we routed (used for "no recipient" diagnostics). */
  routed: Set<string>;
  /** Entity values that had no matching recipient route. */
  unrouted: string[];
}

/**
 * Deterministically derive the per-recipient dispatch plan from a validated
 * GRASSReport plus the live investigation document. Pure function over the
 * inputs — never mutates anything, never performs I/O.
 */
export function buildDispatchPlan(
  report: GRASSReport,
  caseDoc: ICase,
): BuildDispatchPlanResult {
  const inv = caseDoc.osintInvestigation;
  const enrichments = inv?.enrichments ?? [];
  const lossInr = report.total_loss_inr;
  const basePriority = priorityFromLoss(lossInr);
  const lossPriority = (delta: RecipientPriority = "NORMAL"): RecipientPriority =>
    maxPriority(basePriority, delta);

  // ── Cluster context — surface linked-case neighbours in every packet so
  // the recipient understands this is part of a campaign, not a one-off.
  const linkedCases = new Set<string>();
  for (const c of inv?.clusters ?? []) {
    for (const ln of c.linkedCaseNumbers ?? []) linkedCases.add(ln);
  }
  const clusterFootnote =
    linkedCases.size > 0
      ? "\n\n— Cluster context —\n" +
        "This case shares one or more indicators with " +
        String(linkedCases.size) +
        " other open GRASS case(s): " +
        [...linkedCases].slice(0, 8).join(", ") +
        (linkedCases.size > 8 ? `, +${linkedCases.size - 8} more` : "") +
        ".\nA consolidated cross-case freeze is strongly recommended."
      : "";
  const withClusterFootnote = (body: string) => body + clusterFootnote;

  const recipients: IDispatchRecipient[] = [];
  const routed = new Set<string>();

  // ── 1. Banks (from UPI freeze actions + UPI entities) ──────────────
  const upiTargets = new Set<string>();
  for (const req of report.actionable_requests) {
    if (req.action === "FREEZE_ACCOUNT") upiTargets.add(req.targetEntity);
  }
  for (const e of report.extracted_entities) {
    if (e.type === "upi" && (e.confidence === "HIGH" || e.confidence === "VERIFIED" || e.confidence === "MEDIUM")) {
      upiTargets.add(e.value);
    }
  }
  for (const upi of upiTargets) {
    const { entity } = findEntity(inv ?? ({} as IOsintInvestigation), upi);
    const bank = pickBank(upi, enrichments, entity?.id);
    const ifsc = bank.ifsc;
    recipients.push({
      id: rid("bank", caseDoc.caseNumber, upi),
      type: "BANK",
      name: bank.name,
      contactEmail: bank.email,
      jurisdiction: caseDoc.district ?? caseDoc.state,
      legalBasis: "BNSS §457 + §94",
      subject: `[URGENT] Freeze beneficiary VPA ${upi} — Case ${caseDoc.caseNumber}`,
      body: withClusterFootnote(
        bankFreezeBody({
          bankName: bank.name,
          caseNumber: caseDoc.caseNumber,
          upi,
          ifsc,
          lossInr,
          state: caseDoc.state,
          district: caseDoc.district,
          victimName: caseDoc.victimName,
          incidentISO: (caseDoc.incidentDate ?? caseDoc.createdAt).toISOString(),
        }),
      ),
      actionTargets: ifsc ? [upi, ifsc] : [upi],
      priority: lossPriority("URGENT"),
      status: "DRAFT",
    });
    routed.add(upi);
    if (ifsc) routed.add(ifsc);
  }

  // ── 2. Telecom operators (from phone entities) ─────────────────────
  const phones = report.extracted_entities.filter((e) => e.type === "phone");
  // De-duplicate by operator so we don't send the same telecom 10 separate emails
  const operatorBucket = new Map<string, { op: { name: string; email: string }; phones: string[] }>();
  for (const ph of phones) {
    const op = pickTelecomOperator(ph.value);
    const k = op.name;
    if (!operatorBucket.has(k)) operatorBucket.set(k, { op, phones: [] });
    operatorBucket.get(k)!.phones.push(ph.value);
    routed.add(ph.value);
  }
  for (const { op, phones: list } of operatorBucket.values()) {
    recipients.push({
      id: rid("tel", caseDoc.caseNumber, op.name),
      type: "TELECOM",
      name: op.name,
      contactEmail: op.email,
      legalBasis: "BNSS §94",
      subject: `Preservation §94 — ${list.length} MSISDN${list.length > 1 ? "s" : ""} — Case ${caseDoc.caseNumber}`,
      body: withClusterFootnote(
        list
          .map((p) =>
            telecomPreservationBody({
              telecomName: op.name,
              caseNumber: caseDoc.caseNumber,
              phone: p,
              incidentISO: (caseDoc.incidentDate ?? caseDoc.createdAt).toISOString(),
            }),
          )
          .join("\n\n— — —\n\n"),
      ),
      actionTargets: list,
      priority: lossPriority("HIGH"),
      status: "DRAFT",
    });
  }

  // ── 3. CERT-In (if any malicious URL/domain) ───────────────────────
  const flaggedDomains = report.extracted_entities
    .filter((e) => (e.type === "domain" || e.type === "url") && e.confidence !== "UNVERIFIED")
    .map((e) => e.value);
  const flaggedClusterDomain = (report.cluster_alerts ?? []).some(
    (c) => c.type === "DOMAIN_PHISHING_CAMPAIGN",
  );
  const certInWorthy =
    flaggedDomains.length > 0 ||
    flaggedClusterDomain ||
    report.scam_category === "PHISHING" ||
    report.scam_category === "IMPERSONATION";
  if (certInWorthy) {
    const urls = report.extracted_entities.filter((e) => e.type === "url").map((e) => e.value);
    const domains = report.extracted_entities.filter((e) => e.type === "domain").map((e) => e.value);
    recipients.push({
      id: rid("cert", caseDoc.caseNumber, "cert-in"),
      type: "CERT_IN",
      name: "CERT-In — Indian Computer Emergency Response Team",
      contactEmail: "incident@cert-in.org.in",
      contactPortal: "https://www.cert-in.org.in",
      legalBasis: "IT Act §70B + CERT-In Directive 20(3)/2022",
      subject: `Cyber incident report (IT Act §70B) — Case ${caseDoc.caseNumber}`,
      body: withClusterFootnote(
        certInBody({
          caseNumber: caseDoc.caseNumber,
          domains,
          urls,
          category: report.scam_category,
          state: caseDoc.state,
        }),
      ),
      actionTargets: [...new Set([...urls, ...domains])],
      priority: lossPriority(flaggedClusterDomain ? "URGENT" : "HIGH"),
      status: "DRAFT",
    });
    urls.forEach((u) => routed.add(u));
    domains.forEach((d) => routed.add(d));
  }

  // ── 4. Social media (per platform domain) ──────────────────────────
  const socialUrls = report.extracted_entities.filter((e) => e.type === "url");
  const socialBuckets = new Map<string, { platform: { name: string; email: string }; urls: string[] }>();
  for (const u of socialUrls) {
    const host = domainFromUrl(u.value);
    if (!host) continue;
    const match = Object.entries(SOCIAL_DOMAIN_MAP).find(([key]) =>
      host === key || host.endsWith(`.${key}`),
    );
    if (!match) continue;
    const platform = match[1];
    if (!socialBuckets.has(platform.name)) socialBuckets.set(platform.name, { platform, urls: [] });
    socialBuckets.get(platform.name)!.urls.push(u.value);
    routed.add(u.value);
  }
  for (const { platform, urls } of socialBuckets.values()) {
    recipients.push({
      id: rid("soc", caseDoc.caseNumber, platform.name),
      type: "SOCIAL",
      name: platform.name,
      contactEmail: platform.email,
      legalBasis: "IT Act §79 + platform LE policy",
      subject: `Takedown & preservation — ${urls.length} URL${urls.length > 1 ? "s" : ""} — Case ${caseDoc.caseNumber}`,
      body: withClusterFootnote(
        urls
          .map((u) =>
            socialTakedownBody({
              platform: platform.name,
              caseNumber: caseDoc.caseNumber,
              url: u,
              category: report.scam_category,
            }),
          )
          .join("\n\n— — —\n\n"),
      ),
      actionTargets: urls,
      priority: lossPriority("NORMAL"),
      status: "DRAFT",
    });
  }

  // ── 5. Crypto exchanges (per chain) ────────────────────────────────
  const wallets = report.extracted_entities.filter((e) => e.type === "wallet");
  const chainBuckets = new Map<string, string[]>();
  for (const w of wallets) {
    const chain = detectChainFromAddress(w.value);
    if (chain === "UNKNOWN") continue;
    if (!chainBuckets.has(chain)) chainBuckets.set(chain, []);
    chainBuckets.get(chain)!.push(w.value);
    routed.add(w.value);
  }
  for (const [chain, list] of chainBuckets.entries()) {
    const ex = EXCHANGE_NETWORK[chain as "BTC" | "ETH" | "TRX"];
    recipients.push({
      id: rid("ex", caseDoc.caseNumber, chain),
      type: "EXCHANGE",
      name: ex.name,
      contactEmail: ex.email,
      legalBasis: "Mutual Legal Assistance (MLAT) + AMLO compliance request",
      subject: `Wallet flag — ${chain} ${list.length} address${list.length > 1 ? "es" : ""} — Case ${caseDoc.caseNumber}`,
      body: withClusterFootnote(
        list
          .map((w) =>
            exchangeBody({
              chain: chain as "BTC" | "ETH" | "TRX",
              caseNumber: caseDoc.caseNumber,
              wallet: w,
              lossInr,
            }),
          )
          .join("\n\n— — —\n\n"),
      ),
      actionTargets: list,
      priority: lossPriority("HIGH"),
      status: "DRAFT",
    });
  }

  // ── 6. Domain registrar (best-effort generic) ─────────────────────
  for (const req of report.actionable_requests) {
    if (req.action !== "SEIZE_DOMAIN") continue;
    recipients.push({
      id: rid("reg", caseDoc.caseNumber, req.targetEntity),
      type: "REGISTRAR",
      name: `Registrar abuse desk for ${req.targetEntity}`,
      contactEmail: undefined, // Analyst fills after WHOIS — surfaced in UI as required field.
      legalBasis: "ICANN RAA §3.18 abuse + IT Act §69A",
      subject: `Abuse takedown — ${req.targetEntity} — Case ${caseDoc.caseNumber}`,
      body: withClusterFootnote(
        registrarBody({
          registrar: `Registrar abuse contact for ${req.targetEntity}`,
          caseNumber: caseDoc.caseNumber,
          domain: req.targetEntity,
        }),
      ),
      actionTargets: [req.targetEntity],
      priority: lossPriority("HIGH"),
      status: "DRAFT",
    });
    routed.add(req.targetEntity);
  }

  // ── 7. State LE cyber cell (always present) ────────────────────────
  recipients.push({
    id: rid("le", caseDoc.caseNumber, "le-cyber"),
    type: "LE_CYBER",
    name: `State Cyber Cell — ${caseDoc.district ?? "—"}, ${caseDoc.state ?? "—"}`,
    contactEmail: undefined,
    jurisdiction: `${caseDoc.district ?? "—"}, ${caseDoc.state ?? "—"}`,
    legalBasis: "BNS / BNSS / IT Act 2000",
    subject: `Priority escalation — Case ${caseDoc.caseNumber}`,
    body: withClusterFootnote(
      leCyberBody({
        caseNumber: caseDoc.caseNumber,
        district: caseDoc.district,
        state: caseDoc.state,
        lossInr,
        category: report.scam_category,
        victimName: caseDoc.victimName,
      }),
    ),
    actionTargets: [caseDoc.caseNumber],
    priority: lossPriority(lossInr >= 100_000 ? "URGENT" : "HIGH"),
    status: "DRAFT",
  });

  // NCRP / 1930 reference (always)
  recipients.push({
    id: rid("ncrp", caseDoc.caseNumber, "ncrp"),
    type: "LE_NCRP",
    name: "NCRP / 1930 — Indian Cybercrime Coordination Centre (I4C)",
    contactEmail: "complaints@cybercrime.gov.in",
    contactPortal: "https://cybercrime.gov.in",
    legalBasis: "I4C SOP (MHA, 2022)",
    subject: `Case cross-link with NCRP/1930 — ${caseDoc.caseNumber}`,
    body: withClusterFootnote(
      ncrpBody({
        caseNumber: caseDoc.caseNumber,
        lossInr,
        category: report.scam_category,
        state: caseDoc.state,
        district: caseDoc.district,
        victimName: caseDoc.victimName,
      }),
    ),
    actionTargets: [caseDoc.caseNumber],
    priority: lossPriority("NORMAL"),
    status: "DRAFT",
  });

  // Diagnostics
  const allEntities = report.extracted_entities.map((e) => e.value);
  const unrouted = allEntities.filter((v) => !routed.has(v));

  return { recipients, routed, unrouted };
}

/**
 * Best-effort async enrichment of REGISTRAR recipient contact emails by
 * running a WHOIS abuse-contact lookup. Non-blocking: any failure leaves
 * the recipient's contactEmail untouched (analyst still fills manually).
 */
export async function enrichRegistrarContacts(
  recipients: IDispatchRecipient[],
  whoisFetcher: (domain: string) => Promise<{ ok: true; data: unknown } | { ok: false; status: number; error: string }>,
): Promise<IDispatchRecipient[]> {
  const out: IDispatchRecipient[] = [];
  for (const r of recipients) {
    if (r.type !== "REGISTRAR" || r.contactEmail) {
      out.push(r);
      continue;
    }
    const domain = r.actionTargets[0];
    if (!domain) {
      out.push(r);
      continue;
    }
    try {
      const res = await whoisFetcher(domain);
      if (!res.ok) {
        out.push(r);
        continue;
      }
      const data = res.data as Record<string, unknown> | undefined;
      const record = (data?.WhoisRecord ?? data) as Record<string, unknown> | undefined;
      const abuseContacts =
        (record?.abuseContact as Record<string, unknown> | undefined)?.email ??
        (record?.contactEmail as string | undefined) ??
        (record?.registrarAbuseContactEmail as string | undefined);
      if (typeof abuseContacts === "string" && /@/.test(abuseContacts)) {
        out.push({ ...r, contactEmail: abuseContacts });
      } else {
        out.push(r);
      }
    } catch {
      out.push(r);
    }
  }
  return out;
}

export const _internal = {
  UPI_SUFFIX_BANK,
  IFSC_PREFIX_BANK,
  TELECOM_PREFIX,
  SOCIAL_DOMAIN_MAP,
  EXCHANGE_NETWORK,
  bankFromText,
  detectChainFromAddress,
  pickTelecomOperator,
  pickBank,
  formatINR,
  priorityFromLoss,
};
