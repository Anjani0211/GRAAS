"use client";

import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import {
  Banknote,
  MessageSquareWarning,
  ShieldAlert,
  ScanFace,
  KeyRound,
  Fingerprint,
  Fish,
  Building2,
} from "lucide-react";
import type { CaseCategory } from "@/lib/utils";

const iconMap = {
  financial_fraud: Banknote,
  cyberbullying: MessageSquareWarning,
  sextortion: ShieldAlert,
  deepfake: ScanFace,
  account_hacking: KeyRound,
  identity_theft: Fingerprint,
  phishing: Fish,
  corporate: Building2,
};

const descriptionMap: Record<CaseCategory, string> = {
  financial_fraud: "UPI, bank, or investment scams",
  cyberbullying: "Online harassment or threats",
  sextortion: "Blackmail involving intimate content",
  deepfake: "AI-generated fake images or videos",
  account_hacking: "Unauthorized access to accounts",
  identity_theft: "Stolen personal information misuse",
  phishing: "Fake websites or deceptive emails",
  corporate: "Business email compromise or fraud",
};

interface CaseCategoryCardProps {
  category: CaseCategory;
  selected?: boolean;
  onSelect?: (category: CaseCategory) => void;
}

export function CaseCategoryCard({ category, selected, onSelect }: CaseCategoryCardProps) {
  const Icon = iconMap[category];
  const label = category
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  return (
    <motion.button
      type="button"
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => onSelect?.(category)}
      className={cn(
        "relative flex flex-col items-start gap-3 rounded-2xl border p-5 text-left transition-all duration-200 cursor-pointer",
        "bg-card hover:shadow-md",
        selected
          ? "border-primary ring-2 ring-primary/20 bg-primary-soft"
          : "border-border hover:border-primary/30"
      )}
    >
      <div
        className={cn(
          "flex size-10 items-center justify-center rounded-xl",
          selected ? "bg-primary text-white" : "bg-secondary text-foreground"
        )}
      >
        <Icon className="size-5" />
      </div>
      <div>
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{descriptionMap[category]}</p>
      </div>
      {selected && (
        <motion.div
          layoutId="category-selection"
          className="absolute inset-0 rounded-2xl border-2 border-primary"
          transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
        />
      )}
    </motion.button>
  );
}
