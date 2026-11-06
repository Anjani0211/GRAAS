"use client";

import { useRef, useState, useCallback, type MouseEvent } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, X } from "lucide-react";
import {
  Banknote,
  MessageSquareWarning,
  ShieldAlert,
  ScanFace,
  KeyRound,
  Fingerprint,
  Fish,
  Building2,
  type LucideIcon,
} from "lucide-react";

const categories: { icon: LucideIcon; label: string; blurb: string }[] = [
  { icon: Banknote, label: "Financial Fraud", blurb: "UPI, investment, and banking scams — fast freeze and trace workflows." },
  { icon: MessageSquareWarning, label: "Cyberbullying", blurb: "Harassment and threats online — documented for legal escalation." },
  { icon: ShieldAlert, label: "Sextortion", blurb: "Sensitive cases with victim-protective handling and specialist routing." },
  { icon: ScanFace, label: "Deepfake", blurb: "Synthetic media incidents — technical preservation and expert review." },
  { icon: KeyRound, label: "Account Hacking", blurb: "Credential compromise — recovery paths and identity verification." },
  { icon: Fingerprint, label: "Identity Theft", blurb: "Impersonation and document fraud — identity graphing and alerts." },
  { icon: Fish, label: "Phishing", blurb: "Malicious links and spoofing — URL and infrastructure correlation." },
  { icon: Building2, label: "Corporate Fraud", blurb: "B2B and insider vectors — enterprise-grade case segregation." },
];

export function LandingCategories() {
  const [open, setOpen] = useState<string | null>(null);
  const openItem = categories.find((c) => c.label === open);

  return (
    <section className="py-20 md:py-32">
      <div className="mx-auto max-w-[90rem] px-6 md:px-10">
        <div className="mb-12 flex flex-col justify-between gap-6 md:mb-14 md:flex-row md:items-end">
          <div className="max-w-xl space-y-3">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground">Cybercrime categories</h2>
            <p className="leading-relaxed text-muted-foreground">
              Specialized units across vectors — hover to explore, click for a quick brief.
            </p>
          </div>
          <Link
            href="/submit"
            className="inline-flex items-center gap-2 font-mono-technical text-sm font-medium text-primary transition-transform duration-300 hover:gap-3"
          >
            File a complaint <ArrowRight className="size-4" />
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {categories.map((cat) => (
            <CategoryTile key={cat.label} cat={cat} onOpen={() => setOpen(cat.label)} />
          ))}
        </div>
      </div>

      <AnimatePresence>
        {openItem && (
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="cat-modal-title"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
            onClick={() => setOpen(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ type: "spring", stiffness: 380, damping: 32 }}
              className="relative w-full max-w-md rounded-2xl border border-white/20 bg-card p-6 shadow-[0_24px_80px_rgba(0,63,177,0.2)]"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="absolute right-4 top-4 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={() => setOpen(null)}
                aria-label="Close"
              >
                <X className="size-5" />
              </button>
              <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <openItem.icon className="size-6" />
              </div>
              <h3 id="cat-modal-title" className="mt-4 text-xl font-semibold text-foreground">
                {openItem.label}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{openItem.blurb}</p>
              <Link
                href="/submit"
                className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
                onClick={() => setOpen(null)}
              >
                Report this type <ArrowRight className="size-4" />
              </Link>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function CategoryTile({
  cat,
  onOpen,
}: {
  cat: (typeof categories)[number];
  onOpen: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const onMove = useCallback((e: MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(900px) rotateY(${x * 14}deg) rotateX(${-y * 14}deg) translateZ(0)`;
  }, []);

  const onLeave = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = "perspective(900px) rotateY(0deg) rotateX(0deg)";
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-2xl"
    >
      <div
        ref={ref}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        role="button"
        tabIndex={0}
        className="landing-cursor-glow group relative z-0 cursor-pointer rounded-2xl bg-card p-6 text-center shadow-sm ring-1 ring-black/[0.06] transition-[box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:z-10 hover:shadow-[0_20px_50px_rgba(0,63,177,0.14)] hover:ring-primary/20"
      >
        <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary/5 transition-all duration-300 group-hover:bg-primary group-hover:shadow-[0_8px_24px_rgba(0,63,177,0.35)]">
          <cat.icon className="size-6 text-primary transition-all duration-300 group-hover:scale-110 group-hover:text-primary-foreground" />
        </div>
        <span className="mt-4 block text-sm font-medium text-foreground">{cat.label}</span>
      </div>
    </motion.div>
  );
}
