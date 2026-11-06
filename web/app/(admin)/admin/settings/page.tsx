"use client";

import { AdminHeader } from "@/components/layout/admin-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Key, Bell, Shield } from "lucide-react";

export default function SettingsPage() {
  return (
    <>
      <AdminHeader title="Settings" />
      <div className="mx-auto max-w-3xl space-y-6 p-6 sm:p-8">
        <div className="mb-2">
          <p className="font-mono-technical text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
            Platform configuration
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Runtime secrets live in <code className="text-xs">api/.env</code> — this page does not store or display API keys.
          </p>
        </div>

        <Card className="stitch-glass border-black/[0.06]">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Key className="size-5 text-amber-500" />
              <div>
                <CardTitle>Integrations</CardTitle>
                <CardDescription>Configure via server environment variables</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {[
              { label: "VirusTotal / WhoisXML / AbuseIPDB", env: "VIRUSTOTAL_API_KEY, WHOISXML_API_KEY, …" },
              { label: "MinIO evidence store", env: "MINIO_*" },
              { label: "Neo4j graph", env: "NEO4J_*" },
              { label: "Redis / Bull queues", env: "REDIS_HOST" },
              { label: "Local LLM", env: "LOCAL_LLM_BASE_URL" },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-4 py-2 border-b border-black/[0.04] last:border-0">
                <div>
                  <p className="font-medium">{row.label}</p>
                  <p className="text-xs text-muted-foreground font-mono">{row.env}</p>
                </div>
                <Badge variant="secondary">Env only</Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="stitch-glass border-black/[0.06]">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Bell className="size-5 text-primary" />
              <div>
                <CardTitle>Notifications</CardTitle>
                <CardDescription>Outbound SMS/email/WhatsApp</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Provider not configured. Messages are stored as <strong>queued</strong> only — they are not delivered until MSG91/SES/Twilio (or similar) is wired.
            </p>
          </CardContent>
        </Card>

        <Card className="stitch-glass border-black/[0.06]">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="size-5 text-emerald-600" />
              <div>
                <CardTitle>Security</CardTitle>
                <CardDescription>Session &amp; access controls</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>Browser auth uses httpOnly cookie <code className="text-xs">graas_token</code>.</p>
            <p>Login lockout: 5 failed attempts → 15 minute lock.</p>
            <p>HITL finalize/submit-LE requires badge ID on senior roles.</p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
