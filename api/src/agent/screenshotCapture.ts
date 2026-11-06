import sharp from "sharp";
import { config } from "../config";
import { storageService } from "../services/storageService";
import type { ToolCallResult, ToolContext } from "./toolRegistry";
import { renderResultCard } from "./resultCardRenderer";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function getPathValue(root: unknown, path: string[]): unknown {
  let cur: unknown = root;
  for (const key of path) {
    const rec = asRecord(cur);
    if (!rec) return undefined;
    cur = rec[key];
  }
  return cur;
}

function decodeBase64Image(input: string): Buffer | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const dataUrlMatch = trimmed.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  const b64 = dataUrlMatch ? dataUrlMatch[1] : trimmed;
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(b64)) return null;
  try {
    return Buffer.from(b64, "base64");
  } catch {
    return null;
  }
}

const TOOL_IMAGE_PATHS: Record<string, string[][]> = {
  capture_website: [
    ["screenshotBase64"],
    ["screenshotB64"],
    ["imageBase64"],
    ["imageB64"],
  ],
  scan_url: [
    ["urlscan", "screenshotBase64"],
    ["urlscan", "screenshotB64"],
    ["vt", "screenshotBase64"],
    ["vt", "thumbnailB64"],
  ],
  analyze_apk: [
    ["analysis", "screenshotBase64"],
    ["analysis", "previewImageB64"],
    ["screenshotBase64"],
  ],
  search_username: [
    ["profile", "screenshotBase64"],
    ["result", "screenshotBase64"],
  ],
};

const GENERIC_IMAGE_PATHS: string[][] = [
  ["thumbnailB64"],
  ["screenshotB64"],
  ["screenshotBase64"],
  ["imageB64"],
  ["imageBase64"],
  ["previewB64"],
];

function extractNativeImage(toolName: string, result: ToolCallResult<unknown>): Buffer | null {
  const data = asRecord(result.data);
  if (!data) return null;
  const candidatePaths = [...(TOOL_IMAGE_PATHS[toolName] ?? []), ...GENERIC_IMAGE_PATHS];
  for (const path of candidatePaths) {
    const value = getPathValue(data, path);
    if (typeof value !== "string") continue;
    const decoded = decodeBase64Image(value);
    if (decoded && decoded.length > 32) {
      return decoded;
    }
  }
  return null;
}

export async function captureToolScreenshot(
  toolName: string,
  result: ToolCallResult<unknown>,
  ctx: ToolContext,
): Promise<{ screenshotPath?: string; thumbnailB64?: string }> {
  const nativeImage = extractNativeImage(toolName, result);
  const source = nativeImage ?? (await renderResultCard(toolName, result));
  const resized = await sharp(source)
    .resize({ width: config.screenshotMaxWidthPx, withoutEnlargement: true })
    .jpeg({ quality: config.agentScreenshotQuality })
    .toBuffer();

  const stored = await storageService.upload({
    caseId: ctx.caseId,
    fileName: `agent_${ctx.callId}.jpg`,
    mimeType: "image/jpeg",
    buffer: resized,
  });

  const thumb = await sharp(resized).resize({ width: 360, withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
  return {
    screenshotPath: stored.minioPath,
    thumbnailB64: thumb.toString("base64"),
  };
}

