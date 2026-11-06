"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/layout/brand-logo";
import { useSidebarStore, useAuthStore } from "@/lib/store";
import { isAdminRole } from "@/lib/roles";
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
  { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/cases", label: "Cases", icon: FolderOpen },
  { href: "/admin/osint", label: "OSINT", icon: Radar },
  { href: "/admin/threat-graph", label: "Threat Graph", icon: Network },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
];

const adminOnlyNav = [
  { href: "/admin/audit", label: "Audit", icon: ScrollText },
  { href: "/admin/team", label: "Team", icon: Users },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { collapsed, toggle } = useSidebarStore();
  const { logout, user } = useAuthStore();
  const navItems = isAdminRole(user?.role) ? [...baseNav, ...adminOnlyNav] : baseNav;

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
              <item.icon className="size-5 shrink-0" aria-hidden />
              <AnimatePresence mode="wait">
                {!collapsed && (
                  <motion.span
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: "auto" }}
                    exit={{ opacity: 0, width: 0 }}
                    className="overflow-hidden whitespace-nowrap"
                  >
                    {item.label}
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
