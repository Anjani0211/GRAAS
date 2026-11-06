/** Shared Mongoose toJSON id transform — keeps API payloads consistent. */
export function idJsonTransform(
  _doc: unknown,
  ret: Record<string, unknown>,
): Record<string, unknown> {
  ret.id = ret._id;
  delete ret._id;
  delete ret.__v;
  return ret;
}

/** Case.osintInvestigation.stageStates status values. */
export const STAGE_STATUSES = ["PENDING", "RUNNING", "COMPLETE", "FAILED"] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];

/** PipelineRun.stageResults may also record skipped stages. */
export const PIPELINE_STAGE_STATUSES = ["PENDING", "RUNNING", "COMPLETE", "FAILED", "SKIPPED"] as const;
export type PipelineStageStatus = (typeof PIPELINE_STAGE_STATUSES)[number];
