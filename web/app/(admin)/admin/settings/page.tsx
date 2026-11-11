"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminHeader } from "@/components/layout/admin-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { adminApi, ApiError } from "@/lib/api";
import { isAdminRole } from "@/lib/roles";
import { useAuthStore } from "@/lib/store";
import { Bot, Key, Plus, Shield, Trash2, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

type KeyRow = {
  id: string;
  label: string;
  group: string;
  configured: boolean;
  source: "settings" | "env" | "none";
  masked: string;
  custom?: boolean;
  hint?: string;
};

type AiState = {
  provider: string;
  baseUrl: string;
  model: string;
  visionEnabled: boolean;
  toolsEnabled: boolean;
  fromSettings: boolean;
  hasApiKey: boolean;
  apiKeyMasked: string;
  isCloud: boolean;
};

const GROUP_LABELS: Record<string, string> = {
  osint: "OSINT providers",
  payments: "Payments",
  notifications: "Notifications",
  custom: "Custom keys",
};

export default function SettingsPage() {
  const { user } = useAuthStore();
  const canManage = isAdminRole(user?.role);

  const [loading, setLoading] = useState(true);
  const [providers, setProviders] = useState<Array<{ id: string; label: string; baseUrl: string }>>([]);
  const [ai, setAi] = useState<AiState | null>(null);
  const [keys, setKeys] = useState<KeyRow[]>([]);

  const [provider, setProvider] = useState("env");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [visionEnabled, setVisionEnabled] = useState(true);
  const [toolsEnabled, setToolsEnabled] = useState(true);

  const [aiSaving, setAiSaving] = useState(false);
  const [aiTesting, setAiTesting] = useState(false);
  const [aiMessage, setAiMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [savingKeyId, setSavingKeyId] = useState<string | null>(null);

  const [customId, setCustomId] = useState("");
  const [customLabel, setCustomLabel] = useState("");
  const [customValue, setCustomValue] = useState("");
  const [customSaving, setCustomSaving] = useState(false);

  const load = useCallback(async () => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await adminApi.getSettings();
      setProviders(data.providers);
      setAi(data.ai as AiState);
      setKeys(data.keys);
      setProvider(data.ai.provider);
      setBaseUrl(data.ai.baseUrl || "");
      setModel(data.ai.model || "");
      setVisionEnabled(data.ai.visionEnabled);
      setToolsEnabled(data.ai.toolsEnabled);
      setApiKey("");
    } catch (err) {
      setAiMessage({
        type: "err",
        text: err instanceof ApiError ? err.message : "Failed to load settings",
      });
    } finally {
      setLoading(false);
    }
  }, [canManage]);

  useEffect(() => {
    void load();
  }, [load]);

  const providerOptions = useMemo(
    () => providers.map((p) => ({ value: p.id, label: p.label })),
    [providers],
  );

  const groupedKeys = useMemo(() => {
    const groups: Record<string, KeyRow[]> = {};
    for (const row of keys) {
      const g = row.group || "custom";
      if (!groups[g]) groups[g] = [];
      groups[g].push(row);
    }
    return groups;
  }, [keys]);

  if (!canManage) {
    return (
      <>
        <AdminHeader title="Settings" />
        <div className="mx-auto max-w-3xl p-6 sm:p-8">
          <Card className="stitch-glass border-black/[0.06]">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Admin access required to manage API keys and AI settings.
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  async function saveAi(clearApiKey = false) {
    setAiSaving(true);
    setAiMessage(null);
    try {
      const res = await adminApi.updateAiSettings({
        provider,
        baseUrl: provider === "custom" ? baseUrl : baseUrl || undefined,
        model,
        visionEnabled,
        toolsEnabled,
        ...(clearApiKey ? { clearApiKey: true } : apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setAi(res.ai as unknown as AiState);
      setApiKey("");
      setAiMessage({ type: "ok", text: "AI settings saved — active immediately" });
      await load();
    } catch (err) {
      setAiMessage({
        type: "err",
        text: err instanceof ApiError ? err.message : "Failed to save AI settings",
      });
    } finally {
      setAiSaving(false);
    }
  }

  async function testAi() {
    setAiTesting(true);
    setAiMessage(null);
    try {
      const res = await adminApi.testAiSettings(model || undefined);
      if (res.ok) {
        setAiMessage({
          type: "ok",
          text: `Connected · model ${res.model} · reply “${res.reply || "…"}”`,
        });
      } else {
        setAiMessage({ type: "err", text: res.error || "Test failed" });
      }
    } catch (err) {
      setAiMessage({
        type: "err",
        text: err instanceof ApiError ? err.message : "LLM test failed",
      });
    } finally {
      setAiTesting(false);
    }
  }

  async function saveKey(id: string, clear = false) {
    setSavingKeyId(id);
    try {
      const value = draftValues[id];
      const res = await adminApi.updateIntegrationKey({
        id,
        clear,
        ...(clear ? {} : { value }),
      });
      setKeys(res.keys);
      setDraftValues((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      setAiMessage({
        type: "err",
        text: err instanceof ApiError ? err.message : `Failed to update ${id}`,
      });
    } finally {
      setSavingKeyId(null);
    }
  }

  async function addCustomKey() {
    if (!customId.trim() || !customValue.trim()) return;
    setCustomSaving(true);
    try {
      const res = await adminApi.updateIntegrationKey({
        id: customId.trim(),
        value: customValue.trim(),
        label: customLabel.trim() || undefined,
      });
      setKeys(res.keys);
      setCustomId("");
      setCustomLabel("");
      setCustomValue("");
    } catch (err) {
      setAiMessage({
        type: "err",
        text: err instanceof ApiError ? err.message : "Failed to add custom key",
      });
    } finally {
      setCustomSaving(false);
    }
  }

  function onProviderChange(next: string) {
    setProvider(next);
    const preset = providers.find((p) => p.id === next);
    if (preset?.baseUrl) setBaseUrl(preset.baseUrl);
    if (next === "env" && ai) {
      setBaseUrl(ai.baseUrl);
      setModel(ai.model);
    }
  }

  return (
    <>
      <AdminHeader title="Settings" />
      <div className="mx-auto max-w-3xl space-y-6 p-6 sm:p-8">
        <div className="mb-2">
          <p className="font-mono-technical text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
            Platform configuration
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage AI provider/model and integration keys here. Secrets are encrypted at rest and never shown in full.
            Empty key fields keep the existing value; .env remains the fallback when Settings is set to “Use server .env”.
          </p>
        </div>

        {aiMessage && (
          <div
            className={`flex items-start gap-2 rounded-xl px-4 py-3 text-sm ${
              aiMessage.type === "ok"
                ? "bg-emerald-500/10 text-emerald-800"
                : "bg-destructive/10 text-destructive"
            }`}
          >
            {aiMessage.type === "ok" ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            ) : (
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
            )}
            <span>{aiMessage.text}</span>
          </div>
        )}

        <Card className="stitch-glass border-black/[0.06]">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Bot className="size-5 text-primary" />
              <div>
                <CardTitle>AI / LLM</CardTitle>
                <CardDescription>
                  Any OpenAI-compatible key + any model id (OpenRouter, OpenAI, NVIDIA, custom)
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading || !ai ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading…
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary">{ai.fromSettings ? "Settings override" : "From .env"}</Badge>
                  <Badge variant="secondary">{ai.hasApiKey ? "Configured" : "Not configured"}</Badge>
                  {ai.hasApiKey && (
                    <span className="font-mono">key {ai.apiKeyMasked || "••••"}</span>
                  )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="ai-provider">Provider</Label>
                    <Select
                      id="ai-provider"
                      options={providerOptions}
                      value={provider}
                      onChange={(e) => onProviderChange(e.target.value)}
                    />
                  </div>

                  {(provider === "custom" || provider !== "env") && (
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="ai-base">Base URL</Label>
                      <Input
                        id="ai-base"
                        placeholder="https://openrouter.ai/api/v1"
                        value={baseUrl}
                        onChange={(e) => setBaseUrl(e.target.value)}
                        disabled={provider === "env"}
                      />
                    </div>
                  )}

                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="ai-key">API key</Label>
                    <Input
                      id="ai-key"
                      type="password"
                      autoComplete="off"
                      placeholder={
                        ai.hasApiKey
                          ? `Stored ${ai.apiKeyMasked} — paste new key to replace`
                          : "Paste API key (any provider)"
                      }
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      disabled={provider === "env"}
                    />
                  </div>

                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="ai-model">Model</Label>
                    <Input
                      id="ai-model"
                      placeholder="e.g. openai/gpt-4o-mini, meta/llama-3.1-70b-instruct, gpt-4o"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      disabled={provider === "env"}
                    />
                    <p className="text-xs text-muted-foreground">
                      Free-form — use whatever model id your provider accepts.
                    </p>
                  </div>

                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 rounded border-input"
                      checked={visionEnabled}
                      onChange={(e) => setVisionEnabled(e.target.checked)}
                      disabled={provider === "env"}
                    />
                    Vision / OCR enabled
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 rounded border-input"
                      checked={toolsEnabled}
                      onChange={(e) => setToolsEnabled(e.target.checked)}
                      disabled={provider === "env"}
                    />
                    Tool-calling agent enabled
                  </label>
                </div>

                <div className="flex flex-wrap gap-2 pt-2">
                  <Button onClick={() => void saveAi(false)} disabled={aiSaving}>
                    {aiSaving ? <Loader2 className="size-4 animate-spin" /> : null}
                    Save AI settings
                  </Button>
                  <Button variant="outline" onClick={() => void testAi()} disabled={aiTesting || provider === "env"}>
                    {aiTesting ? <Loader2 className="size-4 animate-spin" /> : null}
                    Test connection
                  </Button>
                  {ai.hasApiKey && provider !== "env" && (
                    <Button variant="ghost" onClick={() => void saveAi(true)} disabled={aiSaving}>
                      Clear stored key
                    </Button>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="stitch-glass border-black/[0.06]">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Key className="size-5 text-amber-500" />
              <div>
                <CardTitle>Integration keys</CardTitle>
                <CardDescription>
                  OSINT, payments, notifications — Settings values override .env when set
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-8">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading…
              </div>
            ) : (
              Object.entries(groupedKeys).map(([group, rows]) => (
                <div key={group} className="space-y-3">
                  <p className="font-mono-technical text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    {GROUP_LABELS[group] || group}
                  </p>
                  {rows.map((row) => (
                    <div
                      key={row.id}
                      className="space-y-2 border-b border-black/[0.04] pb-4 last:border-0 last:pb-0"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">{row.label}</p>
                          <p className="font-mono text-[11px] text-muted-foreground">{row.id}</p>
                          {row.hint && (
                            <p className="text-xs text-muted-foreground">{row.hint}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">
                            {row.source === "settings"
                              ? "Settings"
                              : row.source === "env"
                                ? "Env"
                                : "Missing"}
                          </Badge>
                          {row.configured && (
                            <span className="font-mono text-[11px] text-muted-foreground">
                              {row.masked}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Input
                          type="password"
                          autoComplete="off"
                          placeholder={
                            row.configured
                              ? "Paste new value to replace"
                              : "Paste API key"
                          }
                          value={draftValues[row.id] || ""}
                          onChange={(e) =>
                            setDraftValues((prev) => ({ ...prev, [row.id]: e.target.value }))
                          }
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            disabled={
                              savingKeyId === row.id || !draftValues[row.id]?.trim()
                            }
                            onClick={() => void saveKey(row.id)}
                          >
                            {savingKeyId === row.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : null}
                            Save
                          </Button>
                          {(row.source === "settings" || row.custom) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={savingKeyId === row.id}
                              onClick={() => void saveKey(row.id, true)}
                            >
                              <Trash2 className="size-4" />
                              Clear
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))
            )}

            <div className="space-y-3 rounded-xl bg-muted/40 p-4">
              <div className="flex items-center gap-2">
                <Plus className="size-4 text-primary" />
                <p className="text-sm font-medium">Add custom key</p>
              </div>
              <p className="text-xs text-muted-foreground">
                Any provider — use an UPPER_SNAKE id (e.g. MY_CUSTOM_API_KEY).
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  placeholder="KEY_ID"
                  value={customId}
                  onChange={(e) => setCustomId(e.target.value)}
                />
                <Input
                  placeholder="Label (optional)"
                  value={customLabel}
                  onChange={(e) => setCustomLabel(e.target.value)}
                />
                <Input
                  className="sm:col-span-2"
                  type="password"
                  autoComplete="off"
                  placeholder="Secret value"
                  value={customValue}
                  onChange={(e) => setCustomValue(e.target.value)}
                />
              </div>
              <Button
                size="sm"
                disabled={customSaving || !customId.trim() || !customValue.trim()}
                onClick={() => void addCustomKey()}
              >
                {customSaving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                Add key
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="stitch-glass border-black/[0.06]">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="size-5 text-emerald-600" />
              <div>
                <CardTitle>Security notes</CardTitle>
                <CardDescription>How secrets are handled</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Keys are encrypted (AES-256-GCM) in MongoDB using JWT_SECRET / SETTINGS_ENCRYPTION_KEY.</p>
            <p>API responses only return masked hints (last 4 characters).</p>
            <p>Changes apply immediately without restarting the API.</p>
            <p>Admin role required — updates are written to the audit log.</p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
