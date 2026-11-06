"use client";

import { useState, useCallback, useRef, useEffect, type ChangeEvent } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { useSubmissionStore, useAuthStore } from "@/lib/store";
import { useCreateCase, useTriage } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CaseCategoryCard } from "@/components/case/case-category-card";
import { indianStates } from "@/lib/mock-data";
import type { CaseCategory } from "@/lib/utils";
import type { Case } from "@/lib/types";
import {
  ArrowLeft,
  ArrowRight,
  Upload,
  X,
  FileText,
  Image as ImageIcon,
  Link2,
  CheckCircle2,
  Shield,
  AlertTriangle,
  Loader2,
  ShieldCheck,
  Lightbulb,
} from "lucide-react";
import { StitchWizardHeader, stitchFieldLabel } from "@/components/stitch/wizard-shell";

const stepLabels = [
  "Personal Info",
  "Incident Type",
  "Evidence",
  "Description",
  "Review & Submit",
];

const stepHeadlines: { title: string; subtitle: string; italicWord?: string }[] = [
  {
    title: "Personal ",
    italicWord: "Identity",
    subtitle:
      "Before case details, we verify your identity to protect the integrity of the civic redressal process.",
  },
  {
    title: "Incident ",
    italicWord: "Classification",
    subtitle: "Select the vector that best matches your case — we tune routing and severity hints automatically.",
  },
  {
    title: "Verification ",
    italicWord: "Assets",
    subtitle: "Upload evidence and suspicious URLs. Files are encrypted; our OSINT stack can snapshot endpoints.",
  },
  {
    title: "Incident ",
    italicWord: "Narrative",
    subtitle: "Describe what happened. AI triage assists analysts — you can refine before submit.",
  },
  {
    title: "Review & ",
    italicWord: "Attest",
    subtitle: "Confirm accuracy and consent before your complaint enters the investigation queue.",
  },
];

const categories: CaseCategory[] = [
  "financial_fraud",
  "cyberbullying",
  "sextortion",
  "deepfake",
  "account_hacking",
  "identity_theft",
  "phishing",
  "corporate",
];

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 200 : -200,
    opacity: 0,
  }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({
    x: direction < 0 ? 200 : -200,
    opacity: 0,
  }),
};

const MIN_DESCRIPTION_CHARS = 30;

type SubmitFormFields = {
  full_name: string;
  phone: string;
  email: string;
  state: string;
  category: CaseCategory | "";
  description: string;
  evidence_urls: string[];
};

function getStepValidationError(step: number, fd: SubmitFormFields, fileList: File[]): string | null {
  switch (step) {
    case 0: {
      if (!fd.full_name.trim() || fd.full_name.trim().length < 2) {
        return "Please enter your full name.";
      }
      const digits = fd.phone.replace(/\D/g, "");
      if (digits.length < 10) {
        return "Please enter a valid phone number (at least 10 digits).";
      }
      const em = fd.email.trim();
      if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
        return "Please enter a valid email address.";
      }
      if (!fd.state) {
        return "Please select your state.";
      }
      return null;
    }
    case 1:
      if (!fd.category) {
        return "Please select an incident category.";
      }
      return null;
    case 2: {
      const urlRaw = fd.evidence_urls[0]?.trim() ?? "";
      const hasFiles = fileList.length > 0;
      let urlOk = false;
      if (urlRaw.length >= 8) {
        try {
          const u = new URL(urlRaw);
          urlOk = u.protocol === "http:" || u.protocol === "https:";
        } catch {
          urlOk = false;
        }
      }
      if (!hasFiles && !urlOk) {
        return "Please upload at least one file or enter a valid suspicious URL (https://…).";
      }
      return null;
    }
    case 3:
      if (fd.description.trim().length < MIN_DESCRIPTION_CHARS) {
        return `Please describe what happened in at least ${MIN_DESCRIPTION_CHARS} characters.`;
      }
      return null;
    default:
      return null;
  }
}

function isWizardComplete(fd: SubmitFormFields, fileList: File[]): boolean {
  for (let s = 0; s <= 3; s++) {
    if (getStepValidationError(s, fd, fileList)) return false;
  }
  return true;
}

export default function SubmitPage() {
  const { currentStep, nextStep, prevStep, setStep } = useSubmissionStore();
  const [direction, setDirection] = useState(0);
  const [submittedCase, setSubmittedCase] = useState<Case | null>(null);
  const [submitError, setSubmitError] = useState("");
  const [stepError, setStepError] = useState("");

  const createCase = useCreateCase();
  const triage = useTriage();
  const triageTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { user, isAuthenticated } = useAuthStore();

  const [formData, setFormData] = useState({
    full_name: "",
    phone: "",
    email: "",
    state: "",
    district: "",
    category: "" as CaseCategory | "",
    description: "",
    monetary_loss: "",
    incident_date: "",
    evidence_urls: [""],
    consent: false,
    complainant_is_minor: false,
    involves_minor: false,
    guardian_name: "",
    guardian_contact: "",
  });
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isAuthenticated || user?.role !== "victim") return;
    setFormData((prev) => ({
      ...prev,
      email: prev.email || user.email,
      full_name: prev.full_name || user.name,
      ...(user.phone && !prev.phone ? { phone: user.phone } : {}),
    }));
  }, [isAuthenticated, user]);

  const updateField = useCallback((field: string, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleNext = () => {
    const err = getStepValidationError(currentStep, formData, files);
    if (err) {
      setStepError(err);
      return;
    }
    setStepError("");
    setDirection(1);
    nextStep();
  };

  const handlePrev = () => {
    setStepError("");
    setDirection(-1);
    prevStep();
  };

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files);
    setFiles((prev) => [...prev, ...dropped]);
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleFileInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (list?.length) {
      setFiles((prev) => [...prev, ...Array.from(list)]);
    }
    e.target.value = "";
  }, []);

  const handleDescriptionChange = (text: string) => {
    updateField("description", text);

    if (triageTimer.current) clearTimeout(triageTimer.current);
    if (text.length > 30) {
      triageTimer.current = setTimeout(() => {
        triage.mutate({
          text,
          monetaryLoss: formData.monetary_loss ? Number(formData.monetary_loss) : undefined,
        });
      }, 800);
    }
  };

  const handleSubmit = async () => {
    setSubmitError("");
    setStepError("");
    for (let s = 0; s <= 3; s++) {
      const err = getStepValidationError(s, formData, files);
      if (err) {
        setStepError(err);
        setStep(s);
        return;
      }
    }
    if (!formData.consent) {
      setStepError("Please confirm the declaration before submitting.");
      return;
    }
    if (formData.complainant_is_minor) {
      if (!formData.guardian_name.trim() || !formData.guardian_contact.trim()) {
        setStepError("Guardian name and contact are required when the complainant is under 18.");
        setStep(3);
        return;
      }
    }
    try {
      const result = await createCase.mutateAsync({
        victimName: formData.full_name,
        victimEmail: formData.email,
        victimPhone: formData.phone,
        category: formData.category as CaseCategory,
        description: formData.description,
        monetaryLoss: formData.monetary_loss ? Number(formData.monetary_loss) : undefined,
        incidentDate: formData.incident_date || undefined,
        state: formData.state || undefined,
        district: formData.district || undefined,
        evidenceUrl: formData.evidence_urls[0]?.trim() || undefined,
        files: files.length > 0 ? files : undefined,
        complainantIsMinor: formData.complainant_is_minor,
        involvesMinor: formData.involves_minor || formData.complainant_is_minor,
        guardianName: formData.guardian_name.trim() || undefined,
        guardianContact: formData.guardian_contact.trim() || undefined,
        triageFlags: triage.data?.flags,
      });
      setSubmittedCase(result);
      setStep(0);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to submit complaint";
      setSubmitError(message);
    }
  };

  if (submittedCase) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-6 py-16">
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-lg text-center"
        >
          <div className="mx-auto mb-6 flex size-20 items-center justify-center rounded-full bg-primary/10 text-primary">
            <CheckCircle2 className="size-10" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Complaint registered</h1>
          <p className="mt-2 text-muted-foreground">
            Your case is in the queue. Typical triage response is under four hours.
          </p>
          <Card className="mt-8 text-left">
            <CardContent className="space-y-4 pt-6">
              <div className="flex items-center justify-between border-b border-black/[0.06] py-3">
                <span className="text-sm text-muted-foreground">Case number</span>
                <span className="font-mono-technical text-sm font-bold text-primary">{submittedCase.caseNumber}</span>
              </div>
              <div className="flex items-center justify-between border-b border-black/[0.06] py-3">
                <span className="text-sm text-muted-foreground">Status</span>
                <Badge variant="info">Submitted</Badge>
              </div>
              <p className="pt-1 text-left text-xs text-muted-foreground">
                Save this reference. Sign in to the victim portal with the same email to track updates. Confirmation may
                be sent to {formData.email || "your email"}.
              </p>
            </CardContent>
          </Card>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            {isAuthenticated && user?.role === "victim" ? (
              <Button asChild variant="cta">
                <Link href={`/victim/case/${submittedCase.id}`}>Open in My Cases</Link>
              </Button>
            ) : (
              <Button asChild variant="cta">
                <Link href="/login?next=/victim/dashboard">Sign in to track</Link>
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link href="/">Home</Link>
            </Button>
          </div>
        </motion.div>
      </div>
    );
  }

  const headline = stepHeadlines[currentStep] ?? stepHeadlines[0];
  const totalSteps = stepLabels.length;

  return (
    <div className="min-h-[calc(100vh-4rem)] px-4 py-10 sm:px-6 lg:py-14">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 lg:mb-10">
          <Link
            href="/"
            className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
          >
            <ArrowLeft className="size-4" />
            Back
          </Link>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            {headline.italicWord ? (
              <>
                {headline.title}
                <span className="italic text-primary">{headline.italicWord}</span>
              </>
            ) : (
              headline.title
            )}
          </h1>
          <p className="mt-3 max-w-2xl text-base text-muted-foreground">{headline.subtitle}</p>
        </div>

        <StitchWizardHeader stepIndex={currentStep} total={totalSteps} />

        <Card className="stitch-ambient border-black/[0.06] shadow-sm">
          <CardContent className="p-6 sm:p-8 lg:p-10">
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={currentStep}
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3, ease: "easeInOut" }}
              >
                {currentStep === 0 && (
                  <div className="space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="full_name" className={stitchFieldLabel}>
                        Full name *
                      </Label>
                      <Input
                        id="full_name"
                        placeholder="Enter your full name"
                        value={formData.full_name}
                        onChange={(e) => updateField("full_name", e.target.value)}
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="phone" className={stitchFieldLabel}>
                          Phone *
                        </Label>
                        <Input
                          id="phone"
                          placeholder="+91 XXXXX XXXXX"
                          value={formData.phone}
                          onChange={(e) => updateField("phone", e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="email" className={stitchFieldLabel}>
                          Email *
                        </Label>
                        <Input
                          id="email"
                          type="email"
                          placeholder="you@example.com"
                          value={formData.email}
                          onChange={(e) => updateField("email", e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="state" className={stitchFieldLabel}>
                          State *
                        </Label>
                        <select
                          id="state"
                          value={formData.state}
                          onChange={(e) => updateField("state", e.target.value)}
                          className="flex h-10 w-full rounded-xl border border-input bg-card px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                        >
                          <option value="">Select state</option>
                          {indianStates.map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="district" className={stitchFieldLabel}>
                          District
                        </Label>
                        <Input
                          id="district"
                          placeholder="Enter district"
                          value={formData.district}
                          onChange={(e) => updateField("district", e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {currentStep === 1 && (
                  <div>
                    <p className="mb-4 font-mono-technical text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Select incident vector
                    </p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {categories.map((cat) => (
                        <CaseCategoryCard
                          key={cat}
                          category={cat}
                          selected={formData.category === cat}
                          onSelect={(c) => updateField("category", c)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {currentStep === 2 && (
                  <div className="grid gap-8 lg:grid-cols-[1fr_280px] lg:gap-10">
                    <div className="space-y-5">
                      <div
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={handleFileDrop}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            fileInputRef.current?.click();
                          }
                        }}
                        className="relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-primary/25 bg-primary/5 p-10 text-center transition-colors hover:border-primary/50 hover:bg-primary/10"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-card shadow-sm ring-1 ring-black/[0.06]">
                          <Upload className="size-7 text-primary" />
                        </div>
                        <p className="text-sm font-semibold">Drop files or browse</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Screenshots, PDFs, exports — encrypted at rest (50MB total cap)
                        </p>
                        <input
                          ref={fileInputRef}
                          id="file-input"
                          type="file"
                          multiple
                          className="hidden"
                          aria-label="Upload evidence files"
                          onChange={handleFileInputChange}
                        />
                      </div>

                      {files.length > 0 && (
                        <div className="space-y-2">
                          <p className={stitchFieldLabel}>Queued uploads</p>
                          {files.map((file, i) => (
                            <div
                              key={`${file.name}-${i}`}
                              className="flex items-center gap-3 rounded-xl border border-black/[0.06] bg-card/80 p-3"
                            >
                              {file.type.startsWith("image/") ? (
                                <ImageIcon className="size-5 shrink-0 text-primary" />
                              ) : (
                                <FileText className="size-5 shrink-0 text-amber-600" />
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium">{file.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {(file.size / 1024).toFixed(1)} KB
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => removeFile(i)}
                                className="cursor-pointer text-muted-foreground hover:text-destructive"
                              >
                                <X className="size-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="space-y-2">
                        <Label className={stitchFieldLabel}>Suspicious URL</Label>
                        <div className="relative">
                          <Link2 className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            placeholder="https://"
                            className="pl-9"
                            value={formData.evidence_urls[0]}
                            onChange={(e) => {
                              const urls = [...formData.evidence_urls];
                              urls[0] = e.target.value;
                              setFormData((prev) => ({ ...prev, evidence_urls: urls }));
                            }}
                          />
                        </div>
                      </div>
                    </div>

                    <aside className="space-y-4 rounded-2xl border border-black/[0.06] bg-muted/40 p-5 lg:p-6">
                      <div className="flex items-start gap-3">
                        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
                        <div>
                          <p className="text-sm font-semibold">Chain of custody</p>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            Hashes and timestamps are recorded. Analysts may request additional material after triage.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3 border-t border-black/[0.06] pt-4">
                        <Lightbulb className="mt-0.5 size-5 shrink-0 text-amber-600" />
                        <div>
                          <p className="text-sm font-semibold">Tip</p>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            Include full-page screenshots, email headers, and wallet or UPI references when relevant.
                          </p>
                        </div>
                      </div>
                    </aside>
                  </div>
                )}

                {currentStep === 3 && (
                  <div className="space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="description" className={stitchFieldLabel}>
                        Narrative *
                      </Label>
                      <Textarea
                        id="description"
                        placeholder="Please describe the incident in detail. Include any relevant information such as transaction IDs, usernames, or account numbers involved..."
                        rows={6}
                        value={formData.description}
                        onChange={(e) => handleDescriptionChange(e.target.value)}
                        aria-invalid={formData.description.trim().length > 0 && formData.description.trim().length < MIN_DESCRIPTION_CHARS}
                      />
                      <p className="text-xs text-muted-foreground">
                        Minimum {MIN_DESCRIPTION_CHARS} characters ({formData.description.trim().length}/{MIN_DESCRIPTION_CHARS})
                      </p>
                      {triage.isPending && formData.description.length > 30 && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="flex items-center gap-2 text-xs text-muted-foreground"
                        >
                          <Loader2 className="size-3 animate-spin" />
                          Analyzing severity...
                        </motion.div>
                      )}
                      {triage.data && (
                        <motion.div
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="flex items-center gap-2"
                        >
                          <Badge
                            variant={
                              triage.data.severity === "high" ? "danger"
                              : triage.data.severity === "medium" ? "warning"
                              : "success"
                            }
                            className="gap-1"
                          >
                            <AlertTriangle className="size-3" />
                            AI Severity: {triage.data.severity.charAt(0).toUpperCase() + triage.data.severity.slice(1)}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {Math.round(triage.data.confidence * 100)}% confidence
                            {triage.data.flags.length > 0 && ` · ${triage.data.flags.join(", ")}`}
                          </span>
                        </motion.div>
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="incident_date" className={stitchFieldLabel}>
                          Approx. date
                        </Label>
                        <Input
                          id="incident_date"
                          type="date"
                          value={formData.incident_date}
                          onChange={(e) => updateField("incident_date", e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="monetary_loss" className={stitchFieldLabel}>
                          Loss (₹)
                        </Label>
                        <Input
                          id="monetary_loss"
                          type="number"
                          placeholder="0"
                          value={formData.monetary_loss}
                          onChange={(e) => updateField("monetary_loss", e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="space-y-3 rounded-2xl border border-amber-200/80 bg-amber-50/50 p-4">
                      <p className={stitchFieldLabel}>Child safety (DPDP)</p>
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.complainant_is_minor}
                          onChange={(e) => updateField("complainant_is_minor", e.target.checked)}
                          className="mt-1 size-4 rounded border-border accent-primary"
                        />
                        <span className="text-sm text-muted-foreground">
                          I am under 18 (complainant is a minor)
                        </span>
                      </label>
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.involves_minor}
                          onChange={(e) => updateField("involves_minor", e.target.checked)}
                          className="mt-1 size-4 rounded border-border accent-primary"
                        />
                        <span className="text-sm text-muted-foreground">
                          This incident involves a minor (even if I am an adult reporting)
                        </span>
                      </label>
                      {(formData.complainant_is_minor || formData.involves_minor) && (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 pt-1">
                          <div className="space-y-2">
                            <Label htmlFor="guardian_name" className={stitchFieldLabel}>
                              Guardian name {formData.complainant_is_minor ? "*" : ""}
                            </Label>
                            <Input
                              id="guardian_name"
                              value={formData.guardian_name}
                              onChange={(e) => updateField("guardian_name", e.target.value)}
                              placeholder="Parent / guardian full name"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="guardian_contact" className={stitchFieldLabel}>
                              Guardian contact {formData.complainant_is_minor ? "*" : ""}
                            </Label>
                            <Input
                              id="guardian_contact"
                              value={formData.guardian_contact}
                              onChange={(e) => updateField("guardian_contact", e.target.value)}
                              placeholder="Phone or email"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {currentStep === 4 && (
                  <div className="space-y-5">
                    <div className="space-y-3 rounded-2xl border border-black/[0.06] bg-muted/30 p-5 sm:p-6">
                      <h3 className="font-mono-technical text-[11px] font-bold uppercase tracking-wider text-primary">
                        Summary
                      </h3>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="text-muted-foreground">Name:</span>
                          <p className="font-medium">{formData.full_name || "—"}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Phone:</span>
                          <p className="font-medium">{formData.phone || "—"}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Email:</span>
                          <p className="font-medium">{formData.email || "—"}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Location:</span>
                          <p className="font-medium">
                            {formData.district ? `${formData.district}, ` : ""}
                            {formData.state || "—"}
                          </p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Category:</span>
                          <p className="font-medium capitalize">
                            {formData.category?.replace(/_/g, " ") || "—"}
                          </p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Evidence Files:</span>
                          <p className="font-medium">{files.length} file(s)</p>
                        </div>
                      </div>
                      {formData.description && (
                        <div>
                          <span className="text-sm text-muted-foreground">Description:</span>
                          <p className="text-sm mt-1 line-clamp-3">{formData.description}</p>
                        </div>
                      )}
                    </div>

                    {submitError && (
                      <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                        {submitError}
                      </div>
                    )}

                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.consent}
                        onChange={(e) => updateField("consent", e.target.checked)}
                        className="mt-1 size-4 rounded border-border accent-primary"
                      />
                      <span className="text-sm text-muted-foreground">
                        I authorize GRAAS to use the provided information for investigation
                        purposes. I confirm that the information provided is true and accurate
                        to the best of my knowledge.
                      </span>
                    </label>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            {stepError && (
              <div
                role="alert"
                className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200"
              >
                {stepError}
              </div>
            )}

            <div className="mt-10 flex items-center justify-between border-t border-black/[0.06] pt-8">
              <Button
                variant="ghost"
                onClick={handlePrev}
                disabled={currentStep === 0}
                className="text-muted-foreground"
              >
                <ArrowLeft className="size-4" />
                Back
              </Button>

              {currentStep < 4 ? (
                <Button variant="cta" onClick={handleNext}>
                  Continue
                  <ArrowRight className="size-4" />
                </Button>
              ) : (
                <Button
                  variant="cta"
                  onClick={handleSubmit}
                  disabled={
                    !formData.consent || createCase.isPending || !isWizardComplete(formData, files)
                  }
                >
                  {createCase.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Shield className="size-4" />
                  )}
                  {createCase.isPending ? "Submitting..." : "Submit Complaint"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {currentStep === 0 && (
          <div className="mt-8 flex gap-4 rounded-2xl border border-black/[0.06] bg-muted/25 p-5 sm:p-6">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Shield className="size-5" />
            </div>
            <div>
              <p className="text-sm font-semibold">Why we verify identity</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                GRAAS ties each complaint to a contactable party to deter abuse and to meet statutory intake
                requirements. Your details are used only for this case and are not sold or shared for marketing.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
