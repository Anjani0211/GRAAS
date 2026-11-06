"use client";

import { cn } from "@/lib/utils";

const LOGO_SRC = "/Grass1.png";
/** Icon-only mark for collapsed admin rail */
const LOGO_ADMIN_COLLAPSED = "/grass3.png";
/** White horizontal wordmark for dark / glass nav (no CSS invert). */
const LOGO_NAV_DARK = "/grass-white.png";

type BrandLogoProps = {
  className?: string;
  /** default · compact · footer · navDark (floating landing nav) · admin · adminCompact */
  variant?: "default" | "compact" | "footer" | "navDark" | "admin" | "adminCompact";
};

/**
 * Wordmark from /public (Grass1.png). Plain img for reliable loading without the optimizer.
 */
export function BrandLogo({ className, variant = "default" }: BrandLogoProps) {
  if (variant === "navDark") {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- intentional: reliable public/ logo
      <img
        src={LOGO_NAV_DARK}
        alt="GRAAS — Grievance Redressal & Assistance System. AI-powered cybercrime assistance."
        width={320}
        height={80}
        decoding="async"
        fetchPriority="high"
        draggable={false}
        className={cn(
          "block h-7 w-auto min-w-0 max-h-7 max-w-[min(200px,46vw)] shrink-0 object-contain object-left sm:h-8 sm:max-h-8 sm:max-w-[min(240px,40vw)]",
          className,
        )}
      />
    );
  }

  if (variant === "admin") {
    return (
      <div className={cn("flex min-h-0 w-full max-w-full items-center", className)}>
        {/* eslint-disable-next-line @next/next/no-img-element -- intentional: reliable public/ logo */}
        <img
          src={LOGO_SRC}
          alt="GRAAS — Grievance Redressal & Assistance System. AI-powered cybercrime assistance."
          width={320}
          height={80}
          decoding="async"
          draggable={false}
          className="block h-auto w-full max-w-full min-w-0 max-h-[calc(5rem-1.5rem)] object-contain object-left sm:max-h-[calc(5rem-1.75rem)]"
        />
      </div>
    );
  }

  if (variant === "adminCompact") {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- intentional: reliable public/ logo
      <img
        src={LOGO_ADMIN_COLLAPSED}
        alt="GRAAS"
        width={80}
        height={80}
        decoding="async"
        draggable={false}
        title="GRAAS Admin"
        className={cn(
          "size-10 shrink-0 rounded-lg border border-black/[0.08] bg-muted/40 object-contain object-center p-0.5 shadow-sm",
          className,
        )}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- intentional: reliable public/ logo
    <img
      src={LOGO_SRC}
      alt="GRAAS — Grievance Redressal & Assistance System. AI-powered cybercrime assistance."
      width={320}
      height={96}
      decoding="async"
      fetchPriority={variant === "default" ? "high" : "auto"}
      draggable={false}
      className={cn(
        "block shrink-0 object-contain object-left",
        variant === "default" &&
          "h-16 w-auto min-w-[min(176px,100%)] max-h-16 max-w-[min(320px,100%)]",
        variant === "compact" &&
          "mx-auto h-10 w-auto min-w-0 max-h-10 max-w-[52px] object-contain",
        variant === "footer" && "h-20 w-auto min-w-[200px] max-h-20 max-w-[340px]",
        className,
      )}
    />
  );
}
