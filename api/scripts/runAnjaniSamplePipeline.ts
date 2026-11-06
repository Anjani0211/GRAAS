/**
 * Run full OSINT pipeline for case GRS-2026-00001 using Sample Report.pdf
 * as victim-uploaded evidence (user Anjani) + local Gemma 2B.
 *
 * Usage (from api/):
 *   npx tsx scripts/runAnjaniSamplePipeline.ts
 *   npx tsx scripts/runAnjaniSamplePipeline.ts --pdf "../Sample Report .pdf"
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { connectDatabase } from "../src/config/database";
import { graphDB } from "../src/services/graphDB";
import { redisClient } from "../src/utils/redisClient";
import { Case, EvidenceHash, User, type ICase } from "../src/models";
import {
  ensureInvestigation,
  runInvestigation,
  type RunEvent,
} from "../src/services/osintPipeline";
import { buildReport, loadAgentReportAppendix } from "../src/services/reportBuilder";
import { generateDocx, investigationReportFilename } from "../src/services/docxService";
import { generatePdf, closeBrowser } from "../src/services/pdfService";
import { storageService } from "../src/services/storageService";
import { extractTextFromPdfBuffer } from "../src/services/pdfTextService";

const CASE_NUMBER = "GRS-2026-00001";
const ANJANI_EMAIL = "anjani@grass.local";
const ANJANI_PASSWORD = "Anjani@2026";
const ANJANI_NAME = "Anjani Kumar";
const ANJANI_BADGE = "VICTIM-ANJANI-001";

const pdfArg = process.argv.includes("--pdf")
  ? process.argv[process.argv.indexOf("--pdf") + 1]!
  : path.resolve(__dirname, "../../Sample Report .pdf");

const OUT_DIR = path.resolve(__dirname, "../../outputs");

const CASE_META = {
  victimName: "Mr. Tridev Singh Bartwal",
  victimEmail: ANJANI_EMAIL,
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

async function ensureAnjaniUser(): Promise<string> {
  let user = await User.findOne({ email: ANJANI_EMAIL.toLowerCase() });
  if (!user) {
    const password = await bcrypt.hash(ANJANI_PASSWORD, 12);
    user = await User.create({
      email: ANJANI_EMAIL.toLowerCase(),
      password,
      role: "victim",
      name: ANJANI_NAME,
      badgeId: ANJANI_BADGE,
      isActive: true,
    });
    console.log(`Created victim user ${ANJANI_EMAIL}`);
  } else {
    console.log(`Using existing user ${ANJANI_EMAIL} (${user.role})`);
  }
  return user._id.toString();
}

async function attachSamplePdf(caseDoc: ICase, pdfPath: string): Promise<void> {
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`Sample PDF not found: ${pdfPath}`);
  }
  const buffer = fs.readFileSync(pdfPath);
  const fileName = path.basename(pdfPath);
  const mimeType = "application/pdf";

  const pdfText = await extractTextFromPdfBuffer(buffer);
  const ocrText = pdfText.ok ? pdfText.text : "";
  console.log(
    `PDF text: ${ocrText.length} chars${pdfText.pages ? ` (${pdfText.pages} pages)` : ""}${pdfText.ok ? "" : " — extraction failed"}`,
  );
  console.log(`Form description: ${CASE_META.description.length} chars`);

  const stored = await storageService.upload({
    caseId: caseDoc.caseNumber,
    fileName,
    mimeType,
    buffer,
  });

  let evidenceHashDoc = await EvidenceHash.findOne({
    caseId: caseDoc.caseNumber,
    sha256: stored.sha256,
  });
  if (!evidenceHashDoc) {
    try {
      evidenceHashDoc = await EvidenceHash.create({
        caseId: caseDoc.caseNumber,
        fileName,
        originalName: fileName,
        minioPath: stored.minioPath,
        sha256: stored.sha256,
        fileSizeBytes: stored.fileSizeBytes,
        mimeType: stored.mimeType,
        ingestedAt: new Date(),
        ingestedByIpHash: "script-anjani-sample",
        isLocked: storageService.isAvailable(),
      });
    } catch (err: unknown) {
      const code = (err as { code?: number })?.code;
      if (code === 11000) {
        evidenceHashDoc = await EvidenceHash.findOne({
          caseId: caseDoc.caseNumber,
          sha256: stored.sha256,
        });
      } else {
        throw err;
      }
    }
  }
  if (!evidenceHashDoc) throw new Error("Failed to resolve evidence hash record");

  const inv = ensureInvestigation(caseDoc);
  const itemId = uuidv4();
  inv.evidenceItems = [
    {
      id: itemId,
      fileName,
      fileType: mimeType,
      ocrText,
      analystNotes: "Uploaded by victim Anjani — Sample Report.pdf",
      createdAt: new Date(),
      storageKey: stored.minioPath,
      evidenceHashId: evidenceHashDoc.id as string,
      sha256: stored.sha256,
    },
  ];
  inv.hashManifest = [
    {
      evidenceId: itemId,
      fileName,
      fileType: mimeType,
      sha256: stored.sha256,
      sizeBytes: stored.fileSizeBytes,
      ingestedAt: new Date(),
    },
  ];
  inv.phase = "evidence";
  inv.lastRunStatus = "idle";
  await caseDoc.save();
  console.log(`Attached evidence ${fileName} (${(buffer.length / 1024).toFixed(0)} KB)`);
}

async function upsertCase(victimUserId: string): Promise<ICase> {
  let doc = await Case.findOne({ caseNumber: CASE_NUMBER });
  if (!doc) {
    doc = await Case.create({
      caseNumber: CASE_NUMBER,
      ...CASE_META,
      victimUserId: new mongoose.Types.ObjectId(victimUserId),
      status: "triaged",
      evidenceFiles: [],
    });
    console.log(`Created case ${CASE_NUMBER}`);
  } else {
    Object.assign(doc, CASE_META);
    doc.victimUserId = new mongoose.Types.ObjectId(victimUserId);
    doc.status = "triaged";
    console.log(`Updated case ${CASE_NUMBER}`);
  }
  await doc.save();
  return doc;
}

async function checkLlm(): Promise<void> {
  const base = process.env.LOCAL_LLM_BASE_URL || "http://127.0.0.1:8080/v1";
  const model = process.env.LOCAL_LLM_MODEL || "(default)";
  const root = base.replace(/\/v1\/?$/, "");
  const healthUrl = root.includes(":11434") ? `${root}/api/tags` : `${root}/health`;
  try {
    const res = await fetch(healthUrl, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.warn(`⚠ LLM ${healthUrl} → HTTP ${res.status}`);
    } else {
      console.log(`✓ Local LLM healthy (${model}) at ${base}`);
    }
  } catch (e) {
    console.warn(`⚠ LLM not reachable: ${e instanceof Error ? e.message : e}`);
    console.warn("  Start Ollama or: npm run llm:server");
  }
}

async function main(): Promise<void> {
  console.log("\n═══ GRASS — Anjani Sample Report Pipeline ═══\n");
  console.log(`PDF: ${pdfArg}`);
  console.log(`Model: ${process.env.LOCAL_LLM_MODEL || "gemma2b"} @ ${process.env.LOCAL_LLM_BASE_URL || "http://127.0.0.1:8080/v1"}\n`);

  await checkLlm();
  await connectDatabase();
  try {
    await redisClient.connect();
  } catch {
    console.warn("⚠ Redis unavailable — continuing");
  }
  await graphDB.connect().catch(() => console.warn("⚠ Neo4j unavailable — correlation uses MongoDB fallback"));

  const victimUserId = await ensureAnjaniUser();
  const caseDoc = await upsertCase(victimUserId);
  await attachSamplePdf(caseDoc, pdfArg);

  console.log("\nRunning investigation pipeline (intake → parse → osint → correlation → report)…\n");
  const inv = await runInvestigation(caseDoc, { analystId: victimUserId }, emitLog);

  console.log(`\nPipeline status: ${inv.lastRunStatus}`);
  console.log(`Entities: ${inv.entities?.length ?? 0}`);
  console.log(`Enrichments: ${inv.enrichments?.length ?? 0}`);
  console.log(`Parser: ${inv.parserUsed ?? "—"}`);
  console.log(`Summary: ${(inv.geminiSummary ?? "").slice(0, 200)}…`);

  const refreshed = await Case.findOne({ caseNumber: CASE_NUMBER });
  if (!refreshed) throw new Error("Case missing after pipeline");

  const report = await buildReport(refreshed, ANJANI_BADGE, ANJANI_NAME, { redacted: false });
  const appendix = await loadAgentReportAppendix(refreshed);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const docxPath = path.join(OUT_DIR, investigationReportFilename(CASE_NUMBER, "docx"));
  const pdfOutPath = path.join(OUT_DIR, investigationReportFilename(CASE_NUMBER, "pdf"));
  fs.writeFileSync(docxPath, await generateDocx(report, appendix));
  fs.writeFileSync(pdfOutPath, await generatePdf(report));

  await closeBrowser();
  await mongoose.disconnect();
  await redisClient.close().catch(() => undefined);
  await graphDB.close().catch(() => undefined);

  console.log("\n═══ Reports exported ═══");
  console.log(`  DOCX : ${docxPath}`);
  console.log(`  PDF  : ${pdfOutPath}`);
  console.log(`\nVictim login: ${ANJANI_EMAIL} / ${ANJANI_PASSWORD}\n`);
}

main().catch((err) => {
  console.error("Pipeline failed:", err);
  process.exit(1);
});
