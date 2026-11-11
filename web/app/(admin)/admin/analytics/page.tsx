"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { AdminHeader } from "@/components/layout/admin-header";
import { Button } from "@/components/ui/button";
import { useCaseStats, useOsintQueue } from "@/lib/queries";
import type { CaseStats } from "@/lib/types";
import { categoryConfig } from "@/lib/utils";
import { ChartTooltipCard } from "@/components/analytics/chart-tooltip";
import {
  Calendar,
  Download,
  CheckCircle2,
  Timer,
  FolderOpen,
  AlertTriangle,
  Loader2,
} from "lucide-react";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

/** Stitch admin_analytics_dashboard palette */
const STITCH_PRIMARY = "#003fb1";
const STITCH_SECONDARY = "#712ae2";
const STITCH_TERTIARY = "#0062b2";
const STITCH_MUTED = "#e2e2e2";

const STITCH_DONUT_COLORS = [STITCH_PRIMARY, STITCH_SECONDARY, STITCH_TERTIARY, STITCH_MUTED];

const CHART_GRID = "rgba(195, 197, 215, 0.35)";
const CHART_AXIS = "#434654";

const bentoPanel =
  "rounded-xl border border-black/[0.08] bg-card p-6 shadow-[0_12px_40px_rgba(26,86,219,0.04)] sm:p-8";

function formatDeltaBadge(
  delta: number | undefined,
  opts?: { invertGood?: boolean; suffix?: string },
): { label: string; className: string } | null {
  if (delta === undefined || Number.isNaN(delta)) return null;
  if (delta === 0) return { label: "Flat vs last month", className: "bg-muted text-muted-foreground font-mono-technical" };
  const up = delta > 0;
  const abs = Math.abs(delta);
  const num = Number.isInteger(abs) ? String(abs) : abs.toFixed(1);
  const prefix = up ? "+" : "−";
  const suffix = opts?.suffix ?? "";
  const good = opts?.invertGood ? !up : up;
  return {
    label: `${prefix}${num}${suffix} vs last month`,
    className: good
      ? "bg-[#dbe1ff] text-[#003dab] font-mono-technical"
      : "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300 font-mono-technical",
  };
}

function downloadKpiCsv(stats: CaseStats): void {
  const { kpis, pendingTriage, unassigned } = stats;
  const resolutionPct =
    kpis.totalThisMonth > 0 ? ((kpis.resolved / kpis.totalThisMonth) * 100).toFixed(1) : "";
  const rows = [
    ["metric", "value"],
    ["total_this_month", String(kpis.totalThisMonth)],
    ["resolved", String(kpis.resolved)],
    ["resolution_rate_pct", resolutionPct],
    ["avg_resolution_days", String(kpis.avgResolutionDays)],
    ["high_severity", String(kpis.highSeverity)],
    ["pending_triage", String(pendingTriage)],
    ["unassigned", String(unassigned)],
  ];
  const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `analytics_kpi_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AnalyticsPage() {
  const { data: stats, isLoading } = useCaseStats();
  const { data: osintQueue, isLoading: queueLoading } = useOsintQueue();

  const casesOverTime = useMemo(() => {
    const rows = stats?.casesOverTime ?? [];
    return rows.map((r) => ({
      date: r.date.slice(5), // MM-DD for axis
      reported: r.reported,
      resolved: r.resolved,
    }));
  }, [stats]);

  const categoryDistribution = useMemo(() => {
    if (!stats) return [] as { key: string; name: string; value: number }[];
    return Object.entries(stats.categoryCounts)
      .map(([key, value]) => ({
        key,
        name: (categoryConfig[key as keyof typeof categoryConfig]?.label || key) as string,
        value,
      }))
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [stats]);

  const categoryTotal = useMemo(
    () => categoryDistribution.reduce((s, x) => s + x.value, 0),
    [categoryDistribution],
  );

  const donutSlices = useMemo(() => {
    const top = categoryDistribution.slice(0, 3);
    const restSum = categoryDistribution.slice(3).reduce((s, x) => s + x.value, 0);
    const slices = [...top];
    if (restSum > 0) slices.push({ key: "other", name: "Others", value: restSum });
    while (slices.length < 4 && slices.length > 0) {
      slices.push({ key: `pad-${slices.length}`, name: "—", value: 0 });
    }
    return slices.slice(0, 4);
  }, [categoryDistribution]);

  const stateData = useMemo(() => {
    if (!stats) return [];
    return Object.entries(stats.stateCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([state, cases]) => ({ state, cases }));
  }, [stats]);

  const maxStateCases = stateData[0]?.cases ?? 1;

  const categoryVolumeBars = useMemo(() => {
    const top = categoryDistribution.slice(0, 4);
    if (top.length === 0) return [];
    const max = top[0]?.value ?? 1;
    return top.map((c) => ({
      label: c.name,
      cases: c.value,
      widthPct: Math.max(8, Math.round((c.value / max) * 100)),
    }));
  }, [categoryDistribution]);

  const kpis = useMemo(() => {
    if (!stats) return null;
    const { totalThisMonth, resolved, avgResolutionDays, highSeverity, deltas } = stats.kpis;
    const resolutionPct =
      totalThisMonth > 0 ? Number(((resolved / totalThisMonth) * 100).toFixed(1)) : null;
    const triageDisplay =
      avgResolutionDays > 0
        ? avgResolutionDays >= 1
          ? `${avgResolutionDays.toFixed(1)}d`
          : `${Math.round(avgResolutionDays * 24)}h`
        : "—";
    const activeApprox = Math.max(0, totalThisMonth - resolved) + stats.pendingTriage;

    return [
      {
        label: "Total resolution rate",
        value: resolutionPct != null ? `${resolutionPct}%` : "—",
        badge: formatDeltaBadge(deltas?.resolved),
        icon: CheckCircle2,
        iconWrap: "bg-primary/10 text-primary",
      },
      {
        label: "Avg. triage time",
        value: triageDisplay,
        badge: formatDeltaBadge(deltas?.avgResolutionDays, { invertGood: true, suffix: "d" }),
        icon: Timer,
        iconWrap: "bg-[#712ae2]/10 text-[#712ae2]",
      },
      {
        label: "Active cases",
        value: activeApprox > 0 ? activeApprox.toLocaleString("en-IN") : totalThisMonth.toLocaleString("en-IN"),
        badge: formatDeltaBadge(deltas?.totalThisMonth),
        icon: FolderOpen,
        iconWrap: "bg-[#004a88]/10 text-[#004a88]",
      },
      {
        label: "High severity",
        value: highSeverity.toLocaleString("en-IN"),
        badge: formatDeltaBadge(deltas?.highSeverity, { invertGood: true }),
        icon: AlertTriangle,
        iconWrap: "bg-destructive/10 text-destructive",
      },
    ];
  }, [stats]);

  const takedownRows = useMemo(() => {
    if (!osintQueue?.length) return [];
    return osintQueue.slice(0, 5).map((row) => {
      const loc = [row.district, row.state].filter(Boolean).join(", ") || "—";
      const statusUpper = row.status.replace(/_/g, " ").toUpperCase();
      const tone =
        row.status === "osint" ? ("progress" as const)
        : row.status === "triaged" || row.status === "submitted" ? ("queued" as const)
        : ("verified" as const);
      return {
        id: row.caseNumber,
        domain: loc,
        type: categoryConfig[row.category]?.label ?? row.category,
        status: statusUpper,
        statusTone: tone,
        tat: formatRelativeHours(row.updatedAt),
      };
    });
  }, [osintQueue]);

  const highPriorityCount = useMemo(() => {
    if (!osintQueue?.length) return 0;
    return osintQueue.filter((r) => r.severity === "high").length;
  }, [osintQueue]);

  if (isLoading || !stats) {
    return (
      <>
        <AdminHeader title="Analytics" />
        <div className="flex justify-center py-20">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      </>
    );
  }

  return (
    <>
      <AdminHeader title="Analytics" />
      <div className="mx-auto max-w-7xl px-6 pb-12 pt-4 sm:px-8">
        <header className="mb-10 flex flex-col gap-6 sm:mb-12 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Analytics overview</h1>
            <p className="mt-1 text-muted-foreground">Real-time redressal metrics across all operational nodes.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex h-10 items-center gap-2 rounded-xl border border-black/[0.08] bg-muted/50 px-4 text-sm font-medium text-muted-foreground">
              <Calendar className="size-4" aria-hidden />
              Last 30 days
            </span>
            <Button
              variant="cta"
              className="h-10 rounded-xl shadow-lg shadow-primary/20 transition-transform hover:scale-[1.02]"
              onClick={() => downloadKpiCsv(stats)}
            >
              <Download className="size-4" />
              Export KPI CSV
            </Button>
          </div>
        </header>

        <div className="mb-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:mb-12 lg:grid-cols-4">
          {kpis?.map((kpi, i) => (
            <motion.div
              key={kpi.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className={bentoPanel}
            >
              <div className="mb-4 flex items-center justify-between">
                <div className={`flex size-10 items-center justify-center rounded-full ${kpi.iconWrap}`}>
                  <kpi.icon className="size-5" aria-hidden />
                </div>
                {kpi.badge ? (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${kpi.badge.className}`}>
                    {kpi.badge.label}
                  </span>
                ) : null}
              </div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{kpi.label}</p>
              <p className="mt-1 text-3xl font-bold tabular-nums tracking-tight">{kpi.value}</p>
            </motion.div>
          ))}
        </div>

        <div className="grid grid-cols-12 gap-8">
          {/* Cases over time — 8 cols */}
          <div className={`col-span-12 lg:col-span-8 ${bentoPanel}`}>
            <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="text-lg font-semibold tracking-tight">Cases over time (30 days)</h3>
              <div className="flex flex-wrap items-center gap-6">
                <div className="flex items-center gap-2">
                  <span className="size-3 rounded-full" style={{ background: STITCH_PRIMARY }} />
                  <span className="text-xs text-muted-foreground">Reported</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="size-3 rounded-full" style={{ background: STITCH_SECONDARY }} />
                  <span className="text-xs text-muted-foreground">Resolved</span>
                </div>
              </div>
            </div>
            <div className="relative h-64 w-full min-h-[240px]">
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={casesOverTime} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="stitchReportedFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={STITCH_PRIMARY} stopOpacity={0.22} />
                      <stop offset="100%" stopColor={STITCH_PRIMARY} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="stitchResolvedFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={STITCH_SECONDARY} stopOpacity={0.2} />
                      <stop offset="100%" stopColor={STITCH_SECONDARY} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={CHART_GRID} strokeDasharray="4 4" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: CHART_AXIS, fontFamily: "var(--font-mono)" }}
                    tickLine={false}
                    axisLine={{ stroke: CHART_GRID }}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: CHART_AXIS }}
                    tickLine={false}
                    axisLine={false}
                    width={32}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="rounded-xl border border-black/[0.08] bg-card/95 px-3 py-2.5 text-sm shadow-lg backdrop-blur-sm">
                          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            {label != null ? String(label) : ""}
                          </p>
                          <ul className="mt-1 space-y-0.5">
                            {payload.map((p) => (
                              <li key={String(p.dataKey)} className="flex justify-between gap-6 text-xs">
                                <span className="text-muted-foreground">
                                  {p.dataKey === "resolved" ? "Resolved" : "Reported"}
                                </span>
                                <span className="font-semibold tabular-nums">{p.value}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="reported"
                    stroke={STITCH_PRIMARY}
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#stitchReportedFill)"
                    dot={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="resolved"
                    stroke={STITCH_SECONDARY}
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#stitchResolvedFill)"
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Donut — 4 cols */}
          <div className={`col-span-12 lg:col-span-4 ${bentoPanel}`}>
            <h3 className="mb-8 text-lg font-semibold tracking-tight">Case category breakdown</h3>
            <div className="relative flex flex-col items-center justify-center py-4">
              {categoryTotal > 0 ? (
                <>
                  <div className="relative h-52 w-full max-w-[220px] sm:h-56">
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie
                          data={donutSlices.filter((s) => s.value > 0)}
                          cx="50%"
                          cy="50%"
                          innerRadius="58%"
                          outerRadius="88%"
                          paddingAngle={2}
                          dataKey="value"
                          stroke="#fff"
                          strokeWidth={2}
                        >
                          {donutSlices
                            .filter((s) => s.value > 0)
                            .map((entry, index) => (
                              <Cell
                                key={entry.key}
                                fill={STITCH_DONUT_COLORS[index % STITCH_DONUT_COLORS.length]}
                              />
                            ))}
                        </Pie>
                        <Tooltip
                          content={({ active, payload }) => (
                            <ChartTooltipCard
                              active={active}
                              payload={payload}
                              label={payload?.[0]?.name}
                              valueFormatter={(v) => `${v} cases`}
                            />
                          )}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pt-4">
                    <span className="text-2xl font-bold tabular-nums">{categoryTotal.toLocaleString("en-IN")}</span>
                    <span className="text-[10px] uppercase tracking-tighter text-muted-foreground">Total cases</span>
                  </div>
                </>
              ) : (
                <p className="py-12 text-sm text-muted-foreground">No category data yet</p>
              )}
            </div>
            {categoryTotal > 0 && (
              <div className="mt-6 space-y-3">
                {donutSlices
                  .filter((s) => s.value > 0)
                  .map((row, index) => {
                    const pct = Math.round((row.value / categoryTotal) * 100);
                    const color = STITCH_DONUT_COLORS[index % STITCH_DONUT_COLORS.length];
                    return (
                      <div key={row.key} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="size-2 rounded-full" style={{ background: color }} />
                          <span className="text-xs text-foreground">{row.name}</span>
                        </div>
                        <span className="font-mono-technical text-xs font-bold">{pct}%</span>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          {/* Resolution bars — 6 cols */}
          <div className={`col-span-12 lg:col-span-6 ${bentoPanel}`}>
            <h3 className="mb-8 text-lg font-semibold tracking-tight">Cases by category (top 4)</h3>
            <div className="space-y-6">
              {categoryVolumeBars.length === 0 ? (
                <p className="text-sm text-muted-foreground">No category data yet</p>
              ) : (
                categoryVolumeBars.map((row) => (
                  <div key={row.label}>
                    <div className="mb-2 flex justify-between">
                      <span className="text-xs font-medium">{row.label}</span>
                      <span className="font-mono-technical text-xs font-bold text-primary">
                        {row.cases} cases
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-500"
                        style={{ width: `${row.widthPct}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Jurisdiction — 6 cols */}
          <div className={`col-span-12 lg:col-span-6 ${bentoPanel}`}>
            <h3 className="mb-8 text-lg font-semibold tracking-tight">Volume by jurisdiction</h3>
            <div className="grid grid-cols-1 gap-4">
              {stateData.length > 0 ? (
                stateData.map((row) => {
                  const w = Math.round((row.cases / maxStateCases) * 100);
                  return (
                    <div key={row.state} className="flex items-center gap-4">
                      <span className="w-24 shrink-0 text-xs font-medium">{row.state}</span>
                      <div className="h-8 flex-1 overflow-hidden rounded bg-muted">
                        <div
                          className="flex h-full min-w-0 items-center bg-[#8a4cfc]/90 px-3 transition-all duration-500"
                          style={{ width: `${w}%` }}
                        >
                          <span className="truncate text-[10px] font-bold uppercase tracking-wider text-white">
                            {row.cases} cases
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-sm text-muted-foreground">No geographic data yet</p>
              )}
            </div>
          </div>
        </div>

        {/* Takedown table */}
        <div className={`mt-12 overflow-hidden ${bentoPanel} p-0`}>
          <div className="flex flex-col gap-3 border-b border-black/[0.08] px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <h3 className="text-lg font-semibold tracking-tight">Active takedown queue</h3>
            {highPriorityCount > 0 ? (
              <span className="font-mono-technical w-fit rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-800 dark:bg-red-950/60 dark:text-red-200">
                {highPriorityCount} high priority
              </span>
            ) : null}
          </div>
          {queueLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : takedownRows.length === 0 ? (
            <div className="px-6 py-14 text-center text-sm text-muted-foreground sm:px-8">
              No cases in the OSINT takedown queue right now.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="px-6 py-4 font-mono-technical text-[10px] font-bold uppercase tracking-widest text-muted-foreground sm:px-8">
                      Case ID
                    </th>
                    <th className="px-6 py-4 font-mono-technical text-[10px] font-bold uppercase tracking-widest text-muted-foreground sm:px-8">
                      Domain / node
                    </th>
                    <th className="px-6 py-4 font-mono-technical text-[10px] font-bold uppercase tracking-widest text-muted-foreground sm:px-8">
                      Type
                    </th>
                    <th className="px-6 py-4 font-mono-technical text-[10px] font-bold uppercase tracking-widest text-muted-foreground sm:px-8">
                      Status
                    </th>
                    <th className="px-6 py-4 font-mono-technical text-[10px] font-bold uppercase tracking-widest text-muted-foreground sm:px-8">
                      TAT
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.06]">
                  {takedownRows.map((row) => (
                    <tr key={row.id} className="transition-colors hover:bg-muted/40">
                      <td className="px-6 py-4 font-mono-technical text-sm font-bold text-primary sm:px-8">{row.id}</td>
                      <td className="max-w-[200px] truncate px-6 py-4 text-sm sm:max-w-xs sm:px-8">{row.domain}</td>
                      <td className="px-6 py-4 text-xs font-medium sm:px-8">{row.type}</td>
                      <td className="px-6 py-4 sm:px-8">
                        <TakedownStatusPill status={row.status} tone={row.statusTone} />
                      </td>
                      <td className="px-6 py-4 font-mono-technical text-sm sm:px-8">{row.tat}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function formatRelativeHours(iso: string): string {
  const t = (Date.now() - new Date(iso).getTime()) / 36e5;
  if (t < 0.1) return "<0.1h";
  return `${t.toFixed(1)}h`;
}

function TakedownStatusPill({ status, tone }: { status: string; tone: "progress" | "verified" | "queued" }) {
  const map = {
    progress: "bg-[#eaddff] text-[#5a00c6]",
    verified: "bg-[#dbe1ff] text-[#003dab]",
    queued: "bg-muted text-foreground",
  };
  const cls = map[tone] ?? map.queued;
  return (
    <span className={`inline-block rounded-full px-3 py-1 font-mono-technical text-[10px] font-bold ${cls}`}>
      {status}
    </span>
  );
}
