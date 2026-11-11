"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { AdminHeader } from "@/components/layout/admin-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useCreateStaff, useTeamUsers } from "@/lib/queries";
import { isAdminRole } from "@/lib/roles";
import { useAuthStore } from "@/lib/store";
import { ApiError } from "@/lib/api";
import { Mail, UserPlus, Loader2, X, CheckCircle2, AlertCircle } from "lucide-react";

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

const staffRoleOptions = [
  { value: "intake_officer", label: "Intake Officer" },
  { value: "osint_analyst", label: "OSINT Analyst" },
  { value: "case_manager", label: "Case Manager" },
  { value: "legal_team", label: "Legal Team" },
  { value: "senior_analyst", label: "Senior Analyst" },
  { value: "le_portal", label: "LE Portal" },
  { value: "admin", label: "Admin" },
];

const emptyForm = {
  name: "",
  email: "",
  password: "",
  phone: "",
  badgeId: "",
  role: "osint_analyst",
};

export default function TeamPage() {
  const { data, isLoading, isError } = useTeamUsers();
  const createStaff = useCreateStaff();
  const { user } = useAuthStore();
  const users = data?.users ?? [];
  const canManage = isAdminRole(user?.role);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    try {
      await createStaff.mutateAsync({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        phone: form.phone.trim() || undefined,
        badgeId: form.badgeId.trim() || undefined,
        role: form.role,
      });
      setMessage({ type: "ok", text: `Created ${form.email.trim()} — your admin session stays active.` });
      setForm(emptyForm);
      setOpen(false);
    } catch (err) {
      setMessage({
        type: "err",
        text: err instanceof ApiError ? err.message : "Failed to create user",
      });
    }
  }

  return (
    <>
      <AdminHeader title="Team Management" />
      <div className="space-y-6 p-6 sm:p-8">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {isLoading ? "Loading…" : `${users.length} active users`}
          </p>
          {canManage ? (
            <Button size="sm" onClick={() => { setOpen(true); setMessage(null); }}>
              <UserPlus className="size-4" />
              Add staff
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">Admin-only: create staff accounts</p>
          )}
        </div>

        {message && (
          <div
            className={`flex items-start gap-2 rounded-xl px-4 py-3 text-sm ${
              message.type === "ok"
                ? "bg-emerald-500/10 text-emerald-800"
                : "bg-destructive/10 text-destructive"
            }`}
          >
            {message.type === "ok" ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            ) : (
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
            )}
            <span>{message.text}</span>
          </div>
        )}

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

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
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

      {open && canManage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]">
          <Card className="w-full max-w-lg border-black/[0.08] shadow-xl">
            <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
              <div>
                <CardTitle className="text-lg">Add staff user</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Creates an account without signing you out.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <X className="size-4" />
              </Button>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
                <div className="space-y-2">
                  <Label htmlFor="staff-name">Full name</Label>
                  <Input
                    id="staff-name"
                    required
                    minLength={2}
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="staff-email">Email</Label>
                  <Input
                    id="staff-email"
                    type="email"
                    required
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="staff-password">Temporary password</Label>
                  <Input
                    id="staff-password"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="staff-role">Role</Label>
                    <Select
                      id="staff-role"
                      options={staffRoleOptions}
                      value={form.role}
                      onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="staff-badge">Badge ID (optional)</Label>
                    <Input
                      id="staff-badge"
                      value={form.badgeId}
                      onChange={(e) => setForm((f) => ({ ...f, badgeId: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="staff-phone">Phone (optional)</Label>
                  <Input
                    id="staff-phone"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createStaff.isPending}>
                    {createStaff.isPending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
                    Create user
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
