"use client";

import { useState } from "react";
import { ExternalLink, Loader2, Package, Copy, CheckCircle2, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { escalationApi, type EscalationPack } from "@/lib/api";

type Props = {
  caseId: string;
  /** Soft assist links already present on enrichments (phone/merchant/wayback). */
  inlineLinks?: Array<{ label: string; url: string }>;
};

export function AssistPanel({ caseId, inlineLinks = [] }: Props) {
  const [pack, setPack] = useState<EscalationPack | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function loadPack() {
    setLoading(true);
    setError(null);
    try {
      const data = await escalationApi.getPack(caseId);
      setPack(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pack");
    } finally {
      setLoading(false);
    }
  }

  async function copyJson() {
    if (!pack) return;
    await navigator.clipboard.writeText(JSON.stringify(pack, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const portalLinks =
    pack?.assistPortals?.map((p) => ({ label: p.label, url: p.url, note: p.note })) ?? [];
  const deep =
    pack?.deepLinks
      ? Object.entries(pack.deepLinks).map(([k, url]) => ({ label: k, url }))
      : [];

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">India cyber-fraud assist</p>
          <p className="text-xs text-muted-foreground">
            Deep-links for Sanchar Saathi, NCRP, GST — no CAPTCHA bypass. Pack is local only.
          </p>
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={loadPack} disabled={loading}>
          {loading ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Package className="mr-1.5 size-3.5" />}
          Build escalation pack
        </Button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {inlineLinks.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {inlineLinks.slice(0, 12).map((l) => (
            <a
              key={`${l.label}-${l.url}`}
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-secondary/40 px-2 py-1 text-[11px] hover:bg-secondary"
            >
              {l.label}
              <ExternalLink className="size-3 opacity-60" />
            </a>
          ))}
        </div>
      )}

      {pack && (
        <div className="space-y-3 border-t border-border pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {pack.entities.length} entities · {pack.evidenceHashes.length} hashes ·{" "}
              {pack.relatedCases.length} related
            </span>
            <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={copyJson}>
              {copied ? <CheckCircle2 className="mr-1 size-3.5 text-emerald-600" /> : <Copy className="mr-1 size-3.5" />}
              {copied ? "Copied" : "Copy JSON"}
            </Button>
          </div>

          {portalLinks.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Portals
              </p>
              <ul className="space-y-1">
                {portalLinks.map((p) => (
                  <li key={p.label}>
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                    >
                      {p.label}
                      <ExternalLink className="size-3" />
                    </a>
                    {p.note && <span className="ml-2 text-[11px] text-muted-foreground">{p.note}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {deep.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Case deep-links
              </p>
              <div className="flex flex-wrap gap-1.5">
                {deep.slice(0, 16).map((d) => (
                  <a
                    key={d.label}
                    href={d.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      "inline-flex max-w-full items-center gap-1 truncate rounded-md border border-border px-2 py-0.5 font-mono text-[10px]",
                    )}
                  >
                    {d.label}
                    <ExternalLink className="size-2.5 shrink-0 opacity-50" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {pack.analystChecklist.length > 0 && (
            <div>
              <p className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <ListChecks className="size-3.5" />
                Checklist
              </p>
              <ul className="list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
                {pack.analystChecklist.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {pack.relatedCases.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Related: <span className="font-mono">{pack.relatedCases.join(", ")}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
