"use client";

import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { AdminHeader } from "@/components/layout/admin-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  useOsintInvestigation,
  useOsintAddEvidence,
  useOsintPatchEvidence,
  useOsintDeleteEvidence,
  useOsintPatchDraft,
  useOsintFinalize,
  useOsintSubmitLe,
  useOsintRunTool,
  useOsintDeleteTool,
} from "@/lib/queries";
import { API_BASE, osintApi, downloadReport, SENIOR_ANALYST_ROLE_LIST, type GrassReportDownloadFormat } from "@/lib/api";
import type { GraphNode, ClusterAlertType } from "@/lib/types";
import { simulateOcrFromFileName } from "@/lib/osint-utils";
import { categoryConfig, statusConfig, cn } from "@/lib/utils";
import { useAuthStore } from "@/lib/store";
import { resolveRefreshedScreenshotHref, screenshotHref } from "@/lib/screenshot-links";
import { DispatchPanel } from "@/components/osint/dispatch-panel";

// Dynamically imported to avoid SSR issues with canvas
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

import type {
  OsintConfidence,
  OsintEntity,
  OsintEntityType,
  OsintEnrichment,
  OsintCluster,
  OsintHashRecord,
  OsintCustomTool,
  OsintRunEvent,
  OsintRunStage,
  OsintToolKind,
  OsintInvestigation as OsintInvestigationT,
} from "@/lib/types";
import { useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  ArrowLeft,
  Play,
  RotateCw,
  CheckCircle2,
  AlertCircle,
  CircleDashed,
  Lock,
  Bot,
  Radar,
  Network,
  FileText,
  Trash2,
  Sparkles,
  Shield,
  Hash,
  Phone as PhoneIcon,
  AtSign,
  Link2,
  Globe,
  Wallet,
  MessageSquare,
  BadgeCheck,
  Eye,
  Download,
  Printer,
  Plus,
  Wrench,
} from "lucide-react";

type StageStatus = "idle" | "running" | "queued" | "completed" | "failed";

type PipelineLog = {
  id: string;
  ts: string;
  level: "info" | "success" | "error" | "warn";
  stage: OsintRunStage;
  message: string;
  thumbnailB64?: string;
  toolName?: string;
  callId?: string;
};

const STAGES: Array<{ id: OsintRunStage; label: string; icon: typeof Lock; blurb: string }> = [
  {
    id: "intake",
    label: "Secure Intake & Hashing",
    icon: Lock,
    blurb: "Append-only SHA-256 manifest; chain of custody locked under BSA §63.",
  },
  {
    id: "parse",
    label: "Multimodal Parsing",
    icon: Bot,
    blurb: "Forensic entity extraction with Pydantic-style schema validation.",
  },
  {
    id: "osint",
    label: "OSINT Enrichment",
    icon: Radar,
    blurb: "Live enrichment via WhoisXML & VirusTotal with confidence grading.",
  },
  {
    id: "correlation",
    label: "Correlation & Graph Analysis",
    icon: Network,
    blurb: "Cross-case cluster detection and modus-operandi classification.",
  },
  {
    id: "report",
    label: "Report Generation & HITL",
    icon: FileText,
    blurb: "GRASSReport v1.0 auto-composed; analyst badge required before LE dispatch.",
  },
];

const LE_OPTIONS = [
  "State Cyber Crime Police Station",
  "District Cyber Cell",
  "NCRP / 1930 portal (reference)",
  "CERT-In",
  "Interpol (cross-border)",
];

const CONFIDENCE_META: Record<OsintConfidence, { cls: string; dot: string }> = {
  VERIFIED: { cls: "border-emerald-300 bg-emerald-50 text-emerald-800", dot: "bg-emerald-500" },
  HIGH: { cls: "border-blue-300 bg-blue-50 text-blue-800", dot: "bg-blue-500" },
  MEDIUM: { cls: "border-amber-300 bg-amber-50 text-amber-800", dot: "bg-amber-500" },
  LOW: { cls: "border-gray-300 bg-gray-50 text-gray-700", dot: "bg-gray-400" },
  UNVERIFIED: { cls: "border-red-300 bg-red-50 text-red-700", dot: "bg-red-500" },
};

const ENTITY_META: Record<OsintEntityType, { label: string; icon: typeof PhoneIcon }> = {
  phone: { label: "Phone", icon: PhoneIcon },
  upi: { label: "UPI ID", icon: AtSign },
  email: { label: "Email", icon: AtSign },
  url: { label: "URL", icon: Link2 },
  domain: { label: "Domain", icon: Globe },
  ipv4: { label: "IPv4", icon: Network },
  wallet: { label: "Crypto wallet", icon: Wallet },
  telegram: { label: "Telegram", icon: MessageSquare },
};

const TOOL_OPTIONS: Array<{ kind: OsintToolKind; label: string; placeholder: string; icon: typeof Globe }> = [
  { kind: "whois", label: "WHOIS domain lookup", placeholder: "example.com", icon: Globe },
  { kind: "ip", label: "IP reputation (VirusTotal)", placeholder: "8.8.8.8", icon: Network },
  { kind: "urlscan", label: "URL / domain reputation (VirusTotal)", placeholder: "https://bad.example.com", icon: Link2 },
  { kind: "shodan", label: "Shodan (stub)", placeholder: "apache 2.4 country:IN", icon: Radar },
];

function shortHash(h: string): string {
  return h && h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h || "";
}

function nowIso() {
  return new Date().toISOString();
}

/** Minimal safe markdown renderer for the GRASSReport subset (headings, bold, tables, bullets, code). */
function renderMarkdown(md: string): string {
  if (!md) return "";
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const inline = (s: string) =>
    escape(s)
      .replace(/`([^`]+)`/g, '<code class="rounded bg-secondary px-1 py-0.5 text-[11px]">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inTable = false;
  let inCode = false;
  let inList = false;

  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };
  const closeTable = () => {
    if (inTable) {
      out.push("</tbody></table></div>");
      inTable = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    if (line.startsWith("```")) {
      closeList();
      closeTable();
      if (inCode) {
        out.push("</code></pre>");
      } else {
        out.push('<pre class="mt-2 overflow-auto rounded-lg border border-border bg-secondary/60 p-3 text-[11px]"><code>');
      }
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(escape(line));
      continue;
    }

    if (/^#{1,3}\s/.test(line)) {
      closeList();
      closeTable();
      const level = line.match(/^#{1,3}/)![0].length;
      const text = line.replace(/^#{1,3}\s+/, "");
      const size =
        level === 1 ? "text-xl font-bold mt-4" : level === 2 ? "text-base font-bold mt-4 text-foreground" : "text-sm font-semibold mt-3 text-foreground";
      out.push(`<h${level} class="${size}">${inline(text)}</h${level}>`);
      continue;
    }

    if (line.startsWith("|") && line.endsWith("|")) {
      const isSeparator = /^\|\s*[:-]+\s*(\|\s*[:-]+\s*)+\|$/.test(line);
      if (isSeparator) continue;
      const cells = line
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim());
      if (!inTable) {
        closeList();
        out.push('<div class="my-3 overflow-x-auto rounded-lg border border-border"><table class="w-full min-w-[520px] text-xs"><thead class="bg-secondary/40 text-left"><tr>');
        for (const c of cells) out.push(`<th class="px-3 py-2 font-medium text-muted-foreground">${inline(c)}</th>`);
        out.push("</tr></thead><tbody>");
        inTable = true;
      } else {
        out.push('<tr class="border-t border-border/60">');
        for (const c of cells) out.push(`<td class="px-3 py-2 align-top">${inline(c)}</td>`);
        out.push("</tr>");
      }
      continue;
    } else if (inTable) {
      closeTable();
    }

    if (line.startsWith("- ")) {
      if (!inList) {
        out.push('<ul class="ml-5 list-disc space-y-1 text-sm">');
        inList = true;
      }
      out.push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    } else if (inList && line.trim() === "") {
      closeList();
      continue;
    } else if (inList) {
      closeList();
    }

    if (line.trim() === "") {
      out.push("");
    } else {
      out.push(`<p class="mt-2 text-sm leading-6">${inline(line)}</p>`);
    }
  }
  closeList();
  closeTable();
  if (inCode) out.push("</code></pre>");
  return out.join("\n");
}

export default function OsintCaseWorkspacePage() {
  const params = useParams();
  const search = useSearchParams();
  const caseId = String(params.caseId ?? "");
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const canFinalize = user ? SENIOR_ANALYST_ROLE_LIST.includes(user.role) : false;
  const [reportExportErr, setReportExportErr] = useState<string | null>(null);

  const runReportDownload = useCallback(
    async (format: GrassReportDownloadFormat) => {
      setReportExportErr(null);
      try {
        await downloadReport(caseId, format);
      } catch (err) {
        setReportExportErr(err instanceof Error ? err.message : "Report download failed");
      }
    },
    [caseId],
  );

  // Graph state
  const [selectedGraphNode, setSelectedGraphNode] = useState<GraphNode | null>(null);
  const [showGraph, setShowGraph] = useState(false);
  const graphQuery = useQuery({
    queryKey: ["osint-graph", caseId],
    queryFn: () => osintApi.getGraph(caseId),
    enabled: showGraph && !!caseId,
    staleTime: 60_000,
  });

  const { data, isLoading, isError, error } = useOsintInvestigation(caseId);
  const caseData = data?.case;
  const inv: OsintInvestigationT | undefined = data?.investigation;
  const screenshotQuery = useQuery({
    queryKey: ["osintAgentScreenshots", caseId, inv?.lastRunId || ""],
    queryFn: () => osintApi.getAgentScreenshots(caseId, inv?.lastRunId || undefined),
    enabled: !!caseId && !!inv?.lastRunId,
    staleTime: 15_000,
  });
  const addEv = useOsintAddEvidence();
  const patchEv = useOsintPatchEvidence();
  const delEv = useOsintDeleteEvidence();
  const patchDraft = useOsintPatchDraft();
  const finalize = useOsintFinalize();
  const submitLe = useOsintSubmitLe();
  const runTool = useOsintRunTool();
  const delTool = useOsintDeleteTool();

  const screenshotPathByCallId = useMemo(() => {
    const map = new Map<string, string>();
    for (const shot of screenshotQuery.data?.screenshots ?? []) {
      map.set(shot.callId, screenshotHref(API_BASE, shot.downloadPath));
    }
    return map;
  }, [screenshotQuery.data?.screenshots]);
  const openFullScreenshot = useCallback(
    async (callId: string) => {
      const fresh = await screenshotQuery.refetch();
      const href = resolveRefreshedScreenshotHref(
        callId,
        API_BASE,
        fresh.data?.screenshots,
        screenshotPathByCallId,
      );
      if (!href) return;
      window.open(href, "_blank", "noopener,noreferrer");
    },
    [screenshotPathByCallId, screenshotQuery],
  );

  // Editable drafts (for manual edits before finalise/submit)
  const [draftText, setDraftText] = useState("");
  const [finalText, setFinalText] = useState("");
  const evidenceFileInputRef = useRef<HTMLInputElement>(null);

  // Live pipeline overlay (during streaming run)
  const [pipelineStatus, setPipelineStatus] = useState<StageStatus>("idle");
  const [stageStatus, setStageStatus] = useState<Record<OsintRunStage, StageStatus>>({
    intake: "idle",
    parse: "idle",
    osint: "idle",
    correlation: "idle",
    report: "idle",
  });
  const [logs, setLogs] = useState<PipelineLog[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // LE handoff
  const [leAgency, setLeAgency] = useState(LE_OPTIONS[0]);
  const [leDistrict, setLeDistrict] = useState("");
  const [leRef, setLeRef] = useState("");
  const [analystId, setAnalystId] = useState("");

  // Report view mode (inline preview vs editable source)
  const [reportView, setReportView] = useState<"preview" | "source">("preview");

  // Add-tool form
  const [toolKind, setToolKind] = useState<OsintToolKind>("whois");
  const [toolQuery, setToolQuery] = useState("");
  const [toolAttach, setToolAttach] = useState(true);

  const stageRefs = {
    intake: useRef<HTMLDivElement>(null),
    parse: useRef<HTMLDivElement>(null),
    osint: useRef<HTMLDivElement>(null),
    correlation: useRef<HTMLDivElement>(null),
    report: useRef<HTMLDivElement>(null),
  } as const;

  // Sync editable fields from server truth
  useEffect(() => {
    if (inv) {
      setDraftText(inv.draftReport || inv.reportMarkdown || "");
      setFinalText(inv.finalReport || "");
    }
  }, [inv?.draftReport, inv?.finalReport, inv?.reportMarkdown, caseId]);

  // If we come back to a completed run, reflect its status
  useEffect(() => {
    if (!inv) return;
    if (inv.lastRunStatus === "completed" && pipelineStatus === "idle") {
      setStageStatus({
        intake: "completed",
        parse: "completed",
        osint: "completed",
        correlation: "completed",
        report: "completed",
      });
      setPipelineStatus("completed");
    }
  }, [inv?.lastRunStatus]);

  const pushLog = useCallback(
    (
      stage: OsintRunStage,
      message: string,
      level: PipelineLog["level"] = "info",
      extra?: Pick<PipelineLog, "thumbnailB64" | "toolName">,
      callId?: string,
    ) => {
      setLogs((prev) =>
        [
          {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            ts: nowIso(),
            stage,
            level,
            message,
            thumbnailB64: extra?.thumbnailB64,
            toolName: extra?.toolName,
            callId,
          },
          ...prev,
        ].slice(0, 120),
      );
    },
    [],
  );

  const setStage = useCallback(
    (id: OsintRunStage, status: StageStatus) => {
      setStageStatus((prev) => ({ ...prev, [id]: status }));
      if (status === "running") {
        stageRefs[id].current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },
    // stageRefs is stable (refs are mutable)
    [],
  );

  const runInvestigation = useCallback(async () => {
    if (!caseData || pipelineStatus === "running" || pipelineStatus === "queued") return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setPipelineStatus("running");
    setStageStatus({ intake: "idle", parse: "idle", osint: "idle", correlation: "idle", report: "idle" });
    setLogs([]);

    try {
      await osintApi.runInvestigation(
        caseId,
        (event: OsintRunEvent) => {
          switch (event.type) {
            case "run_started":
              pushLog("intake", `Run ${event.runId.slice(0, 8)} started`, "info");
              break;
            case "stage_started":
              setStage(event.stage, "running");
              pushLog(event.stage, `Stage ${event.stage} started.`, "info");
              break;
            case "stage_log":
              pushLog(event.stage, event.message, event.level);
              break;
            case "stage_completed":
              setStage(event.stage, "completed");
              pushLog(event.stage, `Stage ${event.stage} completed.`, "success");
              break;
            case "stage_failed":
              setStage(event.stage, "failed");
              pushLog(event.stage, event.message, "error");
              break;
            case "stage_skipped":
              pushLog(event.stage, `Skipped (${event.reason})`, "warn");
              break;
            case "run_queued":
              setPipelineStatus("queued");
              pushLog("intake", `Queued (job ${event.jobId}, ${event.priority}) — polling for completion…`, "warn");
              break;
            case "agent_iteration":
              pushLog("osint", `AI iteration ${event.iterNum}: ${event.toolName} — ${event.reasoning}`, "info");
              break;
            case "agent_screenshot":
              pushLog(
                "osint",
                `Screenshot captured for ${event.toolName} (${event.callId.slice(0, 8)}...)`,
                "success",
                { thumbnailB64: event.thumbnailB64, toolName: event.toolName },
                event.callId,
              );
              break;
            case "agent_new_lead":
              pushLog("osint", `New lead: ${event.entityType} ${event.entity} (from ${event.foundIn.slice(0, 8)}...)`, "warn");
              break;
            case "agent_complete":
              pushLog("report", `Agent complete: ${event.exitReason} after ${event.totalCalls} calls. ${event.summary}`, "success");
              break;
            case "done":
              setPipelineStatus("completed");
              pushLog("report", "Pipeline finished. Report persisted.", "success");
              qc.setQueryData(["osintInvestigation", caseId], (prev: unknown) => {
                if (!prev || typeof prev !== "object") return prev;
                return { ...(prev as Record<string, unknown>), investigation: event.investigation };
              });
              qc.invalidateQueries({ queryKey: ["osintInvestigation", caseId] });
              qc.invalidateQueries({ queryKey: ["osintAgentScreenshots", caseId] });
              break;
            case "error":
              setPipelineStatus("failed");
              pushLog("report", event.message, "error");
              break;
          }
        },
        abortRef.current.signal,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Pipeline crashed";
      setPipelineStatus("failed");
      pushLog("report", msg, "error");
    }
  }, [caseData, caseId, pipelineStatus, pushLog, qc, setStage]);

  // Auto-start via ?autostart=1 (from case page / queue)
  const didAutoStartRef = useRef(false);
  useEffect(() => {
    if (didAutoStartRef.current) return;
    if (!caseData || !inv) return;
    if (search?.get("autostart") === "1" && pipelineStatus === "idle") {
      didAutoStartRef.current = true;
      void runInvestigation();
    }
  }, [caseData, inv, pipelineStatus, runInvestigation, search]);

  useEffect(() => {
    if (pipelineStatus !== "queued") return;
    const id = window.setInterval(() => {
      void qc.invalidateQueries({ queryKey: ["osintInvestigation", caseId] });
    }, 2500);
    return () => clearInterval(id);
  }, [pipelineStatus, caseId, qc]);

  useEffect(() => {
    if (pipelineStatus !== "queued" || !inv) return;
    if (inv.lastRunStatus === "completed") {
      setPipelineStatus("completed");
      setStageStatus({
        intake: "completed",
        parse: "completed",
        osint: "completed",
        correlation: "completed",
        report: "completed",
      });
      void qc.invalidateQueries({ queryKey: ["osintInvestigation", caseId] });
    } else if (inv.lastRunStatus === "failed") {
      setPipelineStatus("failed");
      void qc.invalidateQueries({ queryKey: ["osintInvestigation", caseId] });
    }
  }, [pipelineStatus, inv, inv?.lastRunStatus, caseId, qc]);

  const onAddTool = useCallback(() => {
    if (!toolQuery.trim()) return;
    runTool.mutate(
      { caseId, kind: toolKind, query: toolQuery.trim(), attach: toolAttach },
      {
        onSuccess: () => {
          setToolQuery("");
        },
      },
    );
  }, [caseId, runTool, toolAttach, toolKind, toolQuery]);

  const handlePrint = useCallback(() => {
    if (typeof window === "undefined") return;
    const html = renderMarkdown(inv?.reportMarkdown || draftText);
    const w = window.open("", "_blank", "width=900,height=1000");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><title>${inv?.reportJson && typeof inv.reportJson === "object" ? (inv.reportJson as Record<string, unknown>).case_id ?? "GRASSReport" : "GRASSReport"}</title>
<style>
  body { font: 14px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif; color: #0a0a0a; margin: 32px; max-width: 900px; }
  h1 { font-size: 22px; }
  h2 { font-size: 16px; margin-top: 18px; border-top: 1px solid #eee; padding-top: 12px; }
  h3 { font-size: 14px; margin-top: 12px; }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; font-size: 12px; }
  th, td { border: 1px solid #e5e7eb; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #f8fafc; }
  code { background: #f1f5f9; padding: 1px 4px; border-radius: 4px; font-size: 12px; }
  pre { background: #f1f5f9; padding: 10px; border-radius: 6px; overflow: auto; }
  ul { padding-left: 20px; }
</style></head><body>${html}</body></html>`);
    w.document.close();
    setTimeout(() => {
      w.focus();
      w.print();
    }, 250);
  }, [inv?.reportMarkdown, draftText, inv?.reportJson]);

  const enrichmentByEntity = useMemo(
    () => new Map((inv?.enrichments ?? []).map((r) => [r.entityId, r])),
    [inv?.enrichments],
  );

  if (isLoading || !caseData || !inv) {
    return (
      <>
        <AdminHeader title="OSINT workspace" />
        <div className="flex justify-center py-24">
          <Loader2 className="size-10 animate-spin text-primary" />
        </div>
      </>
    );
  }

  if (isError) {
    return (
      <>
        <AdminHeader title="OSINT workspace" />
        <p className="px-6 py-12 text-sm text-red-600 sm:px-8">
          {error instanceof Error ? error.message : "Failed to load"}
        </p>
      </>
    );
  }

  const catLabel = categoryConfig[caseData.category]?.label ?? caseData.category;
  const completedStages = Object.values(stageStatus).filter((s) => s === "completed").length;
  const progressPct = Math.round((completedStages / STAGES.length) * 100);
  const hasReport = !!(inv.reportMarkdown && inv.reportMarkdown.trim().length > 0);

  return (
    <>
      <AdminHeader title={`OSINT · ${caseData.caseNumber}`} />
      <div className="mx-auto max-w-7xl px-6 pb-12 pt-2 sm:px-8">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/admin/osint">
                <ArrowLeft className="size-4 mr-1" />
                Queue
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/admin/case/${caseData.id}`}>Case record</Link>
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{catLabel}</Badge>
            <span className={statusConfig[caseData.status]?.color}>{statusConfig[caseData.status]?.label}</span>
          </div>
        </div>

        {/* Hero / Start Investigation */}
        <Card className="mb-8 overflow-hidden border-black/[0.06]">
          <CardContent className="relative p-6 sm:p-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 ring-1 ring-primary/15">
                  <span className="font-mono-technical text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
                    GRASS Pipeline · 5 stages · server-side
                  </span>
                </div>
                <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
                  Investigate <span className="font-mono-technical text-primary">{caseData.caseNumber}</span>
                </h2>
                <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                  Live server pipeline: SHA-256 hash manifest → strict entity extraction → WhoisXML / VirusTotal
                  enrichment → cross-case correlation → auto-generated GRASSReport v1.0.
                </p>
              </div>
              <div className="flex flex-col items-end gap-3">
                {pipelineStatus !== "running" && pipelineStatus !== "queued" ? (
                  <Button size="lg" onClick={runInvestigation} className="gap-2">
                    {pipelineStatus === "completed" || pipelineStatus === "failed" ? (
                      <RotateCw className="size-4" />
                    ) : (
                      <Play className="size-4" />
                    )}
                    {pipelineStatus === "completed"
                      ? "Re-run investigation"
                      : pipelineStatus === "failed"
                        ? "Retry investigation"
                        : "Start investigation"}
                  </Button>
                ) : (
                  <Button size="lg" disabled className="gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    {pipelineStatus === "queued" ? "Queued (Bull)…" : "Running…"}
                  </Button>
                )}
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">
                    Progress <span className="font-mono-technical">{progressPct}%</span>
                  </p>
                  <div className="mt-1 h-1.5 w-52 overflow-hidden rounded-full bg-secondary">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-500",
                        pipelineStatus === "failed" ? "bg-red-500" : "bg-primary",
                      )}
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-2 sm:grid-cols-5">
              {STAGES.map((s) => {
                const st = stageStatus[s.id];
                return (
                  <div
                    key={s.id}
                    className={cn(
                      "flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition-colors",
                      st === "completed"
                        ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                        : st === "running"
                          ? "border-blue-300 bg-blue-50 text-blue-900"
                          : st === "failed"
                            ? "border-red-300 bg-red-50 text-red-900"
                            : "border-border bg-card text-muted-foreground",
                    )}
                  >
                    <StageIcon status={st} />
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-semibold">{s.label}</p>
                      <p className="text-[10px] uppercase tracking-wide opacity-70">{st}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-6">
            {/* Stage 1: Intake */}
            <StageCard ref={stageRefs.intake} stage={STAGES[0]} status={stageStatus.intake}>
              <div className="space-y-4">
                <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border bg-secondary/30 p-4 sm:flex-row sm:items-center">
                  <input
                    ref={evidenceFileInputRef}
                    type="file"
                    className="sr-only"
                    accept="image/*,audio/*,video/*,.pdf,.txt"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) addEv.mutate({ caseId, file: f });
                      e.target.value = "";
                    }}
                  />
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs">Add evidence (stored in MinIO / SHA-256 chain)</Label>
                    <p className="text-[11px] text-muted-foreground">
                      Upload a forensic copy (EXIF preserved). OCR uses a stripped copy only.
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    disabled={addEv.isPending}
                    onClick={() => evidenceFileInputRef.current?.click()}
                  >
                    Choose file…
                  </Button>
                </div>

                {inv.evidenceItems.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border bg-secondary/20 p-4 text-sm text-muted-foreground">
                    No evidence uploaded. The pipeline will still run against the case description, but attaching
                    screenshots / OCR dramatically improves extraction quality.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {inv.evidenceItems.map((ev) => {
                      const h = inv.hashManifest?.find((x) => x.evidenceId === ev.id);
                      return (
                        <EvidenceRow
                          key={ev.id}
                          ev={ev}
                          hash={h}
                          caseId={caseId}
                          patchEv={patchEv}
                          delEv={delEv}
                        />
                      );
                    })}
                  </div>
                )}

                {inv.hashManifest && inv.hashManifest.length > 0 && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-xs text-emerald-900">
                    <p className="font-semibold">Hash manifest sealed</p>
                    <p className="mt-0.5">
                      {inv.hashManifest.length} file{inv.hashManifest.length === 1 ? "" : "s"} locked; any post-intake
                      modification will invalidate this chain of custody.
                    </p>
                  </div>
                )}
              </div>
            </StageCard>

            {/* Stage 2: Parsing */}
            <StageCard ref={stageRefs.parse} stage={STAGES[1]} status={stageStatus.parse}>
              {(inv.entities?.length ?? 0) === 0 && stageStatus.parse === "idle" ? (
                <EmptyStage label="Will appear after Stage 1 completes." />
              ) : (
                <div className="space-y-4">
                  {/* Gemini AI Summary card */}
                  {inv.geminiSummary && (
                    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/40">
                      <div className="flex items-center gap-2 text-xs font-semibold text-blue-700 dark:text-blue-300">
                        <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider dark:bg-blue-900">
                          Gemini AI
                        </span>
                        Incident Summary
                      </div>
                      <p className="mt-2 text-sm text-blue-900 dark:text-blue-100">{inv.geminiSummary}</p>
                      <p className="mt-1 text-xs text-blue-600 dark:text-blue-400">
                        Parser used:{" "}
                        <span className="font-medium">{inv.parserUsed === "gemini" ? "Gemini 2.0 Flash" : "Regex fallback"}</span>
                      </p>
                    </div>
                  )}

                  {/* Per-type entity counts */}
                  {inv.entities.length > 0 && (() => {
                    const counts: Partial<Record<string, number>> = {};
                    for (const e of inv.entities) counts[e.type] = (counts[e.type] ?? 0) + 1;
                    return (
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(counts).map(([type, n]) => (
                          <span key={type} className="rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs font-medium">
                            {n} {type}
                          </span>
                        ))}
                      </div>
                    );
                  })()}

                  {/* Valid entities grid */}
                  {inv.entities.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No entities detected in this corpus.</p>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {inv.entities.map((e) => (
                        <EntityCard key={e.id} entity={e} />
                      ))}
                    </div>
                  )}

                  {/* Invalid entities — HITL Review Required accordion */}
                  {(inv.invalidEntities?.length ?? 0) > 0 && (
                    <details className="group rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40">
                      <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-xs font-semibold text-amber-800 dark:text-amber-300 list-none">
                        <span>
                          ⚠ {inv.invalidEntities.length} entity value(s) — HITL Review Required
                        </span>
                        <span className="ml-2 text-amber-500 group-open:rotate-90 transition-transform">›</span>
                      </summary>
                      <div className="border-t border-amber-200 dark:border-amber-900 px-4 py-3 space-y-1">
                        <p className="text-xs text-amber-700 dark:text-amber-400 mb-2">
                          These values were extracted but failed format validation. They are stored and must be reviewed by an analyst before they can be used.
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {inv.invalidEntities.map((e) => (
                            <EntityCard key={e.id} entity={e} flaggedInvalid />
                          ))}
                        </div>
                      </div>
                    </details>
                  )}
                </div>
              )}
            </StageCard>

            {/* Stage 3: OSINT */}
            <StageCard ref={stageRefs.osint} stage={STAGES[2]} status={stageStatus.osint}>
              {(inv.enrichments?.length ?? 0) === 0 && stageStatus.osint === "idle" ? (
                <EmptyStage label="Will appear after Stage 2 completes." />
              ) : (inv.enrichments?.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing to enrich.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="bg-secondary/50 text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Entity</th>
                        <th className="px-3 py-2 font-medium">Value</th>
                        <th className="px-3 py-2 font-medium">Source</th>
                        <th className="px-3 py-2 font-medium">Confidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inv.entities.map((e) => {
                        const r = enrichmentByEntity.get(e.id);
                        const Meta = ENTITY_META[e.type];
                        const c = r?.confidence ?? "UNVERIFIED";
                        const meta = CONFIDENCE_META[c];
                        return (
                          <tr key={e.id} className="border-t border-border/70">
                            <td className="px-3 py-2">
                              <span className="inline-flex items-center gap-1.5 text-xs">
                                <Meta.icon className="size-3.5 text-muted-foreground" />
                                {Meta.label}
                              </span>
                            </td>
                            <td className="px-3 py-2 font-mono text-xs break-all">{e.value}</td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">{r?.source ?? "—"}</td>
                            <td className="px-3 py-2">
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold",
                                  meta.cls,
                                )}
                              >
                                <span className={cn("size-1.5 rounded-full", meta.dot)} />
                                {c}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </StageCard>

            {/* Stage 4: Correlation */}
            <StageCard ref={stageRefs.correlation} stage={STAGES[3]} status={stageStatus.correlation}>
              {(inv.clusters?.length ?? 0) === 0 && !inv.modusOperandi && stageStatus.correlation === "idle" ? (
                <EmptyStage label="Will appear after Stage 3 completes." />
              ) : (
                <div className="space-y-4">
                  {inv.modusOperandi && (
                    <div className="flex items-center justify-between rounded-xl border border-border bg-secondary/30 p-3">
                      <div>
                        <p className="text-xs text-muted-foreground">Modus operandi (AI suggestion)</p>
                        <p className="mt-0.5 font-mono text-sm font-semibold">{inv.modusOperandi.code}</p>
                      </div>
                      <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                        {Math.round((inv.modusOperandi.confidence ?? 0) * 100)}%
                      </span>
                    </div>
                  )}
                  {(inv.clusters?.length ?? 0) === 0 ? (
                    <p className="text-sm text-muted-foreground">No cluster alerts generated.</p>
                  ) : (
                    <ul className="space-y-2">
                      {inv.clusters.map((c) => (
                        <ClusterRow key={c.id} cluster={c} />
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </StageCard>

            {/* Add OSINT tool (analyst-driven ad-hoc lookups) */}
            <Card className="border-black/[0.06]">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Wrench className="size-4" />
                  Analyst-added OSINT tools
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Run ad-hoc lookups against WhoisXML & VirusTotal (live, using configured API keys). Results are saved
                  on this case and optionally appended to the report.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-[220px_1fr_auto]">
                  <div className="space-y-1">
                    <Label className="text-xs">Tool</Label>
                    <select
                      className="flex h-9 w-full rounded-lg border border-input bg-card px-3 text-sm"
                      value={toolKind}
                      onChange={(e) => setToolKind(e.target.value as OsintToolKind)}
                    >
                      {TOOL_OPTIONS.map((t) => (
                        <option key={t.kind} value={t.kind}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Query</Label>
                    <Input
                      value={toolQuery}
                      onChange={(e) => setToolQuery(e.target.value)}
                      placeholder={TOOL_OPTIONS.find((t) => t.kind === toolKind)?.placeholder}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && toolQuery.trim()) {
                          e.preventDefault();
                          onAddTool();
                        }
                      }}
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      onClick={onAddTool}
                      disabled={runTool.isPending || !toolQuery.trim()}
                      className="gap-1.5"
                    >
                      {runTool.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Plus className="size-4" />
                      )}
                      Run & attach
                    </Button>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={toolAttach}
                    onChange={(e) => setToolAttach(e.target.checked)}
                  />
                  Append result as evidence block in the report
                </label>
                {runTool.isError && (
                  <p className="text-xs text-red-600">
                    {runTool.error instanceof Error ? runTool.error.message : "Tool failed"}
                  </p>
                )}

                {(inv.customTools?.length ?? 0) > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground">
                      Previously run ({inv.customTools.length})
                    </p>
                    <div className="space-y-2">
                      {inv.customTools.map((t) => (
                        <ToolResultRow
                          key={t.id}
                          tool={t}
                          onDelete={() => delTool.mutate({ caseId, toolId: t.id })}
                          deleting={delTool.isPending}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Stage 5: Report + HITL (inline viewer + HITL actions) */}
            <StageCard ref={stageRefs.report} stage={STAGES[4]} status={stageStatus.report}>
              {!hasReport && stageStatus.report === "idle" ? (
                <EmptyStage label="Will appear after Stage 4 completes." />
              ) : (
                <div className="space-y-5">
                  <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3 text-xs text-blue-900">
                    <p className="flex items-center gap-2 font-semibold">
                      <Shield className="size-3.5" />
                      HITL mandatory — report cannot be dispatched to law enforcement without analyst approval.
                    </p>
                  </div>

                  {hasReport && (
                    <div className="rounded-xl border border-border bg-card">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-2">
                        <div className="flex items-center gap-2">
                          <FileText className="size-4 text-muted-foreground" />
                          <span className="text-sm font-semibold">GRASSReport v1.0</span>
                          {inv.lastRunAt && (
                            <span className="text-[11px] text-muted-foreground">
                              generated {new Date(inv.lastRunAt).toLocaleString("en-IN")}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="flex rounded-md border border-border bg-secondary/30 p-0.5 text-[11px]">
                            <button
                              type="button"
                              onClick={() => setReportView("preview")}
                              className={cn(
                                "rounded px-2 py-1",
                                reportView === "preview" ? "bg-card shadow-sm" : "text-muted-foreground",
                              )}
                            >
                              Preview
                            </button>
                            <button
                              type="button"
                              onClick={() => setReportView("source")}
                              className={cn(
                                "rounded px-2 py-1",
                                reportView === "source" ? "bg-card shadow-sm" : "text-muted-foreground",
                              )}
                            >
                              Source
                            </button>
                          </div>
                          <Button type="button" size="sm" variant="outline" onClick={handlePrint} className="gap-1">
                            <Printer className="size-3.5" />
                            Print
                          </Button>
                          {canFinalize && (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="gap-1"
                                onClick={() => void runReportDownload("docx")}
                              >
                                <Download className="size-3.5" />
                                Investigation DOCX
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="gap-1"
                                onClick={() => void runReportDownload("pdf")}
                              >
                                <Download className="size-3.5" />
                                Investigation PDF
                              </Button>
                            </>
                          )}
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="gap-1"
                            onClick={() => void runReportDownload("docx/redacted")}
                          >
                            <Download className="size-3.5" />
                            Redacted DOCX
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="gap-1"
                            onClick={() => void runReportDownload("pdf/redacted")}
                          >
                            <Download className="size-3.5" />
                            Redacted PDF
                          </Button>
                        </div>
                      </div>
                      {reportExportErr && (
                        <p className="px-4 pb-2 text-xs text-red-600">{reportExportErr}</p>
                      )}
                      {reportView === "preview" ? (
                        <div
                          className="max-h-[640px] overflow-auto p-5"
                          // eslint-disable-next-line react/no-danger
                          dangerouslySetInnerHTML={{ __html: renderMarkdown(inv.reportMarkdown || draftText) }}
                        />
                      ) : (
                        <div className="p-3">
                          <Textarea
                            className="min-h-[360px] font-mono text-xs"
                            value={draftText}
                            onChange={(e) => setDraftText(e.target.value)}
                          />
                          <div className="mt-2 flex justify-end">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                patchDraft.mutate({ caseId, draftReport: draftText, phase: "draft_report" })
                              }
                              disabled={patchDraft.isPending}
                            >
                              Save edits to draft
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Final report</Label>
                      <div className="flex gap-2">
                        {canFinalize && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={finalize.isPending || !hasReport}
                            onClick={() => {
                              finalize.mutate(
                                { caseId, finalReport: draftText || inv.reportMarkdown },
                                {
                                  onSuccess: (res) => {
                                    setFinalText(res.investigation.finalReport);
                                  },
                                },
                              );
                            }}
                          >
                            {finalize.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                            Copy draft → final
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            patchDraft.mutate({ caseId, finalReport: finalText, phase: "final_review" })
                          }
                          disabled={patchDraft.isPending}
                        >
                          Save final
                        </Button>
                      </div>
                    </div>
                    <Textarea
                      className="min-h-[160px] font-mono text-xs"
                      placeholder="Final report (after analyst review)."
                      value={finalText}
                      onChange={(e) => setFinalText(e.target.value)}
                    />
                  </div>

                  <DispatchPanel
                    caseId={caseId}
                    canDispatch={Boolean(inv.lastRunStatus === "completed" || hasReport)}
                    emptyHint={
                      !hasReport
                        ? "Run the investigation pipeline first — then the dispatch panel auto-routes recipients."
                        : undefined
                    }
                  />

                  <div className="space-y-3 rounded-xl border border-border bg-secondary/20 p-4">
                    <p className="text-sm font-semibold">Law-enforcement handoff (legacy)</p>
                    {inv.submittedToLeAt && (
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                        Submitted {new Date(inv.submittedToLeAt).toLocaleString("en-IN")} to{" "}
                        <strong>{inv.leAgency}</strong>
                        {inv.leReferenceNumber ? ` · Ref: ${inv.leReferenceNumber}` : ""}
                      </div>
                    )}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Agency</Label>
                        <select
                          className="flex h-9 w-full rounded-lg border border-input bg-card px-3 text-sm"
                          value={leAgency}
                          onChange={(e) => setLeAgency(e.target.value)}
                        >
                          {LE_OPTIONS.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Analyst badge ID (HITL)</Label>
                        <Input
                          value={analystId}
                          onChange={(e) => setAnalystId(e.target.value)}
                          placeholder="e.g. CYB-A-104"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">District</Label>
                        <Input
                          value={leDistrict}
                          onChange={(e) => setLeDistrict(e.target.value)}
                          placeholder="e.g. Bengaluru Urban"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Reference</Label>
                        <Input
                          value={leRef}
                          onChange={(e) => setLeRef(e.target.value)}
                          placeholder="FIR / portal ref"
                        />
                      </div>
                    </div>
                    <Button
                      type="button"
                      disabled={submitLe.isPending || !finalText.trim() || !analystId.trim()}
                      onClick={() =>
                        submitLe.mutate({
                          caseId,
                          leAgency,
                          leDistrict: leDistrict || undefined,
                          leReferenceNumber: leRef || undefined,
                          advanceCaseStatus: true,
                        })
                      }
                    >
                      {submitLe.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                      Approve & submit to LE
                    </Button>
                    {!analystId.trim() && (
                      <p className="text-[11px] text-amber-700">
                        Analyst badge ID is required (HITL certification block).
                      </p>
                    )}
                  </div>
                </div>
              )}
            </StageCard>
          </div>

          {/* Sidebar: live log + quick reference */}
          <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Eye className="size-4" />
                  Live activity
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-[480px] space-y-2 overflow-auto pr-1">
                  {logs.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No pipeline activity yet. Tap <strong>Start investigation</strong> to begin.
                    </p>
                  ) : (
                    logs.map((log) => (
                      <div
                        key={log.id}
                        className="rounded-md border border-border/60 bg-secondary/30 px-2 py-1.5 text-[11px]"
                      >
                        <p
                          className={cn(
                            "font-mono",
                            log.level === "success"
                              ? "text-emerald-700"
                              : log.level === "error"
                                ? "text-red-700"
                                : log.level === "warn"
                                  ? "text-amber-700"
                                  : "text-muted-foreground",
                          )}
                        >
                          {new Date(log.ts).toLocaleTimeString("en-IN")} · {log.stage}
                        </p>
                        <p className="mt-0.5 leading-snug">{log.message}</p>
                        {log.thumbnailB64 ? (
                          <div className="mt-1.5 overflow-hidden rounded border border-border/60">
                            <img
                              src={`data:image/jpeg;base64,${log.thumbnailB64}`}
                              alt={`${log.toolName || "tool"} thumbnail`}
                              className="h-auto w-full"
                            />
                          </div>
                        ) : null}
                        {log.callId && screenshotPathByCallId.get(log.callId) ? (
                          <div className="mt-1.5">
                            <button
                              type="button"
                              onClick={() => void openFullScreenshot(log.callId!)}
                              className="text-xs text-blue-700 underline underline-offset-2"
                            >
                              Open full screenshot
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Hash className="size-4" />
                  Confidence legend
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {(["VERIFIED", "HIGH", "MEDIUM", "LOW", "UNVERIFIED"] as OsintConfidence[]).map((c) => {
                  const m = CONFIDENCE_META[c];
                  return (
                    <div
                      key={c}
                      className={cn(
                        "flex items-center gap-2 rounded-md border px-2 py-1 text-[11px] font-semibold",
                        m.cls,
                      )}
                    >
                      <span className={cn("size-1.5 rounded-full", m.dot)} />
                      {c}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>

      {/* ── Graph Correlation View ── */}
      <div className="mx-auto max-w-7xl px-4 pb-6 sm:px-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="5" cy="12" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><line x1="7" y1="11.5" x2="17" y2="6.5"/><line x1="7" y1="12.5" x2="17" y2="17.5"/></svg>
              Graph Correlation
            </CardTitle>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={showGraph ? "default" : "outline"}
                onClick={() => setShowGraph((v) => !v)}
              >
                {showGraph ? "Hide Graph" : "Show Graph"}
              </Button>
              <a
                href={osintApi.getMaltegoExportUrl(caseId)}
                download
                className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary/40 px-3 py-1 text-xs font-medium hover:bg-secondary transition-colors"
              >
                <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Maltego Export
              </a>
            </div>
          </CardHeader>

          {showGraph && (
            <CardContent className="pt-0">
              {/* Cluster alert badges */}
              {inv && (inv.clusters ?? []).length > 0 && (
                <div className="mb-4 flex flex-wrap gap-2">
                  {(inv.clusters ?? []).map((cluster, i) => {
                    const clusterType = (cluster.kind ?? "") as ClusterAlertType;
                    const badge = CLUSTER_BADGE[clusterType] ?? { label: cluster.kind, cls: "bg-muted text-muted-foreground" };
                    return (
                      <button
                        key={i}
                        onClick={() => {
                          // Find the entity node in graph matching this cluster's summary
                          const found = graphQuery.data?.nodes.find((n) =>
                            cluster.summary?.includes(n.id),
                          );
                          if (found) setSelectedGraphNode(found);
                        }}
                        className={cn("inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold transition-opacity hover:opacity-80 cursor-pointer border-0", badge.cls)}
                      >
                        {badge.label} ({cluster.linkedCaseNumbers?.length ?? 0} cases)
                      </button>
                    );
                  })}
                </div>
              )}

              {graphQuery.isLoading && (
                <div className="flex items-center justify-center h-48">
                  <Loader2 className="size-6 animate-spin text-primary" />
                  <span className="ml-2 text-sm text-muted-foreground">Loading graph…</span>
                </div>
              )}

              {graphQuery.isError && (
                <p className="text-sm text-destructive p-4">Failed to load graph data.</p>
              )}

              {graphQuery.data && (
                <div className="flex gap-4">
                  {/* Force graph canvas */}
                  <div className="flex-1 rounded-xl border border-border bg-secondary/20 overflow-hidden" style={{ height: 480 }}>
                    {graphQuery.data.fallback && (
                      <p className="px-3 py-1 text-[11px] text-amber-600 bg-amber-50 border-b border-amber-200">
                        Graph analysis in fallback mode — Neo4j not connected. Showing MongoDB entity data.
                      </p>
                    )}
                    <ForceGraph2D
                      graphData={{
                        nodes: graphQuery.data.nodes.map((n) => ({ ...n, __indexColor: n.id })),
                        links: graphQuery.data.links,
                      }}
                      nodeLabel="label"
                      nodeColor={(node: unknown) => {
                        const n = node as GraphNode;
                        return NODE_COLORS[n.type] ?? "var(--color-muted-foreground)";
                      }}
                      nodeRelSize={6}
                      linkLabel="relationship"
                      linkColor={() => "rgba(100,116,139,0.4)"}
                      onNodeClick={(node: unknown) => setSelectedGraphNode(node as GraphNode)}
                      backgroundColor="transparent"
                      width={undefined}
                      height={graphQuery.data.fallback ? 436 : 480}
                    />
                  </div>

                  {/* Selected node detail panel */}
                  {selectedGraphNode && (
                    <div className="w-64 shrink-0 space-y-3 rounded-xl border border-border bg-card p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          {selectedGraphNode.type}
                        </span>
                        <button
                          onClick={() => setSelectedGraphNode(null)}
                          className="text-muted-foreground hover:text-foreground text-sm leading-none"
                        >
                          ✕
                        </button>
                      </div>
                      <p className="font-mono text-sm break-all">{selectedGraphNode.label}</p>
                      <div className="space-y-1">
                        <p className="text-[11px] text-muted-foreground">Confidence</p>
                        <Badge variant="outline" className="text-[11px]">
                          {selectedGraphNode.confidence}
                        </Badge>
                      </div>
                      {selectedGraphNode.flags.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-[11px] text-muted-foreground">Flags</p>
                          <div className="flex flex-wrap gap-1">
                            {selectedGraphNode.flags.map((f) => (
                              <Badge key={f} variant="destructive" className="text-[10px]">
                                {f}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      {/* Cases that share this entity */}
                      {(() => {
                        const linkedCases = (graphQuery.data?.links ?? [])
                          .filter((l) => l.target === selectedGraphNode.id || l.source === selectedGraphNode.id)
                          .map((l) => (l.source === selectedGraphNode.id ? l.target : l.source))
                          .filter((id) => id !== caseId);
                        return linkedCases.length > 0 ? (
                          <div className="space-y-1">
                            <p className="text-[11px] text-muted-foreground">Linked cases ({linkedCases.length})</p>
                            <div className="flex flex-col gap-1">
                              {linkedCases.slice(0, 5).map((id) => (
                                <span key={id} className="font-mono text-[11px] text-primary">{id}</span>
                              ))}
                              {linkedCases.length > 5 && (
                                <span className="text-[11px] text-muted-foreground">+{linkedCases.length - 5} more</span>
                              )}
                            </div>
                          </div>
                        ) : null;
                      })()}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          )}
        </Card>
      </div>
    </>
  );
}

// ── Graph constants ──
const NODE_COLORS: Record<string, string> = {
  Case:         "#3b82f6",
  PhoneNumber:  "#22c55e",
  UpiID:        "#06b6d4",
  IPAddress:    "#a855f7",
  Domain:       "#f59e0b",
  Email:        "#f97316",
  CryptoWallet: "#ef4444",
  TelegramID:   "#6366f1",
};

const CLUSTER_BADGE: Record<ClusterAlertType, { label: string; cls: string }> = {
  SHARED_UPI_CLUSTER:       { label: "⚠ UPI Cluster", cls: "bg-red-100 text-red-800" },
  TEMPORAL_BURST:           { label: "⚡ Temporal Burst", cls: "bg-amber-100 text-amber-800" },
  DOMAIN_PHISHING_CAMPAIGN: { label: "🎣 Phishing Campaign", cls: "bg-red-100 text-red-800" },
  PHONE_MULE_CHAIN:         { label: "📞 Phone Mule Chain", cls: "bg-orange-100 text-orange-800" },
};

function StageIcon({ status }: { status: StageStatus }) {
  if (status === "completed") return <CheckCircle2 className="size-4 text-emerald-600" />;
  if (status === "running") return <Loader2 className="size-4 animate-spin text-blue-600" />;
  if (status === "failed") return <AlertCircle className="size-4 text-red-600" />;
  return <CircleDashed className="size-4 text-muted-foreground" />;
}

const StageCard = ({
  stage,
  status,
  children,
  ref,
}: {
  stage: (typeof STAGES)[number];
  status: StageStatus;
  children: React.ReactNode;
  ref: React.RefObject<HTMLDivElement | null>;
}) => {
  const Icon = stage.icon;
  return (
    <motion.div ref={ref} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      <Card
        className={cn(
          "border-black/[0.06] transition-colors",
          status === "running" && "ring-2 ring-blue-300/70",
          status === "completed" && "ring-1 ring-emerald-200",
          status === "failed" && "ring-2 ring-red-300/70",
        )}
      >
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-xl",
                  status === "completed"
                    ? "bg-emerald-50 text-emerald-700"
                    : status === "running"
                      ? "bg-blue-50 text-blue-700"
                      : status === "failed"
                        ? "bg-red-50 text-red-700"
                        : "bg-secondary text-muted-foreground",
                )}
              >
                <Icon className="size-5" />
              </div>
              <div>
                <CardTitle className="text-base">{stage.label}</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">{stage.blurb}</p>
              </div>
            </div>
            <StageIcon status={status} />
          </div>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </motion.div>
  );
};

function EmptyStage({ label }: { label: string }) {
  return (
    <p className="rounded-xl border border-dashed border-border bg-secondary/20 p-4 text-xs text-muted-foreground">
      {label}
    </p>
  );
}

function EntityCard({ entity, flaggedInvalid }: { entity: OsintEntity; flaggedInvalid?: boolean }) {
  const Meta = ENTITY_META[entity.type];
  const isInvalid = flaggedInvalid || !entity.valid;
  return (
    <div
      className={cn(
        "rounded-xl border p-3 text-sm",
        isInvalid
          ? "border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20"
          : "border-border bg-card",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Meta.icon className="size-3" />
          {Meta.label}
        </span>
        {isInvalid ? (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-600">
            <AlertCircle className="size-3.5" />
            HITL
          </span>
        ) : (
          <BadgeCheck className="size-4 text-emerald-600" />
        )}
      </div>
      <p className="mt-2 break-all font-mono text-xs">{entity.value}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        source: <span className="font-mono">{entity.sourceFile}</span>
      </p>
    </div>
  );
}

function ClusterRow({ cluster }: { cluster: OsintCluster }) {
  return (
    <li className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-xs font-bold text-foreground">{cluster.kind}</span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-bold",
            cluster.severity === "high"
              ? "bg-red-100 text-red-700"
              : cluster.severity === "medium"
                ? "bg-amber-100 text-amber-800"
                : "bg-gray-100 text-gray-700",
          )}
        >
          {cluster.severity.toUpperCase()}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{cluster.summary}</p>
      {cluster.linkedCaseNumbers.length > 0 && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Linked cases:{" "}
          <span className="font-mono">{cluster.linkedCaseNumbers.slice(0, 8).join(", ")}</span>
          {cluster.linkedCaseNumbers.length > 8 ? ` … +${cluster.linkedCaseNumbers.length - 8}` : ""}
        </p>
      )}
    </li>
  );
}

function ToolResultRow({
  tool,
  onDelete,
  deleting,
}: {
  tool: OsintCustomTool;
  onDelete: () => void;
  deleting: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-border bg-card p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {tool.kind}
          </span>
          <span className="ml-2 break-all font-mono text-xs">{tool.query}</span>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {new Date(tool.runAt).toLocaleString("en-IN")}
            {tool.attachedToReport && " · appended to report"}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
            {open ? "Hide" : "View"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={deleting}
            onClick={onDelete}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
      {open && (
        <pre className="mt-2 max-h-64 overflow-auto rounded-md border border-border/60 bg-secondary/40 p-2 text-[11px]">
          {JSON.stringify(tool.result, null, 2)}
        </pre>
      )}
    </div>
  );
}

function EvidenceRow({
  ev,
  hash,
  caseId,
  patchEv,
  delEv,
}: {
  ev: import("@/lib/types").OsintEvidenceItem;
  hash?: OsintHashRecord;
  caseId: string;
  patchEv: {
    mutate: (args: {
      caseId: string;
      evidenceId: string;
      ocrText?: string;
      analystNotes?: string;
    }) => void;
  };
  delEv: { mutate: (args: { caseId: string; evidenceId: string }) => void };
}) {
  const [ocr, setOcr] = useState(ev.ocrText);
  const [notes, setNotes] = useState(ev.analystNotes);

  useEffect(() => {
    setOcr(ev.ocrText);
    setNotes(ev.analystNotes);
  }, [ev.ocrText, ev.analystNotes, ev.id]);

  return (
    <div className="rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-sm font-semibold">{ev.fileName}</p>
          <p className="text-[11px] text-muted-foreground">
            Ingested {new Date(ev.createdAt).toLocaleString("en-IN")}
          </p>
          {hash && (
            <p className="mt-1 text-[10px] font-mono text-emerald-700">
              SHA-256 · {shortHash(hash.sha256)}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {ev.evidenceHashId ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={async () => {
                try {
                  const r = await osintApi.downloadEvidenceHash(caseId, ev.evidenceHashId!);
                  if (r.presignedUrl) {
                    window.open(r.presignedUrl, "_blank", "noopener,noreferrer");
                  } else if (r.blob) {
                    const url = URL.createObjectURL(r.blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = ev.fileName;
                    a.click();
                    URL.revokeObjectURL(url);
                  }
                } catch {
                  /* toast optional */
                }
              }}
            >
              <Download className="size-3.5 mr-1" />
              Download
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              const t = ocr || simulateOcrFromFileName(ev.fileName);
              setOcr(t);
              patchEv.mutate({ caseId, evidenceId: ev.id, ocrText: t });
            }}
          >
            <Sparkles className="size-3.5 mr-1" />
            Simulate OCR
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={() => delEv.mutate({ caseId, evidenceId: ev.id })}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        <Label className="text-[11px]">OCR / extracted text</Label>
        <Textarea
          rows={3}          className="text-xs"
          value={ocr}
          onChange={(e) => setOcr(e.target.value)}
          onBlur={() => patchEv.mutate({ caseId, evidenceId: ev.id, ocrText: ocr })}
          placeholder="Extracted text from image/document (used by entity extraction)."
        />
      </div>
      <div className="mt-3 space-y-2">
        <Label className="text-[11px]">Analyst notes</Label>
        <Textarea
          rows={2}
          className="text-xs"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => patchEv.mutate({ caseId, evidenceId: ev.id, analystNotes: notes })}
          placeholder="Optional internal notes for this piece of evidence."
        />
      </div>
    </div>
  );
}
