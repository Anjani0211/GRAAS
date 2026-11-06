import mongoose, { Schema, type Document } from "mongoose";
import { ConfidenceScore } from "../types/confidence";
import type {
  InvestigationMemory,
  CaseClassification,
  ToolCall,
  EntityWithHistory,
} from "../types/investigationMemory";
import { EntityWithHistoryZ } from "../types/investigationMemory";
import { idJsonTransform } from "./schemaUtils";
import { z } from "zod";

export interface IInvestigationMemory extends InvestigationMemory, Document {}

const CONFIDENCE_ENUM_VALUES = Object.values(ConfidenceScore).filter(
  (v): v is number => typeof v === "number",
);

const SCAM_CATEGORIES = [
  "TASK_FRAUD",
  "INVESTMENT_FRAUD",
  "KYC_FRAUD",
  "SEXTORTION",
  "LOAN_APP_FRAUD",
  "OTHER",
] as const;

const ENTITY_TYPES = [
  "phone",
  "upi",
  "email",
  "url",
  "domain",
  "ipv4",
  "wallet",
  "telegram",
  "username",
  "apk",
] as const;

const ToolCallSchema = new Schema<ToolCall>(
  {
    callId: { type: String, required: true },
    iterationNum: { type: Number, required: true },
    toolName: { type: String, required: true },
    input: { type: Schema.Types.Mixed, default: {} },
    output: { type: Schema.Types.Mixed, default: {} },
    screenshotPath: String,
    /** Large; excluded from default query projections where possible. */
    screenshotBase64: { type: String, select: false },
    confidence: { type: Number, enum: CONFIDENCE_ENUM_VALUES, default: ConfidenceScore.UNVERIFIED },
    durationMs: { type: Number, default: 0 },
    timestamp: { type: Date, default: Date.now },
    newLeadsFound: { type: [String], default: [] },
    reasoning: { type: String, default: "" },
  },
  { _id: false },
);

const CaseClassificationSchema = new Schema<CaseClassification>(
  {
    primaryType: { type: String, enum: SCAM_CATEGORIES, default: "OTHER" },
    confidence: { type: Number, default: 0, min: 0, max: 1 },
    indicators: { type: [String], default: [] },
    strategy: { type: String, default: "" },
    priorityTools: { type: [String], default: [] },
  },
  { _id: false },
);

const EntityWithHistorySchema = new Schema<EntityWithHistory>(
  {
    value: { type: String, required: true },
    type: { type: String, required: true, enum: ENTITY_TYPES },
    firstSeenIn: { type: String, required: true },
    leadSource: String,
    enrichments: { type: [ToolCallSchema], default: [] },
    confidence: { type: Number, enum: CONFIDENCE_ENUM_VALUES, default: ConfidenceScore.UNVERIFIED },
    flags: { type: [String], default: [] },
  },
  { _id: false },
);

const EntitiesFoundMapZ = z.record(z.string(), EntityWithHistoryZ);

const InvestigationMemorySchema = new Schema<IInvestigationMemory>(
  {
    caseId: { type: String, required: true, index: true },
    runId: { type: String, required: true, index: true },
    classification: { type: CaseClassificationSchema, required: true },
    iterations: { type: [ToolCallSchema], default: [] },
    /**
     * Plain object keyed by entity value. Validated on save via Zod
     * (Map type would break Object.values() callers).
     */
    entitiesFound: {
      type: Schema.Types.Mixed,
      default: {},
      validate: {
        validator(value: unknown) {
          if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
          return EntitiesFoundMapZ.safeParse(value).success;
        },
        message: "entitiesFound must be a map of EntityWithHistory records",
      },
    },
    totalToolCalls: { type: Number, default: 0 },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date },
    exitReason: {
      type: String,
      enum: ["COMPLETE", "MAX_ITERATIONS", "TIMEOUT", "ERROR"],
      default: "ERROR",
    },
    exitStatement: { type: String, default: "" },
  },
  {
    collection: "investigation_memories",
    timestamps: { createdAt: true, updatedAt: true },
    toJSON: {
      transform(doc: unknown, ret: Record<string, unknown>) {
        idJsonTransform(doc, ret);
        const iterations = ret.iterations;
        if (Array.isArray(iterations)) {
          ret.iterations = iterations.map((item) => {
            if (!item || typeof item !== "object") return item;
            const copy = { ...(item as Record<string, unknown>) };
            delete copy.screenshotBase64;
            return copy;
          });
        }
        return ret;
      },
    },
  },
);

InvestigationMemorySchema.index({ caseId: 1, runId: 1 }, { unique: true });

export const InvestigationMemoryModel = mongoose.model<IInvestigationMemory>(
  "InvestigationMemory",
  InvestigationMemorySchema,
);

// Keep schema registered for nested validation reuse / future Map migration.
void EntityWithHistorySchema;
