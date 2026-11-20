import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NcrpComplaintZ,
  mapGrassCategoryToNcrp,
} from "../types/ncrpComplaint";

test("mapGrassCategoryToNcrp maps financial and social categories", () => {
  assert.equal(mapGrassCategoryToNcrp("financial_fraud"), "Online Financial Fraud");
  assert.equal(mapGrassCategoryToNcrp("phishing"), "Online Financial Fraud");
  assert.equal(mapGrassCategoryToNcrp("account_hacking"), "Hacking");
  assert.equal(
    mapGrassCategoryToNcrp("cyberbullying"),
    "Online and Social Media Related Crime",
  );
  assert.equal(mapGrassCategoryToNcrp("corporate"), "Any Other Cyber Crime");
});

test("NcrpComplaintZ accepts transaction and suspect rows", () => {
  const parsed = NcrpComplaintZ.parse({
    gender: "female",
    parentOrSpouseName: "Ramesh Kumar",
    relationshipToVictim: "self",
    occurredOn: "WhatsApp",
    incidentTime: "14:30",
    ncrpCategory: "Online Financial Fraud",
    transactions: [
      {
        bankOrWallet: "SBI",
        utr: "123456789012",
        date: "2026-03-14",
        amount: 15000,
        beneficiaryUpi: "fraud@paytm",
      },
    ],
    suspects: [{ mobile: "9876543210", urlOrHandle: "https://t.me/scam" }],
  });
  assert.equal(parsed.transactions?.length, 1);
  assert.equal(parsed.transactions?.[0]?.utr, "123456789012");
  assert.equal(parsed.suspects?.[0]?.mobile, "9876543210");
});
