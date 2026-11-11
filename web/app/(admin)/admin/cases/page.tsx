"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { AdminHeader } from "@/components/layout/admin-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CaseStatusBadge, SeverityBadge } from "@/components/case/case-status-badge";
import { Badge } from "@/components/ui/badge";
import { useCases } from "@/lib/queries";
import { categoryConfig, type CaseStatus, type Severity } from "@/lib/utils";
import {
  Search,
  ArrowRight,
  Calendar,
  MapPin,
  FolderOpen,
  X,
} from "lucide-react";

type SpecialFilter = "all" | "unassigned" | "pending_triage";

export default function CasesPage() {
  return (
    <Suspense
      fallback={
        <>
          <AdminHeader title="All Cases" />
          <div className="space-y-3 p-6 sm:p-8">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-28 animate-pulse rounded-xl border border-black/[0.06] bg-muted/50"
              />
            ))}
          </div>
        </>
      }
    >
      <CasesPageInner />
    </Suspense>
  );
}

function CasesPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [searchQuery, setSearchQuery] = useState(searchParams.get("q") || "");
  const [debouncedQ, setDebouncedQ] = useState(searchQuery.trim());
  const [statusFilter, setStatusFilter] = useState<CaseStatus | "all">(
    (searchParams.get("status") as CaseStatus) || "all",
  );
  const [severityFilter, setSeverityFilter] = useState<Severity | "all">(
    (searchParams.get("severity") as Severity) || "all",
  );
  const [specialFilter, setSpecialFilter] = useState<SpecialFilter>(() => {
    const f = searchParams.get("filter");
    if (f === "unassigned" || f === "pending_triage") return f;
    return "all";
  });

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(searchQuery.trim()), 250);
    return () => window.clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (debouncedQ) params.set("q", debouncedQ);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (severityFilter !== "all") params.set("severity", severityFilter);
    if (specialFilter !== "all") params.set("filter", specialFilter);
    const qs = params.toString();
    router.replace(qs ? `/admin/cases?${qs}` : "/admin/cases", { scroll: false });
  }, [debouncedQ, statusFilter, severityFilter, specialFilter, router]);

  const effectiveStatus =
    specialFilter === "pending_triage"
      ? "submitted"
      : statusFilter !== "all"
        ? statusFilter
        : undefined;

  const queryParams = {
    ...(effectiveStatus && { status: effectiveStatus }),
    ...(severityFilter !== "all" && { severity: severityFilter }),
    ...(debouncedQ && { q: debouncedQ }),
    ...(specialFilter === "unassigned" && { unassigned: true }),
    limit: 100,
  };

  const { data: cases, isLoading } = useCases(queryParams);
  const list = cases || [];

  const filterLabel = useMemo(() => {
    if (specialFilter === "unassigned") return "Unassigned open cases";
    if (specialFilter === "pending_triage") return "Pending triage (submitted)";
    return null;
  }, [specialFilter]);

  function clearFilters() {
    setSearchQuery("");
    setStatusFilter("all");
    setSeverityFilter("all");
    setSpecialFilter("all");
  }

  return (
    <>
      <AdminHeader title="All Cases" />
      <div className="space-y-6 p-6 sm:p-8">
        <Card className="border-black/[0.06] shadow-sm">
          <CardContent className="p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-[min(100%,200px)] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by case number, victim name, or email…"
                  className="h-10 rounded-xl border-black/[0.08] bg-muted/30 pl-9 shadow-sm focus-visible:bg-background"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <select
                value={specialFilter === "pending_triage" ? "submitted" : statusFilter}
                onChange={(e) => {
                  const v = e.target.value as CaseStatus | "all";
                  setSpecialFilter("all");
                  setStatusFilter(v);
                }}
                className="h-10 min-w-[9.5rem] rounded-xl border border-input bg-card px-3 text-sm shadow-sm"
              >
                <option value="all">All Status</option>
                <option value="submitted">Submitted</option>
                <option value="triaged">Triaged</option>
                <option value="osint">Under Investigation</option>
                <option value="action_taken">Action Taken</option>
                <option value="closed">Closed</option>
              </select>
              <select
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value as Severity | "all")}
                className="h-10 min-w-[8.5rem] rounded-xl border border-input bg-card px-3 text-sm shadow-sm"
              >
                <option value="all">All Severity</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              {(debouncedQ || statusFilter !== "all" || severityFilter !== "all" || specialFilter !== "all") && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  <X className="size-4" />
                  Clear
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {isLoading ? (
              "Loading…"
            ) : (
              <>
                Showing <span className="font-semibold text-foreground">{list.length}</span> cases
                {filterLabel && (
                  <span className="text-primary"> · {filterLabel}</span>
                )}
              </>
            )}
          </p>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-28 animate-pulse rounded-xl border border-black/[0.06] bg-muted/50"
              />
            ))}
          </div>
        ) : list.length === 0 ? (
          <Card className="border-black/[0.06]">
            <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
              <FolderOpen className="size-9 text-muted-foreground/45" />
              <div>
                <p className="text-sm font-medium">No cases match these filters</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Try clearing filters or search by case number / citizen name.
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={clearFilters}>
                Reset filters
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {list.map((c, i) => (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.03, 0.3) }}
              >
                <Link href={`/admin/case/${c.id}`}>
                  <Card className="group cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
                    <CardContent className="pt-6">
                      <div className="flex items-start gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs font-semibold text-primary">
                              {c.caseNumber}
                            </span>
                            <SeverityBadge severity={c.severity} pulse={c.severity === "high"} />
                            <CaseStatusBadge status={c.status} />
                            <Badge variant="secondary" className="text-[11px] capitalize">
                              {categoryConfig[c.category]?.label ?? c.category}
                            </Badge>
                            {!c.assignedOfficerId && c.status !== "closed" && (
                              <Badge variant="danger" className="text-[10px]">
                                Unassigned
                              </Badge>
                            )}
                          </div>
                          <h3 className="mt-2 text-sm font-semibold">{c.victimName}</h3>
                          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                            {c.description}
                          </p>
                          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Calendar className="size-3" />
                              {new Date(c.createdAt).toLocaleDateString("en-IN", {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              })}
                            </span>
                            {c.state && (
                              <span className="flex items-center gap-1">
                                <MapPin className="size-3" />
                                {c.district}, {c.state}
                              </span>
                            )}
                            {c.assignedOfficerName && (
                              <span>Assigned: {c.assignedOfficerName}</span>
                            )}
                            {c.monetaryLoss !== undefined && c.monetaryLoss > 0 && (
                              <span className="font-medium text-red-600">
                                Loss: ₹{c.monetaryLoss.toLocaleString("en-IN")}
                              </span>
                            )}
                          </div>
                        </div>
                        <ArrowRight className="mt-2 size-5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
