"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, ArrowRight, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AdminNotificationBell } from "@/components/layout/admin-notification-bell";
import { CaseStatusBadge, SeverityBadge } from "@/components/case/case-status-badge";
import { useAuthStore } from "@/lib/store";
import { useCases } from "@/lib/queries";

function userInitials(name?: string | null, email?: string | null): string {
  const base = (name || email || "?").trim();
  const parts = base.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }
  return base.slice(0, 2).toUpperCase();
}

export function AdminHeader({ title }: { title: string }) {
  const router = useRouter();
  const { user } = useAuthStore();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 220);
    return () => window.clearTimeout(t);
  }, [query]);

  const { data: results, isFetching } = useCases(
    { q: debounced, limit: 8 },
    { enabled: debounced.length >= 2 },
  );

  const matches = useMemo(() => (debounced.length >= 2 ? results ?? [] : []), [debounced, results]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function goToCasesSearch(value: string) {
    const q = value.trim();
    setOpen(false);
    router.push(q ? `/admin/cases?q=${encodeURIComponent(q)}` : "/admin/cases");
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    goToCasesSearch(query);
  }

  const initials = userInitials(user?.name, user?.email);

  return (
    <header className="sticky top-0 z-30 border-b border-black/[0.06] bg-card/85 backdrop-blur-md">
      <div className="flex w-full min-h-[5rem] items-center gap-3 px-6 py-3 sm:gap-5 sm:px-8 sm:py-3.5">
        <div className="min-w-0 shrink-0">
          <p className="font-mono-technical text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
            Operations
          </p>
          <h1 className="truncate text-lg font-semibold tracking-tight text-foreground md:text-xl">
            {title}
          </h1>
        </div>

        <div className="relative hidden min-w-0 flex-1 md:block" ref={wrapRef}>
          <form onSubmit={onSubmit}>
            <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              placeholder="Search case ID, citizen name, or email…"
              className="h-10 w-full rounded-xl border-black/[0.08] bg-muted/40 pl-9 shadow-sm transition-colors focus-visible:bg-background"
              aria-label="Search cases"
              aria-expanded={open}
              aria-controls="admin-global-search"
              autoComplete="off"
            />
          </form>

          {open && debounced.length >= 2 && (
            <div
              id="admin-global-search"
              className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-50 overflow-hidden rounded-xl border border-black/[0.08] bg-card shadow-[0_16px_48px_rgba(0,63,177,0.12)]"
            >
              {isFetching && matches.length === 0 ? (
                <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Searching…
                </div>
              ) : matches.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No cases match “{debounced}”
                </div>
              ) : (
                <ul className="max-h-80 overflow-y-auto py-1">
                  {matches.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/admin/case/${c.id}`}
                        onClick={() => setOpen(false)}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-muted/70 transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono-technical text-xs font-semibold text-primary">
                              {c.caseNumber}
                            </span>
                            <SeverityBadge severity={c.severity} />
                            <CaseStatusBadge status={c.status} />
                          </div>
                          <p className="mt-0.5 truncate text-sm font-medium">{c.victimName}</p>
                          <p className="truncate text-xs text-muted-foreground">{c.victimEmail}</p>
                        </div>
                        <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onClick={() => goToCasesSearch(debounced)}
                className="flex w-full items-center justify-between border-t border-black/[0.06] bg-muted/30 px-4 py-2.5 text-left text-xs font-medium text-primary hover:bg-muted/60"
              >
                View all results in Cases
                <ArrowRight className="size-3.5" />
              </button>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="relative shrink-0 md:hidden"
            aria-label="Search cases"
            onClick={() => router.push("/admin/cases")}
          >
            <Search className="size-5" />
          </Button>
          <AdminNotificationBell />
          <div
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
            title={user?.name || user?.email || "Operator"}
            aria-label={user?.name ? `Signed in as ${user.name}` : "Operator"}
          >
            {initials}
          </div>
          {user?.role && (
            <Badge variant="secondary" className="hidden font-mono-technical text-[10px] uppercase lg:inline-flex">
              {user.role.replace(/_/g, " ")}
            </Badge>
          )}
        </div>
      </div>
    </header>
  );
}
