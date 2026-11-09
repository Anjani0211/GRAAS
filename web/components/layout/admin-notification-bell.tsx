"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNotificationFeed } from "@/lib/queries";
import { formatRelativeTime } from "@/lib/utils";

const channelLabel: Record<string, string> = {
  email: "Email",
  sms: "SMS",
  whatsapp: "WhatsApp",
};

export function AdminNotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data, isLoading, isError } = useNotificationFeed();

  const items = data?.notifications ?? [];
  const count = items.length;

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="relative shrink-0"
        aria-label="Notifications"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Bell className="size-5" />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </Button>

      {open && (
        <div
          className="absolute right-0 top-full z-[100] mt-2 w-[min(100vw-2rem,22rem)] rounded-xl border border-black/[0.08] bg-card shadow-lg ring-1 ring-black/[0.04]"
          role="dialog"
          aria-label="Notifications"
        >
          <div className="border-b border-black/[0.06] px-4 py-3">
            <p className="text-sm font-semibold text-foreground">Notifications</p>
            <p className="text-xs text-muted-foreground">Recent messages sent to citizens</p>
          </div>
          <div className="max-h-[min(70vh,24rem)] overflow-y-auto p-2">
            {isLoading && (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">Loading…</p>
            )}
            {isError && (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">Could not load notifications</p>
            )}
            {!isLoading && !isError && items.length === 0 && (
              <p className="px-2 py-8 text-center text-sm text-muted-foreground">No notifications yet</p>
            )}
            {!isLoading &&
              !isError &&
              items.map((n) => (
                <Link
                  key={n.id}
                  href={`/admin/case/${n.caseId}`}
                  className="block rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/80"
                  onClick={() => setOpen(false)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-primary">{n.caseNumber}</span>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {channelLabel[n.channel] ?? n.channel}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-foreground/90">{n.message}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {formatRelativeTime(new Date(n.sentAt))}
                  </p>
                </Link>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
