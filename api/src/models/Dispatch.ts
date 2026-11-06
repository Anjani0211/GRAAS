import mongoose, { Schema, Document } from "mongoose";
import { idJsonTransform } from "./schemaUtils";

/**
 * Entity dispatch model — captures the per-recipient routing plan
 * derived from a finalized GRASSReport. One Dispatch document per
 * (caseId, runId). Recipients are addressable entities:
 *   - BANK        (account/UPI freeze)
 *   - TELECOM     (BNSS §94 preservation)
 *   - CERT_IN     (incident report)
 *   - LE_CYBER    (state cyber cell / district)
 *   - LE_NCRP     (1930 / NCRP escalation reference)
 *   - SOCIAL      (platform takedown)
 *   - EXCHANGE    (crypto wallet flag)
 *   - REGISTRAR   (domain seizure)
 *   - PAYMENT_OPS (payment aggregator)
 */
export type RecipientType =
  | "BANK"
  | "TELECOM"
  | "CERT_IN"
  | "LE_CYBER"
  | "LE_NCRP"
  | "SOCIAL"
  | "EXCHANGE"
  | "REGISTRAR"
  | "PAYMENT_OPS";

export type RecipientPriority = "URGENT" | "HIGH" | "NORMAL";

export type RecipientStatus =
  | "DRAFT"
  | "QUEUED"
  | "SENT"
  | "ACKED"
  | "REJECTED"
  | "SKIPPED";

export interface IDispatchRecipient {
  /** Stable identifier per Dispatch document. */
  id: string;
  type: RecipientType;
  /** Human-readable recipient name (e.g. "YES Bank Nodal Officer"). */
  name: string;
  /** Optional verified contact channel (email / portal URL / NCRP ref). */
  contactEmail?: string;
  contactPortal?: string;
  jurisdiction?: string;
  /** Legal section / template basis (e.g. "BNSS §457", "CERT-In §70B"). */
  legalBasis: string;
  /** Email/portal subject line. */
  subject: string;
  /** Full body (interpolated with case data). */
  body: string;
  /** Entities this packet operates on (UPIs, phones, domains, wallets…). */
  actionTargets: string[];
  priority: RecipientPriority;
  status: RecipientStatus;
  /** Free-text reason from analyst when status is REJECTED/SKIPPED. */
  statusNote?: string;
  /** Set when analyst marks the packet as physically dispatched. */
  dispatchedAt?: Date;
  /** Confirmation / portal reference returned by recipient. */
  confirmationRef?: string;
  /** Analyst user id that updated the recipient last. */
  lastTouchedBy?: string;
  lastTouchedAt?: Date;
}

export interface IDispatch extends Document {
  caseId: string;
  /** Pipeline runId this plan was derived from. */
  runId: string;
  generatedAt: Date;
  generatedBy: string;
  recipients: IDispatchRecipient[];
  /** Aggregate state across all recipients. */
  rollupStatus: "DRAFT" | "PARTIALLY_SENT" | "ALL_SENT" | "CLOSED";
  /** Last time any recipient was updated. */
  updatedAt: Date;
}

const DispatchRecipientSchema = new Schema<IDispatchRecipient>(
  {
    id: { type: String, required: true },
    type: {
      type: String,
      required: true,
      enum: [
        "BANK",
        "TELECOM",
        "CERT_IN",
        "LE_CYBER",
        "LE_NCRP",
        "SOCIAL",
        "EXCHANGE",
        "REGISTRAR",
        "PAYMENT_OPS",
      ],
    },
    name: { type: String, required: true },
    contactEmail: { type: String },
    contactPortal: { type: String },
    jurisdiction: { type: String },
    legalBasis: { type: String, required: true },
    subject: { type: String, required: true },
    body: { type: String, required: true },
    actionTargets: { type: [String], default: [] },
    priority: {
      type: String,
      required: true,
      enum: ["URGENT", "HIGH", "NORMAL"],
      default: "NORMAL",
    },
    status: {
      type: String,
      required: true,
      enum: ["DRAFT", "QUEUED", "SENT", "ACKED", "REJECTED", "SKIPPED"],
      default: "DRAFT",
    },
    statusNote: { type: String },
    dispatchedAt: { type: Date },
    confirmationRef: { type: String },
    lastTouchedBy: { type: String },
    lastTouchedAt: { type: Date },
  },
  { _id: false },
);

const DispatchSchema = new Schema<IDispatch>(
  {
    caseId: { type: String, required: true, index: true },
    runId: { type: String, required: true, index: true },
    generatedAt: { type: Date, default: Date.now },
    generatedBy: { type: String, required: true },
    recipients: { type: [DispatchRecipientSchema], default: [] },
    rollupStatus: {
      type: String,
      enum: ["DRAFT", "PARTIALLY_SENT", "ALL_SENT", "CLOSED"],
      default: "DRAFT",
    },
  },
  {
    timestamps: { createdAt: false, updatedAt: true },
    toJSON: { transform: idJsonTransform },
  },
);

// One dispatch plan per (caseId, runId). Re-running the pipeline creates a new
// plan keyed by the new runId; older plans are preserved for audit.
DispatchSchema.index({ caseId: 1, runId: 1 }, { unique: true });
DispatchSchema.index({ updatedAt: -1 });

export const Dispatch = mongoose.model<IDispatch>("Dispatch", DispatchSchema);
