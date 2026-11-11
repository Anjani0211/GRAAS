"use client";

import { useEffect, useMemo, useState } from "react";
import { AdminHeader } from "@/components/layout/admin-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { adminApi } from "@/lib/api";
import type { AuditEventRow, RetentionAuditRow } from "@/lib/types";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSearch,
  Loader2,
  Shield,
  Trash2,
} from "lucide-react";

type AuditOutcome = "ALL" | "SUCCESS" | "FAILURE";
type TabKey = "audit" | "retention" | "erasure";

type BannerMessage = { type: "ok" | "err"; text: string };

const TABS: { key: TabKey; label: string; icon: typeof FileSearch }[] = [
  { key: "audit", label: "Audit Events", icon: FileSearch },
  { key: "retention", label: "Retention Log", icon: Trash2 },
  { key: "erasure", label: "Erasure Requests", icon: Shield },
];

const thClass =
  "px-4 py-3 font-mono-technical text-[10px] font-bold uppercase tracking-widest text-muted-foreground sm:px-6";

function TableSkeleton({ cols, rows = 6 }: { cols: number; rows?: number }) {
  return (
    <div className="divide-y divide-black/[0.06]">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 px-4 py-4 sm:px-6">
          {Array.from({ length: cols }).map((__, j) => (
            <div key={j} className="h-4 flex-1 animate-pulse rounded bg-muted/70" />
          ))}
        </div>
      ))}
    </div>
  );
}

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
  const [message, setMessage] = useState<BannerMessage | null>(null);
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
    setMessage(null);
    try {
      const res = await adminApi.runRetentionNow();
      setMessage({
        type: "ok",
        text: `Retention cycle complete. Evidence deleted: ${(res.result.evidenceDeleted as number) ?? 0}`,
      });
      await loadRetention();
    } finally {
      setLoading(false);
    }
  }

  async function resolveErasure(caseNumber: string, decision: "APPROVED" | "DENIED"): Promise<void> {
    setLoading(true);
    setMessage(null);
    try {
      await adminApi.resolveErasure(caseNumber, { decision });
      setMessage({ type: "ok", text: `Erasure ${decision.toLowerCase()} for ${caseNumber}` });
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

  async function exportCsv(): Promise<void> {
    setMessage(null);
    try {
      const r = await fetch(csvUrl, { credentials: "include" });
      if (!r.ok) throw new Error("Export failed");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit_export_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage({ type: "ok", text: "Audit log exported as CSV." });
    } catch {
      setMessage({ type: "err", text: "CSV export failed. Check your connection and filters, then retry." });
    }
  }

  return (
    <>
      <AdminHeader title="Audit & Compliance" />
      <div className="space-y-6 p-6 sm:p-8">
        <p className="text-sm text-muted-foreground">
          Immutable audit trail, retention cycles, and erasure request workflows.
        </p>

        <div className="flex flex-wrap gap-2">
          {TABS.map(({ key, label, icon: Icon }) => (
            <Button
              key={key}
              type="button"
              size="sm"
              variant={tab === key ? "default" : "outline"}
              className={tab === key ? "" : "border-black/[0.08]"}
              onClick={() => {
                setTab(key);
                setPage(1);
                setMessage(null);
              }}
            >
              <Icon className="size-4" />
              {label}
            </Button>
          ))}
        </div>

        {message ? (
          <div
            className={`flex items-start gap-2 rounded-xl px-4 py-3 text-sm ${
              message.type === "ok"
                ? "bg-emerald-500/10 text-emerald-800"
                : "bg-destructive/10 text-destructive"
            }`}
          >
            {message.type === "ok" ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            ) : (
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
            )}
            <span>{message.text}</span>
          </div>
        ) : null}

        {tab === "audit" ? (
          <section className="space-y-4">
            <Card className="stitch-glass border-black/[0.06]">
              <CardHeader className="pb-2">
                <CardTitle className="font-mono-technical text-sm font-bold uppercase tracking-wider text-primary">
                  Filters
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="audit-action">Action</Label>
                    <Input
                      id="audit-action"
                      placeholder="e.g. case.update"
                      value={action}
                      onChange={(e) => setAction(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="audit-user">User ID</Label>
                    <Input
                      id="audit-user"
                      placeholder="User identifier"
                      value={userId}
                      onChange={(e) => setUserId(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="audit-resource">Resource ID</Label>
                    <Input
                      id="audit-resource"
                      placeholder="Case or resource"
                      value={resourceId}
                      onChange={(e) => setResourceId(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="audit-outcome">Outcome</Label>
                    <Select
                      id="audit-outcome"
                      value={outcome}
                      onChange={(e) => setOutcome(e.target.value as AuditOutcome)}
                      options={[
                        { value: "ALL", label: "All outcomes" },
                        { value: "SUCCESS", label: "Success" },
                        { value: "FAILURE", label: "Failure" },
                      ]}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="audit-from">From</Label>
                    <Input id="audit-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="audit-to">To</Label>
                    <Input id="audit-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={() => {
                      setPage(1);
                      void loadAudit();
                    }}
                    disabled={loading}
                  >
                    Apply filters
                  </Button>
                  <Button type="button" variant="outline" disabled={loading} onClick={() => void exportCsv()}>
                    <Download className="size-4" />
                    Export CSV
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="stitch-glass overflow-hidden border-black/[0.06] p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-black/[0.06] bg-muted/40">
                      <th className={thClass}>Timestamp</th>
                      <th className={thClass}>Action</th>
                      <th className={thClass}>User ID</th>
                      <th className={thClass}>Resource ID</th>
                      <th className={thClass}>Outcome</th>
                      <th className={thClass}>IP hash</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/[0.06]">
                    {loading ? (
                      <tr>
                        <td colSpan={6} className="p-0">
                          <TableSkeleton cols={6} />
                        </td>
                      </tr>
                    ) : auditRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-14 text-center text-sm text-muted-foreground">
                          No audit events match these filters.
                        </td>
                      </tr>
                    ) : (
                      auditRows.map((r) => (
                        <tr key={`${r.createdAt}-${r.userId}-${r.action}`} className="hover:bg-muted/30">
                          <td className="px-4 py-3 font-mono-technical text-xs sm:px-6">
                            {new Date(r.createdAt).toLocaleString()}
                          </td>
                          <td className="px-4 py-3 sm:px-6">{r.action}</td>
                          <td className="px-4 py-3 font-mono-technical text-xs sm:px-6">{`${r.userId.slice(0, 6)}***`}</td>
                          <td className="px-4 py-3 text-muted-foreground sm:px-6">{r.resourceId || "—"}</td>
                          <td className="px-4 py-3 sm:px-6">
                            <Badge variant={r.outcome === "SUCCESS" ? "success" : "danger"}>{r.outcome}</Badge>
                          </td>
                          <td className="px-4 py-3 font-mono-technical text-xs text-muted-foreground sm:px-6">{r.ip}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <span className="font-mono-technical text-xs text-muted-foreground">
                Page {page} / {pageCount}
                {total > 0 ? ` · ${total} events` : ""}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page >= pageCount || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </section>
        ) : null}

        {tab === "retention" ? (
          <section className="space-y-4">
            <Card className="stitch-glass border-black/[0.06]">
              <CardHeader>
                <CardTitle className="font-mono-technical text-sm font-bold uppercase tracking-wider text-primary">
                  Retention controls
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Button type="button" disabled={loading} onClick={() => void runRetentionNow()}>
                  {loading ? <Loader2 className="size-4 animate-spin" /> : null}
                  Run retention cycle now
                </Button>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    { label: "Eligible evidence cases", value: retentionPreview?.eligibleEvidenceCases ?? 0 },
                    { label: "Eligible report cases", value: retentionPreview?.eligibleReportCases ?? 0 },
                    { label: "Protected by prosecution", value: retentionPreview?.protectedByProsecution ?? 0 },
                    { label: "Pending erasure cases", value: retentionPreview?.pendingErasureCases ?? 0 },
                    {
                      label: "Last cycle",
                      value: lastCycle ? new Date(lastCycle.timestamp).toLocaleString() : "N/A",
                    },
                  ].map((row) => (
                    <div key={row.label} className="rounded-lg border border-black/[0.06] bg-muted/30 px-4 py-3">
                      <p className="font-mono-technical text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {row.label}
                      </p>
                      <p className="mt-1 text-sm font-medium tabular-nums">{row.value}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="stitch-glass overflow-hidden border-black/[0.06] p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-black/[0.06] bg-muted/40">
                      <th className={thClass}>Timestamp</th>
                      <th className={thClass}>Action</th>
                      <th className={thClass}>Case ID</th>
                      <th className={thClass}>Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/[0.06]">
                    {loading ? (
                      <tr>
                        <td colSpan={4} className="p-0">
                          <TableSkeleton cols={4} />
                        </td>
                      </tr>
                    ) : retentionRows.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-6 py-14 text-center text-sm text-muted-foreground">
                          No retention log entries yet.
                        </td>
                      </tr>
                    ) : (
                      retentionRows.map((r) => (
                        <tr key={`${r.timestamp}-${r.caseId || "system"}-${r.action}`} className="hover:bg-muted/30">
                          <td className="px-4 py-3 font-mono-technical text-xs sm:px-6">
                            {new Date(r.timestamp).toLocaleString()}
                          </td>
                          <td className="px-4 py-3 sm:px-6">{r.action}</td>
                          <td className="px-4 py-3 font-mono-technical text-xs sm:px-6">{r.caseId || "—"}</td>
                          <td className="px-4 py-3 text-muted-foreground sm:px-6">{r.reason || "—"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </section>
        ) : null}

        {tab === "erasure" ? (
          <section className="space-y-4">
            <Card className="stitch-glass overflow-hidden border-black/[0.06] p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-black/[0.06] bg-muted/40">
                      <th className={thClass}>Case ID</th>
                      <th className={thClass}>Status</th>
                      <th className={thClass}>Requested</th>
                      <th className={thClass}>Resolved</th>
                      <th className={thClass}>Prosecution</th>
                      <th className={thClass}>Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/[0.06]">
                    {loading ? (
                      <tr>
                        <td colSpan={6} className="p-0">
                          <TableSkeleton cols={6} />
                        </td>
                      </tr>
                    ) : erasureRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-14 text-center text-sm text-muted-foreground">
                          No erasure requests on file.
                        </td>
                      </tr>
                    ) : (
                      erasureRows.map((r) => (
                        <tr key={r.caseNumber} className="hover:bg-muted/30">
                          <td className="px-4 py-3 font-mono-technical text-sm font-semibold text-primary sm:px-6">
                            {r.caseNumber}
                          </td>
                          <td className="px-4 py-3 sm:px-6">
                            <Badge variant={r.erasureRequestStatus === "PENDING" ? "warning" : "secondary"}>
                              {r.erasureRequestStatus}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 font-mono-technical text-xs sm:px-6">
                            {r.erasureRequestedAt ? new Date(r.erasureRequestedAt).toLocaleString() : "—"}
                          </td>
                          <td className="px-4 py-3 font-mono-technical text-xs sm:px-6">
                            {r.erasureResolvedAt ? new Date(r.erasureResolvedAt).toLocaleString() : "—"}
                          </td>
                          <td className="px-4 py-3 sm:px-6">{r.activeProsecution ? "Yes" : "No"}</td>
                          <td className="px-4 py-3 sm:px-6">
                            {r.erasureRequestStatus === "PENDING" ? (
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="success"
                                  disabled={loading}
                                  onClick={() => void resolveErasure(r.caseNumber, "APPROVED")}
                                >
                                  Approve
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="destructive"
                                  disabled={loading}
                                  onClick={() => void resolveErasure(r.caseNumber, "DENIED")}
                                >
                                  Deny
                                </Button>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </section>
        ) : null}
      </div>
    </>
  );
}
