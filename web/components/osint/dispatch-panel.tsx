"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Building2,
  Smartphone,
  ShieldAlert,
  Shield,
  Share2,
  Bitcoin,
  Globe,
  Wallet,
  Loader2,
  CheckCircle2,
  Download,
  Copy,
  RotateCw,
  Sparkles,
  AlertTriangle,
  XCircle,
  SkipForward,
  Eye,
  EyeOff,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  useDispatchPlan,
  useGenerateDispatchPlan,
  usePatchDispatchRecipient,
} from "@/lib/queries";
import { osintApi } from "@/lib/api";
import type {
  DispatchPlan,
  DispatchRecipient,
  DispatchRecipientPriority,
  DispatchRecipientStatus,
  DispatchRecipientType,
} from "@/lib/types";

const RECIPIENT_META: Record<
  DispatchRecipientType,
  { label: string; icon: typeof Building2; tone: string }
> = {
  BANK: {
    label: "Bank — Nodal Cyber Cell",
    icon: Building2,
    tone: "bg-emerald-50 text-emerald-800 border-emerald-200",
  },
  TELECOM: {
    label: "Telecom Operator",
    icon: Smartphone,
    tone: "bg-blue-50 text-blue-800 border-blue-200",
  },
  CERT_IN: {
    label: "CERT-In",
    icon: ShieldAlert,
    tone: "bg-amber-50 text-amber-800 border-amber-200",
  },
  LE_CYBER: {
    label: "State Cyber Cell",
    icon: Shield,
    tone: "bg-rose-50 text-rose-800 border-rose-200",
  },
  LE_NCRP: {
    label: "NCRP / 1930 (I4C)",
    icon: Shield,
    tone: "bg-purple-50 text-purple-800 border-purple-200",
  },
  SOCIAL: {
    label: "Social Platform — LE Portal",
    icon: Share2,
    tone: "bg-sky-50 text-sky-800 border-sky-200",
  },
  EXCHANGE: {
    label: "Crypto Exchange — Compliance",
    icon: Bitcoin,
    tone: "bg-orange-50 text-orange-800 border-orange-200",
  },
  REGISTRAR: {
    label: "Domain Registrar — Abuse",
    icon: Globe,
    tone: "bg-violet-50 text-violet-800 border-violet-200",
  },
  PAYMENT_OPS: {
    label: "Payment Aggregator",
    icon: Wallet,
    tone: "bg-teal-50 text-teal-800 border-teal-200",
  },
};

const PRIORITY_META: Record<DispatchRecipientPriority, { cls: string; label: string }> = {
  URGENT: { cls: "bg-red-600 text-white", label: "URGENT" },
  HIGH: { cls: "bg-amber-500 text-white", label: "HIGH" },
  NORMAL: { cls: "bg-slate-200 text-slate-800", label: "NORMAL" },
};

const STATUS_META: Record<
  DispatchRecipientStatus,
  { cls: string; icon: typeof CheckCircle2; label: string }
> = {
  DRAFT: { cls: "bg-slate-100 text-slate-700 border-slate-300", icon: Sparkles, label: "Draft" },
  QUEUED: { cls: "bg-blue-50 text-blue-800 border-blue-300", icon: Loader2, label: "Queued" },
  SENT: { cls: "bg-emerald-50 text-emerald-800 border-emerald-300", icon: CheckCircle2, label: "Sent" },
  ACKED: { cls: "bg-emerald-100 text-emerald-900 border-emerald-400", icon: CheckCircle2, label: "Acknowledged" },
  REJECTED: { cls: "bg-red-50 text-red-800 border-red-300", icon: XCircle, label: "Rejected" },
  SKIPPED: { cls: "bg-zinc-100 text-zinc-700 border-zinc-300", icon: SkipForward, label: "Skipped" },
};

function rollupBadge(status: DispatchPlan["rollupStatus"]) {
  switch (status) {
    case "ALL_SENT":
      return { cls: "bg-emerald-600 text-white", label: "All recipients dispatched" };
    case "PARTIALLY_SENT":
      return { cls: "bg-amber-500 text-white", label: "Partially dispatched" };
    case "CLOSED":
      return { cls: "bg-zinc-500 text-white", label: "Closed" };
    default:
      return { cls: "bg-slate-200 text-slate-800", label: "Draft" };
  }
}

interface DispatchPanelProps {
  caseId: string;
  /** Whether the analyst has finalised the report — gates the panel. */
  canDispatch: boolean;
  /** Quick-glance counters (entities/clusters) for empty-state context. */
  emptyHint?: string;
}

export function DispatchPanel({ caseId, canDispatch, emptyHint }: DispatchPanelProps) {
  const query = useDispatchPlan(caseId);
  const generate = useGenerateDispatchPlan();
  const patchRecipient = usePatchDispatchRecipient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [expandAll, setExpandAll] = useState(false);
  const [statusFilter, setStatusFilter] = useState<DispatchRecipientStatus | "ALL">("ALL");

  const plan: DispatchPlan | null = query.data?.dispatch ?? null;
  const recipients = useMemo(() => plan?.recipients ?? [], [plan]);

  const counts = useMemo(() => {
    const total = recipients.length;
    const sent = recipients.filter((r) => r.status === "SENT" || r.status === "ACKED").length;
    const urgent = recipients.filter((r) => r.priority === "URGENT").length;
    return { total, sent, urgent };
  }, [recipients]);

  const visible = useMemo(
    () =>
      statusFilter === "ALL"
        ? recipients
        : recipients.filter((r) => r.status === statusFilter),
    [recipients, statusFilter],
  );

  const onGenerate = (regenerate = false) =>
    generate.mutate({ caseId, regenerate });

  return (
    <Card className="border-2 border-primary/20 bg-gradient-to-br from-card to-card/60">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Share2 className="size-4 text-primary" />
              Dispatch &amp; Routing
              {plan ? (
                <span
                  className={cn(
                    "ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    rollupBadge(plan.rollupStatus).cls,
                  )}
                >
                  {rollupBadge(plan.rollupStatus).label}
                </span>
              ) : null}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Auto-routed per-entity packets — banks, telecom, CERT-In, LE cyber cell, social, exchange &amp; registrar.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {plan ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setExpandAll((v) => !v)}
                >
                  {expandAll ? (
                    <>
                      <EyeOff className="mr-1 size-3.5" /> Collapse all
                    </>
                  ) : (
                    <>
                      <Eye className="mr-1 size-3.5" /> Expand all
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={generate.isPending}
                  onClick={() => onGenerate(true)}
                >
                  {generate.isPending ? (
                    <Loader2 className="mr-1 size-3.5 animate-spin" />
                  ) : (
                    <RotateCw className="mr-1 size-3.5" />
                  )}
                  Regenerate
                </Button>
              </>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled={generate.isPending || !canDispatch}
                onClick={() => onGenerate(false)}
              >
                {generate.isPending ? (
                  <Loader2 className="mr-1 size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="mr-1 size-3.5" />
                )}
                Generate dispatch plan
              </Button>
            )}
          </div>
        </div>

        {plan ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="secondary" className="gap-1.5">
              <span className="font-mono">{counts.sent}</span>
              <span className="opacity-70">/ {counts.total} dispatched</span>
            </Badge>
            {counts.urgent > 0 && (
              <Badge className="bg-red-600 text-white gap-1.5">
                <AlertTriangle className="size-3" />
                {counts.urgent} URGENT
              </Badge>
            )}
            <span className="text-muted-foreground">
              Generated {new Date(plan.generatedAt).toLocaleString("en-IN")}
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Filter
              </Label>
              {(["ALL", "DRAFT", "SENT", "ACKED", "REJECTED", "SKIPPED"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors",
                    statusFilter === s
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-secondary text-muted-foreground hover:bg-secondary/80",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-3">
        {!canDispatch && !plan && (
          <div className="rounded-xl border border-dashed border-border bg-secondary/30 p-6 text-center">
            <Shield className="mx-auto mb-2 size-6 text-muted-foreground" />
            <p className="text-sm font-medium">Finalise the report first</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {emptyHint ??
                "Run the pipeline and save the final report — the dispatch panel will auto-route to the correct entities."}
            </p>
          </div>
        )}

        {canDispatch && !plan && !generate.isPending && (
          <div className="rounded-xl border border-dashed border-primary/30 bg-primary/5 p-6 text-center">
            <Sparkles className="mx-auto mb-2 size-6 text-primary" />
            <p className="text-sm font-medium">No dispatch plan yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Tap <strong>Generate dispatch plan</strong> to auto-derive recipients from the report.
            </p>
          </div>
        )}

        {query.isLoading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading dispatch plan…
          </div>
        )}

        {plan && visible.length === 0 && (
          <p className="rounded-md border border-border bg-secondary/30 p-3 text-xs text-muted-foreground">
            No recipients match the current filter.
          </p>
        )}

        <div className="space-y-2">
          {visible.map((r) => {
            const open = expandAll || openId === r.id;
            return (
              <RecipientCard
                key={r.id}
                caseId={caseId}
                dispatchId={plan!.id}
                recipient={r}
                open={open}
                onToggle={() => setOpenId(open ? null : r.id)}
                onPatch={(body) =>
                  patchRecipient.mutate({
                    caseId,
                    dispatchId: plan!.id,
                    recipientId: r.id,
                    ...body,
                  })
                }
                isPatching={patchRecipient.isPending}
              />
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function RecipientCard({
  caseId,
  dispatchId,
  recipient: r,
  open,
  onToggle,
  onPatch,
  isPatching,
}: {
  caseId: string;
  dispatchId: string;
  recipient: DispatchRecipient;
  open: boolean;
  onToggle: () => void;
  onPatch: (body: {
    status?: DispatchRecipientStatus;
    statusNote?: string;
    confirmationRef?: string;
    contactEmail?: string;
  }) => void;
  isPatching: boolean;
}) {
  const [contactEmail, setContactEmail] = useState(r.contactEmail ?? "");
  const [confirmationRef, setConfirmationRef] = useState(r.confirmationRef ?? "");
  const [statusNote, setStatusNote] = useState(r.statusNote ?? "");
  const Icon = RECIPIENT_META[r.type].icon;
  const meta = RECIPIENT_META[r.type];
  const statusMeta = STATUS_META[r.status];
  const StatusIcon = statusMeta.icon;

  const copyBody = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${r.subject}\n\n${r.body}`);
    } catch {
      /* clipboard may not be available — fail silently */
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "rounded-xl border bg-card transition-shadow",
        open ? "shadow-md ring-1 ring-primary/10" : "hover:shadow-sm",
      )}
    >
      <button
        onClick={onToggle}
        className="flex w-full items-start gap-3 p-3 text-left"
      >
        <div
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg border",
            meta.tone,
          )}
        >
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold leading-tight">{r.name}</span>
            <Badge variant="outline" className="text-[10px]">
              {meta.label}
            </Badge>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                PRIORITY_META[r.priority].cls,
              )}
            >
              {PRIORITY_META[r.priority].label}
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                statusMeta.cls,
              )}
            >
              <StatusIcon className="size-3" />
              {statusMeta.label}
            </span>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-1">
            <span className="font-mono">{r.legalBasis}</span> · {r.subject}
          </p>
          {r.actionTargets.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              <span className="font-medium">Targets:</span>{" "}
              <span className="font-mono">{r.actionTargets.slice(0, 3).join(", ")}</span>
              {r.actionTargets.length > 3 ? ` +${r.actionTargets.length - 3}` : ""}
            </p>
          )}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="space-y-3 border-t border-border bg-secondary/20 p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Contact email
                  </Label>
                  <Input
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    placeholder="To be filled by analyst"
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Confirmation reference
                  </Label>
                  <Input
                    value={confirmationRef}
                    onChange={(e) => setConfirmationRef(e.target.value)}
                    placeholder="Bank/portal ticket no."
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Subject
                </Label>
                <Input value={r.subject} readOnly className="h-8 text-xs font-mono" />
              </div>

              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Body
                </Label>
                <Textarea
                  value={r.body}
                  readOnly
                  className="min-h-[180px] font-mono text-[11px] leading-snug"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Note (audit log)
                </Label>
                <Textarea
                  value={statusNote}
                  onChange={(e) => setStatusNote(e.target.value)}
                  placeholder="Optional analyst note — appears in audit trail"
                  className="min-h-[60px] text-xs"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={copyBody}
                  className="h-7 text-xs"
                >
                  <Copy className="mr-1 size-3" />
                  Copy
                </Button>
                <a
                  href={osintApi.getDispatchEmlUrl(caseId, dispatchId, r.id)}
                  download
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2 text-xs font-medium hover:bg-secondary"
                >
                  <Download className="size-3" />
                  Download .eml
                </a>
                <span className="mx-1 h-4 w-px bg-border" />
                <Button
                  type="button"
                  size="sm"
                  disabled={isPatching}
                  onClick={() =>
                    onPatch({
                      status: "SENT",
                      contactEmail: contactEmail || undefined,
                      confirmationRef: confirmationRef || undefined,
                      statusNote: statusNote || undefined,
                    })
                  }
                  className="h-7 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
                >
                  <CheckCircle2 className="mr-1 size-3" />
                  Mark sent
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isPatching}
                  onClick={() =>
                    onPatch({
                      status: "ACKED",
                      contactEmail: contactEmail || undefined,
                      confirmationRef: confirmationRef || undefined,
                      statusNote: statusNote || undefined,
                    })
                  }
                  className="h-7 text-xs"
                >
                  Mark acknowledged
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isPatching}
                  onClick={() =>
                    onPatch({
                      status: "SKIPPED",
                      statusNote: statusNote || "Skipped by analyst",
                    })
                  }
                  className="h-7 text-xs"
                >
                  <SkipForward className="mr-1 size-3" />
                  Skip
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isPatching}
                  onClick={() =>
                    onPatch({
                      status: "REJECTED",
                      statusNote: statusNote || "Rejected by recipient",
                    })
                  }
                  className="h-7 text-xs text-red-700"
                >
                  <XCircle className="mr-1 size-3" />
                  Reject
                </Button>
              </div>

              {r.dispatchedAt && (
                <p className="text-[11px] text-muted-foreground">
                  Last touched: {new Date(r.lastTouchedAt ?? r.dispatchedAt).toLocaleString("en-IN")}
                  {r.lastTouchedBy ? ` · by ${r.lastTouchedBy}` : ""}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
