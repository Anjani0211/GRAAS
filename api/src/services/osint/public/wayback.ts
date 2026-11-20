import { safeHttp } from "../../../utils/httpClient";
import { ConfidenceScore } from "../../../types/confidence";
import type { OsintResult } from "../providerInterface";

/**
 * Internet Archive CDX / availability — free, no API key.
 * Returns nearest archived snapshot for evidence preservation.
 */
export async function waybackLookup(urlOrDomain: string): Promise<OsintResult> {
  const target = normalizeTarget(urlOrDomain);
  if (!target) {
    return {
      success: false,
      confidence: ConfidenceScore.UNVERIFIED,
      source: `wayback/${new Date().toISOString()}`,
      flags: [],
      error: "invalid-url",
    };
  }

  try {
    const response = await safeHttp.get<{
      archived_snapshots?: { closest?: { available?: boolean; url?: string; timestamp?: string; status?: string } };
      url?: string;
    }>("https://archive.org/wayback/available", {
      params: { url: target },
      timeout: 15_000,
      headers: { Accept: "application/json", "User-Agent": "GRAAS-OSINT/1.0" },
      validateStatus: (s) => s >= 200 && s < 300,
    });

    const closest = response.data?.archived_snapshots?.closest;
    const available = Boolean(closest?.available && closest?.url);
    const flags: string[] = [];
    if (!available) flags.push("NO_WAYBACK_SNAPSHOT");
    else flags.push("WAYBACK_AVAILABLE");

    let ageDays: number | null = null;
    if (closest?.timestamp && /^\d{14}$/.test(closest.timestamp)) {
      const ts = closest.timestamp;
      const snap = new Date(
        `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T${ts.slice(8, 10)}:${ts.slice(10, 12)}:${ts.slice(12, 14)}Z`,
      );
      if (!Number.isNaN(snap.getTime())) {
        ageDays = Math.max(0, Math.round((Date.now() - snap.getTime()) / 86_400_000));
      }
    }

    return {
      success: true,
      data: {
        url: target,
        available,
        archive_url: closest?.url ?? null,
        timestamp: closest?.timestamp ?? null,
        status: closest?.status ?? null,
        snapshot_age_days: ageDays,
        assist: {
          wayback_search: `https://web.archive.org/web/*/${encodeURIComponent(target)}`,
        },
      },
      confidence: available ? ConfidenceScore.MEDIUM : ConfidenceScore.LOW,
      source: `wayback/${new Date().toISOString()}`,
      flags,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      confidence: ConfidenceScore.UNVERIFIED,
      source: `wayback/${new Date().toISOString()}`,
      flags: [],
      error: message.slice(0, 200),
    };
  }
}

function normalizeTarget(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    if (/^https?:\/\//i.test(raw)) return new URL(raw).href;
    if (raw.includes(".") && !raw.includes(" ")) return `http://${raw}`;
    return null;
  } catch {
    return null;
  }
}
