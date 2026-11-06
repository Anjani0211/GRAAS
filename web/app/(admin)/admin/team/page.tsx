"use client";

import { motion } from "framer-motion";
import { AdminHeader } from "@/components/layout/admin-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTeamUsers } from "@/lib/queries";
import { isAdminRole } from "@/lib/roles";
import { useAuthStore } from "@/lib/store";
import { Mail, UserPlus, Loader2 } from "lucide-react";

const roleLabels: Record<string, string> = {
  victim: "Victim",
  intake_officer: "Intake Officer",
  osint_analyst: "OSINT Analyst",
  case_manager: "Case Manager",
  legal_team: "Legal Team",
  senior_analyst: "Senior Analyst",
  le_portal: "LE Portal",
  admin: "Admin",
  super_admin: "Super Admin",
};

export default function TeamPage() {
  const { data, isLoading, isError } = useTeamUsers();
  const { user } = useAuthStore();
  const users = data?.users ?? [];
  const canManage = isAdminRole(user?.role);

  return (
    <>
      <AdminHeader title="Team Management" />
      <div className="space-y-6 p-6 sm:p-8">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {isLoading ? "Loading…" : `${users.length} active users`}
          </p>
          {canManage ? (
            <Button size="sm" asChild>
              <a href="/login">
                <UserPlus className="size-4" />
                Add via admin register
              </a>
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">Admin-only: create staff accounts</p>
          )}
        </div>

        {isLoading && (
          <div className="flex justify-center py-16">
            <Loader2 className="size-8 animate-spin text-primary" />
          </div>
        )}

        {isError && (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Could not load team. Admin role required.
            </CardContent>
          </Card>
        )}

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {users.map((member, i) => (
            <motion.div
              key={member.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
            >
              <Card className="h-full border-black/[0.06]">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{member.name}</CardTitle>
                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                      {roleLabels[member.role] ?? member.role}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  <p className="flex items-center gap-2 truncate">
                    <Mail className="size-3.5 shrink-0" />
                    {member.email}
                  </p>
                  {member.badgeId && (
                    <p className="font-mono-technical text-xs">Badge: {member.badgeId}</p>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </>
  );
}
