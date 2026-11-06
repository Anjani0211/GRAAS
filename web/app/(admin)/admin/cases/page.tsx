"use client";

import { useState } from "react";
import Link from "next/link";
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
  ArrowUpDown,
  ArrowRight,
  Calendar,
  MapPin,
  Loader2,
} from "lucide-react";

export default function CasesPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<CaseStatus | "all">("all");
  const [severityFilter, setSeverityFilter] = useState<Severity | "all">("all");

  const queryParams = {
    ...(statusFilter !== "all" && { status: statusFilter }),
    ...(severityFilter !== "all" && { severity: severityFilter }),
  };

  const { data: cases, isLoading } = useCases(Object.keys(queryParams).length ? queryParams : undefined);

  const filtered = (cases || []).filter((c) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.caseNumber.toLowerCase().includes(q) ||
      c.victimName.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q)
    );
  });

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
                  placeholder="Search by case number, victim name, or description..."
                  className="h-10 rounded-xl border-black/[0.08] bg-muted/30 pl-9 shadow-sm focus-visible:bg-background"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as CaseStatus | "all")}
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
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {isLoading ? "Loading..." : <>Showing <span className="font-semibold text-foreground">{filtered.length}</span> cases</>}
          </p>
          <Button variant="ghost" size="sm">
            <ArrowUpDown className="size-4" />
            Sort by Date
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">No cases found</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((c, i) => (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
              >
                <Link href={`/admin/case/${c.id}`}>
                  <Card className="hover:-translate-y-0.5 hover:shadow-md transition-all duration-200 cursor-pointer group">
                    <CardContent className="pt-6">
                      <div className="flex items-start gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-mono font-semibold text-primary">
                              {c.caseNumber}
                            </span>
                            <SeverityBadge severity={c.severity} pulse={c.severity === "high"} />
                            <CaseStatusBadge status={c.status} />
                            <Badge variant="secondary" className="capitalize text-[11px]">
                              {categoryConfig[c.category].label}
                            </Badge>
                          </div>
                          <h3 className="text-sm font-semibold mt-2">{c.victimName}</h3>
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                            {c.description}
                          </p>
                          <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
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
                        <ArrowRight className="size-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-2" />
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
