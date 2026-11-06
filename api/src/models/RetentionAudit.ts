import mongoose, { Schema, type Document } from "mongoose";
import { idJsonTransform } from "./schemaUtils";

export type RetentionAuditAction =
  | "EVIDENCE_DELETED"
  | "REPORT_DELETED"
  | "ARTIFACTS_DELETED"
  | "SKIPPED_ACTIVE_PROSECUTION"
  | "SKIPPED_ERASURE_PENDING"
  | "CYCLE_COMPLETE"
  | "ERASURE_COMPLETED"
  | "ERASURE_DENIED";

export interface IRetentionAudit extends Document {
  caseId?: string;
  action: RetentionAuditAction;
  reason?: string;
  summary?: Record<string, unknown>;
  timestamp: Date;
  createdAt: Date;
}

const RetentionAuditSchema = new Schema<IRetentionAudit>(
  {
    caseId: { type: String },
    action: {
      type: String,
      required: true,
      enum: [
        "EVIDENCE_DELETED",
        "REPORT_DELETED",
        "ARTIFACTS_DELETED",
        "SKIPPED_ACTIVE_PROSECUTION",
        "SKIPPED_ERASURE_PENDING",
        "CYCLE_COMPLETE",
        "ERASURE_COMPLETED",
        "ERASURE_DENIED",
      ],
    },
    reason: String,
    summary: { type: Schema.Types.Mixed },
    timestamp: { type: Date, default: Date.now, required: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: { transform: idJsonTransform },
  },
);

RetentionAuditSchema.index({ timestamp: -1 });
RetentionAuditSchema.index({ caseId: 1 });

RetentionAuditSchema.pre("findOneAndUpdate", function forbidUpdate() {
  throw new Error("retention_audit is append-only. Updates are forbidden.");
});
RetentionAuditSchema.pre("updateOne", function forbidUpdate() {
  throw new Error("retention_audit is append-only. Updates are forbidden.");
});
RetentionAuditSchema.pre("updateMany", function forbidUpdate() {
  throw new Error("retention_audit is append-only. Updates are forbidden.");
});
RetentionAuditSchema.pre("replaceOne", function forbidUpdate() {
  throw new Error("retention_audit is append-only. Updates are forbidden.");
});
RetentionAuditSchema.pre("findOneAndDelete", function forbidDelete() {
  throw new Error("retention_audit is append-only. Deletes are forbidden.");
});
RetentionAuditSchema.pre("deleteOne", function forbidDelete() {
  throw new Error("retention_audit is append-only. Deletes are forbidden.");
});
RetentionAuditSchema.pre("deleteMany", function forbidDelete() {
  throw new Error("retention_audit is append-only. Deletes are forbidden.");
});

export const RetentionAudit = mongoose.model<IRetentionAudit>("RetentionAudit", RetentionAuditSchema);
