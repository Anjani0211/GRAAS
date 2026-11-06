import mongoose, { Schema, Document } from "mongoose";
import {
  idJsonTransform,
  PIPELINE_STAGE_STATUSES,
  type PipelineStageStatus,
} from "./schemaUtils";

export type PipelineRunStatus = "RUNNING" | "COMPLETE" | "FAILED" | "PARTIAL";

export interface IPipelineStageResult {
  stageId: string;
  status: PipelineStageStatus;
  durationMs: number;
  retryCount: number;
  entitiesFound?: number;
  error?: string;
}

export interface IPipelineRun extends Document {
  runId: string;
  /** Case number (e.g. GRS-2026-ABC12) — human-readable, matches Case.caseNumber. */
  caseId: string;
  status: PipelineRunStatus;
  triggeredBy: string;
  startedAt: Date;
  completedAt?: Date;
  stageResults: IPipelineStageResult[];
  totalEntities: number;
  totalEnrichments: number;
  failedAtStage?: string;
  parentRunId?: string;
}

const StageResultSchema = new Schema<IPipelineStageResult>(
  {
    stageId: { type: String, required: true },
    status: { type: String, required: true, enum: PIPELINE_STAGE_STATUSES },
    durationMs: { type: Number, default: 0 },
    retryCount: { type: Number, default: 0 },
    entitiesFound: Number,
    error: String,
  },
  { _id: false },
);

const PipelineRunSchema = new Schema<IPipelineRun>(
  {
    runId: { type: String, required: true, unique: true, index: true },
    caseId: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ["RUNNING", "COMPLETE", "FAILED", "PARTIAL"],
      default: "RUNNING",
    },
    triggeredBy: { type: String, required: true },
    startedAt: { type: Date, default: Date.now },
    completedAt: Date,
    stageResults: { type: [StageResultSchema], default: [] },
    totalEntities: { type: Number, default: 0 },
    totalEnrichments: { type: Number, default: 0 },
    failedAtStage: String,
    parentRunId: { type: String, index: true },
  },
  {
    collection: "pipeline_runs",
    timestamps: { createdAt: true, updatedAt: true },
    toJSON: { transform: idJsonTransform },
  },
);

PipelineRunSchema.index({ caseId: 1, startedAt: -1 });

export const PipelineRun = mongoose.model<IPipelineRun>("PipelineRun", PipelineRunSchema);
