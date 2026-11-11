"use client";

import { AdminSidebar } from "@/components/layout/admin-sidebar";
import { useSidebarStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { AuthGuard } from "@/components/auth-guard";
import { STAFF_ROLES } from "@/lib/roles";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { collapsed, mobileOpen, setMobileOpen } = useSidebarStore();

  return (
    <AuthGuard allowedRoles={[...STAFF_ROLES]}>
      <div className="min-h-screen bg-background">
        {/* Mobile backdrop */}
        {mobileOpen && (
          <button
            type="button"
            aria-label="Close navigation"
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}
        <AdminSidebar />
        <main
          className={cn(
            "min-h-screen transition-all duration-200",
            "ml-0",
            collapsed ? "md:ml-16" : "md:ml-64",
          )}
        >
          {children}
        </main>
      </div>
    </AuthGuard>
  );
}
