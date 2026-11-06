import puppeteer, { type Browser } from "puppeteer";
import Mustache from "mustache";
import fs from "fs";
import path from "path";
import type { GRASSReport } from "../types/grassReport";
import { logger } from "../utils/logger";

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (browser) {
    try {
      await browser.version();
      return browser;
    } catch {
      browser = null;
    }
  }
  browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--font-render-hinting=none",
    ],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  });
  logger.info("[PDF] Puppeteer browser launched");
  return browser;
}

function loadTemplate(name: string): string {
  const p = path.join(__dirname, "..", "templates", "report", name);
  return fs.readFileSync(p, "utf-8");
}

function populateTemplate(report: GRASSReport): string {
  const template = loadTemplate(report.is_redacted ? "redacted.html" : "full.html");
  const view = {
    caseId: report.case_id,
    generatedAt: new Date(report.generated_at).toLocaleString("en-IN"),
    analystName: report.analyst_name,
    analystId: report.analyst_id,
    analystSigHash: report.analyst_signature_hash,
    scamCategory: report.scam_category.replace(/_/g, " "),
    totalLoss: report.total_loss_inr.toLocaleString("en-IN"),
    executiveSummary: report.executive_summary,
    victimStatement: report.victim_statement,
    evidenceFiles: report.evidence_manifest.map((h) => ({
      ...h,
      ingestedAtDisplay: new Date(h.ingestedAt).toLocaleString("en-IN"),
    })),
    entities: report.extracted_entities,
    invalidEntities: report.invalid_entities,
    timeline: report.timeline.map((t) => ({
      ...t,
      tsDisplay: new Date(t.timestamp).toLocaleString("en-IN"),
    })),
    clusters: (report.cluster_alerts ?? []).map((c) => ({
      ...c,
      severityClass: c.severity === "HIGH" ? "sev-high" : "sev-med",
    })),
    hasClusters: (report.cluster_alerts?.length ?? 0) > 0,
    hasInvalidEntities: report.invalid_entities.length > 0,
    recommendations: report.actionable_requests,
    legalDrafts: report.legal_drafts ?? [],
    graphImage: report.graph_image_base64
      ? `data:image/png;base64,${report.graph_image_base64}`
      : null,
    isRedacted: report.is_redacted,
    hasModusDetail: !!(report.modus_operandi_detail && report.modus_operandi_detail.trim()),
    modusOperandiDetail: report.modus_operandi_detail ?? "",
    incidentStart: new Date(report.incident_date_range.start).toLocaleString("en-IN"),
    incidentEnd: new Date(report.incident_date_range.end).toLocaleString("en-IN"),
  };
  return Mustache.render(template, view);
}

/**
 * Renders validated GRASSReport to A4 PDF. Call only after `GRASSReportZ.parse`.
 */
export async function generatePdf(report: GRASSReport): Promise<Buffer> {
  const html = populateTemplate(report);
  const b = await getBrowser();
  const page = await b.newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
      displayHeaderFooter: true,
      headerTemplate: `<div style="font-size:8px;width:100%;text-align:center;color:#666;">
        GRASSReport/1.0 — ${report.case_id} — CONFIDENTIAL</div>`,
      footerTemplate: `<div style="font-size:8px;width:100%;text-align:right;padding-right:15mm;color:#666;">
        Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

export async function closeBrowser(): Promise<void> {
  await browser?.close();
  browser = null;
}
