"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AdminHeader } from "@/components/layout/admin-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { CaseStatusBadge, SeverityBadge } from "@/components/case/case-status-badge";
import { TimelineStep } from "@/components/case/timeline-step";
import {
  useCase,
  useUpdateCaseStatus,
  useAssignCase,
  useTeamUsers,
  useEscalate,
  useSendNotification,
  usePostCaseMessage,
} from "@/lib/queries";
import { categoryConfig, formatRelativeTime, type CaseStatus } from "@/lib/utils";
import {
  User,
  Mail,
  Phone,
  MapPin,
  Calendar,
  DollarSign,
  FileText,
  Image,
  Globe,
  Search,
  Shield,
  Send,
  Download,
  Banknote,
  AlertTriangle,
  MessageSquare,
  Loader2,
  Radar,
  Play,
} from "lucide-react";

const STATUS_ORDER: CaseStatus[] = ["submitted", "triaged", "osint", "action_taken", "closed"];

const timelineStepLabels = [
  { label: "Submitted" },
  { label: "Triaged" },
  { label: "OSINT Investigation" },
  { label: "Action Taken" },
  { label: "Closed" },
];

const actionsByCategory: Record<string, { label: string; icon: typeof Shield; variant: string; actionType: string }[]> = {
  financial_fraud: [
    { label: "Notify Bank", icon: Banknote, variant: "default", actionType: "bank_freeze" },
    { label: "File RBI Complaint", icon: FileText, variant: "default", actionType: "cert_in_report" },
    { label: "Freeze Account Request", icon: Shield, variant: "destructive", actionType: "bank_freeze" },
  ],
  cyberbullying: [
    { label: "Generate Takedown Request", icon: FileText, variant: "default", actionType: "takedown_social_media" },
    { label: "Send to Meta/X/Google", icon: Send, variant: "default", actionType: "takedown_social_media" },
    { label: "Escalate to Cyber Cell", icon: AlertTriangle, variant: "destructive", actionType: "law_enforcement_alert" },
  ],
  sextortion: [
    { label: "Escalate to Cyber Cell", icon: Shield, variant: "destructive", actionType: "law_enforcement_alert" },
    { label: "Law Enforcement Alert", icon: AlertTriangle, variant: "destructive", actionType: "law_enforcement_alert" },
    { label: "Content Takedown", icon: FileText, variant: "default", actionType: "takedown_social_media" },
  ],
  deepfake: [
    { label: "Content Verification", icon: Search, variant: "default", actionType: "cert_in_report" },
    { label: "DMCA Takedown Template", icon: FileText, variant: "default", actionType: "takedown_social_media" },
    { label: "Report to Platform", icon: Send, variant: "default", actionType: "takedown_social_media" },
  ],
  phishing: [
    { label: "Report to CERT-In", icon: Shield, variant: "default", actionType: "cert_in_report" },
    { label: "Domain Suspension", icon: Globe, variant: "destructive", actionType: "cert_in_report" },
    { label: "Block URL Request", icon: AlertTriangle, variant: "default", actionType: "cert_in_report" },
  ],
  account_hacking: [
    { label: "Account Recovery", icon: Shield, variant: "default", actionType: "cert_in_report" },
    { label: "Contact Platform", icon: Send, variant: "default", actionType: "takedown_social_media" },
    { label: "Change Credentials Alert", icon: AlertTriangle, variant: "default", actionType: "law_enforcement_alert" },
  ],
  identity_theft: [
    { label: "Identity Freeze Request", icon: Shield, variant: "destructive", actionType: "bank_freeze" },
    { label: "Credit Bureau Alert", icon: FileText, variant: "default", actionType: "cert_in_report" },
    { label: "FIR Generation", icon: FileText, variant: "default", actionType: "law_enforcement_alert" },
  ],
  corporate: [
    { label: "Notify Organization", icon: Send, variant: "default", actionType: "cert_in_report" },
    { label: "File Regulatory Complaint", icon: FileText, variant: "default", actionType: "cert_in_report" },
    { label: "Digital Evidence Preservation", icon: Download, variant: "default", actionType: "cert_in_report" },
  ],
};

export default function CaseDetailPage() {
  const params = useParams();
  const caseId = String(params.id);
  const { data: caseData, isLoading } = useCase(caseId);
  const updateStatus = useUpdateCaseStatus();
  const assignCase = useAssignCase();
  const { data: teamUsers } = useTeamUsers();
  const escalate = useEscalate();
  const sendNotification = useSendNotification();
  const postMessage = usePostCaseMessage();
  const [notifyMessage, setNotifyMessage] = useState("");
  const [notifyStatus, setNotifyStatus] = useState<string | null>(null);
  const [internalNote, setInternalNote] = useState("");

  if (isLoading) {
    return (
      <>
        <AdminHeader title="Loading…" />
        <div className="mx-auto flex max-w-7xl justify-center px-4 py-20 sm:px-6 lg:px-8">
          <Loader2 className="size-8 animate-spin text-primary" aria-busy />
        </div>
      </>
    );
  }

  if (!caseData) {
    return (
      <>
        <AdminHeader title="Case" />
        <div className="mx-auto max-w-7xl px-6 py-16 text-center text-sm text-muted-foreground">
          Case not found or failed to load.
        </div>
      </>
    );
  }

  const actions = actionsByCategory[caseData.category] || actionsByCategory.financial_fraud;
  const statusIndex = STATUS_ORDER.indexOf(caseData.status);

  const handleStatusChange = (newStatus: string) => {
    updateStatus.mutate({ id: caseData.id, status: newStatus as CaseStatus });
  };

  const handleEscalation = (actionType: string, label: string) => {
    escalate.mutate({
      caseId: caseData.id,
      actionType,
      platformTarget: label,
    });
  };

  const handleNotify = async (channel: "sms" | "email" | "whatsapp" | "both") => {
    if (!notifyMessage.trim()) return;
    const msg = notifyMessage;
    setNotifyStatus(null);
    const notes: string[] = [];
    try {
      if (channel === "both" || channel === "email") {
        const res = await sendNotification.mutateAsync({
          caseId: caseData.id,
          channel: "email",
          recipient: caseData.victimEmail,
          message: msg,
        });
        notes.push(res.note ?? `Email ${res.status}`);
      }
      if (channel === "both" || channel === "sms") {
        const res = await sendNotification.mutateAsync({
          caseId: caseData.id,
          channel: "sms",
          recipient: caseData.victimPhone,
          message: msg,
        });
        notes.push(res.note ?? `SMS ${res.status}`);
      }
      setNotifyStatus(notes.join(" · "));
      setNotifyMessage("");
    } catch {
      setNotifyStatus("Failed to queue notification — check delivery keys in Settings.");
    }
  };

  const handleInternalNote = () => {
    if (!internalNote.trim()) return;
    postMessage.mutate(
      { id: caseData.id, body: internalNote.trim(), visibility: "internal" },
      { onSuccess: () => setInternalNote("") },
    );
  };

  return (
    <>
      <AdminHeader title={`Case ${caseData.caseNumber}`} />
      <div className="mx-auto max-w-7xl px-6 pb-10 pt-2 sm:px-8">
        <div className="grid gap-6 lg:grid-cols-12 lg:gap-8">
          <div className="space-y-6 lg:col-span-8">
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <Card className="stitch-glass border-black/[0.06]">
                <CardContent className="pt-6 sm:pt-8">
                  <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-muted/80 px-3 py-1 ring-1 ring-black/[0.06]">
                    <span className="font-mono-technical text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
                      Case workspace
                    </span>
                  </div>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
                        <span className="font-mono-technical text-primary">{caseData.caseNumber}</span>
                      </h2>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Badge variant="secondary" className="capitalize">
                          {categoryConfig[caseData.category].label}
                        </Badge>
                        <SeverityBadge severity={caseData.severity} pulse />
                        <CaseStatusBadge status={caseData.status} />
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <label className="text-xs text-muted-foreground" htmlFor="assign-officer">
                          Assign officer
                        </label>
                        <select
                          id="assign-officer"
                          value={caseData.assignedOfficerId ?? ""}
                          disabled={assignCase.isPending}
                          onChange={(e) => {
                            const v = e.target.value;
                            assignCase.mutate({
                              id: caseData.caseNumber || caseData.id,
                              officerId: v ? v : null,
                            });
                          }}
                          className="h-9 min-w-[12rem] cursor-pointer rounded-lg border border-input bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                        >
                          <option value="">Unassigned</option>
                          {(teamUsers?.users ?? [])
                            .filter((u) => u.role !== "victim")
                            .map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.name} ({u.role.replace(/_/g, " ")})
                              </option>
                            ))}
                        </select>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <Button size="sm" asChild className="gap-1.5">
                        <Link
                          href={`/admin/osint/case/${encodeURIComponent(caseData.caseNumber)}?autostart=1`}
                        >
                          <Play className="size-4" />
                          Start investigation
                        </Link>
                      </Button>
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/admin/osint/case/${encodeURIComponent(caseData.caseNumber)}`}>
                          <Radar className="size-4 mr-1" />
                          OSINT workspace
                        </Link>
                      </Button>
                      <select
                        value={caseData.status}
                        onChange={(e) => handleStatusChange(e.target.value)}
                        disabled={updateStatus.isPending}
                        className="h-9 w-full min-w-[11rem] cursor-pointer rounded-lg border border-input bg-card px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                      >
                        <option value="submitted">Submitted</option>
                        <option value="triaged">Triaged</option>
                        <option value="osint">Under Investigation</option>
                        <option value="action_taken">Action Taken</option>
                        <option value="closed">Closed</option>
                      </select>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            <Card>
              <CardHeader><CardTitle>Case Timeline</CardTitle></CardHeader>
              <CardContent>
                <TimelineStep steps={timelineStepLabels} currentStep={statusIndex} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Victim Information</CardTitle></CardHeader>
              <CardContent>
                <dl className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                  {[
                    { icon: User, label: "Name", value: caseData.victimName },
                    { icon: Mail, label: "Email", value: caseData.victimEmail },
                    { icon: Phone, label: "Phone", value: caseData.victimPhone },
                    { icon: MapPin, label: "Location", value: `${caseData.district || "—"}, ${caseData.state || "—"}` },
                    { icon: Calendar, label: "Incident Date", value: caseData.incidentDate ? new Date(caseData.incidentDate).toLocaleDateString("en-IN") : "N/A" },
                    { icon: DollarSign, label: "Monetary Loss", value: caseData.monetaryLoss ? `₹${caseData.monetaryLoss.toLocaleString("en-IN")}` : "N/A" },
                  ].map((field) => (
                    <div key={field.label} className="flex min-w-0 items-start gap-3">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary">
                        <field.icon className="size-4 text-muted-foreground" aria-hidden />
                      </div>
                      <div className="min-w-0">
                        <dt className="text-xs text-muted-foreground">{field.label}</dt>
                        <dd className="mt-0.5 break-words text-sm font-medium">{field.value}</dd>
                      </div>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Incident Description</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed">{caseData.description}</p>
              </CardContent>
            </Card>

            {caseData.ncrpComplaint && (
              <Card>
                <CardHeader>
                  <CardTitle>NCRP / I4C complaint block</CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">NCRP category</dt>
                      <dd className="mt-0.5 font-medium">{caseData.ncrpComplaint.ncrpCategory || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Platform / channel</dt>
                      <dd className="mt-0.5 font-medium">{caseData.ncrpComplaint.occurredOn || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Incident time</dt>
                      <dd className="mt-0.5 font-medium">{caseData.ncrpComplaint.incidentTime || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Parent / spouse</dt>
                      <dd className="mt-0.5 font-medium">{caseData.ncrpComplaint.parentOrSpouseName || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Relationship</dt>
                      <dd className="mt-0.5 font-medium capitalize">{caseData.ncrpComplaint.relationshipToVictim || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Address</dt>
                      <dd className="mt-0.5 font-medium">
                        {[caseData.ncrpComplaint.addressLine, caseData.ncrpComplaint.pincode]
                          .filter(Boolean)
                          .join(", ") || "—"}
                      </dd>
                    </div>
                  </dl>

                  {(caseData.ncrpComplaint.transactions?.length ?? 0) > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Transactions
                      </p>
                      <div className="overflow-x-auto rounded-xl border border-border">
                        <table className="w-full min-w-[36rem] text-left text-sm">
                          <thead className="bg-muted/40 text-xs text-muted-foreground">
                            <tr>
                              <th className="px-3 py-2 font-medium">Bank / wallet</th>
                              <th className="px-3 py-2 font-medium">UTR</th>
                              <th className="px-3 py-2 font-medium">Date</th>
                              <th className="px-3 py-2 font-medium">Amount</th>
                              <th className="px-3 py-2 font-medium">Beneficiary</th>
                            </tr>
                          </thead>
                          <tbody>
                            {caseData.ncrpComplaint.transactions!.map((t, i) => (
                              <tr key={i} className="border-t border-border">
                                <td className="px-3 py-2">{t.bankOrWallet || "—"}</td>
                                <td className="px-3 py-2 font-mono text-xs">{t.utr || "—"}</td>
                                <td className="px-3 py-2">{t.date || "—"}</td>
                                <td className="px-3 py-2">
                                  {typeof t.amount === "number"
                                    ? `₹${t.amount.toLocaleString("en-IN")}`
                                    : "—"}
                                </td>
                                <td className="px-3 py-2">
                                  {t.beneficiaryUpi || t.beneficiaryAccount || "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {(caseData.ncrpComplaint.suspects?.length ?? 0) > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Suspects
                      </p>
                      <ul className="space-y-2">
                        {caseData.ncrpComplaint.suspects!.map((s, i) => (
                          <li
                            key={i}
                            className="rounded-xl border border-border bg-muted/20 px-3 py-2 text-sm"
                          >
                            {[s.name, s.mobile, s.email, s.upi, s.urlOrHandle]
                              .filter(Boolean)
                              .join(" · ") || "—"}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {caseData.ncrpComplaint.additionalInfo && (
                    <div>
                      <p className="text-xs text-muted-foreground">Additional info</p>
                      <p className="mt-1 text-sm leading-relaxed">{caseData.ncrpComplaint.additionalInfo}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader><CardTitle>Evidence Gallery</CardTitle></CardHeader>
              <CardContent>
                {caseData.evidenceFiles && caseData.evidenceFiles.length > 0 ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {caseData.evidenceFiles.map((f, n) => (
                      <div
                        key={f.id || n}
                        className="aspect-square rounded-xl bg-secondary flex flex-col items-center justify-center gap-2 hover:bg-secondary/80 transition-colors cursor-pointer border border-border"
                      >
                        <Image className="size-6 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground truncate max-w-[90%]">{f.fileName}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-6">No evidence files uploaded yet</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="size-4" />
                  Internal Notes
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="max-h-48 space-y-2 overflow-y-auto">
                  {(caseData.messages ?? [])
                    .filter((m) => m.visibility === "internal")
                    .map((m) => (
                      <div key={m.id} className="rounded-lg bg-muted/60 p-3 text-sm">
                        <div className="mb-1 flex gap-2 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">{m.authorName}</span>
                          <span>{formatRelativeTime(new Date(m.createdAt))}</span>
                        </div>
                        <p>{m.body}</p>
                      </div>
                    ))}
                </div>
                <div className="flex gap-2">
                  <Textarea
                    placeholder="Add an internal note..."
                    rows={2}
                    className="flex-1"
                    value={internalNote}
                    onChange={(e) => setInternalNote(e.target.value)}
                  />
                  <Button
                    size="sm"
                    className="self-end"
                    disabled={!internalNote.trim() || postMessage.isPending}
                    onClick={handleInternalNote}
                  >
                    <Send className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <aside className="space-y-6 lg:col-span-4 lg:sticky lg:top-24 lg:self-start">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Search className="size-4" />
                  OSINT workspace
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Button asChild variant="outline" size="sm" className="w-full justify-start gap-2">
                  <Link href={`/admin/osint/case/${caseData.id}`}>
                    <Radar className="size-3.5" />
                    Open investigation workspace
                  </Link>
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Case Actions</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {actions.map((action) => (
                  <Button
                    key={action.label}
                    variant={action.variant === "destructive" ? "destructive" : "outline"}
                    className="w-full justify-start gap-2"
                    size="sm"
                    onClick={() => handleEscalation(action.actionType, action.label)}
                    disabled={escalate.isPending}
                  >
                    <action.icon className="size-4" />
                    {action.label}
                    <Badge variant="secondary" className="ml-auto text-[10px]">
                      Draft
                    </Badge>
                  </Button>
                ))}
                <p className="text-[11px] text-muted-foreground">
                  These save a local draft only — they do not email LE or platforms. Use Dispatch to prepare outbound packages.
                </p>
                {escalate.isSuccess && (
                  <p className="text-xs text-emerald-700 mt-1">
                    Escalation draft recorded (no outbound send).
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Notify Victim</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Attempts provider delivery when Resend/MSG91 keys are set in Settings; otherwise the message stays queued only.
                </p>
                <Textarea
                  placeholder="Write update message for victim..."
                  rows={3}
                  value={notifyMessage}
                  onChange={(e) => setNotifyMessage(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 gap-1.5"
                    onClick={() => handleNotify("email")}
                    disabled={sendNotification.isPending || !notifyMessage.trim()}
                  >
                    <Mail className="size-3.5" />
                    Email
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 gap-1.5"
                    onClick={() => handleNotify("sms")}
                    disabled={sendNotification.isPending || !notifyMessage.trim()}
                  >
                    <Phone className="size-3.5" />
                    SMS
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1 gap-1.5"
                    onClick={() => handleNotify("both")}
                    disabled={sendNotification.isPending || !notifyMessage.trim()}
                  >
                    <Send className="size-3.5" />
                    Both
                  </Button>
                </div>
                {notifyStatus && (
                  <p className="text-xs text-muted-foreground">{notifyStatus}</p>
                )}
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </>
  );
}
