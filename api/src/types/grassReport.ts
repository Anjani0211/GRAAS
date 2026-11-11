import { z } from "zod";

// ── Sub-schemas ──────────────────────────────────────────────────────────────

const EvidenceFileZ = z.object({
  fileName: z.string(),
  sha256: z.string().length(64),
  fileSizeBytes: z.number().int().positive(),
  mimeType: z.string(),
  ingestedAt: z.string().datetime(),
});

const ExtractedEntityZ = z.object({
  value: z.string(),
  type: z.enum(["phone", "upi", "ip", "url", "email", "wallet", "telegram", "domain", "username"]),
  source_file: z.string(),
  confidence: z.enum(["VERIFIED", "HIGH", "MEDIUM", "LOW", "UNVERIFIED"]),
  osint_summary: z.string(),
  flags: z.array(z.string()),
});

const TimelineEventZ = z.object({
  timestamp: z.string().datetime(),
  description: z.string(),
  evidence_reference: z.string().optional(),
});

const ClusterAlertZ = z.object({
  type: z.enum([
    "SHARED_UPI_CLUSTER",
    "PHONE_MULE_CHAIN",
    "DOMAIN_PHISHING_CAMPAIGN",
    "TEMPORAL_BURST",
  ]),
  entityValue: z.string(),
  linkedCaseIds: z.array(z.string()),
  caseCount: z.number().int(),
  severity: z.enum(["HIGH", "MEDIUM"]),
});

const MoneyMoveZ = z.object({
  fromAccount: z.string(),
  toAccount: z.string(),
  amountInr: z.number(),
  timestamp: z.string().datetime(),
  layer: z.enum(["LAYER_1", "LAYER_2", "LAYER_3", "LAYER_4", "EXIT", "CRYPTO_OFFRAMP"]),
  utrReference: z.string().optional(),
});

const ActionRequestZ = z.object({
  priority: z.enum(["URGENT", "HIGH", "NORMAL"]),
  targetEntity: z.string(),
  targetBank: z.string().optional(),
  action: z.enum([
    "FREEZE_ACCOUNT",
    "PRESERVE_DATA",
    "SEIZE_DOMAIN",
    "FLAG_WALLET",
    "REQUEST_KYC",
    "OTHER",
  ]),
  justification: z.string(),
});

const LegalDraftZ = z.object({
  section: z.string(),
  template: z.string(),
  content: z.string(),
});

/** Matches live case numbers: GRS-{year}-{5-alnum} (see routes/cases generateCaseNumber). */
export const GRASS_CASE_ID_RE = /^GRS-\d{4}-[A-Z0-9]{5}$/i;

// ── Root schema ──────────────────────────────────────────────────────────────

export const GRASSReportZ = z.object({
  schema_version: z.literal("GRASSReport/1.0"),
  case_id: z.string().regex(GRASS_CASE_ID_RE),
  generated_at: z.string().datetime(),
  analyst_id: z.string().min(1),
  analyst_name: z.string().min(1),
  analyst_signature_hash: z.string().length(64),

  incident_date_range: z.object({
    start: z.string().datetime(),
    end: z.string().datetime(),
  }),
  scam_category: z.enum([
    "TASK_FRAUD",
    "INVESTMENT_FRAUD",
    "SEXTORTION",
    "OTP_FRAUD",
    "PHISHING",
    "ROMANCE_SCAM",
    "IMPERSONATION",
    "KYC_FRAUD",
    "LOAN_FRAUD",
    "OTHER",
  ]),
  total_loss_inr: z.number().int().min(0),

  evidence_manifest: z.array(EvidenceFileZ).min(1),
  extracted_entities: z.array(ExtractedEntityZ),
  invalid_entities: z.array(
    z.object({
      value: z.string(),
      type: z.string(),
      reason: z.string(),
    }),
  ),

  timeline: z.array(TimelineEventZ),
  executive_summary: z.string().min(50).max(1500),
  modus_operandi_detail: z.string().optional(),
  victim_statement: z.string(),

  cluster_alerts: z.array(ClusterAlertZ).optional(),
  financial_flow: z.array(MoneyMoveZ).optional(),

  actionable_requests: z.array(ActionRequestZ).min(1),
  legal_drafts: z.array(LegalDraftZ).optional(),

  graph_image_base64: z.string().optional(),
  is_redacted: z.boolean().default(false),
});

export type GRASSReport = z.infer<typeof GRASSReportZ>;
