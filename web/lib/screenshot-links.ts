import type { OsintAgentScreenshot } from "./types";

export function screenshotHref(apiBase: string, downloadPath: string): string {
  return `${apiBase}${downloadPath}`;
}

export function resolveRefreshedScreenshotHref(
  callId: string,
  apiBase: string,
  freshScreenshots: OsintAgentScreenshot[] | undefined,
  currentHrefByCallId: Map<string, string>,
): string | null {
  const fresh = freshScreenshots?.find((s) => s.callId === callId);
  if (fresh) return screenshotHref(apiBase, fresh.downloadPath);
  return currentHrefByCallId.get(callId) ?? null;
}

