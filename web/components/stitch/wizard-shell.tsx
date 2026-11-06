"use client";

import { cn } from "@/lib/utils";

export function StitchWizardHeader({
  stepIndex,
  total,
  phase = "Filing redressal",
}: {
  stepIndex: number;
  total: number;
  phase?: string;
}) {
  return (
    <div className="mb-10 lg:mb-14">
      <div className="mb-5 flex items-center justify-between px-1">
        <span className="font-mono-technical text-[11px] font-bold uppercase tracking-[0.2em] text-primary">
          Step {String(stepIndex + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
        </span>
        <span className="font-mono-technical text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70">
          {phase}
        </span>
      </div>
      <div className="flex h-1.5 w-full gap-1.5 px-0.5">
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            className={cn(
              "h-full min-h-0 flex-1 rounded-full transition-colors duration-300",
              i <= stepIndex ? "stitch-cta" : "bg-muted",
            )}
          />
        ))}
      </div>
    </div>
  );
}

/** Stitch complaint wizard — uppercase mono labels */
export const stitchFieldLabel =
  "font-mono-technical text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
