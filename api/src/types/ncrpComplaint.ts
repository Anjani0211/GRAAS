import { z } from "zod";

/** NCRP / I4C “Report Other Cybercrime” aligned intake (cybercrime.gov.in). */
export const NCRP_OCCURRED_ON = [
  "WhatsApp",
  "Telegram",
  "Facebook",
  "Instagram",
  "Twitter/X",
  "Email",
  "Website/URL",
  "UPI App",
  "Banking App",
  "Phone Call",
  "SMS",
  "Other",
] as const;

export const NCRP_CATEGORIES = [
  "Online and Social Media Related Crime",
  "Online Financial Fraud",
  "Ransomware",
  "Hacking",
  "Cryptocurrency Related Crime",
  "Online Trafficking",
  "Online Gambling",
  "Any Other Cyber Crime",
] as const;

export const NCRP_RELATIONSHIPS = [
  "self",
  "parent",
  "guardian",
  "spouse",
  "sibling",
  "other",
] as const;

export const NcrpTransactionZ = z.object({
  bankOrWallet: z.string().trim().max(120).optional().default(""),
  utr: z.string().trim().max(64).optional().default(""),
  date: z.string().trim().max(32).optional().default(""),
  amount: z.number().nonnegative().optional(),
  beneficiaryUpi: z.string().trim().max(120).optional().default(""),
  beneficiaryAccount: z.string().trim().max(64).optional().default(""),
  ifsc: z.string().trim().max(20).optional().default(""),
  mode: z.string().trim().max(40).optional().default(""),
});

export const NcrpSuspectZ = z.object({
  name: z.string().trim().max(120).optional().default(""),
  mobile: z.string().trim().max(20).optional().default(""),
  email: z.string().trim().max(160).optional().default(""),
  upi: z.string().trim().max(120).optional().default(""),
  bankAccount: z.string().trim().max(64).optional().default(""),
  urlOrHandle: z.string().trim().max(500).optional().default(""),
  address: z.string().trim().max(400).optional().default(""),
});

export const NcrpComplaintZ = z.object({
  gender: z.enum(["male", "female", "other", "prefer_not_to_say"]).optional(),
  dob: z.string().trim().max(32).optional(),
  parentOrSpouseName: z.string().trim().max(120).optional(),
  relationshipToVictim: z.enum(NCRP_RELATIONSHIPS).optional().default("self"),
  addressLine: z.string().trim().max(400).optional(),
  pincode: z.string().trim().max(12).optional(),
  occurredOn: z.string().trim().max(80).optional(),
  delayReason: z.string().trim().max(500).optional(),
  incidentTime: z.string().trim().max(16).optional(),
  ncrpCategory: z.string().trim().max(120).optional(),
  ncrpSubCategory: z.string().trim().max(120).optional(),
  additionalInfo: z.string().trim().max(2000).optional(),
  transactions: z.array(NcrpTransactionZ).max(30).optional().default([]),
  suspects: z.array(NcrpSuspectZ).max(20).optional().default([]),
});

export type NcrpComplaint = z.infer<typeof NcrpComplaintZ>;
export type NcrpTransaction = z.infer<typeof NcrpTransactionZ>;
export type NcrpSuspect = z.infer<typeof NcrpSuspectZ>;

/** Map GRAAS case category → nearest NCRP portal category label. */
export function mapGrassCategoryToNcrp(category: string): string {
  switch (category) {
    case "financial_fraud":
    case "phishing":
      return "Online Financial Fraud";
    case "account_hacking":
      return "Hacking";
    case "cyberbullying":
    case "sextortion":
    case "deepfake":
      return "Online and Social Media Related Crime";
    case "identity_theft":
    case "corporate":
    default:
      return "Any Other Cyber Crime";
  }
}
