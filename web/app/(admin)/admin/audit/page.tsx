"use client";

import { useEffect, useMemo, useState } from "react";
import { adminApi } from "@/lib/api";
import type { AuditEventRow, RetentionAuditRow } from "@/lib/types";

type AuditOutcome = "ALL" | "SUCCESS" | "FAILURE";
type TabKey = "audit" | "retention" | "erasure";

export default function AuditPage() {
  const [tab, setTab] = useState<TabKey>("audit");
  const [auditRows, setAuditRows] = useState<AuditEventRow[]>([]);
  const [retentionRows, setRetentionRows] = useState<RetentionAuditRow[]>([]);
  const [erasureRows, setErasureRows] = useState<
    Array<{
      caseNumber: string;
      erasureRequestStatus: string;
      erasureRequestedAt?: string;
      erasureResolvedAt?: string;
      activeProsecution: boolean;
      retentionDeletedAt?: string;
    }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [action, setAction] = useState("");
  const [userId, setUserId] = useState("");
  const [resourceId, setResourceId] = useState("");
  const [outcome, setOutcome] = useState<AuditOutcome>("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [retentionPreview, setRetentionPreview] = useState<{
    eligibleEvidenceCases: number;
    eligibleReportCases: number;
    protectedByProsecution: number;
    pendingErasureCases: number;
  } | null>(null);
  const [lastCycle, setLastCycle] = useState<RetentionAuditRow | null>(null);

  const pageCount = useMemo(() => Math.max(1, Math.ceil(total / 50)), [total]);

  async function loadAudit(): Promise<void> {
    setLoading(true);
    try {
      const data = await adminApi.listAudit({
        action: action || undefined,
        userId: userId || undefined,
        resourceId: resourceId || undefined,
        outcome,
        from: from || undefined,
        to: to || undefined,
        page,
        limit: 50,
      });
      setAuditRows(data.rows);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }

  async function loadRetention(): Promise<void> {
    setLoading(true);
    try {
      const [log, preview] = await Promise.all([
        adminApi.listRetentionLog({ page: 1, limit: 50 }),
        adminApi.previewRetention(),
      ]);
      setRetentionRows(log.rows);
      setRetentionPreview(preview.preview);
      setLastCycle(preview.lastCycle ?? null);
    } finally {
      setLoading(false);
    }
  }

  async function loadErasure(): Promise<void> {
    setLoading(true);
    try {
      const data = await adminApi.listErasureRequests("ALL");
      setErasureRows(data.rows);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (tab === "audit") void loadAudit();
    if (tab === "retention") void loadRetention();
    if (tab === "erasure") void loadErasure();
  }, [tab, page]);

  async function runRetentionNow(): Promise<void> {
    setLoading(true);
    setMessage("");
    try {
      const res = await adminApi.runRetentionNow();
      setMessage(`Retention cycle complete. Evidence deleted: ${(res.result.evidenceDeleted as number) ?? 0}`);
      await loadRetention();
    } finally {
      setLoading(false);
    }
  }

  async function resolveErasure(caseNumber: string, decision: "APPROVED" | "DENIED"): Promise<void> {
    setLoading(true);
    setMessage("");
    try {
      await adminApi.resolveErasure(caseNumber, { decision });
      setMessage(`Erasure ${decision.toLowerCase()} for ${caseNumber}`);
      await loadErasure();
    } finally {
      setLoading(false);
    }
  }

  const csvUrl = adminApi.getAuditCsvUrl({
    action: action || undefined,
    userId: userId || undefined,
    resourceId: resourceId || undefined,
    outcome,
    from: from || undefined,
    to: to || undefined,
  });

  return (
    <main className="space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Audit and Compliance</h1>
      <div className="flex gap-2">
        <button className="rounded border px-3 py-1" onClick={() => setTab("audit")}>Audit Events</button>
        <button className="rounded border px-3 py-1" onClick={() => setTab("retention")}>Retention Log</button>
        <button className="rounded border px-3 py-1" onClick={() => setTab("erasure")}>Erasure Requests</button>
      </div>
      {message ? <p className="text-sm text-green-700">{message}</p> : null}
      {tab === "audit" ? (
        <section className="space-y-3">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <input className="rounded border p-2" placeholder="Action" value={action} onChange={(e) => setAction(e.target.value)} />
            <input className="rounded border p-2" placeholder="User ID" value={userId} onChange={(e) => setUserId(e.target.value)} />
            <input className="rounded border p-2" placeholder="Resource ID" value={resourceId} onChange={(e) => setResourceId(e.target.value)} />
            <select className="rounded border p-2" value={outcome} onChange={(e) => setOutcome(e.target.value as AuditOutcome)}>
              <option value="ALL">ALL</option>
              <option value="SUCCESS">SUCCESS</option>
              <option value="FAILURE">FAILURE</option>
            </select>
            <input className="rounded border p-2" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input className="rounded border p-2" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <button className="rounded border px-3 py-1" onClick={() => { setPage(1); void loadAudit(); }}>Apply Filters</button>
            <button
              className="rounded border px-3 py-1"
              onClick={() => {
                void fetch(csvUrl, { credentials: "include" })
                  .then((r) => {
                    if (!r.ok) throw new Error("Export failed");
                    return r.blob();
                  })
                  .then((blob) => {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `audit_export_${new Date().toISOString().slice(0, 10)}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                  })
                  .catch(() => {
                    /* surfaced via empty download */
                  });
              }}
            >
              Export CSV
            </button>
          </div>
          <table className="w-full border text-sm">
            <thead>
              <tr className="bg-muted">
                <th className="border p-2 text-left">Timestamp</th>
                <th className="border p-2 text-left">Action</th>
                <th className="border p-2 text-left">User ID (masked)</th>
                <th className="border p-2 text-left">Resource ID</th>
                <th className="border p-2 text-left">Outcome</th>
                <th className="border p-2 text-left">IP Hash</th>
              </tr>
            </thead>
            <tbody>
              {auditRows.map((r) => (
                <tr key={`${r.createdAt}-${r.userId}-${r.action}`}>
                  <td className="border p-2">{new Date(r.createdAt).toLocaleString()}</td>
                  <td className="border p-2">{r.action}</td>
                  <td className="border p-2">{`${r.userId.slice(0, 6)}***`}</td>
                  <td className="border p-2">{r.resourceId || "-"}</td>
                  <td className="border p-2">{r.outcome}</td>
                  <td className="border p-2">{r.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center gap-2">
            <button className="rounded border px-3 py-1" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
            <span className="text-sm">Page {page} / {pageCount}</span>
            <button className="rounded border px-3 py-1" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </section>
      ) : null}
      {tab === "retention" ? (
        <section className="space-y-3">
          <div className="rounded border p-3">
            <h2 className="font-medium">Retention Controls</h2>
            <button className="mt-2 rounded border px-3 py-1" disabled={loading} onClick={() => void runRetentionNow()}>
              Run Retention Cycle Now
            </button>
            <div className="mt-3 text-sm">
              <p>Eligible evidence cases: {retentionPreview?.eligibleEvidenceCases ?? 0}</p>
              <p>Eligible report cases: {retentionPreview?.eligibleReportCases ?? 0}</p>
              <p>Protected by active prosecution: {retentionPreview?.protectedByProsecution ?? 0}</p>
              <p>Pending erasure cases: {retentionPreview?.pendingErasureCases ?? 0}</p>
              <p>Last cycle: {lastCycle ? new Date(lastCycle.timestamp).toLocaleString() : "N/A"}</p>
            </div>
          </div>
          <table className="w-full border text-sm">
            <thead>
              <tr className="bg-muted">
                <th className="border p-2 text-left">Timestamp</th>
                <th className="border p-2 text-left">Action</th>
                <th className="border p-2 text-left">Case ID</th>
                <th className="border p-2 text-left">Reason</th>
              </tr>
            </thead>
            <tbody>
              {retentionRows.map((r) => (
                <tr key={`${r.timestamp}-${r.caseId || "system"}-${r.action}`}>
                  <td className="border p-2">{new Date(r.timestamp).toLocaleString()}</td>
                  <td className="border p-2">{r.action}</td>
                  <td className="border p-2">{r.caseId || "-"}</td>
                  <td className="border p-2">{r.reason || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
      {tab === "erasure" ? (
        <section className="space-y-3">
          <table className="w-full border text-sm">
            <thead>
              <tr className="bg-muted">
                <th className="border p-2 text-left">Case ID</th>
                <th className="border p-2 text-left">Status</th>
                <th className="border p-2 text-left">Requested</th>
                <th className="border p-2 text-left">Resolved</th>
                <th className="border p-2 text-left">Prosecution</th>
                <th className="border p-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {erasureRows.map((r) => (
                <tr key={r.caseNumber}>
                  <td className="border p-2">{r.caseNumber}</td>
                  <td className="border p-2">{r.erasureRequestStatus}</td>
                  <td className="border p-2">{r.erasureRequestedAt ? new Date(r.erasureRequestedAt).toLocaleString() : "-"}</td>
                  <td className="border p-2">{r.erasureResolvedAt ? new Date(r.erasureResolvedAt).toLocaleString() : "-"}</td>
                  <td className="border p-2">{r.activeProsecution ? "YES" : "NO"}</td>
                  <td className="border p-2">
                    {r.erasureRequestStatus === "PENDING" ? (
                      <div className="flex gap-2">
                        <button className="rounded border px-2 py-1" onClick={() => void resolveErasure(r.caseNumber, "APPROVED")}>Approve</button>
                        <button className="rounded border px-2 py-1" onClick={() => void resolveErasure(r.caseNumber, "DENIED")}>Deny</button>
                      </div>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
      {loading ? <p className="text-sm text-muted-foreground">Loading...</p> : null}
    </main>
  );
}
