"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BrandLogo } from "@/components/layout/brand-logo";
import { Button } from "@/components/ui/button";
import { motion, useReducedMotion } from "framer-motion";
import { LogOut } from "lucide-react";
import { useAuthStore } from "@/lib/store";
import type { UserRole } from "@/lib/types";
import { cn } from "@/lib/utils";

function isStaffRole(role: UserRole): boolean {
  return [
    "intake_officer",
    "osint_analyst",
    "case_manager",
    "legal_team",
    "admin",
    "super_admin",
  ].includes(role);
}

function usePortalLink() {
  const { user, isAuthenticated, isLoading } = useAuthStore();
  const portal =
    user?.role === "victim"
      ? { href: "/victim/dashboard", label: "My cases" }
      : user && isStaffRole(user.role)
        ? { href: "/admin/dashboard", label: "Admin" }
        : null;
  return { user, isAuthenticated, isLoading, portal };
}

/** React Bits–style floating pill nav on the landing page only */
function FloatingLandingHeader() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const { user, isAuthenticated, isLoading, portal } = usePortalLink();
  const { logout } = useAuthStore();

  function handleLogout() {
    logout();
    router.push("/");
  }

  return (
    <motion.header
      initial={{ y: -16, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="pointer-events-none fixed left-0 right-0 top-5 z-[60] flex justify-center px-4"
    >
      <div
        className="pointer-events-auto relative overflow-hidden rounded-full shadow-[0_0_28px_rgba(34,211,238,0.22),0_8px_40px_rgba(0,0,0,0.45)]"
      >
        {!reduceMotion && (
          <div
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
            aria-hidden
          >
            <motion.div
              className="aspect-square h-[240%] min-h-[200px] w-[240%] max-w-none shrink-0"
              style={{
                background:
                  "conic-gradient(from 0deg at 50% 50%, transparent 0deg, transparent 55deg, rgba(34,211,238,0.2) 70deg, rgba(56,189,248,0.95) 88deg, rgba(0,63,177,1) 95deg, rgba(34,211,238,0.85) 102deg, rgba(125,211,252,0.5) 115deg, transparent 130deg, transparent 360deg)",
              }}
              animate={{ rotate: 360 }}
              transition={{ duration: 5.5, repeat: Infinity, ease: "linear" }}
            />
          </div>
        )}
        <div
          className={cn(
            "relative z-10 m-[2px] flex max-w-[calc(100vw-2rem)] items-center gap-1 rounded-full border py-1.5 pl-4 pr-1.5 backdrop-blur-2xl",
            "border-white/[0.12] bg-black/35",
            reduceMotion && "border-cyan-400/35",
            "sm:gap-2 sm:pl-5",
          )}
        >
        <Link
          href="/"
          className="flex shrink-0 items-center rounded-full pr-2 transition-opacity hover:opacity-90"
        >
          <BrandLogo variant="navDark" />
        </Link>

        <nav className="mx-1 flex min-w-0 flex-1 items-center justify-center gap-3 border-l border-white/10 pl-2 text-[11px] text-white/70 sm:justify-start sm:gap-5 sm:pl-4 sm:text-sm">
          <Link href="/#pipeline" className="shrink-0 whitespace-nowrap transition-colors hover:text-white">
            How it works
          </Link>
          <Link href="/track" className="shrink-0 whitespace-nowrap transition-colors hover:text-white">
            Track case
          </Link>
          {!isLoading && isAuthenticated && portal && (
            <Link href={portal.href} className="shrink-0 whitespace-nowrap transition-colors hover:text-white">
              {portal.label}
            </Link>
          )}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1 border-l border-white/10 pl-2 sm:gap-2 sm:pl-3">
          {!isLoading && isAuthenticated && user ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 rounded-full px-3 text-white/75 hover:bg-white/10 hover:text-white"
              onClick={handleLogout}
            >
              <LogOut className="size-4 sm:mr-1" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          ) : !isLoading ? (
            <Button asChild variant="ghost" size="sm" className="hidden h-9 rounded-full px-3 text-white/75 hover:bg-white/10 hover:text-white sm:inline-flex">
              <Link href="/login">Sign in</Link>
            </Button>
          ) : (
            <div className="hidden h-9 w-16 animate-pulse rounded-full bg-white/10 sm:block" aria-hidden />
          )}
          <Button
            asChild
            size="sm"
            className="h-9 rounded-full border-0 bg-white px-4 font-semibold text-[#0a0a0c] shadow-none hover:bg-white/90"
          >
            <Link href="/submit">Report</Link>
          </Button>
        </div>
        </div>
      </div>
    </motion.header>
  );
}

function StandardPublicHeader() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading, portal } = usePortalLink();
  const { logout } = useAuthStore();

  function handleLogout() {
    logout();
    router.push("/");
  }

  return (
    <motion.header
      initial={{ y: -12, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="sticky top-0 z-50 border-b border-black/[0.06] bg-card/80 backdrop-blur-md"
    >
      <div className="mx-auto flex h-16 w-full max-w-[90rem] items-center justify-between px-6 md:px-10">
        <Link
          href="/"
          className="flex shrink-0 items-center rounded-md transition-opacity duration-200 hover:opacity-90"
        >
          <BrandLogo className="!h-11 !max-h-11 !min-w-0 !max-w-[min(252px,78vw)] sm:!h-12 sm:!max-h-12 sm:!max-w-[min(272px,72vw)]" />
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          <Link
            href="/#pipeline"
            className="text-sm font-semibold tracking-tight text-primary transition-colors hover:text-primary/80"
          >
            How it works
          </Link>
          <Link
            href="/track"
            className="text-sm font-medium tracking-tight text-muted-foreground transition-colors hover:text-primary"
          >
            Track case
          </Link>
          {!isLoading && isAuthenticated && portal && (
            <Link
              href={portal.href}
              className="text-sm font-medium tracking-tight text-muted-foreground transition-colors hover:text-foreground"
            >
              {portal.label}
            </Link>
          )}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          {!isLoading && isAuthenticated && user ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={handleLogout}
              >
                <LogOut className="size-4 sm:mr-1" />
                <span className="hidden sm:inline">Sign out</span>
              </Button>
              {portal && (
                <Button asChild variant="outline" size="sm" className="inline-flex shrink-0 md:hidden">
                  <Link href={portal.href}>{portal.label}</Link>
                </Button>
              )}
            </>
          ) : !isLoading ? (
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex text-muted-foreground">
              <Link href="/login">Sign in</Link>
            </Button>
          ) : (
            <div className="hidden h-9 w-[4.5rem] animate-pulse rounded-md bg-muted/50 sm:block" aria-hidden />
          )}
          <Button asChild size="sm" variant="cta" className="rounded-lg px-5 font-semibold shadow-md">
            <Link href="/submit">Report</Link>
          </Button>
        </div>
      </div>
    </motion.header>
  );
}

export function PublicHeader() {
  const pathname = usePathname();
  if (pathname === "/") {
    return <FloatingLandingHeader />;
  }
  return <StandardPublicHeader />;
}
