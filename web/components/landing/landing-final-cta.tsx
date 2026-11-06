"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCallback, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

function RippleButton({
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
      className={cn("relative isolate inline-flex items-center justify-center gap-2 overflow-hidden", className)}
    >
      {ripples.map((rp) => (
        <span
          key={rp.id}
          className="landing-ripple pointer-events-none absolute rounded-full bg-white/40"
          style={{ left: rp.x, top: rp.y, width: 0, height: 0 }}
        />
      ))}
      {children}
    </Link>
  );
}

export function LandingFinalCta() {
  return (
    <section className="pb-24 pt-6 md:pb-28">
      <div className="mx-auto max-w-[90rem] px-6 md:px-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="landing-final-cta relative overflow-hidden rounded-[2rem] p-10 text-center text-white md:p-16"
        >
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_120%,rgba(255,255,255,0.22),transparent)]"
            aria-hidden
          />
          <div className="landing-light-sweep pointer-events-none absolute inset-0 opacity-90" aria-hidden />
          <div className="relative">
            <h2 className="text-3xl font-bold md:text-4xl">Minutes matter after a cyber incident.</h2>
            <p className="mx-auto mt-4 max-w-lg text-sm text-white/90 md:text-base">
              File now, receive a case number, and follow the timeline while we work the stack behind the scenes.
            </p>
            <div className="mt-9 flex flex-wrap justify-center gap-4">
              <RippleButton
                href="/submit"
                className="h-12 rounded-xl bg-white px-8 text-base font-semibold text-primary shadow-[0_0_28px_rgba(255,255,255,0.35)] transition-[box-shadow,transform] hover:shadow-[0_0_40px_rgba(255,255,255,0.5)] active:scale-[0.98]"
              >
                Start Complaint
                <ArrowRight className="size-5" />
              </RippleButton>
              <Button
                asChild
                size="lg"
                variant="ghost"
                className="h-12 rounded-xl border-2 border-white/45 bg-white/10 px-8 text-white hover:bg-white/20"
              >
                <Link href="/track">Track Case</Link>
              </Button>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
