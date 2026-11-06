"use client";

import { cn } from "@/lib/utils";
import { severityConfig, statusConfig, type Severity, type CaseStatus } from "@/lib/utils";

export function CaseStatusBadge({ status }: { status: CaseStatus }) {
  const config = statusConfig[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium border",
        config.bg,
        config.color
      )}
    >
      <span className={cn("size-1.5 rounded-full", config.color.replace("text-", "bg-"))} />
      {config.label}
    </span>
  );
}

export function SeverityBadge({ severity, pulse = false }: { severity: Severity; pulse?: boolean }) {
  const config = severityConfig[severity];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium border",
        config.bg,
        config.color,
        config.border
      )}
    >
      <span className={cn("size-2 rounded-full", config.dot, pulse && severity === "high" && "severity-pulse")} />
      {config.label}
    </span>
  );
}
