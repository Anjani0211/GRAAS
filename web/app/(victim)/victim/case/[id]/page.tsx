"use client";

import { useState, useRef } from "react";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CaseStatusBadge, SeverityBadge } from "@/components/case/case-status-badge";
import { TimelineStep } from "@/components/case/timeline-step";
import { useVictimCase, usePostCaseMessage, useRequestErasure, useUploadVictimEvidence } from "@/lib/queries";
import { ApiError } from "@/lib/api";
import { categoryConfig, formatRelativeTime } from "@/lib/utils";
import { Send, Clock, MapPin, Calendar, DollarSign, Loader2, FileText, ExternalLink, Upload } from "lucide-react";
import Link from "next/link";

const STATUS_ORDER = ["submitted", "triaged", "osint", "action_taken", "closed"];

const timelineSteps = [
  { label: "Complaint Submitted", description: "Your complaint has been received and logged" },
  { label: "AI Triage Complete", description: "Classified and assigned" },
  { label: "Under Investigation", description: "OSINT investigation in progress" },
  { label: "Action Taken", description: "Pending" },
  { label: "Case Resolved", description: "Pending" },
];

export default function VictimCaseDetail() {
  const params = useParams();
  const caseId = String(params.id);
  const { data: caseData, isLoading, isError, error } = useVictimCase(caseId);
  const postMessage = usePostCaseMessage();
  const requestErasure = useRequestErasure();
  const uploadEvidence = useUploadVictimEvidence();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [uploadMsg, setUploadMsg] = useState("");

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError || !caseData) {
    const forbidden = error instanceof ApiError && error.status === 403;
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="font-medium text-foreground">
            {forbidden ? "You don't have access to this case." : "Case not found."}
          </p>
          <Button asChild className="mt-4" variant="outline">
            <Link href="/victim/dashboard">Back to My Cases</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const statusIndex = STATUS_ORDER.indexOf(caseData.status);
  const messages = caseData.messages ?? [];

  const handleSend = () => {
    if (!draft.trim()) return;
    postMessage.mutate(
      { id: caseData.id, body: draft.trim(), visibility: "victim" },
      { onSuccess: () => setDraft("") },
    );
  };

  return (
    <div className="space-y-8">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="stitch-glass relative overflow-hidden border-black/[0.06]">
          <div className="pointer-events-none absolute -right-12 -top-12 size-48 rounded-full bg-primary/[0.07] blur-3xl" />
          <CardContent className="relative pt-6 sm:pt-8">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-muted/80 px-3 py-1 ring-1 ring-black/[0.06]">
              <span className="font-mono-technical text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
                Your reference
              </span>
            </div>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                  Case{" "}
                  <span className="font-mono-technical text-primary">{caseData.caseNumber}</span>
                </h1>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="capitalize">
                    {categoryConfig[caseData.category].label}
                  </Badge>
                  <SeverityBadge severity={caseData.severity} />
                </div>
                <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
                  {caseData.incidentDate && (
                    <span className="flex items-center gap-1">
                      <Calendar className="size-3.5" />
                      {new Date(caseData.incidentDate).toLocaleDateString("en-IN")}
                    </span>
                  )}
                  {caseData.state && (
                    <span className="flex items-center gap-1">
                      <MapPin className="size-3.5" />
                      {caseData.district}, {caseData.state}
                    </span>
                  )}
                  {caseData.monetaryLoss !== undefined && caseData.monetaryLoss > 0 && (
                    <span className="flex items-center gap-1">
                      <DollarSign className="size-3.5" />
                      ₹{caseData.monetaryLoss.toLocaleString("en-IN")}
                    </span>
                  )}
                </div>
              </div>
              <CaseStatusBadge status={caseData.status} />
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader><CardTitle>Case Progress</CardTitle></CardHeader>
            <CardContent>
              <TimelineStep steps={timelineSteps} currentStep={statusIndex} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Your Report</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm leading-relaxed">{caseData.description}</p>
              {caseData.ncrpComplaint && (
                <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    NCRP / I4C fields on file
                  </p>
                  <p>
                    <span className="text-muted-foreground">Platform: </span>
                    {caseData.ncrpComplaint.occurredOn || "—"}
                  </p>
                  <p>
                    <span className="text-muted-foreground">NCRP category: </span>
                    {caseData.ncrpComplaint.ncrpCategory || "—"}
                  </p>
                  {(caseData.ncrpComplaint.transactions?.length ?? 0) > 0 && (
                    <p>
                      <span className="text-muted-foreground">Transactions: </span>
                      {caseData.ncrpComplaint.transactions!.length} recorded
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Messages</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-4 mb-4">
                <div className="rounded-xl bg-primary-soft p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-primary">System</span>
                    <span className="text-xs text-muted-foreground">
                      • {formatRelativeTime(new Date(caseData.createdAt))}
                    </span>
                  </div>
                  <p className="text-sm">
                    Your complaint has been registered and is being processed.
                  </p>
                </div>
                {messages.map((m) => (
                  <div key={m.id} className="rounded-xl border border-border p-4">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="text-xs font-medium">{m.authorName}</span>
                      <span className="text-xs text-muted-foreground">
                        • {formatRelativeTime(new Date(m.createdAt))}
                      </span>
                    </div>
                    <p className="text-sm">{m.body}</p>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Textarea
                  placeholder="Send a message to the investigating team..."
                  rows={2}
                  className="flex-1"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <Button
                  size="sm"
                  className="self-end"
                  disabled={!draft.trim() || postMessage.isPending}
                  onClick={handleSend}
                >
                  <Send className="size-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Submitted evidence</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {caseData.evidenceFiles && caseData.evidenceFiles.length > 0 ? (
                <ul className="space-y-2">
                  {caseData.evidenceFiles.map((f, i) => {
                    const href = f.fileUrl?.startsWith("http") ? f.fileUrl : undefined;
                    return (
                      <li key={f.id ?? `${f.fileName}-${i}`}>
                        {href ? (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                          >
                            <FileText className="size-4 shrink-0" />
                            <span className="truncate">{f.fileName}</span>
                            <ExternalLink className="size-3 shrink-0 opacity-60" />
                          </a>
                        ) : (
                          <span className="flex items-center gap-2 text-sm text-muted-foreground">
                            <FileText className="size-4 shrink-0" />
                            {f.fileName}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No evidence files yet.</p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const list = e.target.files;
                    if (!list?.length) return;
                    setUploadMsg("");
                    uploadEvidence.mutate(
                      { caseId: caseData.caseNumber, files: Array.from(list) },
                      {
                        onSuccess: (res) =>
                          setUploadMsg(`Uploaded ${(res.added ?? []).length} file(s).`),
                        onError: (err) =>
                          setUploadMsg(err instanceof Error ? err.message : "Upload failed"),
                      },
                    );
                    e.target.value = "";
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  disabled={uploadEvidence.isPending}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploadEvidence.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Upload className="size-3.5" />
                  )}
                  Add evidence
                </Button>
                {uploadMsg && <p className="text-xs text-muted-foreground">{uploadMsg}</p>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Case Info</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Filed On</span>
                <span className="font-medium">
                  {new Date(caseData.createdAt).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Last Updated</span>
                <span className="font-medium flex items-center gap-1">
                  <Clock className="size-3" />
                  {formatRelativeTime(new Date(caseData.updatedAt))}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Assigned To</span>
                <span className="font-medium">{caseData.assignedOfficerName || "Pending"}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Privacy</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Request erasure of personal data under DPDP (subject to prosecution holds).
              </p>
              {caseData.erasureRequestStatus === "PENDING" ? (
                <p className="text-sm font-medium text-amber-700">Erasure request pending review</p>
              ) : caseData.activeProsecution ? (
                <p className="text-sm text-muted-foreground">Unavailable while prosecution flag is active</p>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={requestErasure.isPending}
                  onClick={() => requestErasure.mutate(caseData.caseNumber)}
                >
                  Request data erasure
                </Button>
              )}
              {requestErasure.isSuccess && (
                <p className="text-xs text-muted-foreground">Request submitted (acknowledgement logged).</p>
              )}
              {requestErasure.isError && (
                <p className="text-xs text-destructive">
                  {(requestErasure.error as Error)?.message || "Request failed"}
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="bg-primary-soft border-primary/20">
            <CardContent className="pt-6 text-center">
              <p className="text-sm font-semibold text-primary">Need Support?</p>
              <p className="text-xs text-primary/70 mt-1">
                Directory of legal / counselling partners (confirm availability yourself).
              </p>
              <Button asChild variant="default" size="sm" className="mt-3">
                <Link href="/victim/support">View directory</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
