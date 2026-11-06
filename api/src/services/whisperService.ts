import fs from "fs";
import FormData from "form-data";
import { config } from "../config";
import { logger } from "../utils/logger";
import { internalHttp } from "../utils/httpClient";

const AUDIO_EXTENSIONS = new Set([".mp3", ".mp4", ".wav", ".ogg", ".m4a"]);
const AUDIO_MIME_TYPES = new Set([
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/ogg",
  "video/mp4",
  "audio/x-m4a",
]);

export function isAudioFile(fileName: string, mimeType?: string): boolean {
  const ext = fileName.toLowerCase().slice(fileName.lastIndexOf("."));
  if (AUDIO_EXTENSIONS.has(ext)) return true;
  if (mimeType && AUDIO_MIME_TYPES.has(mimeType)) return true;
  return false;
}

export interface TranscriptionResult {
  ok: true;
  text: string;
}

export interface TranscriptionPending {
  ok: false;
  transcriptionPending: true;
  reason: string;
}

export type WhisperResult = TranscriptionResult | TranscriptionPending;

async function postWhisperForm(form: FormData): Promise<WhisperResult> {
  try {
    const response = await internalHttp.post<string>(config.whisperEndpoint, form, {
      headers: form.getHeaders(),
      timeout: 120_000,
      responseType: "text",
    });
    const text = typeof response.data === "string" ? response.data.trim() : "";
    logger.info({ chars: text.length }, "[Whisper] Transcription complete");
    return { ok: true, text };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn({ reason }, "[Whisper] Endpoint unavailable — marked transcription_pending");
    return { ok: false, transcriptionPending: true, reason };
  }
}

/**
 * Transcribe an audio file using the self-hosted Whisper endpoint.
 * Uses internalHttp (SSRF checks not applied — URL is trusted env only).
 */
export async function transcribeAudio(filePath: string): Promise<WhisperResult> {
  if (!fs.existsSync(filePath)) {
    return { ok: false, transcriptionPending: true, reason: `File not found: ${filePath}` };
  }

  try {
    const form = new FormData();
    form.append("audio_file", fs.createReadStream(filePath), {
      filename: filePath.split(/[\\/]/).pop() ?? "audio",
    });
    form.append("encode", "true");
    form.append("task", "transcribe");
    form.append("language", "en");
    form.append("output", "txt");
    return postWhisperForm(form);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn({ filePath, reason }, "[Whisper] Failed to build request");
    return { ok: false, transcriptionPending: true, reason };
  }
}

/** Transcribe from an in-memory buffer (pipeline / MinIO-backed evidence). */
export async function transcribeAudioBuffer(buffer: Buffer, fileName: string): Promise<WhisperResult> {
  try {
    const form = new FormData();
    form.append("audio_file", buffer, { filename: fileName });
    form.append("encode", "true");
    form.append("task", "transcribe");
    form.append("language", "en");
    form.append("output", "txt");
    return postWhisperForm(form);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, transcriptionPending: true, reason };
  }
}
