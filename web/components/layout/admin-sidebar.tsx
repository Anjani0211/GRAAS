"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/layout/brand-logo";
import { useSidebarStore, useAuthStore } from "@/lib/store";
import { isAdminRole } from "@/lib/roles";
import { useCaseStats, useOsintQueue } from "@/lib/queries";
import { AnimatePresence, motion } from "framer-motion";
import {
  LayoutDashboard,
  FolderOpen,
  BarChart3,
  Users,
  Settings,
  PanelLeftClose,
  PanelLeft,
  LogOut,
  Radar,
  Network,
  ScrollText,
} from "lucide-react";

const baseNav = [
  { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard, badgeKey: null },
  { href: "/admin/cases", label: "Cases", icon: FolderOpen, badgeKey: "pending" as const },
  { href: "/admin/osint", label: "OSINT", icon: Radar, badgeKey: "osint" as const },
  { href: "/admin/threat-graph", label: "Threat Graph", icon: Network, badgeKey: null },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3, badgeKey: null },
];

const adminOnlyNav = [
  { href: "/admin/audit", label: "Audit", icon: ScrollText, badgeKey: null },
  { href: "/admin/team", label: "Team", icon: Users, badgeKey: null },
  { href: "/admin/settings", label: "Settings", icon: Settings, badgeKey: null },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { collapsed, toggle } = useSidebarStore();
  const { logout, user } = useAuthStore();
  const { data: stats } = useCaseStats();
  const { data: osintQueue } = useOsintQueue();
  const navItems = isAdminRole(user?.role) ? [...baseNav, ...adminOnlyNav] : baseNav;

  const badges: Record<string, number> = {
    pending: stats?.pendingTriage ?? 0,
    osint: osintQueue?.length ?? 0,
  };

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 64 : 256 }}
      transition={{ duration: 0.2, ease: "easeInOut" }}
      className="fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-black/[0.08] bg-card"
    >
      <div
        className={cn(
          "flex min-h-[5rem] shrink-0 items-center border-b border-black/[0.06] py-3 sm:py-3.5",
          collapsed ? "px-2" : "px-4",
        )}
      >
        <Link
          href="/admin/dashboard"
          className={cn(
            "flex min-h-0 min-w-0 w-full flex-1 items-center transition-opacity hover:opacity-90",
            collapsed ? "justify-center" : "justify-start rounded-lg",
          )}
        >
          <BrandLogo variant={collapsed ? "adminCompact" : "admin"} />
        </Link>
      </div>

      <nav
        className={cn(
          "flex flex-1 flex-col overflow-y-auto overflow-x-hidden",
          collapsed ? "gap-1 p-3" : "gap-1.5 px-3 py-4 sm:px-4",
        )}
      >
        {navItems.map((item) => {
          const isActive =
            item.href === "/admin/osint"
              ? pathname.startsWith("/admin/osint")
              : pathname.startsWith(item.href);
          const badgeCount = item.badgeKey ? badges[item.badgeKey] || 0 : 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-xl text-sm font-medium transition-all duration-200",
                collapsed ? "justify-center px-2 py-2.5" : "px-4 py-3",
                isActive
                  ? "bg-muted text-primary stitch-ambient ring-1 ring-black/[0.06]"
                  : "text-muted-foreground hover:bg-muted/80 hover:text-foreground",
              )}
            >
              <span className="relative shrink-0">
                <item.icon className="size-5" aria-hidden />
                {collapsed && badgeCount > 0 && (
                  <span className="absolute -right-1.5 -top-1 flex size-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
                    {badgeCount > 9 ? "9+" : badgeCount}
                  </span>
                )}
              </span>
              <AnimatePresence mode="wait">
                {!collapsed && (
                  <motion.span
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: "auto" }}
                    exit={{ opacity: 0, width: 0 }}
                    className="flex min-w-0 flex-1 items-center justify-between gap-2 overflow-hidden whitespace-nowrap"
                  >
                    <span>{item.label}</span>
                    {badgeCount > 0 && (
                      <span className="rounded-full bg-primary/10 px-1.5 py-0.5 font-mono-technical text-[10px] font-semibold text-primary">
                        {badgeCount > 99 ? "99+" : badgeCount}
                      </span>
                    )}
                  </motion.span>
                )}
              </AnimatePresence>
            </Link>
          );
        })}
      </nav>

      <div
        className={cn(
          "mt-auto border-t border-black/[0.06]",
          collapsed ? "p-3" : "p-4",
        )}
      >
        <div className={cn("flex flex-col", collapsed ? "gap-2" : "gap-2.5")}>
          {!collapsed && user && (
            <p className="truncate px-0.5 text-xs font-medium text-foreground/80">{user.name}</p>
          )}
          <button
            type="button"
            onClick={() => {
              void logout().then(() => router.push("/login"));
            }}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-destructive",
              collapsed ? "h-9 justify-center px-2" : "justify-start px-2.5 py-2.5",
            )}
          >
            <LogOut className="size-4 shrink-0" aria-hidden />
            {!collapsed && <span>Sign out</span>}
          </button>
          <button
            type="button"
            onClick={toggle}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "flex w-full items-center gap-2 rounded-xl border bg-card text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground",
              "border-black/[0.07]",
              collapsed ? "h-9 justify-center px-2" : "h-10 justify-start px-3 py-2.5",
            )}
          >
            {collapsed ? <PanelLeft className="size-4" aria-hidden /> : <PanelLeftClose className="size-4 shrink-0" aria-hidden />}
            {!collapsed && <span>Collapse sidebar</span>}
          </button>
        </div>
      </div>
    </motion.aside>
  );
}
