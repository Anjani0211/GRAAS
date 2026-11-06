import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCaseNumber(id: string): string {
  const year = new Date().getFullYear();
  return `GRS-${year}-${id.slice(0, 5).toUpperCase()}`;
}

export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export const severityConfig = {
  high: { label: "High", color: "text-red-600", bg: "bg-red-50", border: "border-red-200", dot: "bg-red-500" },
  medium: { label: "Medium", color: "text-amber-600", bg: "bg-amber-50", border: "border-amber-200", dot: "bg-amber-500" },
  low: { label: "Low", color: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-200", dot: "bg-emerald-500" },
} as const;

export const statusConfig = {
  submitted: { label: "Submitted", color: "text-blue-600", bg: "bg-blue-50" },
  triaged: { label: "Triaged", color: "text-purple-600", bg: "bg-purple-50" },
  osint: { label: "Under Investigation", color: "text-amber-600", bg: "bg-amber-50" },
  action_taken: { label: "Action Taken", color: "text-teal-600", bg: "bg-teal-50" },
  closed: { label: "Closed", color: "text-emerald-600", bg: "bg-emerald-50" },
} as const;

export const categoryConfig = {
  financial_fraud: { label: "Financial Fraud", icon: "Banknote" },
  cyberbullying: { label: "Cyberbullying", icon: "MessageSquareWarning" },
  sextortion: { label: "Sextortion", icon: "ShieldAlert" },
  deepfake: { label: "Deepfake", icon: "ScanFace" },
  account_hacking: { label: "Account Hacking", icon: "KeyRound" },
  identity_theft: { label: "Identity Theft", icon: "Fingerprint" },
  phishing: { label: "Phishing", icon: "Fish" },
  corporate: { label: "Corporate Fraud", icon: "Building2" },
} as const;

export type Severity = keyof typeof severityConfig;
export type CaseStatus = keyof typeof statusConfig;
export type CaseCategory = keyof typeof categoryConfig;
