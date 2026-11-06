"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { motion, useScroll, useTransform, useReducedMotion } from "framer-motion";
import { useRef, useCallback, useState, type ReactNode } from "react";
import { ArrowRight, Radio } from "lucide-react";
import { cn } from "@/lib/utils";

const antigravityHeroProps = {
  count: 300,
  magnetRadius: 10,
  ringRadius: 10,
  waveSpeed: 0.4,
  waveAmplitude: 1,
  particleSize: 2,
  lerpSpeed: 0.1,
  color: "#5e3dff",
  autoAnimate: false,
  particleVariance: 1,
  rotationSpeed: 0,
  depthFactor: 1,
  pulseSpeed: 3,
  particleShape: "box" as const,
  fieldStrength: 10,
};

const Antigravity = dynamic(() => import("@/components/Antigravity"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-[#050508]" aria-hidden />,
});

function RippleGlowLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const [ripples, setRipples] = useState<{ x: number; y: number; id: number }[]>([]);
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLAnchorElement>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const id = Date.now();
    setRipples((prev) => [...prev, { x: e.clientX - r.left, y: e.clientY - r.top, id }]);
    window.setTimeout(() => setRipples((prev) => prev.filter((x) => x.id !== id)), 650);
  }, []);

  return (
    <Link
      href={href}
      onPointerDown={onPointerDown}
      className={cn("relative isolate overflow-hidden", className)}
    >
      {ripples.map((rp) => (
        <span
          key={rp.id}
          className="landing-ripple pointer-events-none absolute rounded-full bg-black/12"
          style={{ left: rp.x, top: rp.y, width: 0, height: 0 }}
        />
      ))}
      {children}
    </Link>
  );
}

export function LandingHero() {
  const sectionRef = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });

  const sceneOpacity = useTransform(scrollYProgress, [0, 0.7], reduceMotion ? [1, 1] : [1, 0.2]);
  const contentY = useTransform(scrollYProgress, [0, 1], reduceMotion ? [0, 0] : [0, -16]);

  return (
    <section
      ref={sectionRef}
      className="relative min-h-[min(100dvh,960px)] w-full min-w-0 overflow-hidden border-b border-white/[0.06] bg-[#050508]"
    >
      {/* Antigravity (React Bits): full-bleed canvas; gradients keep type readable */}
      <motion.div
        className="pointer-events-auto absolute inset-0 z-0 h-full min-h-0 w-full min-w-0"
        style={{ opacity: sceneOpacity }}
      >
        {!reduceMotion ? (
          <div className="absolute inset-0 min-h-[min(100dvh,960px)] w-full min-w-full" aria-hidden>
            <Antigravity {...antigravityHeroProps} />
          </div>
        ) : (
          <div className="absolute inset-0 bg-[#08060c]" aria-hidden />
        )}
      </motion.div>

      <div
        className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-b from-[#050508] from-0% via-[#050508]/92 via-[38%] to-transparent to-[62%]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-t from-transparent from-45% via-transparent to-[#050508]/25 to-100%"
        aria-hidden
      />

      <div className="pointer-events-none relative z-[2] mx-auto flex min-h-[min(100dvh,960px)] max-w-[90rem] flex-col px-5 pb-16 pt-[5.5rem] md:px-8 md:pb-20 md:pt-[6.25rem]">
        <motion.div
          className="mx-auto flex w-full max-w-[34rem] flex-1 flex-col items-center justify-center text-center md:max-w-3xl"
          style={{ y: contentY }}
        >
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="inline-flex items-center gap-2 rounded-full border border-white/[0.14] bg-white/[0.06] px-4 py-2 backdrop-blur-xl"
          >
            <Radio className="size-3.5 text-white/55" aria-hidden />
            <span className="font-mono-technical text-[10px] font-bold uppercase tracking-[0.2em] text-white/90">
              Protocol v2.4
            </span>
            <span className="size-1 rounded-full bg-emerald-400/90 shadow-[0_0_10px_rgba(52,211,153,0.6)]" />
            <span className="font-mono-technical text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">
              Command center live
            </span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.06, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            className="mt-10 text-[1.65rem] font-bold leading-[1.12] tracking-tight text-white sm:text-4xl md:text-5xl lg:text-[3.25rem] lg:leading-[1.08]"
          >
            <span className="text-white">AI-Powered </span>
            <span className="bg-gradient-to-r from-sky-300 via-blue-200 to-violet-300 bg-clip-text text-transparent">
              Justice
            </span>
            <span className="text-white"> for Cybercrime Victims</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.12, duration: 0.45 }}
            className="mt-6 max-w-xl text-pretty text-sm leading-relaxed text-white/55 md:text-base"
          >
            Intelligence-first redressal with OSINT forensics, AI analysis, and secure routing from incident to
            resolution.
          </motion.p>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.16, duration: 0.45 }}
            className="mt-8 text-xs font-medium text-white/40 md:text-sm"
          >
            GRAAS — Grievance Redressal &amp; Assistance System
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-auto mt-5 flex w-full max-w-md flex-col items-stretch gap-3 sm:flex-row sm:justify-center"
          >
            <RippleGlowLink
              href="/submit"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white px-8 text-base font-semibold text-[#0a0a0c] transition-transform hover:bg-white/95 active:scale-[0.98]"
            >
              Report Cybercrime
              <ArrowRight className="size-5" />
            </RippleGlowLink>
            <Link
              href="/track"
              className="inline-flex h-12 items-center justify-center rounded-full border border-white/20 bg-white/[0.06] px-8 text-base font-semibold text-white backdrop-blur-md transition-colors hover:border-white/30 hover:bg-white/[0.1]"
            >
              Track Case
            </Link>
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.26 }}
            className="pointer-events-auto mt-10 text-xs text-white/40 md:text-sm"
          >
            <Link href="/login" className="font-medium text-white/70 underline-offset-4 hover:text-white hover:underline">
              Victim portal
            </Link>
            {" · "}
            <Link href="/login" className="font-medium text-white/70 underline-offset-4 hover:text-white hover:underline">
              Staff sign-in
            </Link>
          </motion.p>
        </motion.div>
      </div>
    </section>
  );
}
