import { z } from "zod";
import { ConfidenceScore } from "./confidence";

export type ScamCategory =
  | "TASK_FRAUD"
  | "INVESTMENT_FRAUD"
  | "KYC_FRAUD"
  | "SEXTORTION"
  | "LOAN_APP_FRAUD"
  | "OTHER";

export type EntityType =
  | "phone"
  | "upi"
  | "email"
  | "url"
  | "domain"
  | "ipv4"
  | "wallet"
  | "telegram"
  | "username"
  | "apk";

export interface ToolCall {
  callId: string;
  iterationNum: number;
  toolName: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  screenshotPath?: string;
  screenshotBase64?: string;
  confidence: ConfidenceScore;
  durationMs: number;
  timestamp: Date;
  newLeadsFound: string[];
  reasoning: string;
}

export interface CaseClassification {
  primaryType: ScamCategory;
  confidence: number;
  indicators: string[];
  strategy: string;
  priorityTools: string[];
}

export interface EntityWithHistory {
  value: string;
  type: EntityType;
  firstSeenIn: string;
  leadSource?: string;
  enrichments: ToolCall[];
  confidence: ConfidenceScore;
  flags: string[];
}

export interface InvestigationMemory {
  caseId: string;
  runId: string;
  classification: CaseClassification;
  iterations: ToolCall[];
  /**
   * NOTE: This is represented as a plain object when persisted to MongoDB/JSON.
   * Keys are entity values; value is EntityWithHistory.
   */
  entitiesFound: Record<string, EntityWithHistory>;
  totalToolCalls: number;
  startedAt: Date;
  completedAt?: Date;
  exitReason: "COMPLETE" | "MAX_ITERATIONS" | "TIMEOUT" | "ERROR";
  exitStatement: string;
}

export const ToolCallZ = z.object({
  callId: z.string().min(1),
  iterationNum: z.number().int().min(1),
  toolName: z.string().min(1),
  input: z.record(z.string(), z.unknown()),
  output: z.record(z.string(), z.unknown()),
  screenshotPath: z.string().optional(),
  screenshotBase64: z.string().optional(),
  confidence: z.nativeEnum(ConfidenceScore),
  durationMs: z.number().int().min(0),
  timestamp: z.coerce.date(),
  newLeadsFound: z.array(z.string()),
  reasoning: z.string(),
});

export const CaseClassificationZ = z.object({
  primaryType: z.enum(["TASK_FRAUD", "INVESTMENT_FRAUD", "KYC_FRAUD", "SEXTORTION", "LOAN_APP_FRAUD", "OTHER"]),
  confidence: z.number().min(0).max(1),
  indicators: z.array(z.string()).default([]),
  strategy: z.string().default(""),
  priorityTools: z.array(z.string()).default([]),
});

export const EntityWithHistoryZ = z.object({
  value: z.string(),
  type: z.enum([
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
  ]),
  firstSeenIn: z.string(),
  leadSource: z.string().optional(),
  enrichments: z.array(ToolCallZ).default([]),
  confidence: z.nativeEnum(ConfidenceScore),
  flags: z.array(z.string()).default([]),
});

export const InvestigationMemoryZ = z.object({
  caseId: z.string().min(1),
  runId: z.string().min(1),
  classification: CaseClassificationZ,
  iterations: z.array(ToolCallZ).default([]),
  entitiesFound: z.record(z.string(), EntityWithHistoryZ).default({}),
  totalToolCalls: z.number().int().min(0),
  startedAt: z.coerce.date(),
  completedAt: z.coerce.date().optional(),
  exitReason: z.enum(["COMPLETE", "MAX_ITERATIONS", "TIMEOUT", "ERROR"]),
  exitStatement: z.string().default(""),
});
