"use client";

import { motion } from "framer-motion";
import { AdminHeader } from "@/components/layout/admin-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CaseStatusBadge, SeverityBadge } from "@/components/case/case-status-badge";
import { useCases, useCaseStats } from "@/lib/queries";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowRight,
  Clock,
  Loader2,
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

export default function AdminDashboard() {
  const { data: cases, isLoading: casesLoading } = useCases();
  const { data: stats, isLoading: statsLoading } = useCaseStats();

  const recentCases = cases?.slice(0, 5) || [];

  const kpis = stats
    ? [
        { label: "Total Cases This Month", value: stats.kpis.totalThisMonth, trend: "up" as const },
        { label: "Resolved", value: stats.kpis.resolved, trend: "up" as const },
        { label: "Avg Resolution Time", value: stats.kpis.avgResolutionDays > 0 ? `${stats.kpis.avgResolutionDays} days` : "N/A", trend: "down" as const },
        { label: "High Severity", value: stats.kpis.highSeverity, trend: "up" as const },
      ]
    : [];

  return (
    <>
      <AdminHeader title="Command Center" />
      <div className="space-y-8 p-6 sm:p-8">
        {statsLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-6 animate-spin text-primary" />
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
                <Card className="stitch-glass border-black/[0.06] transition-transform duration-200 hover:-translate-y-0.5">
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-mono-technical text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {kpi.label}
                        </p>
                        <p className="mt-1 text-3xl font-bold tabular-nums">{kpi.value}</p>
                      </div>
                      <div
                        className={`flex items-center gap-1 text-xs font-medium rounded-full px-2 py-1 ${
                          kpi.trend === "up"
                            ? kpi.label === "High Severity"
                              ? "bg-red-50 text-red-600"
                              : "bg-emerald-50 text-emerald-600"
                            : "bg-emerald-50 text-emerald-600"
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
                  </CardContent>
                </Card>
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
                    className="text-sm text-primary hover:underline flex items-center gap-1"
                  >
                    View all <ArrowRight className="size-3" />
                  </Link>
                </div>
              </CardHeader>
              <CardContent>
                {casesLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="size-5 animate-spin text-muted-foreground" />
                  </div>
                ) : recentCases.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No cases yet</p>
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
                          className="flex items-center gap-4 rounded-xl p-4 hover:bg-secondary/50 transition-colors group"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono text-muted-foreground">
                                {c.caseNumber}
                              </span>
                              <SeverityBadge severity={c.severity} />
                            </div>
                            <p className="text-sm font-medium mt-1 truncate">
                              {c.victimName}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {c.description.slice(0, 80)}...
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <CaseStatusBadge status={c.status} />
                            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1 justify-end">
                              <Clock className="size-3" />
                              {formatRelativeTime(new Date(c.updatedAt))}
                            </p>
                          </div>
                          <ArrowRight className="size-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
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
                  {stats && (() => {
                    const total = stats.severityCounts.high + stats.severityCounts.medium + stats.severityCounts.low || 1;
                    return [
                      { label: "High", count: stats.severityCounts.high, total, color: "bg-red-500" },
                      { label: "Medium", count: stats.severityCounts.medium, total, color: "bg-amber-500" },
                      { label: "Low", count: stats.severityCounts.low, total, color: "bg-emerald-500" },
                    ].map((s) => (
                      <div key={s.label}>
                        <div className="flex items-center justify-between text-sm mb-1.5">
                          <span className="font-medium">{s.label}</span>
                          <span className="text-muted-foreground">{s.count}</span>
                        </div>
                        <div className="h-2 rounded-full bg-secondary overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${(s.count / s.total) * 100}%` }}
                            transition={{ duration: 0.8, ease: "easeOut" as const, delay: 0.2 }}
                            className={`h-full rounded-full ${s.color}`}
                          />
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              </CardContent>
            </Card>

            <Card className="border-black/[0.06]">
              <CardHeader>
                <CardTitle className="text-base">Triage signals</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {[
                  { label: "Unassigned Cases", count: stats?.unassigned ?? 0, variant: "danger" as const },
                  { label: "Pending Triage", count: stats?.pendingTriage ?? 0, variant: "warning" as const },
                ].map((action) => (
                  <div
                    key={action.label}
                    className="flex items-center justify-between rounded-lg p-3 bg-secondary/50 hover:bg-secondary transition-colors cursor-pointer"
                  >
                    <span className="text-sm font-medium">{action.label}</span>
                    <Badge variant={action.variant}>{action.count}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
