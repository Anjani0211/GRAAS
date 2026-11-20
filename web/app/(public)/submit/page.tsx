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
  NCRP_GENDERS,
  NCRP_OCCURRED_ON,
  NCRP_RELATIONSHIPS,
  buildNcrpPayload,
  emptySuspect,
  emptyTransaction,
  mapGrassCategoryToNcrp,
  needsFinancialTransactions,
  sumTransactionAmounts,
  type NcrpSuspect,
  type NcrpTransaction,
} from "@/lib/ncrp";
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
  Plus,
} from "lucide-react";
import { StitchWizardHeader, stitchFieldLabel } from "@/components/stitch/wizard-shell";

const stepLabels = [
  "Complainant",
  "Incident",
  "Money & Suspect",
  "Evidence",
  "Review & Submit",
];

const stepHeadlines: { title: string; subtitle: string; italicWord?: string }[] = [
  {
    title: "Complainant ",
    italicWord: "Details",
    subtitle:
      "Aligned with the NCRP / I4C cybercrime.gov.in checklist — name, contact, ID relationship, and address.",
  },
  {
    title: "Incident ",
    italicWord: "Details",
    subtitle:
      "Category, platform, date/time, and a clear narrative (minimum 200 characters, as on NCRP).",
  },
  {
    title: "Money & ",
    italicWord: "Suspect",
    subtitle:
      "Enter each fraud transaction (UTR, bank/wallet, amount) and any suspect phone, UPI, email, or URL.",
  },
  {
    title: "Evidence ",
    italicWord: "Upload",
    subtitle: "Screenshots, statements, chat exports. Soft copies stay with the case hash chain.",
  },
  {
    title: "Review & ",
    italicWord: "Attest",
    subtitle: "Confirm accuracy before the complaint enters the GRAAS investigation queue.",
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

/** NCRP citizen checklist: incident details ≥ 200 characters. */
const MIN_DESCRIPTION_CHARS = 200;

type SubmitFormFields = {
  full_name: string;
  phone: string;
  email: string;
  state: string;
  district: string;
  gender: string;
  dob: string;
  parent_or_spouse: string;
  relationship: string;
  address_line: string;
  pincode: string;
  category: CaseCategory | "";
  occurred_on: string;
  delay_reason: string;
  incident_date: string;
  incident_time: string;
  description: string;
  additional_info: string;
  monetary_loss: string;
  evidence_urls: string[];
  complainant_is_minor: boolean;
  involves_minor: boolean;
  guardian_name: string;
  guardian_contact: string;
};

function getStepValidationError(
  step: number,
  fd: SubmitFormFields,
  fileList: File[],
  transactions: NcrpTransaction[],
): string | null {
  switch (step) {
    case 0: {
      if (!fd.full_name.trim() || fd.full_name.trim().length < 2) {
        return "Please enter your full name.";
      }
      const digits = fd.phone.replace(/\D/g, "");
      if (digits.length < 10) {
        return "Please enter a valid Indian mobile number (at least 10 digits).";
      }
      const em = fd.email.trim();
      if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
        return "Please enter a valid email address.";
      }
      if (!fd.parent_or_spouse.trim()) {
        return "Father / Mother / Spouse name is required (NCRP complainant block).";
      }
      if (!fd.state) return "Please select your state.";
      if (!fd.district.trim()) return "District is required (NCRP address).";
      return null;
    }
    case 1: {
      if (!fd.category) return "Please select an incident category.";
      if (!fd.occurred_on) return "Where did the incident occur? (platform / channel)";
      if (!fd.incident_date) return "Incident date is required.";
      if (fd.description.trim().length < MIN_DESCRIPTION_CHARS) {
        return `Incident details must be at least ${MIN_DESCRIPTION_CHARS} characters (NCRP checklist).`;
      }
      return null;
    }
    case 2: {
      if (needsFinancialTransactions(fd.category)) {
        const usable = transactions.filter(
          (t) => t.utr.trim() || (t.amount.trim() && Number(t.amount) > 0) || t.bankOrWallet.trim(),
        );
        if (usable.length === 0) {
          return "Financial fraud needs at least one transaction (bank/wallet, UTR, date, amount).";
        }
        for (const [i, t] of usable.entries()) {
          if (!t.utr.trim() || t.utr.trim().length < 8) {
            return `Transaction ${i + 1}: enter a valid UTR / transaction ID.`;
          }
          if (!t.bankOrWallet.trim()) {
            return `Transaction ${i + 1}: enter bank / wallet / merchant name.`;
          }
          if (!t.date.trim()) {
            return `Transaction ${i + 1}: enter transaction date.`;
          }
          if (!t.amount.trim() || Number(t.amount) <= 0) {
            return `Transaction ${i + 1}: enter fraud amount.`;
          }
        }
      }
      return null;
    }
    case 3: {
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
        return "Please upload at least one evidence file or enter a valid suspicious URL (https://…).";
      }
      return null;
    }
    default:
      return null;
  }
}

function isWizardComplete(
  fd: SubmitFormFields,
  fileList: File[],
  transactions: NcrpTransaction[],
): boolean {
  for (let s = 0; s <= 3; s++) {
    if (getStepValidationError(s, fd, fileList, transactions)) return false;
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

  const [formData, setFormData] = useState<SubmitFormFields>({
    full_name: "",
    phone: "",
    email: "",
    state: "",
    district: "",
    gender: "",
    dob: "",
    parent_or_spouse: "",
    relationship: "self",
    address_line: "",
    pincode: "",
    category: "",
    occurred_on: "",
    delay_reason: "",
    incident_date: "",
    incident_time: "",
    description: "",
    additional_info: "",
    monetary_loss: "",
    evidence_urls: [""],
    complainant_is_minor: false,
    involves_minor: false,
    guardian_name: "",
    guardian_contact: "",
  });
  const [transactions, setTransactions] = useState<NcrpTransaction[]>([emptyTransaction()]);
  const [suspects, setSuspects] = useState<NcrpSuspect[]>([emptySuspect()]);
  const [files, setFiles] = useState<File[]>([]);
  const [consent, setConsent] = useState(false);
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

  const updateField = useCallback((field: keyof SubmitFormFields, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleNext = () => {
    const err = getStepValidationError(currentStep, formData, files, transactions);
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
        const loss =
          sumTransactionAmounts(transactions) ||
          (formData.monetary_loss ? Number(formData.monetary_loss) : undefined);
        triage.mutate({
          text,
          monetaryLoss: loss || undefined,
        });
      }, 800);
    }
  };

  const updateTx = (index: number, field: keyof NcrpTransaction, value: string) => {
    setTransactions((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  const updateSuspect = (index: number, field: keyof NcrpSuspect, value: string) => {
    setSuspects((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  const handleSubmit = async () => {
    setSubmitError("");
    setStepError("");
    for (let s = 0; s <= 3; s++) {
      const err = getStepValidationError(s, formData, files, transactions);
      if (err) {
        setStepError(err);
        setStep(s);
        return;
      }
    }
    if (!consent) {
      setStepError("Please confirm the declaration before submitting.");
      return;
    }
    if (formData.complainant_is_minor) {
      if (!formData.guardian_name.trim() || !formData.guardian_contact.trim()) {
        setStepError("Guardian name and contact are required when the complainant is under 18.");
        setStep(0);
        return;
      }
    }

    const ncrpComplaint = buildNcrpPayload({
      gender: formData.gender,
      dob: formData.dob,
      parentOrSpouseName: formData.parent_or_spouse,
      relationshipToVictim: formData.relationship,
      addressLine: formData.address_line,
      pincode: formData.pincode,
      occurredOn: formData.occurred_on,
      delayReason: formData.delay_reason,
      incidentTime: formData.incident_time,
      category: formData.category,
      additionalInfo: formData.additional_info,
      transactions,
      suspects,
    });

    const txSum = sumTransactionAmounts(transactions);
    const monetaryLoss =
      txSum > 0 ? txSum : formData.monetary_loss ? Number(formData.monetary_loss) : undefined;

    try {
      const result = await createCase.mutateAsync({
        victimName: formData.full_name,
        victimEmail: formData.email,
        victimPhone: formData.phone,
        category: formData.category as CaseCategory,
        description: formData.description,
        monetaryLoss,
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
        ncrpComplaint,
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
            Your NCRP-aligned complaint is in the GRAAS queue. Also keep your{" "}
            <a
              href="https://cybercrime.gov.in"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              cybercrime.gov.in
            </a>{" "}
            / 1930 acknowledgement if you filed there separately.
          </p>
          <Card className="mt-8 text-left">
            <CardContent className="space-y-4 pt-6">
              <div className="flex items-center justify-between border-b border-black/[0.06] py-3">
                <span className="text-sm text-muted-foreground">Case number</span>
                <span className="font-mono-technical text-sm font-bold text-primary">
                  {submittedCase.caseNumber}
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-black/[0.06] py-3">
                <span className="text-sm text-muted-foreground">Status</span>
                <Badge variant="info">Submitted</Badge>
              </div>
              <p className="pt-1 text-left text-xs text-muted-foreground">
                Save this reference. Sign in to the victim portal with the same email to track updates.
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
  const showFinancial = needsFinancialTransactions(formData.category);

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
          <p className="mb-2 font-mono-technical text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            NCRP / I4C aligned intake
          </p>
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

        <StitchWizardHeader stepIndex={currentStep} total={totalSteps} phase="NCRP-style filing" />

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
                          Mobile *
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
                        <Label htmlFor="gender" className={stitchFieldLabel}>
                          Gender
                        </Label>
                        <select
                          id="gender"
                          value={formData.gender}
                          onChange={(e) => updateField("gender", e.target.value)}
                          className="flex h-10 w-full rounded-xl border border-input bg-card px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                        >
                          <option value="">Select</option>
                          {NCRP_GENDERS.map((g) => (
                            <option key={g.value} value={g.value}>
                              {g.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="dob" className={stitchFieldLabel}>
                          Date of birth
                        </Label>
                        <Input
                          id="dob"
                          type="date"
                          value={formData.dob}
                          onChange={(e) => updateField("dob", e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="parent_or_spouse" className={stitchFieldLabel}>
                          Father / Mother / Spouse name *
                        </Label>
                        <Input
                          id="parent_or_spouse"
                          value={formData.parent_or_spouse}
                          onChange={(e) => updateField("parent_or_spouse", e.target.value)}
                          placeholder="As on NCRP complainant form"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="relationship" className={stitchFieldLabel}>
                          Relationship to victim
                        </Label>
                        <select
                          id="relationship"
                          value={formData.relationship}
                          onChange={(e) => updateField("relationship", e.target.value)}
                          className="flex h-10 w-full rounded-xl border border-input bg-card px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                        >
                          {NCRP_RELATIONSHIPS.map((r) => (
                            <option key={r.value} value={r.value}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="address_line" className={stitchFieldLabel}>
                        Address
                      </Label>
                      <Input
                        id="address_line"
                        placeholder="House / street / colony"
                        value={formData.address_line}
                        onChange={(e) => updateField("address_line", e.target.value)}
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="district" className={stitchFieldLabel}>
                          District *
                        </Label>
                        <Input
                          id="district"
                          placeholder="District"
                          value={formData.district}
                          onChange={(e) => updateField("district", e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="pincode" className={stitchFieldLabel}>
                          PIN code
                        </Label>
                        <Input
                          id="pincode"
                          placeholder="6-digit PIN"
                          value={formData.pincode}
                          onChange={(e) => updateField("pincode", e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="space-y-3 rounded-2xl border border-amber-200/80 bg-amber-50/50 p-4">
                      <p className={stitchFieldLabel}>Child safety (DPDP)</p>
                      <label className="flex cursor-pointer items-start gap-3">
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
                      <label className="flex cursor-pointer items-start gap-3">
                        <input
                          type="checkbox"
                          checked={formData.involves_minor}
                          onChange={(e) => updateField("involves_minor", e.target.checked)}
                          className="mt-1 size-4 rounded border-border accent-primary"
                        />
                        <span className="text-sm text-muted-foreground">
                          This incident involves a minor
                        </span>
                      </label>
                      {(formData.complainant_is_minor || formData.involves_minor) && (
                        <div className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label htmlFor="guardian_name" className={stitchFieldLabel}>
                              Guardian name {formData.complainant_is_minor ? "*" : ""}
                            </Label>
                            <Input
                              id="guardian_name"
                              value={formData.guardian_name}
                              onChange={(e) => updateField("guardian_name", e.target.value)}
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
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {currentStep === 1 && (
                  <div className="space-y-6">
                    <div>
                      <p className="mb-4 font-mono-technical text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Select incident category
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
                      {formData.category && (
                        <p className="mt-3 text-xs text-muted-foreground">
                          NCRP portal category:{" "}
                          <span className="font-medium text-foreground">
                            {mapGrassCategoryToNcrp(formData.category)}
                          </span>
                        </p>
                      )}
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="occurred_on" className={stitchFieldLabel}>
                          Where did the incident occur? *
                        </Label>
                        <select
                          id="occurred_on"
                          value={formData.occurred_on}
                          onChange={(e) => updateField("occurred_on", e.target.value)}
                          className="flex h-10 w-full rounded-xl border border-input bg-card px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                        >
                          <option value="">Select platform / channel</option>
                          {NCRP_OCCURRED_ON.map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="delay_reason" className={stitchFieldLabel}>
                          Reason for delay in reporting
                        </Label>
                        <Input
                          id="delay_reason"
                          placeholder="If reporting late"
                          value={formData.delay_reason}
                          onChange={(e) => updateField("delay_reason", e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="incident_date" className={stitchFieldLabel}>
                          Incident date *
                        </Label>
                        <Input
                          id="incident_date"
                          type="date"
                          value={formData.incident_date}
                          onChange={(e) => updateField("incident_date", e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="incident_time" className={stitchFieldLabel}>
                          Approx. time
                        </Label>
                        <Input
                          id="incident_time"
                          type="time"
                          value={formData.incident_time}
                          onChange={(e) => updateField("incident_time", e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="description" className={stitchFieldLabel}>
                        Incident details * (min {MIN_DESCRIPTION_CHARS} characters)
                      </Label>
                      <Textarea
                        id="description"
                        placeholder="Describe what happened in plain language: date, how you were contacted, what you were asked to do, and what money or data was lost…"
                        rows={7}
                        value={formData.description}
                        onChange={(e) => handleDescriptionChange(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        {formData.description.trim().length}/{MIN_DESCRIPTION_CHARS}
                      </p>
                      {triage.data && (
                        <Badge
                          variant={
                            triage.data.severity === "high"
                              ? "danger"
                              : triage.data.severity === "medium"
                                ? "warning"
                                : "success"
                          }
                          className="gap-1"
                        >
                          <AlertTriangle className="size-3" />
                          AI Severity: {triage.data.severity}
                        </Badge>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="additional_info" className={stitchFieldLabel}>
                        Additional information
                      </Label>
                      <Textarea
                        id="additional_info"
                        rows={3}
                        placeholder="Anything else that could help investigation"
                        value={formData.additional_info}
                        onChange={(e) => updateField("additional_info", e.target.value)}
                      />
                    </div>
                  </div>
                )}

                {currentStep === 2 && (
                  <div className="space-y-8">
                    {showFinancial ? (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className={stitchFieldLabel}>Financial transactions *</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              NCRP requires bank/wallet, 12-digit UTR, date, and fraud amount per payment.
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setTransactions((prev) => [...prev, emptyTransaction()])}
                          >
                            <Plus className="size-4" />
                            Add
                          </Button>
                        </div>
                        {transactions.map((tx, i) => (
                          <div
                            key={i}
                            className="space-y-3 rounded-2xl border border-black/[0.06] bg-muted/20 p-4"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Transaction {i + 1}
                              </span>
                              {transactions.length > 1 && (
                                <button
                                  type="button"
                                  className="text-muted-foreground hover:text-destructive"
                                  onClick={() =>
                                    setTransactions((prev) => prev.filter((_, idx) => idx !== i))
                                  }
                                >
                                  <X className="size-4" />
                                </button>
                              )}
                            </div>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                              <Input
                                placeholder="Bank / wallet / merchant *"
                                value={tx.bankOrWallet}
                                onChange={(e) => updateTx(i, "bankOrWallet", e.target.value)}
                              />
                              <Input
                                placeholder="UTR / transaction ID *"
                                value={tx.utr}
                                onChange={(e) => updateTx(i, "utr", e.target.value)}
                              />
                              <Input
                                type="date"
                                value={tx.date}
                                onChange={(e) => updateTx(i, "date", e.target.value)}
                              />
                              <Input
                                type="number"
                                placeholder="Amount (₹) *"
                                value={tx.amount}
                                onChange={(e) => updateTx(i, "amount", e.target.value)}
                              />
                              <Input
                                placeholder="Beneficiary UPI"
                                value={tx.beneficiaryUpi}
                                onChange={(e) => updateTx(i, "beneficiaryUpi", e.target.value)}
                              />
                              <Input
                                placeholder="Beneficiary account"
                                value={tx.beneficiaryAccount}
                                onChange={(e) => updateTx(i, "beneficiaryAccount", e.target.value)}
                              />
                              <Input
                                placeholder="IFSC"
                                value={tx.ifsc}
                                onChange={(e) => updateTx(i, "ifsc", e.target.value)}
                              />
                              <Input
                                placeholder="Mode (UPI / IMPS / NEFT…)"
                                value={tx.mode}
                                onChange={(e) => updateTx(i, "mode", e.target.value)}
                              />
                            </div>
                          </div>
                        ))}
                        <p className="text-sm text-muted-foreground">
                          Total from rows: ₹{sumTransactionAmounts(transactions).toLocaleString("en-IN")}
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Label htmlFor="monetary_loss" className={stitchFieldLabel}>
                          Estimated loss (₹)
                        </Label>
                        <Input
                          id="monetary_loss"
                          type="number"
                          placeholder="0"
                          value={formData.monetary_loss}
                          onChange={(e) => updateField("monetary_loss", e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                          For non-financial categories this is optional. Switch to financial fraud /
                          phishing to unlock the full UTR table.
                        </p>
                      </div>
                    )}

                    <div className="space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className={stitchFieldLabel}>Suspect details</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Optional but valuable — mobile, email, UPI, handles, URLs.
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setSuspects((prev) => [...prev, emptySuspect()])}
                        >
                          <Plus className="size-4" />
                          Add
                        </Button>
                      </div>
                      {suspects.map((s, i) => (
                        <div
                          key={i}
                          className="space-y-3 rounded-2xl border border-black/[0.06] bg-muted/20 p-4"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Suspect {i + 1}
                            </span>
                            {suspects.length > 1 && (
                              <button
                                type="button"
                                className="text-muted-foreground hover:text-destructive"
                                onClick={() =>
                                  setSuspects((prev) => prev.filter((_, idx) => idx !== i))
                                }
                              >
                                <X className="size-4" />
                              </button>
                            )}
                          </div>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <Input
                              placeholder="Name"
                              value={s.name}
                              onChange={(e) => updateSuspect(i, "name", e.target.value)}
                            />
                            <Input
                              placeholder="Mobile"
                              value={s.mobile}
                              onChange={(e) => updateSuspect(i, "mobile", e.target.value)}
                            />
                            <Input
                              placeholder="Email"
                              value={s.email}
                              onChange={(e) => updateSuspect(i, "email", e.target.value)}
                            />
                            <Input
                              placeholder="UPI ID"
                              value={s.upi}
                              onChange={(e) => updateSuspect(i, "upi", e.target.value)}
                            />
                            <Input
                              placeholder="Bank account"
                              value={s.bankAccount}
                              onChange={(e) => updateSuspect(i, "bankAccount", e.target.value)}
                            />
                            <Input
                              placeholder="URL / social handle"
                              value={s.urlOrHandle}
                              onChange={(e) => updateSuspect(i, "urlOrHandle", e.target.value)}
                            />
                          </div>
                          <Input
                            placeholder="Address (if known)"
                            value={s.address}
                            onChange={(e) => updateSuspect(i, "address", e.target.value)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {currentStep === 3 && (
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
                          Screenshots, PDFs, bank SMS exports — max ~10 MB each recommended
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
                          <p className="text-sm font-semibold">NCRP evidence tip</p>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            Keep national ID and transaction proofs ready. Soft copies help LE match
                            UTR rows on cybercrime.gov.in.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3 border-t border-black/[0.06] pt-4">
                        <Lightbulb className="mt-0.5 size-5 shrink-0 text-amber-600" />
                        <div>
                          <p className="text-sm font-semibold">Tip</p>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            Include full-page screenshots, email headers, and UPI detail screens.
                          </p>
                        </div>
                      </div>
                    </aside>
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
                          <span className="text-muted-foreground">Name</span>
                          <p className="font-medium">{formData.full_name || "—"}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Phone</span>
                          <p className="font-medium">{formData.phone || "—"}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Location</span>
                          <p className="font-medium">
                            {formData.district ? `${formData.district}, ` : ""}
                            {formData.state || "—"}
                          </p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Platform</span>
                          <p className="font-medium">{formData.occurred_on || "—"}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Category</span>
                          <p className="font-medium capitalize">
                            {formData.category?.replace(/_/g, " ") || "—"}
                          </p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">NCRP category</span>
                          <p className="font-medium">
                            {formData.category
                              ? mapGrassCategoryToNcrp(formData.category)
                              : "—"}
                          </p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Transactions</span>
                          <p className="font-medium">
                            {transactions.filter((t) => t.utr.trim()).length} row(s)
                          </p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Evidence</span>
                          <p className="font-medium">{files.length} file(s)</p>
                        </div>
                      </div>
                      {formData.description && (
                        <div>
                          <span className="text-sm text-muted-foreground">Incident details</span>
                          <p className="mt-1 line-clamp-4 text-sm">{formData.description}</p>
                        </div>
                      )}
                    </div>

                    {submitError && (
                      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                        {submitError}
                      </div>
                    )}

                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        checked={consent}
                        onChange={(e) => setConsent(e.target.checked)}
                        className="mt-1 size-4 rounded border-border accent-primary"
                      />
                      <span className="text-sm text-muted-foreground">
                        I confirm the information is true to the best of my knowledge and authorize
                        GRAAS to use it for investigation and NCRP / LE coordination.
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
                    !consent ||
                    createCase.isPending ||
                    !isWizardComplete(formData, files, transactions)
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
      </div>
    </div>
  );
}
