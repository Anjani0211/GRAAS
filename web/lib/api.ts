import type {
  Case,
  CaseStats,
  TriageResult,
  AuthResponse,
  User,
  UserRole,
  OsintInvestigation,
  OsintEvidenceItem,
  OsintQueueItem,
  OsintPhase,
  OsintRunEvent,
  OsintToolKind,
  OsintCustomTool,
  OsintAgentScreenshot,
  AuditEventRow,
  RetentionAuditRow,
} from "./types";
import type { CaseStatus } from "./utils";

/**
 * Resolve the API base URL.
 *
 * `NEXT_PUBLIC_API_URL` wins when explicitly configured. Otherwise the browser
 * uses the same hostname the app was opened on. Using `localhost` unconditionally
 * breaks 127.0.0.1 / LAN access: the auth cookie is host-scoped, so a cookie set
 * for `localhost` is never sent to `127.0.0.1:3000` and the proxy bounces the
 * user back to /login.
 */
function resolveApiBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  // Prefer same-origin /api on Vercel (rewrites → Render) so auth cookies are first-party.
  if (process.env.NEXT_PUBLIC_API_SAME_ORIGIN === "true") {
    return "/api";
  }
  if (configured) {
    // Absolute cross-origin URL — works only if cookies are SameSite=None (not for middleware).
    if (configured.startsWith("/")) return configured.replace(/\/$/, "") || "/api";
    return configured.replace(/\/$/, "");
  }
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:8000/api`;
  }
  return "http://localhost:8000/api";
}

export const API_BASE = resolveApiBase();

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Cookie-only auth — Bearer header no longer used by the browser client. */
export function getAuthHeader(): Record<string, string> {
  return {};
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Graas-Client": "1",
      ...options?.headers,
    },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error || `Request failed (${res.status})`, body.details);
  }

  return res.json();
}

export const casesApi = {
  list(params?: {
    status?: string;
    severity?: string;
    category?: string;
    q?: string;
    unassigned?: boolean;
    limit?: number;
    offset?: number;
  }) {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.severity) qs.set("severity", params.severity);
    if (params?.category) qs.set("category", params.category);
    if (params?.q) qs.set("q", params.q);
    if (params?.unassigned) qs.set("unassigned", "1");
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.offset) qs.set("offset", String(params.offset));
    const query = qs.toString();
    return apiFetch<Case[]>(`/cases${query ? `?${query}` : ""}`);
  },

  getById(id: string) {
    return apiFetch<Case>(`/cases/${encodeURIComponent(id)}`);
  },

  /** Victim portal: only cases owned by the logged-in victim (JWT). */
  listMine() {
    return apiFetch<Case[]>("/cases/mine");
  },

  getMineById(id: string) {
    return apiFetch<Case>(`/cases/mine/${encodeURIComponent(id)}`);
  },

  getStats() {
    return apiFetch<CaseStats>("/cases/stats");
  },

  postMessage(id: string, body: string, visibility?: "internal" | "victim") {
    return apiFetch<{ message: import("./types").CaseMessage }>(
      `/cases/${encodeURIComponent(id)}/messages`,
      {
        method: "POST",
        body: JSON.stringify({ body, visibility }),
      },
    );
  },

  requestErasure(caseId: string) {
    return apiFetch<{ status: string; acknowledgementDeadline?: string }>(
      `/cases/${encodeURIComponent(caseId)}/erasure-request`,
      { method: "POST", body: JSON.stringify({}) },
    );
  },

  create(input: {
    victimName: string;
    victimEmail: string;
    victimPhone: string;
    category: string;
    description: string;
    monetaryLoss?: number;
    incidentDate?: string;
    state?: string;
    district?: string;
    evidenceUrl?: string;
    files?: File[];
    complainantIsMinor?: boolean;
    involvesMinor?: boolean;
    guardianName?: string;
    guardianContact?: string;
    triageFlags?: string[];
    ncrpComplaint?: Record<string, unknown>;
  }) {
    const { files, evidenceUrl, ...data } = input;
    const hasFiles = files && files.length > 0;
    const urlTrim = evidenceUrl?.trim() ?? "";
    const hasUrl = urlTrim.length >= 8;

    if (hasFiles || hasUrl) {
      const fd = new FormData();
      fd.append("victimName", data.victimName);
      fd.append("victimEmail", data.victimEmail);
      fd.append("victimPhone", data.victimPhone);
      fd.append("category", data.category);
      fd.append("description", data.description);
      if (data.monetaryLoss != null && !Number.isNaN(data.monetaryLoss)) {
        fd.append("monetaryLoss", String(data.monetaryLoss));
      }
      if (data.incidentDate) fd.append("incidentDate", data.incidentDate);
      if (data.state) fd.append("state", data.state);
      if (data.district) fd.append("district", data.district);
      if (data.complainantIsMinor != null) fd.append("complainantIsMinor", String(data.complainantIsMinor));
      if (data.involvesMinor != null) fd.append("involvesMinor", String(data.involvesMinor));
      if (data.guardianName) fd.append("guardianName", data.guardianName);
      if (data.guardianContact) fd.append("guardianContact", data.guardianContact);
      if (data.triageFlags?.length) fd.append("triageFlags", JSON.stringify(data.triageFlags));
      if (data.ncrpComplaint) fd.append("ncrpComplaint", JSON.stringify(data.ncrpComplaint));
      if (hasUrl) fd.append("evidenceUrl", urlTrim);
      if (hasFiles) {
        for (const f of files!) {
          fd.append("evidence", f);
        }
      }

      return (async () => {
        const res = await fetch(`${API_BASE}/cases`, {
          method: "POST",
          credentials: "include",
          headers: { "X-Graas-Client": "1", ...getAuthHeader() },
          body: fd,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new ApiError(res.status, body.error || `Request failed (${res.status})`, body.details);
        }
        return res.json() as Promise<Case>;
      })();
    }

    return apiFetch<Case>("/cases", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  uploadEvidence(caseId: string, files: File[]) {
    const fd = new FormData();
    for (const f of files) fd.append("evidence", f);
    return (async () => {
      const res = await fetch(`${API_BASE}/cases/${encodeURIComponent(caseId)}/evidence`, {
        method: "POST",
        credentials: "include",
        headers: { "X-Graas-Client": "1", ...getAuthHeader() },
        body: fd,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError(res.status, body.error || `Upload failed (${res.status})`, body.details);
      }
      return res.json() as Promise<{ message: string; evidenceFiles: Case["evidenceFiles"]; added: Case["evidenceFiles"] }>;
    })();
  },

  updateStatus(id: string, status: CaseStatus, note?: string) {
    return apiFetch<{ message: string; caseId: string; newStatus: CaseStatus }>(
      `/cases/${encodeURIComponent(id)}/status`,
      { method: "PATCH", body: JSON.stringify({ status, note }) },
    );
  },

  assign(id: string, officerId: string | null) {
    return apiFetch<{
      message: string;
      caseId: string;
      assignedOfficerId: string | null;
      assignedOfficerName: string | null;
      assignedAt?: string;
    }>(`/cases/${encodeURIComponent(id)}/assign`, {
      method: "PATCH",
      body: JSON.stringify({ officerId }),
    });
  },
};

export const osintApi = {
  queue() {
    return apiFetch<OsintQueueItem[]>("/osint/queue");
  },

  getInvestigation(caseId: string) {
    return apiFetch<{ case: Case; investigation: OsintInvestigation }>(
      `/osint/case/${encodeURIComponent(caseId)}/investigation`,
    );
  },

  addEvidence(caseId: string, body: { fileName: string; fileType?: string; ocrText?: string; analystNotes?: string }) {
    return apiFetch<{ evidence: OsintEvidenceItem; investigation: OsintInvestigation }>(
      `/osint/case/${encodeURIComponent(caseId)}/investigation/evidence`,
      { method: "POST", body: JSON.stringify(body) },
    );
  },

  /** Multipart upload — persists to MinIO/local + EvidenceHash chain. */
  addEvidenceFile(caseId: string, file: File) {
    const fd = new FormData();
    fd.append("file", file);
    return (async () => {
      const res = await fetch(`${API_BASE}/osint/case/${encodeURIComponent(caseId)}/investigation/evidence`, {
        method: "POST",
        credentials: "include",
        headers: { "X-Graas-Client": "1", ...getAuthHeader() },
        body: fd,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError(res.status, (body as { error?: string }).error || `Request failed (${res.status})`, body);
      }
      return res.json() as Promise<{ evidence: OsintEvidenceItem; investigation: OsintInvestigation }>;
    })();
  },

  patchEvidence(
    caseId: string,
    evidenceId: string,
    body: { ocrText?: string; analystNotes?: string },
  ) {
    return apiFetch<{ evidence: OsintEvidenceItem; investigation: OsintInvestigation }>(
      `/osint/case/${encodeURIComponent(caseId)}/investigation/evidence/${encodeURIComponent(evidenceId)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    );
  },

  deleteEvidence(caseId: string, evidenceId: string) {
    return apiFetch<{ investigation: OsintInvestigation }>(
      `/osint/case/${encodeURIComponent(caseId)}/investigation/evidence/${encodeURIComponent(evidenceId)}`,
      { method: "DELETE" },
    );
  },

  patchDraft(caseId: string, body: { draftReport?: string; finalReport?: string; phase?: OsintPhase }) {
    return apiFetch<{ investigation: OsintInvestigation }>(
      `/osint/case/${encodeURIComponent(caseId)}/investigation/draft`,
      { method: "PATCH", body: JSON.stringify(body) },
    );
  },

  finalizeReport(caseId: string, body?: { finalReport?: string }) {
    return apiFetch<{ investigation: OsintInvestigation }>(
      `/osint/case/${encodeURIComponent(caseId)}/investigation/finalize`,
      { method: "POST", body: JSON.stringify(body ?? {}) },
    );
  },

  submitToLe(
    caseId: string,
    body: { leAgency: string; leDistrict?: string; leReferenceNumber?: string; advanceCaseStatus?: boolean },
  ) {
    return apiFetch<{ message: string; case: Case; investigation: OsintInvestigation }>(
      `/osint/case/${encodeURIComponent(caseId)}/investigation/submit-le`,
      { method: "POST", body: JSON.stringify(body) },
    );
  },

  whois(domain: string) {
    return apiFetch<Record<string, unknown>>(`/osint/whois?domain=${encodeURIComponent(domain)}`);
  },

  ipLookup(ip: string) {
    return apiFetch<Record<string, unknown>>(`/osint/ip?ip=${encodeURIComponent(ip)}`);
  },

  urlscan(url: string) {
    return apiFetch<Record<string, unknown>>(`/osint/urlscan?url=${encodeURIComponent(url)}`);
  },

  shodan(query: string) {
    return apiFetch<Record<string, unknown>>(`/osint/shodan?query=${encodeURIComponent(query)}`);
  },

  async runInvestigation(
    caseId: string,
    onEvent: (event: OsintRunEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const res = await fetch(`${API_BASE}/osint/case/${encodeURIComponent(caseId)}/investigation/run`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-Graas-Client": "1", ...getAuthHeader() },
      signal,
    });
    if (res.status === 202) {
      const data = (await res.json()) as { mode: string; jobId: string; priority: string };
      onEvent({
        type: "run_queued",
        mode: data.mode,
        jobId: data.jobId,
        priority: data.priority,
        at: new Date().toISOString(),
      });
      return;
    }
    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, body.error || `Pipeline failed (${res.status})`, body.details);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIdx = buffer.indexOf("\n");
        while (newlineIdx !== -1) {
          const line = buffer.slice(0, newlineIdx).trim();
          buffer = buffer.slice(newlineIdx + 1);
          if (line && !line.startsWith(":")) {
            try {
              const event = JSON.parse(line) as OsintRunEvent;
              onEvent(event);
            } catch {
              // Ignore malformed partial chunks
            }
          }
          newlineIdx = buffer.indexOf("\n");
        }
      }
      const rest = buffer.trim();
      if (rest && !rest.startsWith(":")) {
        try {
          onEvent(JSON.parse(rest) as OsintRunEvent);
        } catch {
          /* ignore */
        }
      }
    } finally {
      reader.releaseLock();
    }
  },

  getAgentScreenshots(caseId: string, runId?: string) {
    const qs = new URLSearchParams();
    if (runId) qs.set("runId", runId);
    const query = qs.toString();
    return apiFetch<{ runId: string; screenshots: OsintAgentScreenshot[] }>(
      `/osint/case/${encodeURIComponent(caseId)}/investigation/agent-screenshots${query ? `?${query}` : ""}`,
    );
  },

  runTool(caseId: string, body: { kind: OsintToolKind; query: string; attach?: boolean }) {
    return apiFetch<{ tool: OsintCustomTool; investigation: OsintInvestigation; provider: string }>(
      `/osint/case/${encodeURIComponent(caseId)}/investigation/tool`,
      { method: "POST", body: JSON.stringify(body) },
    );
  },

  deleteTool(caseId: string, toolId: string) {
    return apiFetch<{ investigation: OsintInvestigation }>(
      `/osint/case/${encodeURIComponent(caseId)}/investigation/tool/${encodeURIComponent(toolId)}`,
      { method: "DELETE" },
    );
  },

  listPipelineRuns(caseId: string, params?: { page?: number; limit?: number }) {
    const qs = new URLSearchParams();
    if (params?.page) qs.set("page", String(params.page));
    if (params?.limit) qs.set("limit", String(params.limit));
    const q = qs.toString();
    return apiFetch<{ runs: unknown[]; total: number; page: number; limit: number }>(
      `/osint/case/${encodeURIComponent(caseId)}/investigation/runs${q ? `?${q}` : ""}`,
    );
  },

  getReport(caseId: string) {
    return apiFetch<{
      caseNumber: string;
      generatedAt?: string;
      runId: string;
      status: "idle" | "running" | "completed" | "failed";
      markdown: string;
      json: Record<string, unknown> | null;
      finalReport: string;
      phase: OsintPhase;
    }>(`/osint/case/${encodeURIComponent(caseId)}/investigation/report`);
  },

  getGraph(caseId: string) {
    return apiFetch<import("./types").GraphResponse>(
      `/osint/case/${encodeURIComponent(caseId)}/investigation/graph`,
    );
  },

  getMaltegoExportUrl(caseId: string): string {
    return `${API_BASE}/osint/case/${encodeURIComponent(caseId)}/investigation/maltego-export`;
  },

  // ── Entity dispatch (report → respective entity routing) ──
  getDispatch(caseId: string) {
    return apiFetch<{ dispatch: import("./types").DispatchPlan | null; exists: boolean }>(
      `/osint/case/${encodeURIComponent(caseId)}/investigation/dispatch`,
    );
  },

  planDispatch(caseId: string, opts?: { regenerate?: boolean }) {
    return apiFetch<{
      dispatch: import("./types").DispatchPlan;
      regenerated: boolean;
      unrouted: string[];
    }>(`/osint/case/${encodeURIComponent(caseId)}/investigation/dispatch/plan`, {
      method: "POST",
      body: JSON.stringify(opts ?? {}),
    });
  },

  patchDispatchRecipient(
    caseId: string,
    dispatchId: string,
    recipientId: string,
    body: {
      status?: import("./types").DispatchRecipientStatus;
      statusNote?: string;
      confirmationRef?: string;
      contactEmail?: string;
      contactPortal?: string;
    },
  ) {
    return apiFetch<{ dispatch: import("./types").DispatchPlan }>(
      `/osint/case/${encodeURIComponent(caseId)}/investigation/dispatch/${encodeURIComponent(dispatchId)}/recipient/${encodeURIComponent(recipientId)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    );
  },

  getDispatchEmlUrl(caseId: string, dispatchId: string, recipientId: string): string {
    return `${API_BASE}/osint/case/${encodeURIComponent(caseId)}/investigation/dispatch/${encodeURIComponent(dispatchId)}/recipient/${encodeURIComponent(recipientId)}/eml`;
  },

  /** Chain-of-custody download: JSON { presignedUrl } when MinIO up, else raw file body. */
  async downloadEvidenceHash(caseId: string, evidenceHashId: string): Promise<{ presignedUrl?: string; blob?: Blob }> {
    const res = await fetch(
      `${API_BASE}/osint/case/${encodeURIComponent(caseId)}/investigation/evidence/${encodeURIComponent(evidenceHashId)}/download`,
      { method: "GET", credentials: "include", headers: { ...getAuthHeader() } },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, (body as { error?: string }).error || "Download failed", body);
    }
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const data = (await res.json()) as { presignedUrl?: string };
      return { presignedUrl: data.presignedUrl };
    }
    const blob = await res.blob();
    return { blob };
  },
};

/** GRASSReport v1.0 export — DOCX and PDF only. */
export type GrassReportDownloadFormat = "pdf" | "pdf/redacted" | "docx" | "docx/redacted";

export async function downloadReport(caseId: string, format: GrassReportDownloadFormat): Promise<void> {
  const pathSeg =
    format === "pdf/redacted"
      ? "pdf/redacted"
      : format === "docx/redacted"
        ? "docx/redacted"
        : format === "docx"
          ? "docx"
          : "pdf";
  const res = await fetch(
    `${API_BASE}/osint/case/${encodeURIComponent(caseId)}/investigation/report/${pathSeg}`,
    { credentials: "include", headers: getAuthHeader() },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      (body as { error?: string }).error || `Report download failed (${res.status})`,
      body,
    );
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const ext = format.startsWith("docx") ? "docx" : "pdf";
  const suffix = format.endsWith("/redacted") ? "_redacted" : "";
  a.download = `GRASS_Investigation_Report_${caseId}${suffix}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Roles that may export full PDF / JSON (matches api SENIOR_ANALYST_ROLES). */
export const SENIOR_ANALYST_ROLE_LIST: UserRole[] = [
  "case_manager",
  "legal_team",
  "senior_analyst",
  "le_portal",
  "admin",
  "super_admin",
];

export const triageApi = {
  classify(
    text: string,
    monetaryLoss?: number,
    extras?: { complainantIsMinor?: boolean; involvesMinor?: boolean },
  ) {
    return apiFetch<TriageResult>("/triage", {
      method: "POST",
      body: JSON.stringify({
        text,
        monetaryLoss,
        complainantIsMinor: extras?.complainantIsMinor,
        involvesMinor: extras?.involvesMinor,
      }),
    });
  },
};

export type EscalationPack = {
  caseNumber: string;
  category: string;
  status: string;
  generatedAt: string;
  entities: Array<{ type: string; value: string; flags?: string[] }>;
  evidenceHashes: Array<{ fileName: string; sha256: string; sizeBytes?: number }>;
  enrichmentsSummary: Array<{ entityId: string; source: string; confidence: string; highlight: string }>;
  relatedCases: string[];
  assistPortals: Array<{ id: string; label: string; url: string; note: string }>;
  analystChecklist: string[];
  deepLinks: Record<string, string>;
};

export const escalationApi = {
  create(data: { caseId: string; actionType: string; platformTarget?: string; templateUsed?: string }) {
    return apiFetch<{ status: string; actionType: string; message: string; template?: { subject: string; body: string } }>(
      "/escalation",
      { method: "POST", body: JSON.stringify(data) },
    );
  },

  getTemplates() {
    return apiFetch<{ templates: { id: string; subject: string }[] }>("/escalation/templates");
  },

  getPack(caseId: string) {
    return apiFetch<EscalationPack>(`/escalation/pack/${encodeURIComponent(caseId)}`);
  },
};

export type NotificationFeedItem = {
  id: string;
  caseId: string;
  caseNumber: string;
  channel: string;
  message: string;
  sentAt: string;
  status: string;
};

export const notificationsApi = {
  send(data: { caseId: string; channel: "sms" | "email" | "whatsapp"; recipient: string; message: string }) {
    return apiFetch<{
      status: string;
      channel: string;
      recipient: string;
      notificationId: string;
      note?: string;
      delivery?: { ok: boolean; provider?: string; reason?: string };
    }>("/notifications/send", { method: "POST", body: JSON.stringify(data) });
  },

  history(caseId: string) {
    return apiFetch<{ caseId: string; notifications: { channel: string; message: string; sentAt: string; status: string }[] }>(
      `/notifications/history/${encodeURIComponent(caseId)}`,
    );
  },

  recent() {
    return apiFetch<{ notifications: NotificationFeedItem[] }>("/notifications/recent");
  },
};

export const authApi = {
  login(email: string, password: string) {
    return apiFetch<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },

  register(data: { name: string; email: string; password: string; phone?: string; role?: string }) {
    return apiFetch<AuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  /** Admin-only staff create — does not switch the current session cookie. */
  createStaff(data: {
    name: string;
    email: string;
    password: string;
    phone?: string;
    badgeId?: string;
    role: string;
  }) {
    return apiFetch<{ user: User }>("/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  me() {
    return apiFetch<{ user: User }>("/auth/me");
  },

  logout() {
    return apiFetch<{ message: string }>("/auth/logout", { method: "POST" });
  },

  listUsers() {
    return apiFetch<{ users: import("./types").TeamUserRow[] }>("/auth/users");
  },
};

export const adminApi = {
  listAudit(params?: {
    action?: string;
    userId?: string;
    resourceId?: string;
    outcome?: "SUCCESS" | "FAILURE" | "ALL";
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }) {
    const qs = new URLSearchParams();
    if (params?.action) qs.set("action", params.action);
    if (params?.userId) qs.set("userId", params.userId);
    if (params?.resourceId) qs.set("resourceId", params.resourceId);
    if (params?.outcome) qs.set("outcome", params.outcome);
    if (params?.from) qs.set("from", params.from);
    if (params?.to) qs.set("to", params.to);
    if (params?.page) qs.set("page", String(params.page));
    if (params?.limit) qs.set("limit", String(params.limit));
    const q = qs.toString();
    return apiFetch<{ rows: AuditEventRow[]; total: number; page: number; limit: number }>(
      `/admin/audit${q ? `?${q}` : ""}`,
    );
  },

  getAuditCsvUrl(params?: {
    action?: string;
    userId?: string;
    resourceId?: string;
    outcome?: "SUCCESS" | "FAILURE" | "ALL";
    from?: string;
    to?: string;
  }): string {
    const qs = new URLSearchParams();
    if (params?.action) qs.set("action", params.action);
    if (params?.userId) qs.set("userId", params.userId);
    if (params?.resourceId) qs.set("resourceId", params.resourceId);
    if (params?.outcome) qs.set("outcome", params.outcome);
    if (params?.from) qs.set("from", params.from);
    if (params?.to) qs.set("to", params.to);
    const q = qs.toString();
    return `${API_BASE}/admin/audit/export/csv${q ? `?${q}` : ""}`;
  },


  listRetentionLog(params?: { from?: string; to?: string; page?: number; limit?: number }) {
    const qs = new URLSearchParams();
    if (params?.from) qs.set("from", params.from);
    if (params?.to) qs.set("to", params.to);
    if (params?.page) qs.set("page", String(params.page));
    if (params?.limit) qs.set("limit", String(params.limit));
    const q = qs.toString();
    return apiFetch<{ rows: RetentionAuditRow[]; total: number; page: number; limit: number }>(
      `/admin/retention-log${q ? `?${q}` : ""}`,
    );
  },

  previewRetention() {
    return apiFetch<{
      preview: {
        eligibleEvidenceCases: number;
        eligibleReportCases: number;
        protectedByProsecution: number;
        pendingErasureCases: number;
      };
      lastCycle?: RetentionAuditRow;
    }>("/admin/retention/preview");
  },

  runRetentionNow() {
    return apiFetch<{ result: Record<string, unknown> }>("/admin/retention/run", {
      method: "POST",
    });
  },

  listErasureRequests(status: "ALL" | "NONE" | "PENDING" | "APPROVED" | "DENIED" = "ALL") {
    const qs = new URLSearchParams({ status });
    return apiFetch<{
      rows: Array<{
        caseNumber: string;
        erasureRequestStatus: string;
        erasureRequestedAt?: string;
        erasureResolvedAt?: string;
        activeProsecution: boolean;
        retentionDeletedAt?: string;
      }>;
    }>(`/admin/erasure-requests?${qs.toString()}`);
  },

  resolveErasure(caseId: string, body: { decision: "APPROVED" | "DENIED"; reason?: string }) {
    return apiFetch<{ status: string; caseNumber: string }>(
      `/admin/erasure-requests/${encodeURIComponent(caseId)}/resolve`,
      { method: "PATCH", body: JSON.stringify(body) },
    );
  },

  getSettings() {
    return apiFetch<{
      ai: {
        provider: string;
        baseUrl: string;
        model: string;
        visionEnabled: boolean;
        toolsEnabled: boolean;
        fromSettings: boolean;
        hasApiKey: boolean;
        apiKeyMasked: string;
        isCloud: boolean;
      };
      providers: Array<{ id: string; label: string; baseUrl: string }>;
      catalog: Array<{ id: string; label: string; group: string; hint?: string }>;
      keys: Array<{
        id: string;
        label: string;
        group: string;
        configured: boolean;
        source: "settings" | "env" | "none";
        masked: string;
        custom?: boolean;
        hint?: string;
      }>;
    }>("/admin/settings");
  },

  updateAiSettings(body: {
    provider: string;
    apiKey?: string;
    clearApiKey?: boolean;
    baseUrl?: string;
    model?: string;
    visionEnabled?: boolean | null;
    toolsEnabled?: boolean | null;
  }) {
    return apiFetch<{ ok: boolean; ai: Record<string, unknown> }>("/admin/settings/ai", {
      method: "PUT",
      body: JSON.stringify(body),
    });
  },

  updateIntegrationKey(body: { id: string; value?: string; clear?: boolean; label?: string }) {
    return apiFetch<{
      ok: boolean;
      keys: Array<{
        id: string;
        label: string;
        group: string;
        configured: boolean;
        source: "settings" | "env" | "none";
        masked: string;
        custom?: boolean;
        hint?: string;
      }>;
    }>("/admin/settings/keys", {
      method: "PUT",
      body: JSON.stringify(body),
    });
  },

  deleteIntegrationKey(id: string) {
    return apiFetch<{ ok: boolean; keys: Array<Record<string, unknown>> }>(
      `/admin/settings/keys/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
  },

  testAiSettings(model?: string) {
    return apiFetch<{
      ok: boolean;
      model?: string;
      provider?: string;
      baseUrl?: string;
      reply?: string;
      error?: string;
    }>("/admin/settings/ai/test", {
      method: "POST",
      body: JSON.stringify(model ? { model } : {}),
    });
  },
};


// ── Threat-intelligence graph (cross-case) ─────────────────────────────
export const threatGraphApi = {
  global(params: {
    from?: string;
    to?: string;
    entityTypes?: string[];
    minCaseCount?: number;
    minConfidence?: string;
    nodeLimit?: number;
  } = {}) {
    const qs = new URLSearchParams();
    if (params.from) qs.set("from", params.from);
    if (params.to) qs.set("to", params.to);
    if (params.entityTypes) {
      for (const t of params.entityTypes) qs.append("entityTypes", t);
    }
    if (params.minCaseCount) qs.set("minCaseCount", String(params.minCaseCount));
    if (params.minConfidence) qs.set("minConfidence", params.minConfidence);
    if (params.nodeLimit) qs.set("nodeLimit", String(params.nodeLimit));
    const q = qs.toString();
    return apiFetch<import("./types").ThreatGraphSlice>(
      "/threat-graph/global" + (q ? "?" + q : ""),
    );
  },

  entity(type: string, value: string, params: { nodeLimit?: number; from?: string; to?: string } = {}) {
    const qs = new URLSearchParams();
    if (params.nodeLimit) qs.set("nodeLimit", String(params.nodeLimit));
    if (params.from) qs.set("from", params.from);
    if (params.to) qs.set("to", params.to);
    const q = qs.toString();
    return apiFetch<import("./types").ThreatGraphSlice>(
      "/threat-graph/entity/" +
        encodeURIComponent(type) +
        "/" +
        encodeURIComponent(value) +
        (q ? "?" + q : ""),
    );
  },

  topThreats(params: { from?: string; to?: string; entityTypes?: string[]; minCaseCount?: number } = {}) {
    const qs = new URLSearchParams();
    if (params.from) qs.set("from", params.from);
    if (params.to) qs.set("to", params.to);
    if (params.entityTypes) {
      for (const t of params.entityTypes) qs.append("entityTypes", t);
    }
    if (params.minCaseCount) qs.set("minCaseCount", String(params.minCaseCount));
    const q = qs.toString();
    return apiFetch<{ topThreats: import("./types").ThreatEntityRow[] }>(
      "/threat-graph/top-threats" + (q ? "?" + q : ""),
    );
  },
};

export type SupportPartner = {
  id: string;
  name: string;
  supportType: "legal" | "psychological";
  specialization: string;
  available: boolean;
};

export type SupportBooking = {
  id: string;
  caseId?: string;
  supportType: "legal" | "psychological";
  advisorId?: string;
  partnerName?: string;
  scheduledAt?: string;
  notes?: string;
  contactPreference?: "call" | "video" | "either";
  status: "requested" | "confirmed" | "completed" | "cancelled";
  createdAt?: string;
};

export const supportApi = {
  partners() {
    return apiFetch<{ partners: SupportPartner[] }>("/support/partners");
  },
  myBookings() {
    return apiFetch<{ bookings: SupportBooking[] }>("/support/bookings/mine");
  },
  book(input: {
    caseId?: string;
    supportType: "legal" | "psychological";
    partnerId: string;
    scheduledAt?: string;
    notes?: string;
    contactPreference?: "call" | "video" | "either";
  }) {
    return apiFetch<{ booking: SupportBooking }>("/support/bookings", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
};
