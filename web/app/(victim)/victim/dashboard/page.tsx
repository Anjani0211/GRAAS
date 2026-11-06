"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useVictimCases } from "@/lib/queries";
import { useAuthStore } from "@/lib/store";
import { categoryConfig, type CaseStatus } from "@/lib/utils";
import type { Case } from "@/lib/types";
import {
  PlusCircle,
  FolderOpen,
  Scale,
  Brain,
  Gavel,
  Info,
  ArrowRight,
  User,
  Loader2,
  HeartPulse,
} from "lucide-react";

function firstName(full: string | undefined): string {
  if (!full?.trim()) return "there";
  return full.trim().split(/\s+/)[0] ?? "there";
}

function statusPresentation(status: CaseStatus): { label: string; pill: string; dot: string } {
  switch (status) {
    case "closed":
      return {
        label: "Resolved",
        pill: "bg-[#dbe1ff]/30 text-[#003dab]",
        dot: "bg-primary",
      };
    case "osint":
      return {
        label: "In progress",
        pill: "bg-[#eaddff]/40 text-[#5a00c6]",
        dot: "bg-[#712ae2]",
      };
    case "action_taken":
      return {
        label: "Action taken",
        pill: "bg-[#eaddff]/40 text-[#5a00c6]",
        dot: "bg-[#712ae2]",
      };
    default:
      return {
        label: "Under review",
        pill: "bg-[#d4e3ff]/50 text-[#004884]",
        dot: "bg-[#004a88]",
      };
  }
}

function ActiveCaseCard({ c }: { c: Case }) {
  const st = statusPresentation(c.status);
  const title = categoryConfig[c.category]?.label ?? c.category;
  return (
    <Link href={`/victim/case/${c.id}`}>
      <article className="group flex h-full flex-col rounded-xl border border-black/[0.08] bg-card p-6 shadow-[0_12px_40px_rgba(26,86,219,0.04)] transition-all duration-300 hover:border-primary/20">
        <div className="mb-4 flex items-start justify-between gap-2">
          <span className="rounded bg-primary/5 px-2 py-0.5 font-mono-technical text-[10px] text-primary">{c.caseNumber}</span>
          <span
            className={`flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-widest ${st.pill}`}
          >
            <span className={`size-1.5 shrink-0 rounded-full ${st.dot}`} />
            {st.label}
          </span>
        </div>
        <h3 className="mb-2 text-lg font-bold transition-colors group-hover:text-primary">{title}</h3>
        <p className="mb-6 line-clamp-2 text-sm text-muted-foreground">{c.description}</p>
        <div className="mt-auto flex items-center gap-3 border-t border-black/[0.08] pt-4">
          <div className="flex size-8 items-center justify-center rounded-full bg-muted">
            <User className="size-4 text-muted-foreground" />
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="text-[10px] font-semibold uppercase text-muted-foreground">Assigned officer</span>
            <span className="truncate text-xs font-medium">{c.assignedOfficerName ?? "Pending assignment"}</span>
          </div>
        </div>
      </article>
    </Link>
  );
}

function ResolvedCaseRow({ c }: { c: Case }) {
  const title = categoryConfig[c.category]?.label ?? c.category;
  return (
    <article className="group flex flex-col gap-6 rounded-xl border border-black/[0.08] bg-muted/30 p-6 md:flex-row md:items-center">
      <div className="min-w-0 flex-1">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <span className="rounded bg-muted px-2 py-0.5 font-mono-technical text-[10px] text-muted-foreground">
            {c.caseNumber}
          </span>
          <span className="flex items-center gap-1 rounded-full bg-[#dbe1ff]/30 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-[#003dab]">
            <span className="size-1.5 rounded-full bg-primary" />
            Resolved
          </span>
        </div>
        <h3 className="mb-1 text-lg font-bold">{title}</h3>
        <p className="text-sm text-muted-foreground line-clamp-3 md:line-clamp-2">{c.description}</p>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0 border-black/[0.12] bg-card font-semibold shadow-sm hover:bg-muted/80"
        asChild
      >
        <Link href={`/victim/case/${c.id}`}>View archival report</Link>
      </Button>
    </article>
  );
}

export default function VictimDashboard() {
  const { user } = useAuthStore();
  const { data: cases, isLoading } = useVictimCases();
  const myCases = cases || [];

  const openCases = myCases.filter((c) => c.status !== "closed");
  const closedCases = myCases.filter((c) => c.status === "closed");

  return (
    <div className="pb-12">
      <header className="mb-10 flex flex-col justify-between gap-6 md:mb-12 md:flex-row md:items-end">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight text-foreground md:text-5xl">
            Welcome back, {firstName(user?.name)}
          </h1>
          <p className="max-w-xl text-lg text-muted-foreground">
            You are not alone. Your cases are being monitored by our specialized officers. We are here to support you at
            every step.
          </p>
        </div>
        <Button
          asChild
          variant="cta"
          size="lg"
          className="h-auto shrink-0 gap-2 rounded-xl px-8 py-4 text-base font-bold shadow-xl shadow-primary/10 transition-all hover:shadow-primary/20 active:scale-[0.98]"
        >
          <Link href="/submit">
            <PlusCircle className="size-5" />
            New complaint
          </Link>
        </Button>
      </header>

      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-3">
        <section className="space-y-8 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-xl font-semibold">
              <FolderOpen className="size-6 text-primary" aria-hidden />
              Active cases
            </h2>
            <span className="rounded-full bg-muted px-3 py-1 font-mono-technical text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {myCases.length} {myCases.length === 1 ? "case" : "cases"} total
            </span>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="size-8 animate-spin text-primary" />
            </div>
          ) : myCases.length === 0 ? (
            <div className="rounded-xl border border-dashed border-black/[0.12] bg-muted/20 p-10 text-center">
              <p className="text-muted-foreground">No cases filed yet.</p>
              <Button asChild variant="cta" className="mt-6 rounded-xl px-8 py-3 font-bold">
                <Link href="/submit">
                  <PlusCircle className="size-4" />
                  File your first complaint
                </Link>
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {openCases.map((c, i) => (
                <motion.div
                  key={c.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <ActiveCaseCard c={c} />
                </motion.div>
              ))}
              {closedCases.map((c, i) => (
                <motion.div
                  key={c.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: (openCases.length + i) * 0.05 }}
                  className="md:col-span-2"
                >
                  <ResolvedCaseRow c={c} />
                </motion.div>
              ))}
            </div>
          )}
        </section>

        <aside className="space-y-8">
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <HeartPulse className="size-6 text-[#712ae2]" aria-hidden />
            Support resources
          </h2>
          <div className="flex flex-col gap-6">
            <div className="group relative overflow-hidden rounded-2xl border border-white/50 bg-white/70 p-6 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-card/80">
              <Gavel
                className="pointer-events-none absolute -right-4 -top-4 size-[7rem] text-foreground/10 transition-transform duration-500 group-hover:scale-110"
                aria-hidden
              />
              <div className="relative z-10">
                <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-primary/10">
                  <Scale className="size-6 text-primary" />
                </div>
                <h4 className="mb-2 text-xl font-bold">Legal consultation</h4>
                <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
                  Discuss your rights and potential legal actions with verified experts specialized in digital justice.
                </p>
                <Link
                  href="/victim/support"
                  className="inline-flex items-center gap-2 text-sm font-bold text-primary transition-all hover:gap-3"
                >
                  Schedule briefing
                  <ArrowRight className="size-4" />
                </Link>
              </div>
            </div>

            <div className="group relative overflow-hidden rounded-2xl border border-white/50 bg-white/70 p-6 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-card/80">
              <Brain
                className="pointer-events-none absolute -right-4 -top-4 size-[7rem] text-[#712ae2]/15 transition-transform duration-500 group-hover:scale-110"
                aria-hidden
              />
              <div className="relative z-10">
                <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-[#712ae2]/10">
                  <Brain className="size-6 text-[#712ae2]" />
                </div>
                <h4 className="mb-2 text-xl font-bold">Well-being support</h4>
                <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
                  Soft-entry guidance and psychological counseling focused on recovery from digital trauma.
                </p>
                <Link
                  href="/victim/support"
                  className="inline-flex items-center gap-2 text-sm font-bold text-[#712ae2] transition-all hover:gap-3"
                >
                  Access counseling
                  <ArrowRight className="size-4" />
                </Link>
              </div>
            </div>

            <div className="rounded-2xl border border-black/[0.08] bg-muted p-6">
              <div className="flex items-start gap-4">
                <Info className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                <div>
                  <span className="mb-1 block font-mono-technical text-[10px] font-bold uppercase">Safety tip</span>
                  <p className="text-xs italic text-muted-foreground">
                    &ldquo;Always enable two-factor authentication on all recovered accounts to prevent secondary
                    breaches.&rdquo;
                  </p>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>

      <section className="mt-16 grid grid-cols-1 gap-8 md:grid-cols-4">
        <div className="flex flex-col justify-center md:col-span-1">
          <h3 className="mb-2 text-2xl font-bold tracking-tight text-foreground">Platform pulse</h3>
          <p className="text-sm text-muted-foreground">Our commitment to justice is measured in the safety of our users.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 md:col-span-3">
          {[
            { value: "98.2%", label: "Resolution rate" },
            { value: "12hr", label: "Response median" },
            { value: "2.4k", label: "Officers active" },
          ].map((s) => (
            <div key={s.label} className="rounded-xl bg-muted p-6">
              <span className="font-mono-technical text-3xl font-bold text-primary">{s.value}</span>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="mt-16 border-t border-black/[0.08] pt-8">
        <div className="flex flex-col items-center justify-between gap-4 text-center md:flex-row md:text-left">
          <span className="font-bold text-foreground">GRAAS</span>
          <p className="text-xs text-muted-foreground">© 2026 GRAAS. Digital curators of justice.</p>
          <div className="flex flex-wrap justify-center gap-6 md:justify-end">
            <span className="text-xs text-muted-foreground">Legal</span>
            <span className="text-xs text-muted-foreground">Privacy policy</span>
            <span className="text-xs text-muted-foreground">Security audit</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
