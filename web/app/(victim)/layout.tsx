"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/layout/brand-logo";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthGuard } from "@/components/auth-guard";
import { useAuthStore } from "@/lib/store";

const navLinks = [
  { href: "/victim/dashboard", label: "Home", isActive: (p: string) => p.startsWith("/victim/dashboard") || p.startsWith("/victim/case") },
  { href: "/#pipeline", label: "How it works", isActive: (_p: string) => false },
  { href: "/victim/support", label: "Support", isActive: (p: string) => p.startsWith("/victim/support") },
];

export default function VictimLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { logout, user } = useAuthStore();

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  return (
    <AuthGuard allowedRoles={["victim"]}>
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-50 border-b border-black/[0.06] bg-card/80 shadow-[0_12px_40px_rgba(26,86,219,0.04)] backdrop-blur-md">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3 md:px-8 md:py-3.5">
            <Link href="/victim/dashboard" className="flex shrink-0 items-center rounded-md transition-opacity hover:opacity-90">
              <BrandLogo className="!h-11 !max-h-11 !min-w-0 !max-w-[min(252px,78vw)] sm:!h-12 sm:!max-h-12 sm:!max-w-[min(272px,72vw)]" />
            </Link>

            <nav className="hidden items-center gap-8 md:flex">
              {navLinks.map((item) => {
                const active = item.isActive(pathname);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "border-b-2 py-1 text-sm font-semibold tracking-tight transition-colors",
                      active
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-primary",
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <div className="flex items-center gap-4">
              {user && (
                <span className="hidden max-w-[140px] truncate text-sm text-muted-foreground lg:inline">{user.name}</span>
              )}
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-primary" onClick={handleLogout}>
                <LogOut className="size-4 sm:mr-1" />
                <span className="hidden sm:inline">Sign out</span>
              </Button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-6 py-10">{children}</main>
      </div>
    </AuthGuard>
  );
}
