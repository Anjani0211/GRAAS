"use client";

import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Lock, CheckCircle2, Shield } from "lucide-react";

export function LandingTrust() {
  return (
    <section className="border-t border-black/[0.06] bg-gradient-to-b from-muted/40 to-background py-20 md:py-24">
      <div className="mx-auto max-w-[90rem] px-6 md:px-10">
        <div className="text-center">
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">Trust by design</h2>
          <p className="mx-auto mt-3 max-w-lg text-muted-foreground">
            From citizen intake to courtroom-ready evidence — protected at every layer.
          </p>
        </div>
        <div className="mt-14 grid gap-5 md:grid-cols-3">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="perspective-[800px]"
          >
            <Card className="landing-trust-card group h-full border-0 bg-card shadow-sm">
              <CardContent className="p-7">
                <motion.div
                  className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"
                  animate={{ rotateY: [0, 10, -8, 0] }}
                  transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
                  style={{ transformStyle: "preserve-3d" }}
                >
                  <Lock className="size-7" />
                </motion.div>
                <h3 className="mt-5 text-lg font-semibold">AES-256 encryption</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Evidence and PII encrypted in transit and at rest.
                </p>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.06 }}
          >
            <Card className="landing-trust-card group h-full border-0 bg-card shadow-sm">
              <CardContent className="p-7">
                <motion.div
                  className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"
                  animate={{ scale: [1, 1.05, 1], opacity: [0.85, 1, 0.85] }}
                  transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
                >
                  <CheckCircle2 className="size-7" />
                </motion.div>
                <h3 className="mt-5 text-lg font-semibold">CERT-In aligned</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Structured for Indian cyber response norms.
                </p>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.12 }}
          >
            <Card className="landing-trust-card group h-full border-0 bg-card shadow-sm">
              <CardContent className="p-7">
                <motion.div
                  className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"
                  animate={{ scale: [1, 1.06, 1] }}
                  transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
                >
                  <Shield className="size-7" />
                </motion.div>
                <h3 className="mt-5 text-lg font-semibold">Role-based access</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Staff and victims see only what they should.
                </p>
                <div className="mt-4 flex gap-2">
                  <motion.span
                    className="h-1.5 flex-1 rounded-full bg-primary/25"
                    whileHover={{ scaleY: 1.4, backgroundColor: "rgba(0,63,177,0.55)" }}
                  />
                  <motion.span
                    className="h-1.5 flex-1 rounded-full bg-primary/45"
                    whileHover={{ scaleY: 1.4, backgroundColor: "rgba(0,63,177,0.65)" }}
                  />
                  <motion.span
                    className="h-1.5 flex-1 rounded-full bg-muted"
                    whileHover={{ scaleY: 1.4, backgroundColor: "rgba(0,63,177,0.3)" }}
                  />
                </div>
                <p className="mt-2 font-mono-technical text-[10px] uppercase tracking-wider text-muted-foreground">
                  Access tiers
                </p>
              </CardContent>
            </Card>
          </motion.div>
        </div>

      </div>
    </section>
  );
}
