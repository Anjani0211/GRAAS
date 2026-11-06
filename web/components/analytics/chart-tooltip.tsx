"use client";

/** Compatible with Recharts Tooltip payload (value types vary by series). */
export function ChartTooltipCard({
  active,
  payload,
  label,
  valueFormatter,
}: {
  active?: boolean;
  payload?: readonly unknown[] | undefined;
  label?: string | number;
  valueFormatter?: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0];
  if (!row || typeof row !== "object") return null;
  const rec = row as { name?: string | number; value?: unknown };
  const raw = rec.value;
  let v = 0;
  if (typeof raw === "number") v = raw;
  else if (typeof raw === "string") v = Number(raw);
  else if (Array.isArray(raw) && raw.length) v = Number(raw[0]);
  const formatted =
    valueFormatter && !Number.isNaN(v) ? valueFormatter(v) : String(raw ?? "");
  const title = label ?? rec.name;
  return (
    <div className="rounded-xl border border-border/80 bg-card/95 px-3 py-2.5 text-sm shadow-lg shadow-slate-900/10 backdrop-blur-sm">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title !== undefined && title !== null ? String(title) : ""}
      </p>
      <p className="mt-0.5 font-semibold tabular-nums text-foreground">{formatted}</p>
    </div>
  );
}
