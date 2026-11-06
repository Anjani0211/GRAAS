/**
 * End-to-end pipeline test: seed case → run all 5 stages → export GRASS investigation report.
 *
 * Usage (from api/):
 *   npx tsx scripts/e2ePipelineReport.ts
 *   npx tsx scripts/e2ePipelineReport.ts --case GRS-2026-00001
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { connectDatabase } from "../src/config/database";
import { graphDB } from "../src/services/graphDB";
import { redisClient } from "../src/utils/redisClient";
import { Case, type ICase } from "../src/models";
import {
  ensureInvestigation,
  runInvestigation,
  type RunEvent,
} from "../src/services/osintPipeline";
import { buildReport, loadAgentReportAppendix } from "../src/services/reportBuilder";
import { generateDocx, investigationReportFilename } from "../src/services/docxService";
import { generatePdf } from "../src/services/pdfService";
import { closeBrowser } from "../src/services/pdfService";

const CASE_NUMBER = process.argv.includes("--case")
  ? process.argv[process.argv.indexOf("--case") + 1]!
  : "GRS-2026-00001";

const OUT_DIR = path.resolve(__dirname, "../../outputs");

const SAMPLE = {
  victimName: "Mr. Tridev Singh Bartwal",
  victimEmail: "tridev.bartwal@example.com",
  victimPhone: "+919876543210",
  category: "financial_fraud" as const,
  monetaryLoss: 99488.08,
  state: "Jharkhand",
  district: "Deoghar",
  incidentDate: new Date("2026-02-20"),
  description: [
    "Fraudulent UPI Collect Request via RCS/SMS impersonating Reliance Retail Limited and YES Bank.",
    "Victim approved a collect request believing it was legitimate banking communication.",
    "Debit of ₹99,488.08 from Punjab National Bank via RRN 641754933097 on 2026-02-20.",
    "Settlement routed through Paytm (One 97 Communications) to Axis Bank IFSC UTIBOCCH274, Deoghar.",
    "Fraudster phone: 08073757658. YES Bank CMS reference: N202526017013106.",
    "Merchant name shown: RELIANCE RETAIL LIMITED (suspected impersonation).",
  ].join(" "),
};

function emitLog(event: RunEvent): void {
  const t = event.type;
  if (t === "stage_started") console.log(`  ▶ ${event.stage}`);
  else if (t === "stage_completed") console.log(`  ✓ ${event.stage}`);
  else if (t === "stage_failed") console.log(`  ✗ ${event.stage}: ${event.message}`);
  else if (t === "stage_log") console.log(`    [${event.stage}] ${event.message}`);
  else if (t === "done") console.log(`  ✅ Pipeline done (run ${event.runId})`);
  else if (t === "error") console.log(`  ❌ ${event.message}`);
}

async function upsertTestCase(): Promise<ICase> {
  let doc = await Case.findOne({ caseNumber: CASE_NUMBER });
  if (!doc) {
    doc = await Case.create({
      caseNumber: CASE_NUMBER,
      ...SAMPLE,
      status: "triaged",
      evidenceFiles: [],
    });
    console.log(`Created case ${CASE_NUMBER}`);
  } else {
    Object.assign(doc, SAMPLE);
    doc.status = "triaged";
    console.log(`Updated case ${CASE_NUMBER}`);
  }

  const inv = ensureInvestigation(doc);
  const evidenceId = uuidv4();
  const complaintText = SAMPLE.description;
  inv.evidenceItems = [
    {
      id: evidenceId,
      fileName: "complaint_narrative.txt",
      fileType: "text/plain",
      ocrText: complaintText,
      analystNotes: "E2E seed — primary complaint narrative",
      createdAt: new Date(),
    },
    {
      id: uuidv4(),
      fileName: "yes_bank_cms_summary.txt",
      fileType: "text/plain",
      ocrText:
        "YES Bank CMS N202526017013106 documents settlement to UTIBOCCH274 Axis Bank Deoghar. RRN 641754933097. Amount INR 99488.08.",
      analystNotes: "E2E seed — payment trail",
      createdAt: new Date(),
    },
  ];
  inv.phase = "evidence";
  inv.lastRunStatus = "idle";
  await doc.save();
  return doc;
}

async function checkLlm(): Promise<void> {
  const base = process.env.LOCAL_LLM_BASE_URL || "http://127.0.0.1:8080/v1";
  const healthUrl = base.replace(/\/v1\/?$/, "") + "/health";
  try {
    const res = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      console.warn(`⚠ LLM health ${healthUrl} → ${res.status} (pipeline may use fallbacks until model loads)`);
    } else {
      console.log(`✓ LLM healthy at ${healthUrl}`);
    }
  } catch (e) {
    console.warn(`⚠ LLM not reachable (${healthUrl}): ${e instanceof Error ? e.message : e}`);
  }
}

async function main(): Promise<void> {
  console.log("\n═══ GRASS E2E Pipeline + Final Report ═══\n");
  await checkLlm();

  await connectDatabase();
  try {
    await redisClient.connect();
  } catch {
    console.warn("⚠ Redis unavailable — continuing (direct pipeline only)");
  }
  await graphDB.connect().catch(() => console.warn("⚠ Neo4j unavailable — correlation may be limited"));

  const caseDoc = await upsertTestCase();

  console.log("\nRunning investigation pipeline (stages 1–5)…\n");
  const inv = await runInvestigation(caseDoc, { analystId: "e2e-script" }, emitLog);

  console.log(`\nPipeline status: ${inv.lastRunStatus}`);
  console.log(`Entities: ${inv.entities?.length ?? 0}`);
  console.log(`Enrichments: ${inv.enrichments?.length ?? 0}`);
  console.log(`Clusters: ${inv.clusters?.length ?? 0}`);

  const refreshed = await Case.findOne({ caseNumber: CASE_NUMBER });
  if (!refreshed) throw new Error("Case missing after pipeline");

  const report = await buildReport(refreshed, "BADGE-E2E-001", "GRASS E2E Analyst", {
    redacted: false,
  });
  const appendix = await loadAgentReportAppendix(refreshed);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const docxPath = path.join(OUT_DIR, investigationReportFilename(CASE_NUMBER, "docx"));
  fs.writeFileSync(docxPath, await generateDocx(report, appendix));

  const pdfPath = path.join(OUT_DIR, investigationReportFilename(CASE_NUMBER, "pdf"));
  fs.writeFileSync(pdfPath, await generatePdf(report));

  await closeBrowser();
  await mongoose.disconnect();
  await redisClient.close().catch(() => undefined);

  console.log("\n═══ Export complete (DOCX + PDF only) ═══");
  console.log(`  DOCX : ${docxPath}`);
  console.log(`  PDF  : ${pdfPath}\n`);
}

main().catch((err) => {
  console.error("E2E failed:", err);
  process.exit(1);
});
