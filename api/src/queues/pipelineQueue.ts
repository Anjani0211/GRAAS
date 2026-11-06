import Bull, { type Queue } from "bull";
import { config } from "../config";
import { redisClient } from "../utils/redisClient";
import { logger } from "../utils/logger";

export interface PipelineJobData {
  caseId: string;
  triggeredBy: string;
  priority: "URGENT" | "NORMAL" | "BULK";
}

const PRIORITY_MAP: Record<PipelineJobData["priority"], number> = { URGENT: 1, NORMAL: 5, BULK: 10 };

let queue: Queue<PipelineJobData> | null = null;

export function getPipelineQueue(): Queue<PipelineJobData> | null {
  return queue;
}

export function initPipelineQueue(): void {
  if (!redisClient.isAvailable()) {
    logger.warn("[Queue] Bull queue disabled — Redis unavailable");
    return;
  }
  queue = new Bull<PipelineJobData>("osint-pipeline", {
    redis: {
      host: config.redisHost,
      port: config.redisPort,
      password: config.redisPassword,
    },
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: 50,
      removeOnFail: 100,
    },
  });
  queue.on("error", (err: Error) => logger.error({ err }, "[Queue] Bull error"));
  queue.on("failed", (job, err: Error) =>
    logger.error({ jobId: job?.id, caseId: job?.data?.caseId, err }, "[Queue] Job failed"),
  );
  logger.info("[Queue] Bull pipeline queue initialised");
}

export async function enqueuePipelineJob(data: PipelineJobData): Promise<string | null> {
  if (!queue) return null;
  const job = await queue.add(data, { priority: PRIORITY_MAP[data.priority] });
  return String(job.id);
}

export function derivePriority(lossInr: number): PipelineJobData["priority"] {
  if (lossInr >= 100_000) return "URGENT";
  if (lossInr >= 10_000) return "NORMAL";
  return "BULK";
}
