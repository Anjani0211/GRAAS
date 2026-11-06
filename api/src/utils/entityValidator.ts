import { z } from "zod";
import { isIPv4, isIPv6 } from "net";
import { v4 as uuidv4 } from "uuid";
import type { IOsintEntity, OsintEntityType } from "../models";

// ── Validation patterns from IMPLEMENTATION_PLAN.md §2.2 ──

const PHONE_RE = /^(\+91|0)?[6-9]\d{9}$/;
const UPI_RE = /^[a-zA-Z0-9._-]{2,}@[a-zA-Z]{3,}$/;
const URL_SCHEMES = new Set(["http:", "https:"]);
const EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;
const CRYPTO_BTC_RE = /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/;
const CRYPTO_ETH_RE = /^0x[a-fA-F0-9]{40}$/;
const CRYPTO_TRX_RE = /^T[a-zA-Z0-9]{33}$/;
const TELEGRAM_RE = /^\d+$/;

function validateIp(value: string): boolean {
  return isIPv4(value) || isIPv6(value);
}

function validateUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return URL_SCHEMES.has(u.protocol);
  } catch {
    return false;
  }
}

/** Per-type validation — returns true if value matches the expected format. */
export function isValid(type: OsintEntityType, value: string): boolean {
  switch (type) {
    case "phone":
      return PHONE_RE.test(value.replace(/\s/g, ""));
    case "upi":
      return UPI_RE.test(value);
    case "ipv4":
      return validateIp(value);
    case "url":
      return validateUrl(value);
    case "email":
      return EMAIL_RE.test(value);
    case "wallet":
      return CRYPTO_BTC_RE.test(value) || CRYPTO_ETH_RE.test(value) || CRYPTO_TRX_RE.test(value);
    case "telegram":
      return TELEGRAM_RE.test(value);
    case "domain":
      // Domains must be non-empty, have a TLD, and be lowercase
      return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(value);
    default:
      return false;
  }
}

// ── Gemini raw entity (before validation) ──

export const ExtractedEntitySchema = z.object({
  value: z.string().min(1),
  source_file: z.string().min(1),
  source_position: z.string().optional(),
  raw_context: z.string().default(""),
});

export type ExtractedEntity = z.infer<typeof ExtractedEntitySchema>;

export const GeminiExtractionResultSchema = z.object({
  phones: z.array(ExtractedEntitySchema).default([]),
  upis: z.array(ExtractedEntitySchema).default([]),
  ips: z.array(ExtractedEntitySchema).default([]),
  urls: z.array(ExtractedEntitySchema).default([]),
  emails: z.array(ExtractedEntitySchema).default([]),
  crypto_wallets: z.array(ExtractedEntitySchema).default([]),
  telegram_ids: z.array(ExtractedEntitySchema).default([]),
  suspect_names: z.array(ExtractedEntitySchema).default([]),
  summary: z.string().default(""),
  confidence_overall: z.number().min(0).max(1).default(0),
});

export type GeminiExtractionResult = z.infer<typeof GeminiExtractionResultSchema>;

// ── Conversion + Validation ──

interface ValidationResult {
  valid: IOsintEntity[];
  /** Entities that failed format validation — stored separately, never silently dropped. */
  invalid: IOsintEntity[];
}

const TYPE_MAP: Array<[keyof GeminiExtractionResult, OsintEntityType]> = [
  ["phones", "phone"],
  ["upis", "upi"],
  ["ips", "ipv4"],
  ["urls", "url"],
  ["emails", "email"],
  ["crypto_wallets", "wallet"],
  ["telegram_ids", "telegram"],
];

/**
 * Convert Gemini extraction result into typed IOsintEntity records.
 * Entities without source_file are REJECTED per the plan's contract.
 * Entities that fail format validation are moved to `invalid[]`, never dropped.
 */
export function validateExtractedEntities(raw: GeminiExtractionResult): ValidationResult {
  const valid: IOsintEntity[] = [];
  const invalid: IOsintEntity[] = [];
  const seen = new Set<string>();

  function push(type: OsintEntityType, e: ExtractedEntity): void {
    // Plan: "Every entity MUST have a source_file field. Reject any entity without it."
    if (!e.source_file?.trim()) return;

    const value = e.value.trim();
    const key = `${type}:${value.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);

    const entity: IOsintEntity = {
      id: `${type}-${uuidv4().slice(0, 8)}`,
      type,
      value,
      sourceFile: e.source_file,
      valid: isValid(type, value),
    };

    if (entity.valid) {
      valid.push(entity);
    } else {
      invalid.push(entity);
    }
  }

  for (const [key, type] of TYPE_MAP) {
    const arr = raw[key];
    if (Array.isArray(arr)) {
      (arr as ExtractedEntity[]).forEach((e) => push(type, e));
    }
  }

  return { valid, invalid };
}
