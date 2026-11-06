import type { Job } from "bull";
import { getPipelineQueue } from "../queues/pipelineQueue";
import { runInvestigation, type RunEvent, type RunStage } from "../services/osintPipeline";
import { Case } from "../models";
import { logger } from "../utils/logger";

const STAGE_PROGRESS: Record<RunStage, number> = {
  intake: 10,
  parse: 30,
  osint: 70,
  correlation: 85,
  report: 100,
};

function findCaseByParam(id: string) {
  const isObjectId = /^[a-f\d]{24}$/i.test(id);
  return isObjectId ? Case.findById(id) : Case.findOne({ caseNumber: id });
}

export function startPipelineWorker(): void {
  const q = getPipelineQueue();
  if (!q) {
    logger.warn("[Worker] Pipeline worker not started — queue unavailable");
    return;
  }

  void q.process(3, async (job: Job<{ caseId: string; triggeredBy: string; priority: string }>) => {
    const { caseId, triggeredBy } = job.data;
    logger.info({ jobId: job.id, caseId }, "[Worker] Processing pipeline job");

    const doc = await findCaseByParam(caseId);
    if (!doc) {
      throw new Error(`Case not found: ${caseId}`);
    }
    if (doc.status === "triaged" || doc.status === "submitted") {
      doc.status = "osint";
      await doc.save();
    }

    const emit = (event: RunEvent): void => {
      if (event.type === "stage_completed" && "stage" in event) {
        void job.progress(STAGE_PROGRESS[event.stage] ?? 50);
      }
    };

    await runInvestigation(doc, { analystId: triggeredBy }, emit);
    logger.info({ jobId: job.id, caseId }, "[Worker] Pipeline job complete");
  });

  logger.info("[Worker] Pipeline worker started (concurrency: 3)");
}
