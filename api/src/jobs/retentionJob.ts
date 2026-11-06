import cron from "node-cron";
import { Case, PipelineRun, AuditLog, RetentionAudit } from "../models";
import { storageService } from "../services/storageService";
import { RETENTION } from "../config/retention";
import { logger } from "../utils/logger";

export interface RetentionCycleError {
  caseId?: string;
  error: string;
}

export interface RetentionCycleResult {
  startedAt: Date;
  completedAt?: Date;
  evidenceDeleted: number;
  reportsDeleted: number;
  artifactsDeleted: number;
  auditsPurged: number;
  runsPurged: number;
  skippedActiveProsecution: number;
  skippedErasurePending: number;
  errors: RetentionCycleError[];
}

export async function logRetentionEvent(params: {
  caseId?: string;
  action:
    | "EVIDENCE_DELETED"
    | "REPORT_DELETED"
    | "ARTIFACTS_DELETED"
    | "SKIPPED_ACTIVE_PROSECUTION"
    | "SKIPPED_ERASURE_PENDING"
    | "CYCLE_COMPLETE"
    | "ERASURE_COMPLETED"
    | "ERASURE_DENIED";
  reason?: string;
  summary?: Record<string, unknown>;
  timestamp?: Date;
}): Promise<void> {
  await RetentionAudit.create({
    caseId: params.caseId,
    action: params.action,
    reason: params.reason,
    summary: params.summary,
    timestamp: params.timestamp ?? new Date(),
  });
}

export function scheduleRetentionJob(): void {
  cron.schedule(
    "0 2 * * *",
    () => {
      void runRetentionCycle();
    },
    { timezone: "UTC" },
  );
  logger.info("[Retention] Daily job scheduled at 02:00 UTC");
}

export async function getRetentionPreview(): Promise<{
  eligibleEvidenceCases: number;
  eligibleReportCases: number;
  protectedByProsecution: number;
  pendingErasureCases: number;
}> {
  const now = Date.now();
  const evidenceCutoff = new Date(now - RETENTION.EVIDENCE_FILES_MS);
  const reportCutoff = new Date(now - RETENTION.FINAL_REPORTS_MS);

  const [
    eligibleEvidenceCases,
    eligibleReportCases,
    protectedByProsecution,
    pendingErasureCases,
  ] = await Promise.all([
    Case.countDocuments({
      closedAt: { $lt: evidenceCutoff },
      activeProsecution: { $ne: true },
      erasureRequestStatus: { $ne: "PENDING" },
    }),
    Case.countDocuments({
      closedAt: { $lt: reportCutoff },
      activeProsecution: { $ne: true },
    }),
    Case.countDocuments({ activeProsecution: true }),
    Case.countDocuments({ erasureRequestStatus: "PENDING" }),
  ]);

  return {
    eligibleEvidenceCases,
    eligibleReportCases,
    protectedByProsecution,
    pendingErasureCases,
  };
}

export async function runRetentionCycle(): Promise<RetentionCycleResult> {
  logger.info("[Retention] Cycle started");
  const now = Date.now();
  const result: RetentionCycleResult = {
    startedAt: new Date(),
    evidenceDeleted: 0,
    reportsDeleted: 0,
    artifactsDeleted: 0,
    auditsPurged: 0,
    runsPurged: 0,
    skippedActiveProsecution: 0,
    skippedErasurePending: 0,
    errors: [],
  };

  const evidenceCutoff = new Date(now - RETENTION.EVIDENCE_FILES_MS);
  const evidenceCandidates = await Case.find({
    closedAt: { $lt: evidenceCutoff },
  }).select("caseNumber activeProsecution erasureRequestStatus osintInvestigation retentionDeletedAt");

  for (const doc of evidenceCandidates) {
    if (doc.activeProsecution) {
      result.skippedActiveProsecution++;
      await logRetentionEvent({
        caseId: doc.caseNumber,
        action: "SKIPPED_ACTIVE_PROSECUTION",
        reason: "Case has activeProsecution flag",
      });
      continue;
    }
    if (doc.erasureRequestStatus === "PENDING") {
      result.skippedErasurePending++;
      await logRetentionEvent({
        caseId: doc.caseNumber,
        action: "SKIPPED_ERASURE_PENDING",
        reason: "Case has pending erasure request",
      });
      continue;
    }

    try {
      if (doc.retentionDeletedAt) {
        continue;
      }
      const evidenceItems = doc.osintInvestigation?.evidenceItems ?? [];
      for (const item of evidenceItems) {
        if (!item.storageKey) continue;
        try {
          await storageService.deleteObject(item.storageKey);
          result.evidenceDeleted++;
          await logRetentionEvent({
            caseId: doc.caseNumber,
            action: "EVIDENCE_DELETED",
            reason: "RETENTION_POLICY_3YR",
          });
        } catch (err) {
          // Object-lock or missing object are non-fatal to keep job idempotent.
          logger.debug({ err, caseId: doc.caseNumber }, "[Retention] Evidence delete skipped");
        }
      }

      const inv = doc.osintInvestigation;
      if (inv) {
        inv.evidenceItems = [];
        inv.entities = [];
        inv.invalidEntities = [];
        inv.enrichments = [];
        inv.customTools = [];
        inv.reportMarkdown = "[DELETED — retention policy]";
        inv.reportJson = undefined;
        doc.markModified("osintInvestigation");
      }
      doc.retentionDeletedAt = new Date();
      await doc.save();
      result.artifactsDeleted++;
      await logRetentionEvent({
        caseId: doc.caseNumber,
        action: "ARTIFACTS_DELETED",
        reason: "RETENTION_POLICY_3YR",
      });
    } catch (err) {
      result.errors.push({ caseId: doc.caseNumber, error: String(err) });
      logger.error({ err, caseId: doc.caseNumber }, "[Retention] Case processing error");
    }
  }

  const reportCutoff = new Date(now - RETENTION.FINAL_REPORTS_MS);
  const reportCandidates = await Case.find({
    closedAt: { $lt: reportCutoff },
    activeProsecution: { $ne: true },
  }).select("caseNumber");
  for (const doc of reportCandidates) {
    try {
      const reportPath = `reports/${doc.caseNumber}/GRASS_${doc.caseNumber}_Report.pdf`;
      await storageService.deleteObject(reportPath).catch(() => undefined);
      result.reportsDeleted++;
      await logRetentionEvent({
        caseId: doc.caseNumber,
        action: "REPORT_DELETED",
        reason: "RETENTION_POLICY_7YR",
      });
    } catch (err) {
      result.errors.push({ caseId: doc.caseNumber, error: String(err) });
    }
  }

  const auditCutoff = new Date(now - RETENTION.AUDIT_LOGS_MS);
  const auditDeleteRes = await AuditLog.deleteMany({ createdAt: { $lt: auditCutoff } });
  result.auditsPurged = auditDeleteRes.deletedCount ?? 0;

  const runCutoff = new Date(now - RETENTION.INVESTIGATION_ARTIFACTS_MS);
  const runDeleteRes = await PipelineRun.deleteMany({ createdAt: { $lt: runCutoff } });
  result.runsPurged = runDeleteRes.deletedCount ?? 0;

  result.completedAt = new Date();
  logger.info({ result }, "[Retention] Cycle complete");
  await logRetentionEvent({
    action: "CYCLE_COMPLETE",
    summary: result as unknown as Record<string, unknown>,
    timestamp: result.completedAt,
  });
  return result;
}
