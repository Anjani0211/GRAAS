import type { OsintEntityType } from "../../models";
import type { ConfidenceScore } from "../../types/confidence";

export interface OsintResult<T = Record<string, unknown>> {
  success: boolean;
  data?: T;
  confidence: ConfidenceScore;
  /** Provider name + response timestamp e.g. "VirusTotal/2026-04-23T10:00:00Z" */
  source: string;
  /** Raw API response — stored for audit trail. Never logged to console. */
  raw?: unknown;
  error?: string;
  /** Human-readable flags e.g. ["SPAM_REPORTED", "PHISHING_URL"] */
  flags: string[];
}

export interface OsintProvider<T = Record<string, unknown>> {
  name: string;
  tier: "PRIMARY" | "SECONDARY" | "FALLBACK";
  entityType: OsintEntityType;
  /** Per-lookup timeout in ms. Default 15000. */
  timeout: number;
  lookup(value: string): Promise<OsintResult<T>>;
}

/** Aggregate result for a single entity after all providers have run. */
export interface EnrichedEntityResult {
  entityId: string;
  entityType: OsintEntityType;
  entityValue: string;
  /** Best confidence score achieved from any provider. */
  confidence: ConfidenceScore;
  /** All individual provider results for audit. */
  providerResults: OsintResult[];
  /** Union of all flags from all providers. */
  flags: string[];
  /** The best (highest confidence) result. */
  best?: OsintResult;
}
