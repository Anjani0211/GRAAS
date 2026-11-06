"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Search, ArrowRight, Lock } from "lucide-react";
import { stitchFieldLabel } from "@/components/stitch/wizard-shell";
import { useAuthStore } from "@/lib/store";
import { isStaffRole } from "@/lib/roles";

function normalizeCaseNumber(input: string): string {
  const t = input.trim();
  if (!t) return "";
  if (/^GRS-\d{4}-/i.test(t)) return t;
  const suffix = t.replace(/^GRS-\d{4}-/i, "").toUpperCase();
  const year = new Date().getFullYear();
  return `GRS-${year}-${suffix}`;
}

export default function TrackPage() {
  const router = useRouter();
  const [caseInput, setCaseInput] = useState("");
  const { isAuthenticated, user, isLoading } = useAuthStore();

  const isVictim = isAuthenticated && user?.role === "victim";
  const isStaff = isAuthenticated && user && isStaffRole(user.role);

  const handleContinue = (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    const normalized = normalizeCaseNumber(caseInput);
    if (!normalized) return;

    if (isVictim) {
      router.push(`/victim/case/${encodeURIComponent(normalized)}`);
      return;
    }
    if (isStaff) {
      router.push(`/admin/case/${encodeURIComponent(normalized)}`);
      return;
    }

    const next = encodeURIComponent(`/victim/case/${normalized}`);
    router.push(`/login?next=${next}`);
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] px-4 py-14 sm:px-6 lg:py-20">
      <div className="mx-auto max-w-3xl">
        <motion.header
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-10 text-center md:text-left"
        >
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-muted/90 px-3 py-1.5 ring-1 ring-black/[0.06]">
            <span className="font-mono-technical text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
              Case tracking active
            </span>
            <span className="size-1.5 animate-pulse rounded-full bg-primary" aria-hidden />
          </div>
          <h1 className="mb-3 text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
            Secure reference{" "}
            <span className="font-mono-technical text-primary">lookup</span>
          </h1>
          <p className="max-w-2xl text-muted-foreground leading-relaxed">
            {isVictim || isStaff ? (
              <>
                You&apos;re signed in — enter a case number to open it in your {isVictim ? "victim" : "admin"}{" "}
                workspace. Investigator identities stay redacted where applicable.
              </>
            ) : (
              <>
                Status and updates live in your victim portal. Enter the case number from your acknowledgement, then sign
                in with the same email you used when filing. Investigator identities stay redacted.
              </>
            )}
          </p>
        </motion.header>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
        >
          <Card className="stitch-glass stitch-ambient overflow-hidden rounded-2xl border-black/[0.08] shadow-[0_12px_40px_rgba(26,86,219,0.08)]">
            <CardContent className="relative p-6 sm:p-8">
              <div className="pointer-events-none absolute -right-8 -top-8 size-40 rounded-full bg-primary/[0.06] blur-2xl" />
              <div className="relative mb-6 flex items-center gap-3">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Lock className="size-5" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold">Authenticated access</p>
                  <p className="text-xs text-muted-foreground">
                    {isVictim || isStaff
                      ? "Case details open in your portal after you continue."
                      : "You will sign in before any case details are shown."}
                  </p>
                </div>
              </div>
              <form onSubmit={handleContinue} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="caseId" className={stitchFieldLabel}>
                    Case number
                  </Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="caseId"
                      placeholder="GRS-2026-XXXXX"
                      className="pl-9 font-mono-technical"
                      value={caseInput}
                      onChange={(e) => setCaseInput(e.target.value)}
                      autoFocus
                    />
                  </div>
                </div>
                <Button
                  type="submit"
                  variant="cta"
                  className="w-full"
                  size="lg"
                  disabled={!caseInput.trim() || isLoading}
                >
                  {isVictim || isStaff ? (
                    <>
                      Open case
                      <ArrowRight className="size-4" />
                    </>
                  ) : (
                    <>
                      Continue to sign in
                      <ArrowRight className="size-4" />
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        </motion.div>

        <p className="mt-8 text-center text-sm text-muted-foreground md:text-left">
          Already signed in?{" "}
          <Link href="/victim/dashboard" className="font-medium text-primary hover:underline">
            Open My Cases
          </Link>
        </p>
      </div>
    </div>
  );
}
