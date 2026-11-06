import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { buildDispatchPlan, enrichRegistrarContacts } from "../services/entityDispatch";
import type { ICase } from "../models";
import type { GRASSReport } from "../types/grassReport";

function makeCase(): ICase {
  return {
    caseNumber: "GRS-2026-XYZ99",
    victimName: "Test Victim",
    victimEmail: "v@example.com",
    victimPhone: "+919000000001",
    category: "phishing",
    state: "Karnataka",
    district: "Bengaluru Urban",
    monetaryLoss: 50000,
    incidentDate: new Date("2026-05-01"),
    createdAt: new Date("2026-05-02"),
    updatedAt: new Date("2026-05-02"),
    description: "Phishing attempt via fake banking domain.",
    osintInvestigation: {
      entities: [
        { id: "u1", type: "upi", value: "fraud@oksbi", sourceFile: "x", valid: true },
        { id: "d1", type: "domain", value: "fake-bank.test", sourceFile: "x", valid: true },
      ],
      enrichments: [],
      clusters: [
        {
          id: "cl-test",
          kind: "SHARED_UPI_CLUSTER",
          severity: "high",
          summary: "UPI also seen in 3 other cases.",
          linkedCaseNumbers: ["GRS-2026-AAA01", "GRS-2026-BBB02", "GRS-2026-CCC03"],
        },
      ],
    } as unknown as ICase["osintInvestigation"],
  } as unknown as ICase;
}

function makeReport(): GRASSReport {
  return {
    schema_version: "GRASSReport/1.0",
    case_id: "GRS-2026-XYZ99",
    generated_at: new Date().toISOString(),
    analyst_id: "BADGE-1",
    analyst_name: "Test",
    analyst_signature_hash: "a".repeat(64),
    incident_date_range: {
      start: new Date("2026-05-01").toISOString(),
      end: new Date("2026-05-02").toISOString(),
    },
    scam_category: "PHISHING",
    total_loss_inr: 50000,
    evidence_manifest: [
      {
        fileName: "f.txt",
        sha256: "a".repeat(64),
        fileSizeBytes: 100,
        mimeType: "text/plain",
        ingestedAt: new Date().toISOString(),
      },
    ],
    extracted_entities: [
      { value: "fraud@oksbi", type: "upi", source_file: "x", confidence: "HIGH", osint_summary: "x", flags: [] },
      { value: "fake-bank.test", type: "domain", source_file: "x", confidence: "HIGH", osint_summary: "x", flags: [] },
    ],
    invalid_entities: [],
    timeline: [],
    executive_summary: "Phishing case with fake banking domain. Routed to multiple entities.",
    victim_statement: "x",
    actionable_requests: [
      { priority: "HIGH", targetEntity: "fraud@oksbi", action: "FREEZE_ACCOUNT", justification: "x" },
      { priority: "HIGH", targetEntity: "fake-bank.test", action: "SEIZE_DOMAIN", justification: "x" },
    ],
    is_redacted: false,
  } as GRASSReport;
}

test("dispatch: recipient IDs are deterministic across rebuilds", () => {
  const ids1 = buildDispatchPlan(makeReport(), makeCase()).recipients.map((r) => r.id);
  const ids2 = buildDispatchPlan(makeReport(), makeCase()).recipients.map((r) => r.id);
  assert.deepEqual(ids1, ids2, "recipient IDs must be stable under regenerate");
});

test("dispatch: cluster footnote present when linked cases exist", () => {
  const plan = buildDispatchPlan(makeReport(), makeCase());
  for (const r of plan.recipients) {
    assert.match(r.body, /Cluster context/);
    assert.match(r.body, /3 other open GRASS case/);
  }
});

test("dispatch: WHOIS enrichment fills REGISTRAR contactEmail", async () => {
  const plan = buildDispatchPlan(makeReport(), makeCase());
  const reg = plan.recipients.find((r) => r.type === "REGISTRAR");
  assert.ok(reg, "expected a REGISTRAR recipient for SEIZE_DOMAIN action");
  assert.equal(reg!.contactEmail, undefined);

  const enriched = await enrichRegistrarContacts(
    plan.recipients,
    async (_domain) =>
      ({
        ok: true,
        data: { WhoisRecord: { registrarAbuseContactEmail: "abuse@registrar.example" } },
      }) as { ok: true; data: unknown },
  );
  const r2 = enriched.find((r) => r.type === "REGISTRAR");
  assert.equal(r2!.contactEmail, "abuse@registrar.example");
});

test("dispatch: WHOIS enrichment is no-op when fetcher errors", async () => {
  const plan = buildDispatchPlan(makeReport(), makeCase());
  const enriched = await enrichRegistrarContacts(plan.recipients, async () => ({
    ok: false,
    status: 500,
    error: "boom",
  }));
  const r = enriched.find((rr) => rr.type === "REGISTRAR");
  assert.equal(r!.contactEmail, undefined, "must not invent emails when whois fails");
});

test("webhook: HMAC sha256 signature shape matches expected", () => {
  const secret = "test-secret";
  const body = JSON.stringify({ dispatchId: "abc", recipientId: "r-1", status: "ACKED" });
  const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(sig.length, 64, "sha256 hex is 64 chars");
  assert.match(`sha256=${sig}`, /^sha256=[a-f0-9]{64}$/);
});
