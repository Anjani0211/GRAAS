import mongoose, { Schema, Document } from "mongoose";
import { idJsonTransform } from "./schemaUtils";

export type AuditAction =
  | "LOGIN"
  | "LOGOUT"
  | "LOGIN_FAILED"
  | "LOGIN_LOCKED"
  | "CASE_VIEW"
  | "EVIDENCE_ACCESS"
  | "EVIDENCE_UPLOAD"
  | "PIPELINE_RUN"
  | "REPORT_EXPORT"
  | "LE_SUBMIT"
  | "REPORT_FINALIZE"
  | "USER_CREATED"
  | "USER_DEACTIVATED"
  | "TOOL_RUN"
  | "PROSECUTION_FLAG_SET"
  | "ERASURE_REQUESTED"
  | "ERASURE_RESOLVED"
  | "SUPPORT_BOOKING_CREATED"
  | "CASE_ASSIGNED"
  | "SETTINGS_UPDATED"
  | "ESCALATION_DRAFT"
  | "ESCALATION_PACK";

export interface IAuditLog extends Document {
  userId: string;
  action: AuditAction;
  resourceId?: string;
  outcome: "SUCCESS" | "FAILURE";
  /** Hashed IP (SHA-256) — raw IP never stored. */
  ip: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    userId: { type: String, required: true, index: true },
    action: {
      type: String,
      required: true,
      enum: [
        "LOGIN",
        "LOGOUT",
        "LOGIN_FAILED",
        "LOGIN_LOCKED",
        "CASE_VIEW",
        "EVIDENCE_ACCESS",
        "EVIDENCE_UPLOAD",
        "PIPELINE_RUN",
        "REPORT_EXPORT",
        "LE_SUBMIT",
        "REPORT_FINALIZE",
        "USER_CREATED",
        "USER_DEACTIVATED",
        "TOOL_RUN",
        "PROSECUTION_FLAG_SET",
        "ERASURE_REQUESTED",
        "ERASURE_RESOLVED",
        "SUPPORT_BOOKING_CREATED",
        "CASE_ASSIGNED",
        "SETTINGS_UPDATED",
        "ESCALATION_DRAFT",
        "ESCALATION_PACK",
      ],
    },
    resourceId: { type: String, index: true },
    outcome: { type: String, required: true, enum: ["SUCCESS", "FAILURE"] },
    ip: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: { transform: idJsonTransform },
  },
);

AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });

export const AuditLog = mongoose.model<IAuditLog>("AuditLog", AuditLogSchema);
