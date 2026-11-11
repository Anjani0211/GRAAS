"use client";

import { motion } from "framer-motion";
import { AdminHeader } from "@/components/layout/admin-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CaseStatusBadge, SeverityBadge } from "@/components/case/case-status-badge";
import { useCases, useCaseStats, useOsintQueue } from "@/lib/queries";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowRight,
  Clock,
  AlertTriangle,
  UserRoundX,
  Radar,
  FolderOpen,
} from "lucide-react";
import Link from "next/link";
import { formatRelativeTime } from "@/lib/utils";

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

const item = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0 },
};

function trendMeta(
  delta: number | undefined,
  opts?: { invertGood?: boolean },
): { trend: "up" | "down" | "neutral"; deltaLabel: string; good: boolean | null } {
  if (delta === undefined || delta === 0 || Number.isNaN(delta)) {
    return { trend: "neutral", deltaLabel: "Flat vs last month", good: null };
  }
  const up = delta > 0;
  const trend = up ? "up" : "down";
  const abs = Math.abs(delta);
  const deltaLabel = `${up ? "+" : "−"}${Number.isInteger(abs) ? abs : abs.toFixed(1)} vs last month`;
  const good = opts?.invertGood ? !up : up;
  return { trend, deltaLabel, good };
}

export default function AdminDashboard() {
  const { data: cases, isLoading: casesLoading } = useCases({ limit: 8 });
  const { data: stats, isLoading: statsLoading } = useCaseStats();
  const { data: osintQueue } = useOsintQueue();

  const recentCases = cases?.slice(0, 5) || [];
  const queueCount = osintQueue?.length ?? 0;
  const deltas = stats?.kpis.deltas;

  const kpis = stats
    ? [
        {
          label: "Total Cases This Month",
          value: stats.kpis.totalThisMonth,
          href: "/admin/cases",
          ...trendMeta(deltas?.totalThisMonth),
        },
        {
          label: "Resolved",
          value: stats.kpis.resolved,
          href: "/admin/cases?status=closed",
          ...trendMeta(deltas?.resolved),
        },
        {
          label: "Avg Resolution Time",
          value:
            stats.kpis.avgResolutionDays > 0
              ? `${stats.kpis.avgResolutionDays} days`
              : "N/A",
          href: "/admin/analytics",
          ...trendMeta(deltas?.avgResolutionDays, { invertGood: true }),
        },
        {
          label: "High Severity",
          value: stats.kpis.highSeverity,
          href: "/admin/cases?severity=high",
          ...trendMeta(deltas?.highSeverity, { invertGood: true }),
        },
      ]
    : [];

  return (
    <>
      <AdminHeader title="Command Center" />
      <div className="space-y-8 p-6 sm:p-8">
        {/* Urgency strip */}
        <div className="grid gap-3 sm:grid-cols-3">
          <Link
            href="/admin/cases?filter=pending_triage"
            className="group flex items-center justify-between rounded-xl border border-amber-500/20 bg-amber-50/80 px-4 py-3 transition-colors hover:bg-amber-50"
          >
            <div className="flex items-center gap-3">
              <span className="relative flex size-2.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-60" />
                <span className="relative inline-flex size-2.5 rounded-full bg-amber-500" />
              </span>
              <div>
                <p className="font-mono-technical text-[10px] font-semibold uppercase tracking-wider text-amber-800/80">
                  Pending triage
                </p>
                <p className="text-xl font-bold tabular-nums text-amber-950">
                  {statsLoading ? "—" : (stats?.pendingTriage ?? 0)}
                </p>
              </div>
            </div>
            <ArrowRight className="size-4 text-amber-700/50 transition-transform group-hover:translate-x-0.5" />
          </Link>

          <Link
            href="/admin/cases?filter=unassigned"
            className="group flex items-center justify-between rounded-xl border border-red-500/15 bg-red-50/70 px-4 py-3 transition-colors hover:bg-red-50"
          >
            <div className="flex items-center gap-3">
              <UserRoundX className="size-4 text-red-600" />
              <div>
                <p className="font-mono-technical text-[10px] font-semibold uppercase tracking-wider text-red-800/80">
                  Unassigned
                </p>
                <p className="text-xl font-bold tabular-nums text-red-950">
                  {statsLoading ? "—" : (stats?.unassigned ?? 0)}
                </p>
              </div>
            </div>
            <ArrowRight className="size-4 text-red-700/40 transition-transform group-hover:translate-x-0.5" />
          </Link>

          <Link
            href="/admin/osint"
            className="group flex items-center justify-between rounded-xl border border-primary/15 bg-primary-soft/40 px-4 py-3 transition-colors hover:bg-primary-soft/70"
          >
            <div className="flex items-center gap-3">
              <Radar className="size-4 text-primary" />
              <div>
                <p className="font-mono-technical text-[10px] font-semibold uppercase tracking-wider text-primary/80">
                  OSINT queue
                </p>
                <p className="text-xl font-bold tabular-nums text-foreground">{queueCount}</p>
              </div>
            </div>
            <ArrowRight className="size-4 text-primary/40 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>

        {statsLoading ? (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-28 animate-pulse rounded-xl border border-black/[0.06] bg-muted/50"
              />
            ))}
          </div>
        ) : (
          <motion.div
            variants={container}
            initial="hidden"
            animate="show"
            className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-5 lg:grid-cols-4 lg:gap-6"
          >
            {kpis.map((kpi) => (
              <motion.div key={kpi.label} variants={item}>
                <Link href={kpi.href} className="block">
                  <Card className="stitch-glass border-black/[0.06] transition-transform duration-200 hover:-translate-y-0.5">
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-mono-technical text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {kpi.label}
                          </p>
                          <p className="mt-1 text-3xl font-bold tabular-nums">{kpi.value}</p>
                        </div>
                        <div
                          className={`flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${
                            kpi.trend === "neutral"
                              ? "bg-secondary text-muted-foreground"
                              : kpi.good
                                ? "bg-emerald-50 text-emerald-700"
                                : kpi.good === false
                                  ? "bg-red-50 text-red-600"
                                  : "bg-secondary text-muted-foreground"
                          }`}
                        >
                          {kpi.trend === "up" ? (
                            <TrendingUp className="size-3" />
                          ) : kpi.trend === "down" ? (
                            <TrendingDown className="size-3" />
                          ) : (
                            <Minus className="size-3" />
                          )}
                        </div>
                      </div>
                      <p className="mt-3 text-[11px] text-muted-foreground">{kpi.deltaLabel}</p>
                    </CardContent>
                  </Card>
                </Link>
              </motion.div>
            ))}
          </motion.div>
        )}

        <div className="grid gap-6 lg:grid-cols-3 lg:gap-8">
          <div className="lg:col-span-2">
            <Card className="border-black/[0.06]">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="font-mono-technical text-sm font-bold uppercase tracking-wider text-primary">
                    Live queue
                  </CardTitle>
                  <Link
                    href="/admin/cases"
                    className="flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    View all <ArrowRight className="size-3" />
                  </Link>
                </div>
              </CardHeader>
              <CardContent>
                {casesLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="h-16 animate-pulse rounded-xl bg-muted/60" />
                    ))}
                  </div>
                ) : recentCases.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 py-10 text-center">
                    <FolderOpen className="size-8 text-muted-foreground/50" />
                    <div>
                      <p className="text-sm font-medium">No cases in queue yet</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        New victim submissions will appear here for triage.
                      </p>
                    </div>
                    <Button size="sm" variant="outline" asChild>
                      <Link href="/submit">Open intake form</Link>
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {recentCases.map((c, i) => (
                      <motion.div
                        key={c.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.05 }}
                      >
                        <Link
                          href={`/admin/case/${c.id}`}
                          className="group flex items-center gap-4 rounded-xl p-4 transition-colors hover:bg-secondary/50"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs text-muted-foreground">
                                {c.caseNumber}
                              </span>
                              <SeverityBadge severity={c.severity} />
                            </div>
                            <p className="mt-1 truncate text-sm font-medium">{c.victimName}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {c.description.slice(0, 80)}
                              {c.description.length > 80 ? "…" : ""}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <CaseStatusBadge status={c.status} />
                            <p className="mt-1 flex items-center justify-end gap-1 text-xs text-muted-foreground">
                              <Clock className="size-3" />
                              {formatRelativeTime(new Date(c.updatedAt))}
                            </p>
                          </div>
                          <ArrowRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                        </Link>
                      </motion.div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="border-black/[0.06]">
              <CardHeader>
                <CardTitle className="text-base">Severity distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {stats &&
                    (() => {
                      const total =
                        stats.severityCounts.high +
                          stats.severityCounts.medium +
                          stats.severityCounts.low || 1;
                      return [
                        {
                          label: "High",
                          count: stats.severityCounts.high,
                          total,
                          color: "bg-red-500",
                          href: "/admin/cases?severity=high",
                        },
                        {
                          label: "Medium",
                          count: stats.severityCounts.medium,
                          total,
                          color: "bg-amber-500",
                          href: "/admin/cases?severity=medium",
                        },
                        {
                          label: "Low",
                          count: stats.severityCounts.low,
                          total,
                          color: "bg-emerald-500",
                          href: "/admin/cases?severity=low",
                        },
                      ].map((s) => (
                        <Link key={s.label} href={s.href} className="block">
                          <div className="mb-1.5 flex items-center justify-between text-sm">
                            <span className="font-medium">{s.label}</span>
                            <span className="text-muted-foreground">{s.count}</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-secondary">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${(s.count / s.total) * 100}%` }}
                              transition={{ duration: 0.8, ease: "easeOut" as const, delay: 0.2 }}
                              className={`h-full rounded-full ${s.color}`}
                            />
                          </div>
                        </Link>
                      ));
                    })()}
                </div>
              </CardContent>
            </Card>

            <Card className="border-black/[0.06]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="size-4 text-amber-600" />
                  Triage signals
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {[
                  {
                    label: "Unassigned Cases",
                    count: stats?.unassigned ?? 0,
                    variant: "danger" as const,
                    href: "/admin/cases?filter=unassigned",
                  },
                  {
                    label: "Pending Triage",
                    count: stats?.pendingTriage ?? 0,
                    variant: "warning" as const,
                    href: "/admin/cases?filter=pending_triage",
                  },
                ].map((action) => (
                  <Link
                    key={action.label}
                    href={action.href}
                    className="flex items-center justify-between rounded-lg bg-secondary/50 p-3 transition-colors hover:bg-secondary"
                  >
                    <span className="text-sm font-medium">{action.label}</span>
                    <Badge variant={action.variant}>{action.count}</Badge>
                  </Link>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
