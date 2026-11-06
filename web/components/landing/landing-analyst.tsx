"use client";

import { motion, useInView } from "framer-motion";
import { useRef, useEffect, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

const chartData = [
  { t: "00", v: 12 },
  { t: "04", v: 28 },
  { t: "08", v: 22 },
  { t: "12", v: 45 },
  { t: "16", v: 38 },
  { t: "20", v: 52 },
  { t: "24", v: 48 },
];

const feed = [
  { id: "GR-2041", type: "UPI fraud", sev: "high" as const, time: "2m" },
  { id: "GR-2038", type: "Phishing", sev: "med" as const, time: "14m" },
  { id: "GR-2035", type: "Account takeov.", sev: "low" as const, time: "1h" },
];

function SeverityDot({ sev }: { sev: "high" | "med" | "low" }) {
  const colors = {
    high: "bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.85)]",
    med: "bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.7)]",
    low: "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]",
  };
  return <span className={`size-2 shrink-0 rounded-full ${colors[sev]} severity-pulse`} />;
}

export function LandingAnalyst() {
  const barRef = useRef<HTMLDivElement>(null);
  const inView = useInView(barRef, { once: true, margin: "-80px" });
  const [triage, setTriage] = useState(0);
  const [chartReady, setChartReady] = useState(false);

  useEffect(() => {
    setChartReady(true);
  }, []);

  useEffect(() => {
    if (!inView) return;
    setTriage(0);
    let frame = 0;
    const total = 55;
    const id = setInterval(() => {
      frame += 1;
      setTriage(Math.min(94, Math.round((frame / total) * 94)));
      if (frame >= total) clearInterval(id);
    }, 28);
    return () => clearInterval(id);
  }, [inView]);

  return (
    <section className="relative py-20 md:py-28">
      <div className="absolute inset-0 bg-gradient-to-b from-[#0c0e14] via-[#12141a] to-[#0a0c12]" aria-hidden />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_0%,rgba(0,63,177,0.2),transparent)]" />

      <div className="relative mx-auto max-w-[90rem] px-6 md:px-10">
        <div className="mb-12 max-w-xl">
          <p className="font-mono-technical text-xs font-bold uppercase tracking-[0.2em] text-white/40">
            Built for analysts
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-white md:text-4xl">
            Cyber intelligence console
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-white/55 md:text-base">
            Comfortable for citizens — powerful for staff. Escalation templates, OSINT hooks, and sealed evidence
            chains.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-12 lg:gap-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="landing-dashboard-panel flex flex-col rounded-[1.25rem] border border-white/[0.08] bg-white/[0.04] p-5 backdrop-blur-xl lg:col-span-5"
          >
            <p className="font-mono-technical text-[10px] font-bold uppercase tracking-[0.15em] text-white/40">
              Live case feed
            </p>
            <ul className="mt-4 space-y-3">
              {feed.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-black/20 px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <SeverityDot sev={row.sev} />
                    <div>
                      <p className="font-mono-technical text-xs font-semibold text-white/90">{row.id}</p>
                      <p className="text-[11px] text-white/45">{row.type}</p>
                    </div>
                  </div>
                  <span className="font-mono-technical text-[10px] text-white/35">{row.time}</span>
                </li>
              ))}
            </ul>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.08 }}
            className="landing-dashboard-panel min-w-0 rounded-[1.25rem] border border-white/[0.08] bg-white/[0.04] p-5 backdrop-blur-xl lg:col-span-7"
          >
            <p className="font-mono-technical text-[10px] font-bold uppercase tracking-[0.15em] text-white/40">
              Intake velocity (24h)
            </p>
            <div className="relative mt-2 h-[200px] min-h-[200px] w-full min-w-0">
              {chartReady ? (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="landingFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#003fb1" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="#712ae2" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 6" stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis dataKey="t" tick={{ fill: "rgba(255,255,255,0.35)", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis hide domain={[0, "auto"]} />
                    <Tooltip
                      contentStyle={{
                        background: "rgba(18,20,26,0.95)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: 12,
                        fontSize: 12,
                      }}
                      labelStyle={{ color: "rgba(255,255,255,0.5)" }}
                    />
                    <Area
                      type="monotone"
                      dataKey="v"
                      stroke="#1a56db"
                      strokeWidth={2}
                      fill="url(#landingFill)"
                      isAnimationActive
                      animationDuration={1800}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="landing-shimmer h-full w-full rounded-xl bg-white/[0.04]" aria-hidden />
              )}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="landing-dashboard-panel rounded-[1.25rem] border border-white/[0.08] bg-white/[0.04] p-6 backdrop-blur-xl lg:col-span-4"
          >
            <div className="flex items-center justify-between">
              <p className="font-mono-technical text-[10px] font-bold uppercase tracking-[0.15em] text-white/40">
                Evidence chain
              </p>
              <span className="landing-seal-badge rounded-md border border-emerald-400/40 bg-emerald-500/15 px-2 py-0.5 font-mono-technical text-[9px] font-bold uppercase tracking-wider text-emerald-300">
                Sealed
              </span>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-white/50">
              Hash-verified custody log. Court-ready export when authorized.
            </p>
          </motion.div>

          <motion.div
            ref={barRef}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="landing-dashboard-panel rounded-[1.25rem] border border-white/[0.08] bg-white/[0.04] p-6 backdrop-blur-xl lg:col-span-8"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-mono-technical text-[10px] font-bold uppercase tracking-[0.15em] text-white/40">
                  Triage confidence
                </p>
                <p className="mt-1 font-mono-technical text-2xl font-bold text-white">{Math.round(triage)}%</p>
              </div>
              <div className="h-2 flex-1 max-w-[200px] rounded-full border border-white/10 bg-black/30">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-accent"
                  initial={{ width: 0 }}
                  animate={{ width: `${triage}%` }}
                  transition={{ type: "spring", stiffness: 50, damping: 20 }}
                />
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
