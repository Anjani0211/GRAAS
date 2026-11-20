/** NCRP / I4C portal constants mirrored from cybercrime.gov.in checklist. */

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

export const NCRP_RELATIONSHIPS = [
  { value: "self", label: "Self (I am the victim)" },
  { value: "parent", label: "Parent" },
  { value: "guardian", label: "Guardian" },
  { value: "spouse", label: "Spouse" },
  { value: "sibling", label: "Sibling" },
  { value: "other", label: "Other" },
] as const;

export const NCRP_GENDERS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
] as const;

export type NcrpTransaction = {
  bankOrWallet: string;
  utr: string;
  date: string;
  amount: string;
  beneficiaryUpi: string;
  beneficiaryAccount: string;
  ifsc: string;
  mode: string;
};

export type NcrpSuspect = {
  name: string;
  mobile: string;
  email: string;
  upi: string;
  bankAccount: string;
  urlOrHandle: string;
  address: string;
};

export type NcrpComplaintPayload = {
  gender?: "male" | "female" | "other" | "prefer_not_to_say";
  dob?: string;
  parentOrSpouseName?: string;
  relationshipToVictim?: string;
  addressLine?: string;
  pincode?: string;
  occurredOn?: string;
  delayReason?: string;
  incidentTime?: string;
  ncrpCategory?: string;
  ncrpSubCategory?: string;
  additionalInfo?: string;
  transactions?: Array<{
    bankOrWallet?: string;
    utr?: string;
    date?: string;
    amount?: number;
    beneficiaryUpi?: string;
    beneficiaryAccount?: string;
    ifsc?: string;
    mode?: string;
  }>;
  suspects?: Array<{
    name?: string;
    mobile?: string;
    email?: string;
    upi?: string;
    bankAccount?: string;
    urlOrHandle?: string;
    address?: string;
  }>;
};

export function emptyTransaction(): NcrpTransaction {
  return {
    bankOrWallet: "",
    utr: "",
    date: "",
    amount: "",
    beneficiaryUpi: "",
    beneficiaryAccount: "",
    ifsc: "",
    mode: "",
  };
}

export function emptySuspect(): NcrpSuspect {
  return {
    name: "",
    mobile: "",
    email: "",
    upi: "",
    bankAccount: "",
    urlOrHandle: "",
    address: "",
  };
}

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

export function needsFinancialTransactions(category: string): boolean {
  return category === "financial_fraud" || category === "phishing";
}

export function sumTransactionAmounts(rows: NcrpTransaction[]): number {
  return rows.reduce((acc, row) => {
    const n = Number(row.amount);
    return acc + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);
}

export function buildNcrpPayload(args: {
  gender: string;
  dob: string;
  parentOrSpouseName: string;
  relationshipToVictim: string;
  addressLine: string;
  pincode: string;
  occurredOn: string;
  delayReason: string;
  incidentTime: string;
  category: string;
  additionalInfo: string;
  transactions: NcrpTransaction[];
  suspects: NcrpSuspect[];
}): NcrpComplaintPayload {
  const transactions = args.transactions
    .filter(
      (t) =>
        t.bankOrWallet.trim() ||
        t.utr.trim() ||
        t.date.trim() ||
        t.amount.trim() ||
        t.beneficiaryUpi.trim() ||
        t.beneficiaryAccount.trim(),
    )
    .map((t) => ({
      bankOrWallet: t.bankOrWallet.trim(),
      utr: t.utr.trim(),
      date: t.date.trim(),
      amount: t.amount.trim() ? Number(t.amount) : undefined,
      beneficiaryUpi: t.beneficiaryUpi.trim(),
      beneficiaryAccount: t.beneficiaryAccount.trim(),
      ifsc: t.ifsc.trim(),
      mode: t.mode.trim(),
    }));

  const suspects = args.suspects
    .filter(
      (s) =>
        s.name.trim() ||
        s.mobile.trim() ||
        s.email.trim() ||
        s.upi.trim() ||
        s.bankAccount.trim() ||
        s.urlOrHandle.trim() ||
        s.address.trim(),
    )
    .map((s) => ({
      name: s.name.trim(),
      mobile: s.mobile.trim(),
      email: s.email.trim(),
      upi: s.upi.trim(),
      bankAccount: s.bankAccount.trim(),
      urlOrHandle: s.urlOrHandle.trim(),
      address: s.address.trim(),
    }));

  return {
    gender: (args.gender || undefined) as NcrpComplaintPayload["gender"],
    dob: args.dob.trim() || undefined,
    parentOrSpouseName: args.parentOrSpouseName.trim() || undefined,
    relationshipToVictim: args.relationshipToVictim || "self",
    addressLine: args.addressLine.trim() || undefined,
    pincode: args.pincode.trim() || undefined,
    occurredOn: args.occurredOn.trim() || undefined,
    delayReason: args.delayReason.trim() || undefined,
    incidentTime: args.incidentTime.trim() || undefined,
    ncrpCategory: mapGrassCategoryToNcrp(args.category),
    additionalInfo: args.additionalInfo.trim() || undefined,
    transactions,
    suspects,
  };
}
