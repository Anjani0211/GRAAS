"use client";

import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AdminNotificationBell } from "@/components/layout/admin-notification-bell";
import { useSidebarStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export function AdminHeader({ title }: { title: string }) {
  const { collapsed } = useSidebarStore();

  return (
    <header
      className={cn(
        "sticky top-0 z-30 border-b border-black/[0.06] bg-card/85 backdrop-blur-md transition-all duration-200",
        collapsed ? "ml-16" : "ml-64",
      )}
    >
      <div className="flex w-full min-h-[5rem] items-center gap-3 px-6 py-3 sm:gap-5 sm:px-8 sm:py-3.5">
        <h1 className="min-w-0 shrink-0 truncate text-lg font-semibold tracking-tight text-foreground md:text-xl">
          {title}
        </h1>

        <div className="relative hidden min-w-0 flex-1 md:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search case ID, citizen name, or metadata…"
            className="h-10 w-full rounded-xl border-black/[0.08] bg-muted/40 pl-9 shadow-sm transition-colors focus-visible:bg-background"
            aria-label="Search cases"
          />
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <Button variant="ghost" size="icon" className="relative shrink-0 md:hidden" aria-label="Search">
            <Search className="size-5" />
          </Button>
          <AdminNotificationBell />
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
            VR
          </div>
        </div>
      </div>
    </header>
  );
}
