"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain,
  CheckCircle2,
  FileText,
  Gavel,
  Target,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type StepConfig = {
  title: string;
  blurb: string;
  description: string;
  tags: string[];
  Icon: LucideIcon;
  inactiveWrap: string;
  inactiveIcon: string;
  activeWrap: string;
  activeIcon: string;
  shape: "square" | "circle";
};

const steps: StepConfig[] = [
  {
    title: "Submit",
    blurb: "Encrypted intake",
    description:
      "Victims file through a secure portal with end-to-end encryption and structured evidence upload.",
    tags: ["AES-256 envelope", "PII minimization", "Tamper-evident"],
    Icon: FileText,
    inactiveWrap: "rounded-2xl bg-sky-100/90 ring-1 ring-sky-200/80",
    inactiveIcon: "text-sky-600",
    activeWrap:
      "rounded-2xl bg-sky-500 shadow-[0_0_0_1px_rgba(14,165,233,0.3),0_12px_40px_rgba(14,165,233,0.35)]",
    activeIcon: "text-white",
    shape: "square",
  },
  {
    title: "AI Triage",
    blurb: "Severity & category",
    description:
      "Our AI analyzes severity, categorizes the crime, and prioritizes response so urgent cases surface first.",
    tags: ["98% accuracy", "<30s processing", "Auto-categorization"],
    Icon: Brain,
    inactiveWrap: "rounded-2xl bg-accent-soft ring-1 ring-accent/15",
    inactiveIcon: "text-accent",
    activeWrap:
      "rounded-2xl bg-accent shadow-[0_0_0_1px_rgba(113,42,226,0.35),0_16px_48px_rgba(113,42,226,0.45)]",
    activeIcon: "text-white",
    shape: "square",
  },
  {
    title: "OSINT Analysis",
    blurb: "Digital footprint",
    description:
      "Open-source intelligence weaves timelines, identities, and infrastructure clues into analyst-ready dossiers.",
    tags: ["Multi-source fusion", "Timeline graph", "Chain of custody"],
    Icon: Target,
    inactiveWrap: "rounded-full bg-accent-soft/80 ring-1 ring-accent/12",
    inactiveIcon: "text-accent",
    activeWrap:
      "rounded-full bg-accent/15 ring-2 ring-accent/40 shadow-[0_12px_36px_rgba(113,42,226,0.2)]",
    activeIcon: "text-accent",
    shape: "circle",
  },
  {
    title: "Action",
    blurb: "Enforcement sync",
    description:
      "Workflows align with cyber cells and designated authorities while preserving auditability and escalation rules.",
    tags: ["Cyber cell handoff", "Escalation tiers", "Live status"],
    Icon: Gavel,
    inactiveWrap: "rounded-2xl bg-amber-100/90 ring-1 ring-amber-200/70",
    inactiveIcon: "text-amber-700",
    activeWrap:
      "rounded-2xl bg-amber-500 shadow-[0_0_0_1px_rgba(245,158,11,0.35),0_12px_40px_rgba(245,158,11,0.3)]",
    activeIcon: "text-white",
    shape: "square",
  },
  {
    title: "Resolution",
    blurb: "Verified closure",
    description:
      "Cases close with verified outcomes, victim communications, and a clear path for appeals or follow-up support.",
    tags: ["Verified closure", "Victim dashboard", "Appeals-ready"],
    Icon: CheckCircle2,
    inactiveWrap: "rounded-full bg-emerald-100/90 ring-1 ring-emerald-200/80",
    inactiveIcon: "text-emerald-700",
    activeWrap:
      "rounded-full bg-emerald-500 shadow-[0_0_0_1px_rgba(16,185,129,0.35),0_12px_40px_rgba(16,185,129,0.28)]",
    activeIcon: "text-white",
    shape: "circle",
  },
];

function StepIconButton({
  step,
  active,
  onSelect,
}: {
  step: StepConfig;
  active: boolean;
  onSelect: () => void;
}) {
  const { Icon } = step;
  const wrap = active ? step.activeWrap : step.inactiveWrap;
  const iconCls = active ? step.activeIcon : step.inactiveIcon;
  const size = step.shape === "circle" ? "size-[52px] md:size-14" : "size-[52px] md:size-14";

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "step" : undefined}
      className="group flex flex-col items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <motion.div
        layout
        className={cn(
          "flex items-center justify-center transition-transform duration-300",
          size,
          wrap,
          active && "scale-105",
        )}
        whileHover={{ scale: active ? 1.06 : 1.04 }}
        whileTap={{ scale: 0.98 }}
      >
        <Icon className={cn("size-6 md:size-7", iconCls)} strokeWidth={active ? 2.25 : 2} aria-hidden />
      </motion.div>
      <span
        className={cn(
          "max-w-[88px] text-center text-xs font-semibold leading-tight md:max-w-[100px] md:text-sm",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {step.title}
      </span>
      <span className="hidden max-w-[120px] text-center text-[11px] leading-snug text-muted-foreground md:block">
        {step.blurb}
      </span>
    </button>
  );
}

function Connector({ completed }: { completed: boolean }) {
  return (
    <div
      className="mx-1 hidden min-w-[24px] flex-1 items-center md:flex md:mx-2"
      aria-hidden
    >
      <div className="h-px w-full overflow-hidden rounded-full bg-border">
        <motion.div
          className="h-full bg-gradient-to-r from-accent to-primary"
          initial={false}
          animate={{ width: completed ? "100%" : "0%" }}
          transition={{ type: "spring", stiffness: 380, damping: 38 }}
        />
      </div>
    </div>
  );
}

export function LandingPipeline() {
  const [active, setActive] = useState(1);

  const current = steps[active];

  return (
    <section
      id="pipeline"
      className="scroll-mt-20 border-b border-black/[0.06] bg-gradient-to-b from-background via-muted/20 to-background py-20 md:py-28"
    >
      <div className="mx-auto max-w-[90rem] px-6 md:px-10">
        <header className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center rounded-full bg-primary-soft px-4 py-1.5 font-mono-technical text-xs font-semibold uppercase tracking-wider text-primary">
            How it works
          </span>
          <h2 className="mt-5 text-3xl font-semibold tracking-tight text-foreground md:text-4xl lg:text-[2.75rem]">
            Redressal{" "}
            <span className="bg-gradient-to-r from-primary via-[#1a56db] to-accent bg-clip-text text-transparent">
              pipeline
            </span>
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">
            From secure intake to verified resolution — each stage instrumented for analysts and clear for
            victims.
          </p>
        </header>

        {/* Stepper row */}
        <div className="mt-14 md:mt-16">
          <div className="flex items-start justify-between gap-0 overflow-x-auto pb-4 pt-1 [-ms-overflow-style:none] [scrollbar-width:none] md:mx-auto md:max-w-5xl md:justify-center md:overflow-visible md:pb-2 [&::-webkit-scrollbar]:hidden">
            {steps.map((step, i) => (
              <div key={step.title} className="flex min-w-[72px] flex-1 items-start md:min-w-0 md:flex-initial">
                <div className="flex w-full flex-col items-center md:w-auto">
                  <StepIconButton step={step} active={active === i} onSelect={() => setActive(i)} />
                </div>
                {i < steps.length - 1 && (
                  <div className="mt-[26px] flex flex-1 self-start md:mt-7">
                    <Connector completed={i < active} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Detail card */}
        <motion.div
          layout
          className="mx-auto mt-10 max-w-4xl rounded-3xl border border-black/[0.06] bg-card p-6 shadow-[0_24px_80px_rgba(0,63,177,0.08)] md:p-10 md:shadow-[0_32px_90px_rgba(0,63,177,0.1)]"
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={current.title}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-col gap-8 md:flex-row md:items-center md:gap-12"
            >
              <div className="flex shrink-0 justify-center md:justify-start">
                <div
                  className={cn(
                    "flex size-24 items-center justify-center md:size-28",
                    current.activeWrap,
                  )}
                >
                  <current.Icon className={cn("size-12 md:size-14", current.activeIcon)} strokeWidth={2} />
                </div>
              </div>
              <div className="min-w-0 flex-1 text-center md:text-left">
                <p className="font-mono-technical text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Step {active + 1} of {steps.length}
                </p>
                <h3 className="mt-2 text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
                  {current.title}
                </h3>
                <p className="mt-3 text-base leading-relaxed text-muted-foreground md:text-lg">
                  {current.description}
                </p>
                <ul className="mt-6 flex flex-wrap justify-center gap-2 md:justify-start">
                  {current.tags.map((tag) => (
                    <li
                      key={tag}
                      className="rounded-full bg-primary-soft px-3 py-1.5 font-mono-technical text-xs font-medium text-primary"
                    >
                      {tag}
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>
          </AnimatePresence>
        </motion.div>
      </div>
    </section>
  );
}
