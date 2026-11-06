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
  const { collapsed } = useSidebarStore();

  return (
    <AuthGuard allowedRoles={[...STAFF_ROLES]}>
      <div className="min-h-screen bg-background">
        <AdminSidebar />
        <main
          className={cn(
            "min-h-screen transition-all duration-200",
            collapsed ? "ml-16" : "ml-64"
          )}
        >
          {children}
        </main>
      </div>
    </AuthGuard>
  );
}
