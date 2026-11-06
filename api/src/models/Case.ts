import mongoose, { Schema, Document } from "mongoose";
import { idJsonTransform, STAGE_STATUSES } from "./schemaUtils";

export const SEVERITIES = ["high", "medium", "low"] as const;
export const STATUSES = ["submitted", "triaged", "osint", "action_taken", "closed"] as const;
export const CATEGORIES = [
  "financial_fraud", "cyberbullying", "sextortion", "deepfake",
  "account_hacking", "identity_theft", "phishing", "corporate",
] as const;

export type Severity = (typeof SEVERITIES)[number];
export type CaseStatus = (typeof STATUSES)[number];
export type CaseCategory = (typeof CATEGORIES)[number];

export interface IEvidenceFile {
  fileUrl: string;
  fileName: string;
  fileType: string;
  fileSize?: number;
  uploadedAt: Date;
}

export interface ICaseAction {
  actionType: string;
  platformTarget?: string;
  templateUsed?: string;
  sentBy: string;
  sentAt: Date;
  responseReceived?: string;
}

export interface ICaseMessage {
  id: string;
  body: string;
  visibility: "internal" | "victim";
  authorId: string;
  authorName: string;
  authorRole: string;
  createdAt: Date;
}

export type OsintPhase = "evidence" | "draft_report" | "final_review" | "submitted_to_le";

export type OsintEntityType =
  | "phone"
  | "upi"
  | "email"
  | "url"
  | "domain"
  | "ipv4"
  | "wallet"
  | "telegram";

export type OsintConfidence = "VERIFIED" | "HIGH" | "MEDIUM" | "LOW" | "UNVERIFIED";

export interface IOsintEvidenceItem {
  id: string;
  fileName: string;
  fileType: string;
  ocrText: string;
  analystNotes: string;
  createdAt: Date;
  /** MinIO/local path under uploads/ (evidence/{caseId}/{sha256}/{file}) */
  storageKey?: string;
  /** Refers to EvidenceHash document _id */
  evidenceHashId?: string;
  sha256?: string;
}

export interface IOsintExifArtifact {
  evidenceSha256: string;
  exif: Record<string, unknown>;
}

export interface IOsintHashRecord {
  evidenceId: string;
  fileName: string;
  fileType: string;
  sha256: string;
  sizeBytes: number;
  ingestedAt: Date;
}

export interface IOsintEntity {
  id: string;
  type: OsintEntityType;
  value: string;
  sourceFile: string;
  valid: boolean;
}

export interface IOsintEnrichment {
  entityId: string;
  source: string;
  confidence: OsintConfidence;
  details: Record<string, unknown>;
  timestamp: Date;
}

export interface IOsintCluster {
  id: string;
  kind: "SHARED_UPI_CLUSTER" | "PHONE_MULE_CHAIN" | "DOMAIN_PHISHING_CAMPAIGN" | "TEMPORAL_BURST";
  severity: "high" | "medium" | "low";
  summary: string;
  linkedCaseNumbers: string[];
}

export interface IOsintCustomTool {
  id: string;
  kind: "whois" | "ip" | "urlscan" | "shodan";
  query: string;
  result: Record<string, unknown>;
  runAt: Date;
  runBy: string;
  attachedToReport: boolean;
}

export type OsintStageStateStatus = (typeof STAGE_STATUSES)[number];

export interface IOsintStageState {
  stageId: string;
  status: OsintStageStateStatus;
  startedAt?: Date;
  completedAt?: Date;
  retryCount: number;
  lastError?: string;
}

export interface IOsintInvestigation {
  evidenceItems: IOsintEvidenceItem[];
  draftReport: string;
  finalReport: string;
  leAgency: string;
  leDistrict: string;
  leReferenceNumber: string;
  submittedToLeAt?: Date;
  phase: OsintPhase;
  hashManifest: IOsintHashRecord[];
  entities: IOsintEntity[];
  /** Entities that failed format validation — stored for HITL review, never silently dropped. */
  invalidEntities: IOsintEntity[];
  enrichments: IOsintEnrichment[];
  clusters: IOsintCluster[];
  modusOperandi?: { code: string; confidence: number };
  /** AI-generated 2–4 sentence summary of the incident (Gemini Stage 2). */
  geminiSummary: string;
  /** Which parser produced the entities — "gemini" or "regex" (fallback). */
  parserUsed: "gemini" | "regex";
  reportMarkdown: string;
  reportJson?: Record<string, unknown>;
  customTools: IOsintCustomTool[];
  /** Forensic EXIF JSON extracted at upload; original file bytes unchanged in storage. */
  exifArtifacts: IOsintExifArtifact[];
  /** Per-stage retry / status for pipeline reliability (Phase 7). */
  stageStates: IOsintStageState[];
  lastRunId: string;
  lastRunAt?: Date;
  lastRunStatus: "idle" | "running" | "completed" | "failed";
}

export interface ICase extends Document {
  caseNumber: string;
  victimName: string;
  victimEmail: string;
  victimPhone: string;
  /** Set when complaint is filed by a logged-in victim (or linked); used for portal scoping */
  victimUserId?: mongoose.Types.ObjectId;
  category: CaseCategory;
  severity: Severity;
  status: CaseStatus;
  /** Set when status first becomes `closed`; used for “resolved this month” KPIs */
  closedAt?: Date;
  activeProsecution: boolean;
  prosecutionSetAt?: Date;
  prosecutionSetBy?: string;
  prosecutionNotes?: string;
  retentionDeletedAt?: Date;
  erasureRequestStatus: "NONE" | "PENDING" | "APPROVED" | "DENIED";
  erasureRequestedAt?: Date;
  erasureResolvedAt?: Date;
  /** DPDP / child-safety: complainant declares they are under 18. */
  complainantIsMinor: boolean;
  /** DPDP: incident involves a minor (victim or other). */
  involvesMinor: boolean;
  /** Required when complainantIsMinor — guardian/parent name. */
  guardianName?: string;
  /** Required when complainantIsMinor — guardian contact. */
  guardianContact?: string;
  /** Triage flags persisted at create (e.g. possible_minor_involved). */
  triageFlags: string[];
  description: string;
  monetaryLoss?: number;
  incidentDate?: Date;
  state?: string;
  district?: string;
  /** Staff User._id (string). */
  assignedOfficerId?: string;
  assignedOfficerName?: string;
  assignedAt?: Date;
  evidenceFiles: IEvidenceFile[];
  actions: ICaseAction[];
  /** Internal notes + victim-visible messages */
  messages: ICaseMessage[];
  osintInvestigation?: IOsintInvestigation;
  createdAt: Date;
  updatedAt: Date;
}

const EvidenceFileSchema = new Schema<IEvidenceFile>({
  fileUrl: { type: String, required: true },
  fileName: { type: String, required: true },
  fileType: { type: String, required: true },
  fileSize: Number,
  uploadedAt: { type: Date, default: Date.now },
});

const CaseActionSchema = new Schema<ICaseAction>({
  actionType: { type: String, required: true },
  platformTarget: String,
  templateUsed: String,
  sentBy: { type: String, required: true },
  sentAt: { type: Date, default: Date.now },
  responseReceived: String,
});

const CaseMessageSchema = new Schema<ICaseMessage>(
  {
    id: { type: String, required: true },
    body: { type: String, required: true },
    visibility: { type: String, enum: ["internal", "victim"], required: true },
    authorId: { type: String, required: true },
    authorName: { type: String, required: true },
    authorRole: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const OsintExifArtifactSchema = new Schema<IOsintExifArtifact>(
  {
    evidenceSha256: { type: String, required: true },
    exif: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false },
);

const OsintEvidenceItemSchema = new Schema<IOsintEvidenceItem>(
  {
    id: { type: String, required: true },
    fileName: { type: String, required: true },
    fileType: { type: String, default: "application/octet-stream" },
    ocrText: { type: String, default: "" },
    analystNotes: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
    storageKey: { type: String, required: false },
    evidenceHashId: { type: String, required: false },
    sha256: { type: String, required: false },
  },
  { _id: false },
);

const OsintHashRecordSchema = new Schema<IOsintHashRecord>(
  {
    evidenceId: { type: String, required: true },
    fileName: { type: String, required: true },
    fileType: { type: String, default: "application/octet-stream" },
    sha256: { type: String, required: true },
    sizeBytes: { type: Number, default: 0 },
    ingestedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const OsintEntitySchema = new Schema<IOsintEntity>(
  {
    id: { type: String, required: true },
    type: {
      type: String,
      enum: ["phone", "upi", "email", "url", "domain", "ipv4", "wallet", "telegram"],
      required: true,
    },
    value: { type: String, required: true },
    sourceFile: { type: String, required: true },
    valid: { type: Boolean, default: true },
  },
  { _id: false },
);

const OsintEnrichmentSchema = new Schema<IOsintEnrichment>(
  {
    entityId: { type: String, required: true },
    source: { type: String, required: true },
    confidence: {
      type: String,
      enum: ["VERIFIED", "HIGH", "MEDIUM", "LOW", "UNVERIFIED"],
      default: "UNVERIFIED",
    },
    details: { type: Schema.Types.Mixed, default: {} },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false },
);

const OsintClusterSchema = new Schema<IOsintCluster>(
  {
    id: { type: String, required: true },
    kind: {
      type: String,
      enum: ["SHARED_UPI_CLUSTER", "PHONE_MULE_CHAIN", "DOMAIN_PHISHING_CAMPAIGN", "TEMPORAL_BURST"],
      required: true,
    },
    severity: { type: String, enum: ["high", "medium", "low"], default: "low" },
    summary: { type: String, default: "" },
    linkedCaseNumbers: { type: [String], default: [] },
  },
  { _id: false },
);

const OsintCustomToolSchema = new Schema<IOsintCustomTool>(
  {
    id: { type: String, required: true },
    kind: { type: String, enum: ["whois", "ip", "urlscan", "shodan"], required: true },
    query: { type: String, required: true },
    result: { type: Schema.Types.Mixed, default: {} },
    runAt: { type: Date, default: Date.now },
    runBy: { type: String, default: "system" },
    attachedToReport: { type: Boolean, default: false },
  },
  { _id: false },
);

const OsintStageStateSchema = new Schema<IOsintStageState>(
  {
    stageId: { type: String, required: true },
    status: {
      type: String,
      enum: STAGE_STATUSES,
      default: "PENDING",
    },
    startedAt: Date,
    completedAt: Date,
    retryCount: { type: Number, default: 0 },
    lastError: String,
  },
  { _id: false },
);

const OsintInvestigationSchema = new Schema<IOsintInvestigation>(
  {
    evidenceItems: { type: [OsintEvidenceItemSchema], default: [] },
    draftReport: { type: String, default: "" },
    finalReport: { type: String, default: "" },
    leAgency: { type: String, default: "" },
    leDistrict: { type: String, default: "" },
    leReferenceNumber: { type: String, default: "" },
    submittedToLeAt: Date,
    phase: {
      type: String,
      enum: ["evidence", "draft_report", "final_review", "submitted_to_le"],
      default: "evidence",
    },
    hashManifest: { type: [OsintHashRecordSchema], default: [] },
    entities: { type: [OsintEntitySchema], default: [] },
    invalidEntities: { type: [OsintEntitySchema], default: [] },
    enrichments: { type: [OsintEnrichmentSchema], default: [] },
    clusters: { type: [OsintClusterSchema], default: [] },
    modusOperandi: {
      type: new Schema(
        {
          code: { type: String, required: true },
          confidence: { type: Number, default: 0 },
        },
        { _id: false },
      ),
      required: false,
    },
    geminiSummary: { type: String, default: "" },
    parserUsed: { type: String, enum: ["gemini", "regex"], default: "regex" },
    reportMarkdown: { type: String, default: "" },
    reportJson: { type: Schema.Types.Mixed, default: undefined },
    customTools: { type: [OsintCustomToolSchema], default: [] },
    exifArtifacts: { type: [OsintExifArtifactSchema], default: [] },
    stageStates: { type: [OsintStageStateSchema], default: [] },
    lastRunId: { type: String, default: "" },
    lastRunAt: Date,
    lastRunStatus: {
      type: String,
      enum: ["idle", "running", "completed", "failed"],
      default: "idle",
    },
  },
  { _id: false },
);

const CaseSchema = new Schema<ICase>(
  {
    caseNumber: { type: String, required: true, unique: true, index: true },
    victimName: { type: String, required: true },
    victimEmail: { type: String, required: true, index: true },
    victimUserId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    victimPhone: { type: String, required: true },
    category: { type: String, required: true, enum: CATEGORIES, index: true },
    severity: { type: String, default: "medium", enum: SEVERITIES, index: true },
    status: { type: String, default: "submitted", enum: STATUSES, index: true },
    closedAt: { type: Date, index: true },
    activeProsecution: { type: Boolean, default: false, index: true },
    prosecutionSetAt: Date,
    prosecutionSetBy: String,
    prosecutionNotes: String,
    retentionDeletedAt: Date,
    erasureRequestStatus: {
      type: String,
      enum: ["NONE", "PENDING", "APPROVED", "DENIED"],
      default: "NONE",
      index: true,
    },
    erasureRequestedAt: Date,
    erasureResolvedAt: Date,
    complainantIsMinor: { type: Boolean, default: false, index: true },
    involvesMinor: { type: Boolean, default: false, index: true },
    guardianName: String,
    guardianContact: String,
    triageFlags: { type: [String], default: [] },
    description: { type: String, required: true },
    monetaryLoss: Number,
    incidentDate: Date,
    state: String,
    district: String,
    /** User._id of assigned staff officer (string form for API stability). */
    assignedOfficerId: { type: String, index: true },
    assignedOfficerName: { type: String, trim: true },
    assignedAt: Date,
    evidenceFiles: [EvidenceFileSchema],
    actions: [CaseActionSchema],
    messages: { type: [CaseMessageSchema], default: [] },
    osintInvestigation: { type: OsintInvestigationSchema, required: false },
  },
  {
    timestamps: true,
    toJSON: { transform: idJsonTransform },
  }
);

CaseSchema.index({ createdAt: -1 });
CaseSchema.index({ status: 1, closedAt: -1 });

export const Case = mongoose.model<ICase>("Case", CaseSchema);
