import { config } from "../config";
import { logger } from "../utils/logger";
import {
  GeminiExtractionResultSchema,
  type GeminiExtractionResult,
} from "../utils/entityValidator";
import { getLlmModel, getOpenAIClient, isLlmConfigured } from "./llmClient";

// ── System prompt — extraction ONLY, no inference ──

const EXTRACTION_SYSTEM_PROMPT = `You are a cybercrime evidence analyzer. Your ONLY job is to extract named entities from the provided evidence text.

Rules:
- Do not include any entity that is not explicitly present in the provided text.
- If you are uncertain about an entity, omit it.
- Every entity MUST include the source_file field (the filename from which it was extracted).
- Entities without source_file will be rejected — never omit this field.
- Do not infer, guess, or hallucinate. Extract only what is visible in the text.

Return a single JSON object with these exact keys:
{
  "phones": [{ "value": "string", "source_file": "string", "source_position": "optional string", "raw_context": "string" }],
  "upis": [{ "value": "string", "source_file": "string", "source_position": "optional string", "raw_context": "string" }],
  "ips": [{ "value": "string", "source_file": "string", "source_position": "optional string", "raw_context": "string" }],
  "urls": [{ "value": "string", "source_file": "string", "source_position": "optional string", "raw_context": "string" }],
  "emails": [{ "value": "string", "source_file": "string", "source_position": "optional string", "raw_context": "string" }],
  "crypto_wallets": [{ "value": "string", "source_file": "string", "source_position": "optional string", "raw_context": "string" }],
  "telegram_ids": [{ "value": "string", "source_file": "string", "source_position": "optional string", "raw_context": "string" }],
  "suspect_names": [{ "value": "string", "source_file": "string", "source_position": "optional string", "raw_context": "string" }],
  "summary": "2-4 sentence factual summary of the incident based solely on the evidence text",
  "confidence_overall": 0.0
}`;

const OCR_PROMPT =
  "Extract ALL visible text from this image exactly as written. Return plain text only, no formatting. " +
  "If this is a screenshot of a chat, preserve the message order. Do not describe the image — only transcribe visible text.";

type CorpusEntry = { text: string; sourceFile: string };

/** Strip markdown fences and isolate a JSON object from model prose. */
function extractJson(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenced) return fenced[1]!.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

/** Build the user prompt from the corpus. */
function buildPrompt(corpus: CorpusEntry[]): string {
  const parts = corpus
    .filter((c) => c.text.trim())
    .map((c) => `--- Evidence: ${c.sourceFile} ---\n${c.text.slice(0, 8000)}`)
    .join("\n\n");
  return parts || "No evidence text provided.";
}

/** Call local LLM for entity extraction. Throws on failure. */
async function callLlmExtraction(corpus: CorpusEntry[]): Promise<GeminiExtractionResult> {
  const client = getOpenAIClient();
  const prompt = buildPrompt(corpus);

  const response = await client.chat.completions.create({
    model: getLlmModel(),
    temperature: 0,
    max_tokens: 2048,
    messages: [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
  });

  const text = extractJson(response.choices[0]?.message?.content ?? "{}");
  const parsed: unknown = JSON.parse(text);
  return GeminiExtractionResultSchema.parse(parsed);
}

export interface GeminiServiceResult {
  extraction: GeminiExtractionResult;
  usedFallback: false;
}

export interface GeminiServiceFallback {
  usedFallback: true;
  reason: string;
}

export type GeminiResult = GeminiServiceResult | GeminiServiceFallback;

/**
 * Extract entities from evidence using cloud LLM (OpenRouter/OpenAI/NVIDIA) or local llama.cpp.
 *
 * Retry behaviour:
 * - On first failure: wait 2 seconds, retry once.
 * - If retry also fails: return `{usedFallback: true}` — caller must fall back to regex.
 * - The pipeline NEVER stops because the AI is down.
 */
export async function extractEntitiesWithGemini(corpus: CorpusEntry[]): Promise<GeminiResult> {
  if (!isLlmConfigured()) {
    return { usedFallback: true, reason: "No LLM configured (set OPENROUTER_API_KEY / OPENAI_API_KEY / LLM_API_KEY or LOCAL_LLM_BASE_URL)" };
  }

  try {
    const extraction = await callLlmExtraction(corpus);
    return { extraction, usedFallback: false };
  } catch (firstErr) {
    logger.warn(
      { err: firstErr instanceof Error ? firstErr.message : String(firstErr) },
      "[LLM] First extraction attempt failed — retrying in 2s",
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 2000));

    try {
      const extraction = await callLlmExtraction(corpus);
      logger.info("[LLM] Retry succeeded");
      return { extraction, usedFallback: false };
    } catch (retryErr) {
      logger.warn(
        { err: retryErr instanceof Error ? retryErr.message : String(retryErr) },
        "[LLM] Retry also failed — falling back to regex",
      );
      return {
        usedFallback: true,
        reason: retryErr instanceof Error ? retryErr.message : "LLM retry failed",
      };
    }
  }
}

/**
 * Vision OCR via cloud/local multimodal model.
 * Skipped when LLM_VISION_ENABLED=false.
 */
export async function ocrImageWithGemini(
  imageBuffer: Buffer,
  mimeType: string,
): Promise<string> {
  if (!isLlmConfigured() || !config.localLlmVisionEnabled) return "";

  try {
    const client = getOpenAIClient();
    const base64 = imageBuffer.toString("base64");
    const dataUrl = `data:${mimeType};base64,${base64}`;

    const response = await client.chat.completions.create({
      model: getLlmModel(),
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: OCR_PROMPT },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    });

    return (response.choices[0]?.message?.content ?? "").trim();
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[LLM OCR] Failed to extract text from image",
    );
    return "";
  }
}
