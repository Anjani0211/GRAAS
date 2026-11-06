"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store";
import type { UserRole } from "@/lib/types";
import { Loader2 } from "lucide-react";

import { isStaffRole } from "@/lib/roles";

function isStaff(role: UserRole): boolean {
  return isStaffRole(role);
}

/** Legacy /track/[id] links: send users through login, then to the right portal. */
export default function TrackCaseRedirectPage() {
  const params = useParams();
  const router = useRouter();
  const rawId = String(params.caseId ?? "");
  const { isLoading, isAuthenticated, user } = useAuthStore();

  useEffect(() => {
    if (!rawId || isLoading) return;

    if (!isAuthenticated) {
      const next = encodeURIComponent(`/victim/case/${rawId}`);
      router.replace(`/login?next=${next}`);
      return;
    }

    if (user?.role === "victim") {
      router.replace(`/victim/case/${encodeURIComponent(rawId)}`);
      return;
    }

    if (user && isStaff(user.role)) {
      router.replace(`/admin/case/${encodeURIComponent(rawId)}`);
      return;
    }

    router.replace("/login");
  }, [isLoading, isAuthenticated, user, rawId, router]);

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2 className="size-8 animate-spin text-primary" />
        <p className="text-sm">Redirecting…</p>
      </div>
    </div>
  );
}
