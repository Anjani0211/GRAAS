"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { AdminHeader } from "@/components/layout/admin-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useOsintQueue } from "@/lib/queries";
import { categoryConfig, formatRelativeTime, statusConfig } from "@/lib/utils";
import { Loader2, Radar, ArrowRight, Play } from "lucide-react";

const phaseLabel: Record<string, string> = {
  evidence: "Evidence",
  draft_report: "Draft report",
  final_review: "Final review",
  submitted_to_le: "LE handoff",
};

export default function OsintQueuePage() {
  const { data: queue, isLoading, isError } = useOsintQueue();

  return (
    <>
      <AdminHeader title="OSINT Investigation" />
      <div className="mx-auto max-w-7xl px-6 pb-10 pt-2 sm:px-8">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-muted/90 px-3 py-1 ring-1 ring-black/[0.06]">
            <span className="font-mono-technical text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
              OSINT operations
            </span>
            <span className="size-1.5 rounded-full bg-primary/80" aria-hidden />
          </div>
          <div className="flex items-start gap-4">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Radar className="size-7" aria-hidden />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-foreground">Investigation queue</h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Cases in <strong>Triaged</strong> or <strong>Under Investigation</strong>. Open a case to run tools,
                capture evidence OCR, build the report, and submit to law enforcement.
              </p>
            </div>
          </div>
        </motion.div>

        <Card className="stitch-glass border-black/[0.06]">
          <CardHeader>
            <CardTitle className="font-mono-technical text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Active queue
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading && (
              <div className="flex justify-center py-16">
                <Loader2 className="size-8 animate-spin text-primary" />
              </div>
            )}
            {isError && <p className="text-sm text-red-600">Could not load queue.</p>}
            {!isLoading && queue && queue.length === 0 && (
              <p className="text-sm text-muted-foreground py-8 text-center">No cases in the OSINT queue.</p>
            )}
            {!isLoading && queue && queue.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="pb-3 pr-4 font-medium">Case</th>
                      <th className="pb-3 pr-4 font-medium">Victim</th>
                      <th className="pb-3 pr-4 font-medium">Category</th>
                      <th className="pb-3 pr-4 font-medium">Status</th>
                      <th className="pb-3 pr-4 font-medium">Phase</th>
                      <th className="pb-3 pr-4 font-medium">Updated</th>
                      <th className="pb-3 font-medium w-40" />
                    </tr>
                  </thead>
                  <tbody>
                    {queue.map((row) => (
                      <tr key={row.id} className="border-b border-border/60 last:border-0">
                        <td className="py-3 pr-4 font-mono font-semibold text-primary">{row.caseNumber}</td>
                        <td className="py-3 pr-4">{row.victimName}</td>
                        <td className="py-3 pr-4">
                          <Badge variant="secondary" className="text-xs">
                            {categoryConfig[row.category]?.label ?? row.category}
                          </Badge>
                        </td>
                        <td className="py-3 pr-4">
                          <span className={statusConfig[row.status]?.color}>{statusConfig[row.status]?.label}</span>
                        </td>
                        <td className="py-3 pr-4">
                          <Badge variant="outline" className="text-xs">
                            {phaseLabel[row.phase] ?? row.phase}
                          </Badge>
                        </td>
                        <td className="py-3 pr-4 text-muted-foreground">
                          {formatRelativeTime(new Date(row.updatedAt))}
                        </td>
                        <td className="py-3">
                          <div className="flex justify-end gap-2">
                            <Button asChild size="sm" variant="outline">
                              <Link href={`/admin/osint/case/${encodeURIComponent(row.caseNumber)}`}>
                                Open
                                <ArrowRight className="size-3.5 ml-1" />
                              </Link>
                            </Button>
                            <Button asChild size="sm" variant="default">
                              <Link
                                href={`/admin/osint/case/${encodeURIComponent(row.caseNumber)}?autostart=1`}
                              >
                                <Play className="size-3.5 mr-1" />
                                Start
                              </Link>
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
