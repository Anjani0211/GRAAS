import type { CaseCategory, CaseStatus, Severity } from "./utils";

export type UserRole =
  | "victim"
  | "intake_officer"
  | "osint_analyst"
  | "case_manager"
  | "legal_team"
  | "senior_analyst"
  | "le_portal"
  | "admin"
  | "super_admin";

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  phone?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export type OsintPhase = "evidence" | "draft_report" | "final_review" | "submitted_to_le";

/** Phase 4: D3-compatible graph types */
export interface GraphNode {
  id: string;
  type: string;
  label: string;
  confidence: string;
  flags: string[];
  caseCount?: number;
}

export interface GraphLink {
  source: string;
  target: string;
  relationship: string;
  confidence: string;
}

export interface GraphResponse {
  nodes: GraphNode[];
  links: GraphLink[];
  fallback: boolean;
}

export type ClusterAlertType =
  | "SHARED_UPI_CLUSTER"
  | "PHONE_MULE_CHAIN"
  | "DOMAIN_PHISHING_CAMPAIGN"
  | "TEMPORAL_BURST";

export type OsintEntityType =
  | "phone"
  | "upi"
  | "email"
  | "url"
  | "domain"
  | "ipv4"
  | "wallet"
  | "telegram"
  | "username";

export type OsintConfidence = "VERIFIED" | "HIGH" | "MEDIUM" | "LOW" | "UNVERIFIED";

export type OsintRunStage = "intake" | "parse" | "osint" | "correlation" | "report";

export type OsintRunStatus = "idle" | "running" | "completed" | "failed";

export type OsintToolKind = "whois" | "ip" | "urlscan" | "shodan";

export interface OsintEvidenceItem {
  id: string;
  fileName: string;
  fileType: string;
  ocrText: string;
  analystNotes: string;
  createdAt: string;
  storageKey?: string;
  evidenceHashId?: string;
  sha256?: string;
}

export interface OsintExifArtifact {
  evidenceSha256: string;
  exif: Record<string, unknown>;
}

export interface OsintHashRecord {
  evidenceId: string;
  fileName: string;
  fileType: string;
  sha256: string;
  sizeBytes: number;
  ingestedAt: string;
}

export interface OsintEntity {
  id: string;
  type: OsintEntityType;
  value: string;
  sourceFile: string;
  valid: boolean;
}

export interface OsintEnrichment {
  entityId: string;
  source: string;
  confidence: OsintConfidence;
  details: Record<string, unknown>;
  timestamp: string;
}

export interface OsintCluster {
  id: string;
  kind: "SHARED_UPI_CLUSTER" | "PHONE_MULE_CHAIN" | "DOMAIN_PHISHING_CAMPAIGN" | "TEMPORAL_BURST";
  severity: "high" | "medium" | "low";
  summary: string;
  linkedCaseNumbers: string[];
}

export interface OsintCustomTool {
  id: string;
  kind: OsintToolKind;
  query: string;
  result: Record<string, unknown>;
  runAt: string;
  runBy: string;
  attachedToReport: boolean;
}

export interface OsintAgentScreenshot {
  callId: string;
  toolName: string;
  timestamp: string;
  downloadPath: string;
}

export interface OsintInvestigation {
  evidenceItems: OsintEvidenceItem[];
  draftReport: string;
  finalReport: string;
  leAgency: string;
  leDistrict: string;
  leReferenceNumber: string;
  submittedToLeAt?: string;
  phase: OsintPhase;
  hashManifest: OsintHashRecord[];
  entities: OsintEntity[];
  /** Entities that failed format validation — shown in HITL review UI. */
  invalidEntities: OsintEntity[];
  enrichments: OsintEnrichment[];
  clusters: OsintCluster[];
  modusOperandi?: { code: string; confidence: number };
  /** AI-generated incident summary from Gemini Stage 2. */
  geminiSummary: string;
  /** Which parser was used for this run. */
  parserUsed: "gemini" | "regex";
  reportMarkdown: string;
  reportJson?: Record<string, unknown>;
  customTools: OsintCustomTool[];
  exifArtifacts?: OsintExifArtifact[];
  lastRunId: string;
  lastRunAt?: string;
  lastRunStatus: OsintRunStatus;
}

export type OsintRunEvent =
  | { type: "run_started"; runId: string; at: string }
  | { type: "stage_started"; stage: OsintRunStage; at: string }
  | {
      type: "stage_log";
      stage: OsintRunStage;
      level: "info" | "success" | "warn" | "error";
      message: string;
      fallback?: boolean;
      at: string;
    }
  | { type: "stage_completed"; stage: OsintRunStage; at: string; data?: Record<string, unknown> }
  | { type: "stage_failed"; stage: OsintRunStage; at: string; message: string }
  | { type: "stage_skipped"; stage: OsintRunStage; reason: string; at: string }
  | { type: "run_queued"; mode: string; jobId: string; priority: string; at: string }
  | { type: "entity_enriched"; entityId: string; result: OsintEnrichment; at: string }
  | { type: "agent_iteration"; iterNum: number; toolName: string; reasoning: string; at: string }
  | { type: "agent_screenshot"; callId: string; toolName: string; thumbnailB64: string; at: string }
  | { type: "agent_new_lead"; entity: string; entityType: string; foundIn: string; at: string }
  | { type: "agent_complete"; exitReason: string; totalCalls: number; summary: string; at: string }
  | { type: "done"; runId: string; at: string; investigation: OsintInvestigation }
  | { type: "error"; message: string; at: string };

export interface Case {
  id: string;
  caseNumber: string;
  victimName: string;
  victimEmail: string;
  victimPhone: string;
  /** Present when filed by a logged-in victim */
  victimUserId?: string;
  category: CaseCategory;
  severity: Severity;
  status: CaseStatus;
  /** When the case was closed (set by API on first transition to closed) */
  closedAt?: string;
  description: string;
  monetaryLoss?: number;
  incidentDate?: string;
  assignedOfficerId?: string;
  assignedOfficerName?: string;
  assignedAt?: string;
  createdAt: string;
  updatedAt: string;
  state?: string;
  district?: string;
  evidenceFiles?: EvidenceFile[];
  actions?: CaseAction[];
  messages?: CaseMessage[];
  activeProsecution?: boolean;
  erasureRequestStatus?: "NONE" | "PENDING" | "APPROVED" | "DENIED";
  erasureRequestedAt?: string;
  complainantIsMinor?: boolean;
  involvesMinor?: boolean;
  guardianName?: string;
  guardianContact?: string;
  triageFlags?: string[];
  osintInvestigation?: OsintInvestigation;
}

export interface EvidenceFile {
  id: string;
  fileUrl: string;
  fileName: string;
  fileType: string;
  fileSize?: number;
  uploadedAt: string;
}

export interface CaseAction {
  id: string;
  actionType: string;
  platformTarget?: string;
  templateUsed?: string;
  sentBy: string;
  sentAt: string;
  responseReceived?: string;
}

export interface CaseMessage {
  id: string;
  body: string;
  visibility: "internal" | "victim";
  authorId: string;
  authorName: string;
  authorRole: string;
  createdAt: string;
}

export interface OsintReport {
  id: string;
  caseId: string;
  queryType: "whois" | "ip" | "urlscan" | "shodan";
  queryValue: string;
  resultJson: Record<string, unknown>;
  riskScore?: number;
  tags?: string[];
  runAt: string;
}

// ── Entity dispatch (per-entity report routing) ────────────────────────
export type DispatchRecipientType =
  | "BANK"
  | "TELECOM"
  | "CERT_IN"
  | "LE_CYBER"
  | "LE_NCRP"
  | "SOCIAL"
  | "EXCHANGE"
  | "REGISTRAR"
  | "PAYMENT_OPS";

export type DispatchRecipientPriority = "URGENT" | "HIGH" | "NORMAL";

export type DispatchRecipientStatus =
  | "DRAFT"
  | "QUEUED"
  | "SENT"
  | "ACKED"
  | "REJECTED"
  | "SKIPPED";

export interface DispatchRecipient {
  id: string;
  type: DispatchRecipientType;
  name: string;
  contactEmail?: string;
  contactPortal?: string;
  jurisdiction?: string;
  legalBasis: string;
  subject: string;
  body: string;
  actionTargets: string[];
  priority: DispatchRecipientPriority;
  status: DispatchRecipientStatus;
  statusNote?: string;
  dispatchedAt?: string;
  confirmationRef?: string;
  lastTouchedBy?: string;
  lastTouchedAt?: string;
}

export interface DispatchPlan {
  id: string;
  caseId: string;
  runId: string;
  generatedAt: string;
  generatedBy: string;
  recipients: DispatchRecipient[];
  rollupStatus: "DRAFT" | "PARTIALLY_SENT" | "ALL_SENT" | "CLOSED";
  updatedAt: string;
}
export interface Notification {
  id: string;
  caseId: string;
  channel: "sms" | "email" | "whatsapp";
  recipient: string;
  message: string;
  sentAt: string;
  status: "sent" | "delivered" | "failed";
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: "intake_officer" | "osint_analyst" | "case_manager" | "legal_team" | "admin" | "super_admin";
  avatar?: string;
  casesAssigned: number;
  status: "online" | "offline" | "busy";
}

export interface KPI {
  label: string;
  value: number | string;
  change?: number;
  trend?: "up" | "down" | "neutral";
}

export interface CaseStats {
  kpis: {
    totalThisMonth: number;
    resolved: number;
    avgResolutionDays: number;
    highSeverity: number;
    /** Absolute change vs previous calendar month (for avg days: negative = faster). */
    deltas?: {
      totalThisMonth: number;
      resolved: number;
      avgResolutionDays: number;
      highSeverity: number;
    };
  };
  severityCounts: { high: number; medium: number; low: number };
  categoryCounts: Record<string, number>;
  stateCounts: Record<string, number>;
  unassigned: number;
  pendingTriage: number;
  casesOverTime?: { date: string; reported: number; resolved: number }[];
}

export interface TeamUserRow {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  phone?: string;
  badgeId?: string;
  createdAt?: string;
  lastLoginAt?: string;
}

export interface TriageResult {
  category: string;
  severity: Severity;
  confidence: number;
  flags: string[];
}

export interface AuditEventRow {
  id?: string;
  createdAt: string;
  action: string;
  userId: string;
  resourceId?: string;
  outcome: "SUCCESS" | "FAILURE";
  ip: string;
}

export interface RetentionAuditRow {
  id?: string;
  caseId?: string;
  action: string;
  reason?: string;
  summary?: Record<string, unknown>;
  timestamp: string;
}

export interface OsintQueueItem {
  id: string;
  caseNumber: string;
  category: CaseCategory;
  severity: Severity;
  status: CaseStatus;
  victimName: string;
  district?: string;
  state?: string;
  updatedAt: string;
  phase: OsintPhase;
}

export interface SubmissionFormData {
  full_name: string;
  phone: string;
  email: string;
  state: string;
  district: string;
  category: CaseCategory | "";
  description: string;
  monetary_loss?: number;
  incident_date: string;
  evidence_files: File[];
  evidence_urls: string[];
  consent: boolean;
}

// ── Threat-intelligence graph (cross-case) ─────────────────────────────
export type ThreatGraphNodeType = "Case" | "Entity";

export interface ThreatGraphNode {
  id: string;
  type: ThreatGraphNodeType;
  entityType?: OsintEntityType;
  label: string;
  caseCount?: number;
  riskScore?: number;
  totalLossInr?: number;
  severity?: "high" | "medium" | "low";
  confidence?: OsintConfidence;
}

export interface ThreatGraphLink {
  source: string;
  target: string;
  relationship: "INVOLVED" | "CO_OCCURS";
  weight?: number;
}

export interface ThreatGraphCaseTouch {
  caseNumber: string;
  caseSeverity?: "high" | "medium" | "low";
  caseStatus?: string;
  lossInr?: number;
  incidentDate?: string;
  confidence?: OsintConfidence;
}

export interface ThreatEntityRow {
  type: OsintEntityType;
  value: string;
  touches: ThreatGraphCaseTouch[];
  bestConfidence: OsintConfidence;
  riskScore: number;
  totalLossInr: number;
  confidenceMix: Record<OsintConfidence, number>;
}

export interface ThreatGraphSlice {
  nodes: ThreatGraphNode[];
  links: ThreatGraphLink[];
  topThreats: ThreatEntityRow[];
  stats: {
    totalEntities: number;
    totalCases: number;
    totalEdges: number;
    highRiskEntities: number;
    earliestIncident?: string;
    latestIncident?: string;
  };
  focus?: { type: OsintEntityType; value: string };
}
