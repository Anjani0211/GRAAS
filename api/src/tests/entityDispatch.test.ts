import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDispatchPlan } from "../services/entityDispatch";
import type { ICase } from "../models";
import type { GRASSReport } from "../types/grassReport";

function makeCase(overrides: Partial<ICase> = {}): ICase {
  // Minimal ICase shape used by entityDispatch.ts (only reads a handful of
  // fields). We avoid the heavyweight Mongoose Document path here.
  return {
    caseNumber: "GRS-2026-ABC12",
    victimName: "Mr. Tridev Singh Bartwal",
    victimEmail: "victim@example.com",
    victimPhone: "+919876543210",
    category: "financial_fraud",
    state: "Jharkhand",
    district: "Deoghar",
    monetaryLoss: 99488.08,
    incidentDate: new Date("2026-02-20"),
    createdAt: new Date("2026-02-21"),
    updatedAt: new Date("2026-02-21"),
    description: "Fraudulent UPI Collect Request impersonating YES Bank.",
    osintInvestigation: {
      entities: [
        { id: "u1", type: "upi", value: "scammer@oksbi", sourceFile: "complaint", valid: true },
      ],
      enrichments: [
        {
          entityId: "u1",
          source: "Razorpay/VPA",
          confidence: "HIGH",
          details: { ifsc: "UTIB0CCH274" },
          timestamp: new Date(),
        },
      ],
    } as unknown as ICase["osintInvestigation"],
    ...overrides,
  } as unknown as ICase;
}

function makeReport(overrides: Partial<GRASSReport> = {}): GRASSReport {
  return {
    schema_version: "GRASSReport/1.0",
    case_id: "GRS-2026-ABC12",
    generated_at: new Date().toISOString(),
    analyst_id: "BADGE-1",
    analyst_name: "Test Analyst",
    analyst_signature_hash: "a".repeat(64),
    incident_date_range: {
      start: new Date("2026-02-20").toISOString(),
      end: new Date("2026-02-21").toISOString(),
    },
    scam_category: "INVESTMENT_FRAUD",
    total_loss_inr: 99488,
    evidence_manifest: [
      {
        fileName: "complaint.txt",
        sha256: "a".repeat(64),
        fileSizeBytes: 100,
        mimeType: "text/plain",
        ingestedAt: new Date().toISOString(),
      },
    ],
    extracted_entities: [
      {
        value: "scammer@oksbi",
        type: "upi",
        source_file: "complaint",
        confidence: "HIGH",
        osint_summary: "UPI VPA flagged",
        flags: [],
      },
      {
        value: "+919876543211",
        type: "phone",
        source_file: "complaint",
        confidence: "MEDIUM",
        osint_summary: "Phone flagged",
        flags: [],
      },
      {
        value: "https://t.me/fraudchannel",
        type: "url",
        source_file: "complaint",
        confidence: "HIGH",
        osint_summary: "Telegram channel",
        flags: [],
      },
      {
        value: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
        type: "wallet",
        source_file: "complaint",
        confidence: "MEDIUM",
        osint_summary: "ETH wallet",
        flags: [],
      },
    ],
    invalid_entities: [],
    timeline: [],
    executive_summary:
      "Auto-drafted GRASSReport/1.0 for GRS-2026-ABC12. UPI collect-request scam.",
    victim_statement: "Fraudulent UPI collect request",
    actionable_requests: [
      {
        priority: "HIGH",
        targetEntity: "scammer@oksbi",
        action: "FREEZE_ACCOUNT",
        justification: "Beneficiary VPA in active scam",
      },
    ],
    is_redacted: false,
    ...overrides,
  } as GRASSReport;
}

test("dispatch: routes UPI to bank with IFSC enrichment", () => {
  const plan = buildDispatchPlan(makeReport(), makeCase());
  const bank = plan.recipients.find((r) => r.type === "BANK");
  assert.ok(bank, "expected a BANK recipient");
  assert.ok(bank!.actionTargets.includes("scammer@oksbi"));
  assert.match(bank!.body, /BNSS .457/);
  assert.equal(bank!.priority, "URGENT", "loss >= 100k OR bank-freeze should be URGENT");
});

test("dispatch: telecom recipient created for phone entity", () => {
  const plan = buildDispatchPlan(makeReport(), makeCase());
  const tel = plan.recipients.find((r) => r.type === "TELECOM");
  assert.ok(tel, "expected a TELECOM recipient");
  assert.ok(tel!.actionTargets.some((t) => t.includes("9876543211")));
  assert.match(tel!.legalBasis, /BNSS .94/);
});

test("dispatch: social platform routed for Telegram URL", () => {
  const plan = buildDispatchPlan(makeReport(), makeCase());
  const soc = plan.recipients.find((r) => r.type === "SOCIAL");
  assert.ok(soc, "expected a SOCIAL recipient");
  assert.match(soc!.name, /Telegram/);
});

test("dispatch: exchange routed by ETH wallet detection", () => {
  const plan = buildDispatchPlan(makeReport(), makeCase());
  const ex = plan.recipients.find((r) => r.type === "EXCHANGE");
  assert.ok(ex, "expected an EXCHANGE recipient");
  assert.match(ex!.subject, /ETH/);
});

test("dispatch: CERT-In + LE_CYBER + NCRP always included for phishing-like flow", () => {
  const plan = buildDispatchPlan(makeReport({ scam_category: "PHISHING" }), makeCase());
  assert.ok(plan.recipients.find((r) => r.type === "CERT_IN"));
  assert.ok(plan.recipients.find((r) => r.type === "LE_CYBER"));
  assert.ok(plan.recipients.find((r) => r.type === "LE_NCRP"));
});

test("dispatch: recipients carry interpolated case number in subject and body", () => {
  const plan = buildDispatchPlan(makeReport(), makeCase());
  for (const r of plan.recipients) {
    assert.match(
      r.subject + r.body,
      /GRS-2026-ABC12/,
      `recipient ${r.type} missing case number in subject/body`,
    );
  }
});
