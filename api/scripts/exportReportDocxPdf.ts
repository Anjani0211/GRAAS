/**
 * Export DOCX + PDF only from an existing completed investigation (no pipeline re-run).
 *
 *   npx tsx scripts/exportReportDocxPdf.ts
 *   npx tsx scripts/exportReportDocxPdf.ts --case GRS-2026-00001
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { connectDatabase } from "../src/config/database";
import { Case } from "../src/models";
import { buildReport, loadAgentReportAppendix } from "../src/services/reportBuilder";
import { generateDocx, investigationReportFilename } from "../src/services/docxService";
import { generatePdf, closeBrowser } from "../src/services/pdfService";

const CASE_NUMBER = process.argv.includes("--case")
  ? process.argv[process.argv.indexOf("--case") + 1]!
  : "GRS-2026-00001";

const OUT_DIR = path.resolve(__dirname, "../../outputs");

async function main(): Promise<void> {
  await connectDatabase();
  const doc = await Case.findOne({ caseNumber: CASE_NUMBER });
  if (!doc?.osintInvestigation) {
    throw new Error(`Case ${CASE_NUMBER} not found or investigation not run`);
  }

  const report = await buildReport(doc, "BADGE-EXPORT-001", "GRASS Export Analyst", { redacted: false });
  const appendix = await loadAgentReportAppendix(doc);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const docxPath = path.join(OUT_DIR, investigationReportFilename(CASE_NUMBER, "docx"));
  const pdfPath = path.join(OUT_DIR, investigationReportFilename(CASE_NUMBER, "pdf"));

  fs.writeFileSync(docxPath, await generateDocx(report, appendix));
  fs.writeFileSync(pdfPath, await generatePdf(report));
  await closeBrowser();
  await mongoose.disconnect();

  console.log(docxPath);
  console.log(pdfPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
