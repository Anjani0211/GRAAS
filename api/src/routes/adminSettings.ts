import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { AI_PROVIDERS, KEY_CATALOG } from "../config/keyCatalog";
import { logEvent } from "../services/auditLog";
import {
  deleteIntegrationKey,
  getEffectiveLlm,
  listKeyStatuses,
  updateAiSettings,
  upsertIntegrationKey,
} from "../services/runtimeSettings";
import { getOpenAIClient, getLlmModel } from "../services/llmClient";

const router = Router();

const AiBodySchema = z.object({
  provider: z.enum(["env", "openrouter", "openai", "nvidia", "custom"]),
  apiKey: z.string().optional(),
  clearApiKey: z.boolean().optional(),
  baseUrl: z.string().optional(),
  model: z.string().optional(),
  visionEnabled: z.boolean().nullable().optional(),
  toolsEnabled: z.boolean().nullable().optional(),
});

const KeyBodySchema = z.object({
  id: z.string().min(1).max(64),
  value: z.string().optional(),
  clear: z.boolean().optional(),
  label: z.string().max(120).optional(),
});

router.get("/", async (_req: Request, res: Response) => {
  try {
    const llm = getEffectiveLlm();
    res.json({
      ai: {
        provider: llm.provider,
        baseUrl: llm.baseUrl,
        model: llm.model,
        visionEnabled: llm.visionEnabled,
        toolsEnabled: llm.toolsEnabled,
        fromSettings: llm.fromSettings,
        hasApiKey: llm.hasApiKey,
        apiKeyMasked: llm.apiKeyMasked,
        isCloud: llm.isCloud,
      },
      providers: AI_PROVIDERS,
      catalog: KEY_CATALOG,
      keys: listKeyStatuses(),
    });
  } catch {
    res.status(500).json({ error: "Failed to load settings" });
  }
});

router.put("/ai", async (req: Request, res: Response) => {
  try {
    const body = AiBodySchema.parse(req.body);
    const llm = await updateAiSettings({
      ...body,
      updatedBy: req.auth?.userId,
    });
    await logEvent({
      userId: req.auth?.userId || "unknown",
      action: "SETTINGS_UPDATED",
      resourceId: "ai",
      outcome: "SUCCESS",
      ip: req.ip || "",
      metadata: {
        provider: body.provider,
        model: body.model,
        clearedKey: Boolean(body.clearApiKey),
        keyChanged: Boolean(body.apiKey && !body.apiKey.includes("••••")),
      },
    });
    res.json({
      ok: true,
      ai: {
        provider: llm.provider,
        baseUrl: llm.baseUrl,
        model: llm.model,
        visionEnabled: llm.visionEnabled,
        toolsEnabled: llm.toolsEnabled,
        fromSettings: llm.fromSettings,
        hasApiKey: llm.hasApiKey,
        apiKeyMasked: llm.apiKeyMasked,
        isCloud: llm.isCloud,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Validation failed", details: err.issues });
      return;
    }
    res.status(500).json({ error: "Failed to update AI settings" });
  }
});

router.put("/keys", async (req: Request, res: Response) => {
  try {
    const body = KeyBodySchema.parse(req.body);
    if (!body.clear && !body.value?.trim()) {
      res.status(400).json({ error: "Provide a key value or set clear: true" });
      return;
    }
    await upsertIntegrationKey({
      id: body.id,
      value: body.value,
      clear: body.clear,
      label: body.label,
      updatedBy: req.auth?.userId,
    });
    await logEvent({
      userId: req.auth?.userId || "unknown",
      action: "SETTINGS_UPDATED",
      resourceId: body.id.toUpperCase(),
      outcome: "SUCCESS",
      ip: req.ip || "",
      metadata: { clear: Boolean(body.clear), custom: !KEY_CATALOG.some((k) => k.id === body.id.toUpperCase()) },
    });
    res.json({ ok: true, keys: listKeyStatuses() });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Validation failed", details: err.issues });
      return;
    }
    if (err instanceof Error && err.message === "Invalid key id") {
      res.status(400).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: "Failed to update key" });
  }
});

router.delete("/keys/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    await deleteIntegrationKey(req.params.id, req.auth?.userId);
    await logEvent({
      userId: req.auth?.userId || "unknown",
      action: "SETTINGS_UPDATED",
      resourceId: req.params.id,
      outcome: "SUCCESS",
      ip: req.ip || "",
      metadata: { clear: true },
    });
    res.json({ ok: true, keys: listKeyStatuses() });
  } catch {
    res.status(500).json({ error: "Failed to delete key" });
  }
});

/** Best-effort connectivity check against the configured OpenAI-compatible endpoint. */
router.post("/ai/test", async (req: Request, res: Response) => {
  try {
    const llm = getEffectiveLlm();
    if (!llm.baseUrl) {
      res.status(400).json({ ok: false, error: "No LLM base URL configured" });
      return;
    }
    const client = getOpenAIClient();
    const model = (typeof req.body?.model === "string" && req.body.model.trim()) || getLlmModel();
    const completion = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: "Reply with exactly: ok" }],
      max_tokens: 8,
      temperature: 0,
    });
    const text = completion.choices[0]?.message?.content?.trim() || "";
    res.json({
      ok: true,
      model,
      provider: llm.provider,
      baseUrl: llm.baseUrl,
      reply: text.slice(0, 120),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "LLM test failed";
    res.status(502).json({ ok: false, error: message });
  }
});

export default router;
