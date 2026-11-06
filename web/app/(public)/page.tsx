"use client";

import { LandingHero } from "@/components/landing/landing-hero";
import { LandingPipeline } from "@/components/landing/landing-pipeline";
import { LandingAnalyst } from "@/components/landing/landing-analyst";
import { LandingCategories } from "@/components/landing/landing-categories";
import { LandingTrust } from "@/components/landing/landing-trust";
import { LandingFinalCta } from "@/components/landing/landing-final-cta";

const marqueeTags = [
  "Financial fraud",
  "OSINT",
  "CERT-In aligned",
  "Victim-first",
  "Encrypted evidence",
  "Real-time triage",
  "Cyber cell ready",
  "Deepfake",
  "UPI scams",
];

export default function LandingPage() {
  const doubledMarquee = [...marqueeTags, ...marqueeTags];

  return (
    <div className="relative overflow-hidden bg-background">
      <LandingHero />

      <div className="border-b border-black/[0.06] bg-card/60 py-3 backdrop-blur-sm">
        <div className="relative overflow-hidden mask-[linear-gradient(90deg,transparent,black_8%,black_92%,transparent)]">
          <div className="landing-marquee-track flex w-max gap-3 pr-3">
            {doubledMarquee.map((tag, i) => (
              <span
                key={`${tag}-${i}`}
                className="whitespace-nowrap rounded-full bg-muted px-4 py-1.5 font-mono-technical text-xs font-medium text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>

      <LandingPipeline />
      <LandingAnalyst />
      <LandingCategories />
      <LandingTrust />
      <LandingFinalCta />
    </div>
  );
}
