// Retention periods from GRASS PRD v2.0 Section 7.3.
// All values are milliseconds for Date arithmetic.
// NEVER modify these without legal sign-off.

export const RETENTION = {
  EVIDENCE_FILES_MS: 3 * 365 * 24 * 60 * 60 * 1000,
  INVESTIGATION_ARTIFACTS_MS: 3 * 365 * 24 * 60 * 60 * 1000,
  FINAL_REPORTS_MS: 7 * 365 * 24 * 60 * 60 * 1000,
  AUDIT_LOGS_MS: 5 * 365 * 24 * 60 * 60 * 1000,
  VICTIM_ACCOUNT_MS: 1 * 365 * 24 * 60 * 60 * 1000,
} as const;

export const PRE_DELETION_WARN_DAYS = 30;
