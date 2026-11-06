import { test } from "node:test";
import assert from "node:assert/strict";
import {
  projectEntities,
  buildGraphSlice,
  entityNodeId,
  type CaseTouch,
} from "../services/threatGraph";

function mk(
  type: import("../models").OsintEntityType,
  value: string,
  touches: Array<Partial<CaseTouch>>,
) {
  return {
    type,
    value,
    touches: touches.map((t, i) => ({
      caseNumber: t.caseNumber ?? `GRS-2026-${String(i).padStart(5, "0")}`,
      caseSeverity: t.caseSeverity,
      lossInr: t.lossInr ?? 0,
      incidentDate: t.incidentDate ?? new Date("2026-01-15").toISOString(),
      confidence: t.confidence ?? "MEDIUM",
    })) as CaseTouch[],
  };
}

test("projectEntities ranks UPI shared across many cases highest", () => {
  const rows = [
    mk("upi", "scammer@oksbi", [
      { caseSeverity: "high", lossInr: 100000, confidence: "HIGH" },
      { caseSeverity: "high", lossInr: 50000, confidence: "VERIFIED" },
      { caseSeverity: "medium", lossInr: 20000, confidence: "MEDIUM" },
    ]),
    mk("ipv4", "203.0.113.1", [{ caseSeverity: "low", confidence: "LOW" }]),
    mk("phone", "+919999900001", [
      { caseSeverity: "medium", lossInr: 30000, confidence: "MEDIUM" },
      { caseSeverity: "medium", lossInr: 10000, confidence: "MEDIUM" },
    ]),
  ];
  const ranked = projectEntities(rows);
  assert.equal(ranked[0].type, "upi");
  assert.equal(ranked[0].value, "scammer@oksbi");
  assert.ok(ranked[0].riskScore > ranked[1].riskScore);
});

test("projectEntities filters by minCaseCount and confidence floor", () => {
  const rows = [
    mk("upi", "lonely@bank", [{ confidence: "HIGH" }]),
    mk("upi", "popular@bank", [
      { confidence: "MEDIUM" },
      { confidence: "MEDIUM" },
      { confidence: "MEDIUM" },
    ]),
  ];
  const out = projectEntities(rows, { minCaseCount: 2, minConfidence: "MEDIUM" });
  assert.equal(out.length, 1);
  assert.equal(out[0].value, "popular@bank");
});

test("projectEntities respects date range filter", () => {
  const rows = [
    mk("upi", "old@bank", [{ incidentDate: new Date("2025-06-01").toISOString() }]),
    mk("upi", "new@bank", [{ incidentDate: new Date("2026-05-15").toISOString() }]),
  ];
  const recent = projectEntities(rows, {
    from: new Date("2026-01-01").toISOString(),
    to: new Date("2026-12-31").toISOString(),
  });
  assert.equal(recent.length, 1);
  assert.equal(recent[0].value, "new@bank");
});

test("buildGraphSlice yields entity + case nodes with INVOLVED edges", () => {
  const rows = projectEntities([
    mk("upi", "x@bank", [
      { caseNumber: "GRS-A", confidence: "HIGH" },
      { caseNumber: "GRS-B", confidence: "MEDIUM" },
    ]),
  ]);
  const slice = buildGraphSlice(rows, { coOccurMode: false });
  const entityId = entityNodeId({ type: "upi", value: "x@bank" });
  assert.ok(slice.nodes.find((n) => n.id === entityId && n.type === "Entity"));
  assert.ok(slice.nodes.find((n) => n.id === "GRS-A" && n.type === "Case"));
  assert.ok(slice.nodes.find((n) => n.id === "GRS-B" && n.type === "Case"));
  const involvedEdges = slice.links.filter((l) => l.relationship === "INVOLVED");
  assert.equal(involvedEdges.length, 2);
});

test("buildGraphSlice co-occurrence connects entities that share a case", () => {
  const rows = projectEntities([
    mk("upi", "a@bank", [{ caseNumber: "GRS-X", confidence: "HIGH" }]),
    mk("phone", "9000000001", [{ caseNumber: "GRS-X", confidence: "HIGH" }]),
    mk("domain", "fake.test", [{ caseNumber: "GRS-Y", confidence: "HIGH" }]),
  ]);
  const slice = buildGraphSlice(rows, { coOccurMode: true });
  const coEdges = slice.links.filter((l) => l.relationship === "CO_OCCURS");
  // a@bank and 9000000001 share GRS-X -> one CO_OCCURS edge.
  // fake.test alone in GRS-Y -> no extra co-occur edges.
  assert.equal(coEdges.length, 1);
});

test("buildGraphSlice stats roll up correctly", () => {
  const rows = projectEntities([
    mk("upi", "a@bank", [
      { caseNumber: "C1", confidence: "VERIFIED", incidentDate: new Date("2026-03-01").toISOString() },
      { caseNumber: "C2", confidence: "HIGH", incidentDate: new Date("2026-04-15").toISOString() },
      { caseNumber: "C3", confidence: "HIGH", lossInr: 200000, caseSeverity: "high" },
    ]),
  ]);
  const slice = buildGraphSlice(rows);
  assert.equal(slice.stats.totalEntities, 1);
  assert.equal(slice.stats.totalCases, 3);
  assert.ok(slice.stats.highRiskEntities >= 0);
  assert.ok(slice.stats.earliestIncident);
  assert.ok(slice.stats.latestIncident);
});

test("buildGraphSlice respects nodeLimit", () => {
  const rows = projectEntities(
    Array.from({ length: 50 }, (_, i) =>
      mk("phone", `+91${String(i).padStart(10, "9")}`, [
        { caseNumber: `C-${i}-a` },
        { caseNumber: `C-${i}-b` },
      ]),
    ),
  );
  const slice = buildGraphSlice(rows, { nodeLimit: 10 });
  const entityNodes = slice.nodes.filter((n) => n.type === "Entity");
  assert.equal(entityNodes.length, 10);
});

test("entityNodeId normalises to lowercase and includes type", () => {
  assert.equal(entityNodeId({ type: "upi", value: "ABC@OkSBI" }), "upi:abc@oksbi");
});
