import crypto from "crypto";
import { AuditLog, type AuditAction } from "../models";
import { logger } from "../utils/logger";

interface LogEventParams {
  userId: string;
  action: AuditAction;
  resourceId?: string;
  outcome: "SUCCESS" | "FAILURE";
  /** Raw IP from req.ip — hashed before storage. */
  ip: string;
  metadata?: Record<string, unknown>;
}

/**
 * Hash an IP address before persistence (DPDP Act 2023 compliance).
 * The hash is deterministic so duplicate lookups are possible, but the raw IP
 * is never stored.
 */
export function hashIp(ip: string): string {
  return crypto.createHash("sha256").update(ip, "utf8").digest("hex").slice(0, 16);
}

/**
 * Write a structured audit event to the `audit_logs` MongoDB collection.
 * Fire-and-forget — never throws; logs to stderr on failure.
 */
export async function logEvent(params: LogEventParams): Promise<void> {
  try {
    await AuditLog.create({
      userId: params.userId,
      action: params.action,
      resourceId: params.resourceId,
      outcome: params.outcome,
      ip: hashIp(params.ip),
      metadata: params.metadata,
    });
  } catch (err) {
    logger.error(
      { err, action: params.action, userId: params.userId },
      "[AuditLog] Failed to write audit event",
    );
  }
}
