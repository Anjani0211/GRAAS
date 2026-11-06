import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { GRASSReport } from "../types/grassReport";

export type AgentReportAppendix = {
  classificationType?: string;
  classificationConfidence?: number;
  indicators?: string[];
  strategy?: string;
  exitReason?: string;
  exitStatement?: string;
  totalToolCalls?: number;
  toolSummaries?: Array<{ toolName: string; callId: string; confidence: string }>;
};

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function h1(text: string): Paragraph {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 280, after: 120 } });
}

function h2(text: string): Paragraph {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 80 } });
}

function body(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: text || "—", size: 22 })],
    spacing: { after: 100 },
  });
}

function tableHeaderRow(cells: string[]): TableRow {
  return new TableRow({
    children: cells.map(
      (c) =>
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: c, bold: true, size: 20 })] })],
          width: { size: Math.floor(9000 / cells.length), type: WidthType.DXA },
        }),
    ),
  });
}

function tableDataRow(cells: string[]): TableRow {
  return new TableRow({
    children: cells.map(
      (c) =>
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: (c || "—").slice(0, 2000), size: 20 })] })],
        }),
    ),
  });
}

/** Filename pattern: GRASS_Investigation_Report_GRS-2026-XXXXX.docx */
export function investigationReportFilename(caseId: string, ext: "docx" | "pdf" | "json", redacted = false): string {
  const suffix = redacted ? "_redacted" : "";
  return `GRASS_Investigation_Report_${caseId}${suffix}.${ext}`;
}

/**
 * Renders validated GRASSReport/1.0 as a Word document (law-enforcement package layout).
 */
export async function generateDocx(
  report: GRASSReport,
  appendix?: AgentReportAppendix | null,
): Promise<Buffer> {
  const blocks: (Paragraph | Table)[] = [];

  blocks.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: "GRASS Investigation Report", bold: true, size: 36 }),
      ],
      spacing: { after: 80 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: "Government Reporting & Analytics for Cybercrime — CONFIDENTIAL",
          italics: true,
          size: 22,
          color: "444444",
        }),
      ],
      spacing: { after: 200 },
    }),
  );

  blocks.push(h2("Case identification"));
  blocks.push(body(`Case ID: ${report.case_id}`));
  blocks.push(body(`Generated: ${new Date(report.generated_at).toLocaleString("en-IN")}`));
  blocks.push(body(`Analyst: ${report.analyst_name} (Badge ${report.analyst_id})`));
  blocks.push(body(`Scam category: ${report.scam_category.replace(/_/g, " ")}`));
  blocks.push(body(`Total loss (INR): ₹${report.total_loss_inr.toLocaleString("en-IN")}`));
  blocks.push(
    body(
      `Incident window: ${new Date(report.incident_date_range.start).toLocaleString("en-IN")} — ${new Date(report.incident_date_range.end).toLocaleString("en-IN")}`,
    ),
  );
  if (report.is_redacted) {
    blocks.push(
      new Paragraph({
        children: [new TextRun({ text: "REDACTED EXPORT — limited distribution", bold: true, color: "AA0000" })],
      }),
    );
  }

  blocks.push(h1("1. Executive summary"));
  blocks.push(body(report.executive_summary));

  if (appendix?.classificationType) {
    blocks.push(h1("2. AI case classification"));
    blocks.push(
      body(
        `Primary type: ${appendix.classificationType.replace(/_/g, " ")}` +
          (appendix.classificationConfidence != null
            ? ` (confidence ${Math.round(appendix.classificationConfidence * 100)}%)`
            : ""),
      ),
    );
    if (appendix.strategy) blocks.push(body(`Investigation strategy: ${appendix.strategy}`));
    if (appendix.indicators?.length) {
      blocks.push(h2("Classification indicators"));
      for (const ind of appendix.indicators.slice(0, 20)) {
        blocks.push(body(`• ${ind}`));
      }
    }
  }

  blocks.push(h1(appendix?.classificationType ? "3. Victim statement" : "2. Victim statement"));
  blocks.push(body(report.victim_statement));

  const manifestSection = appendix?.classificationType ? "4" : "3";
  blocks.push(h1(`${manifestSection}. Evidence hash manifest (BSA §63)`));
  const manifestRows = [
    tableHeaderRow(["Filename", "SHA-256", "Size (bytes)", "Ingested"]),
    ...report.evidence_manifest.map((h) =>
      tableDataRow([
        h.fileName,
        h.sha256,
        String(h.fileSizeBytes),
        new Date(h.ingestedAt).toLocaleString("en-IN"),
      ]),
    ),
  ];
  blocks.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: manifestRows,
    }),
  );

  const entitySection = appendix?.classificationType ? "5" : "4";
  blocks.push(h1(`${entitySection}. Indicators & OSINT findings`));
  const entityRows = [
    tableHeaderRow(["Value", "Type", "Source", "Confidence", "OSINT summary"]),
    ...report.extracted_entities.map((e) =>
      tableDataRow([
        e.value,
        e.type,
        e.source_file,
        e.confidence,
        e.osint_summary.slice(0, 500),
      ]),
    ),
  ];
  blocks.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: entityRows }));

  if (report.invalid_entities.length > 0) {
    blocks.push(h2("Rejected / invalid entities"));
    const invalidRows = [
      tableHeaderRow(["Value", "Type", "Reason"]),
      ...report.invalid_entities.map((e) => tableDataRow([e.value, e.type, e.reason])),
    ];
    blocks.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: invalidRows }));
  }

  const timelineSection = appendix?.classificationType ? "6" : "5";
  blocks.push(h1(`${timelineSection}. Investigation timeline`));
  const timelineRows = [
    tableHeaderRow(["When", "Event", "Reference"]),
    ...report.timeline.map((t) =>
      tableDataRow([
        new Date(t.timestamp).toLocaleString("en-IN"),
        t.description,
        t.evidence_reference ?? "",
      ]),
    ),
  ];
  blocks.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: timelineRows }));

  const corrSection = appendix?.classificationType ? "7" : "6";
  blocks.push(h1(`${corrSection}. Correlation & cluster alerts`));
  if ((report.cluster_alerts?.length ?? 0) > 0) {
    const clusterRows = [
      tableHeaderRow(["Type", "Entity / summary", "Linked cases", "Severity"]),
      ...(report.cluster_alerts ?? []).map((c) =>
        tableDataRow([
          c.type,
          c.entityValue,
          c.linkedCaseIds.join(", "),
          c.severity,
        ]),
      ),
    ];
    blocks.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: clusterRows }));
  } else {
    blocks.push(body("No cross-case cluster alerts recorded."));
  }

  blocks.push(h1(`${corrSection === "7" ? "8" : "7"}. Modus operandi`));
  blocks.push(body(report.scam_category.replace(/_/g, " ")));
  if (report.modus_operandi_detail) blocks.push(body(report.modus_operandi_detail));

  if (appendix && (appendix.exitStatement || (appendix.toolSummaries?.length ?? 0) > 0)) {
    blocks.push(h1("Agentic investigation summary"));
    if (appendix.exitReason) blocks.push(body(`Exit reason: ${appendix.exitReason}`));
    if (appendix.totalToolCalls != null) blocks.push(body(`Total tool calls: ${appendix.totalToolCalls}`));
    if (appendix.exitStatement) blocks.push(body(appendix.exitStatement));
    if (appendix.toolSummaries?.length) {
      blocks.push(h2("Tool execution log"));
      const toolRows = [
        tableHeaderRow(["Tool", "Call ID", "Confidence"]),
        ...appendix.toolSummaries.slice(0, 50).map((t) =>
          tableDataRow([t.toolName, t.callId, t.confidence]),
        ),
      ];
      blocks.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: toolRows }));
    }
  }

  blocks.push(h1("Actionable requests"));
  const actionRows = [
    tableHeaderRow(["Priority", "Action", "Target", "Justification"]),
    ...report.actionable_requests.map((a) =>
      tableDataRow([a.priority, a.action, a.targetEntity, a.justification]),
    ),
  ];
  blocks.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: actionRows }));

  if (!report.is_redacted && (report.legal_drafts?.length ?? 0) > 0) {
    blocks.push(h1("Legal draft fragments"));
    for (const draft of report.legal_drafts ?? []) {
      blocks.push(h2(`${draft.section} — ${draft.template}`));
      blocks.push(body(stripHtml(draft.content)));
    }
  }

  blocks.push(h1("Analyst certification"));
  blocks.push(
    body(
      "I certify that this GRASSReport/1.0 package was generated under controlled HITL review and is suitable for supervisory review before law-enforcement submission.",
    ),
  );
  blocks.push(body(`Analyst name: ${report.analyst_name}`));
  blocks.push(body(`Badge ID: ${report.analyst_id}`));
  blocks.push(body(`Signature hash (SHA-256): ${report.analyst_signature_hash}`));

  const doc = new Document({
    sections: [{ properties: {}, children: blocks }],
  });

  return Packer.toBuffer(doc);
}
