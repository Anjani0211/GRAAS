import { z } from "zod";
import net from "net";
import puppeteer, { type Browser } from "puppeteer";
import { EvidenceHash } from "../../models/EvidenceHash";
import { safeHttp } from "../../utils/httpClient";
import { storageService } from "../../services/storageService";
import { ConfidenceScore } from "../../types/confidence";
import type { AgentTool } from "../toolRegistry";
import { enrichTelegramEntity } from "../../services/osint/providers/telegramProviders";

let captureBrowser: Browser | null = null;
export type WebsiteCapturePageLike = {
  title: () => Promise<string>;
  $$eval: (selector: string, pageFunction: (anchors: Array<{ getAttribute: (name: string) => string | null }>) => string[]) => Promise<string[]>;
  $eval: (selector: string, pageFunction: (el: { textContent: string | null }) => string) => Promise<string>;
  screenshot: (opts: { fullPage: boolean; type: "jpeg"; quality: number; encoding: "base64" }) => Promise<string>;
};

async function getCaptureBrowser(): Promise<Browser> {
  if (captureBrowser) {
    try {
      await captureBrowser.version();
      return captureBrowser;
    } catch {
      captureBrowser = null;
    }
  }
  captureBrowser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  });
  return captureBrowser;
}

export function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "::1") return true;
  const ip = net.isIP(h) ? h : "";
  if (!ip) return false;
  if (ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("169.254.")) return true;
  if (ip.startsWith("172.")) {
    const seg = Number(ip.split(".")[1] ?? -1);
    if (seg >= 16 && seg <= 31) return true;
  }
  return false;
}

function uniqueMatches(re: RegExp, text: string, limit = 25): string[] {
  const out = new Set<string>();
  const all = text.match(re) ?? [];
  for (const m of all) {
    if (out.size >= limit) break;
    out.add(m.trim());
  }
  return [...out];
}

export function extractApkIocsFromText(text: string): {
  urls: string[];
  domains: string[];
  ips: string[];
  phones: string[];
  emails: string[];
  wallets: string[];
} {
  return {
    urls: uniqueMatches(/\bhttps?:\/\/[^\s"'<>\\]{6,}/g, text),
    domains: uniqueMatches(/\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}\b/gi, text),
    ips: uniqueMatches(/\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b/g, text),
    phones: uniqueMatches(/(?:\+?91|0)?[6-9]\d{9}/g, text),
    emails: uniqueMatches(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, text),
    wallets: uniqueMatches(/\b0x[a-fA-F0-9]{40}\b/g, text),
  };
}

export async function collectWebsiteCaptureData(
  page: WebsiteCapturePageLike,
  input: { url: string; reason: string },
): Promise<{
  rawText: string;
  data: {
    url: string;
    reason: string;
    title: string;
    links: string[];
    textSample: string;
    screenshotBase64: string;
  };
}> {
  const title = await page.title();
  const hrefs = await page.$$eval("a[href]", (anchors) =>
    anchors
      .map((a) => a.getAttribute("href") || "")
      .filter(Boolean)
      .slice(0, 30),
  );
  const textSample = await page.$eval("body", (el) => (el.textContent || "").slice(0, 3000));
  const shot = await page.screenshot({ fullPage: true, type: "jpeg", quality: 82, encoding: "base64" });
  return {
    rawText: `Captured ${input.url} (${title || "untitled"}). Extracted ${hrefs.length} links.`,
    data: {
      url: input.url,
      reason: input.reason,
      title,
      links: hrefs,
      textSample,
      screenshotBase64: shot,
    },
  };
}

function buildApkPreviewB64(evidenceId: string, counts: Record<string, number>): string {
  const esc = (s: string) => s.replace(/[<>&"']/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="280">
<rect width="100%" height="100%" fill="#0b1220"/>
<rect x="24" y="24" width="752" height="232" rx="14" fill="#111827" stroke="#334155"/>
<text x="44" y="74" fill="#e2e8f0" font-size="28" font-family="Arial, sans-serif">APK IOC Summary</text>
<text x="44" y="112" fill="#93c5fd" font-size="20" font-family="Arial, sans-serif">Evidence: ${esc(evidenceId)}</text>
<text x="44" y="158" fill="#e5e7eb" font-size="18" font-family="Arial, sans-serif">URLs ${counts.urls}  |  Domains ${counts.domains}  |  IPs ${counts.ips}</text>
<text x="44" y="192" fill="#e5e7eb" font-size="18" font-family="Arial, sans-serif">Phones ${counts.phones}  |  Emails ${counts.emails}  |  Wallets ${counts.wallets}</text>
</svg>`;
  return Buffer.from(svg).toString("base64");
}

export const searchUsernameTool: AgentTool<{ username: string }, Record<string, unknown>> = {
  name: "search_username",
  description:
    "Search a username/alias across many platforms to find profiles. Use when a suspect handle is found in evidence or returned by another tool. Prefer screenshots for documentation.",
  inputSchema: z.object({
    username: z.string().min(1).describe("Username/alias to search without @"),
  }),
  execute: async (input) => {
    const cleaned = input.username.replace(/^@/, "").trim();
    if (!/^[A-Za-z0-9_.-]{3,32}$/.test(cleaned)) {
      return {
        success: false,
        rawText: `Username ${input.username} failed basic format validation.`,
        confidence: ConfidenceScore.UNVERIFIED,
        error: "INVALID_USERNAME",
        data: { username: cleaned, note: "invalid-format" },
      };
    }

    const candidates = [
      { platform: "Telegram", url: `https://t.me/${cleaned}` },
      { platform: "GitHub", url: `https://github.com/${cleaned}` },
      { platform: "Instagram", url: `https://instagram.com/${cleaned}` },
      { platform: "X", url: `https://x.com/${cleaned}` },
      { platform: "Facebook", url: `https://facebook.com/${cleaned}` },
      { platform: "LinkedIn", url: `https://linkedin.com/in/${cleaned}` },
    ];
    const checks = await Promise.all(
      candidates.map(async (c) => {
        try {
          const r = await safeHttp.get(c.url, {
            timeout: 6000,
            maxRedirects: 2,
            validateStatus: (s) => s >= 200 && s < 500,
          });
          return {
            ...c,
            status: r.status,
            likelyExists: r.status >= 200 && r.status < 400,
          };
        } catch {
          return { ...c, status: null, likelyExists: false };
        }
      }),
    );
    const hits = checks.filter((c) => c.likelyExists);
    return {
      success: true,
      rawText: `Username ${cleaned}: likely profiles=${hits.length}/${checks.length}.`,
      confidence: hits.length >= 2 ? ConfidenceScore.MEDIUM : ConfidenceScore.LOW,
      data: {
        username: cleaned,
        checks,
        likelyProfiles: hits.map((h) => h.url),
        telegramHandle: `@${cleaned}`,
      },
    };
  },
  shouldScreenshot: true,
  tier: "DOCKER",
  requiresKey: null,
};

export const analyzeApkTool: AgentTool<{ evidenceId: string }, Record<string, unknown>> = {
  name: "analyze_apk",
  description:
    "Analyse an APK evidence file to extract IOCs (URLs, IPs, phone numbers, keys, permissions). Use when an APK is submitted or discovered.",
  inputSchema: z.object({
    evidenceId: z.string().min(1).describe("Evidence ID of APK file"),
  }),
  execute: async (input, ctx) => {
    const ev = await EvidenceHash.findOne({
      _id: input.evidenceId,
      caseId: ctx.caseId,
    }).select("+minioPath");
    if (!ev) {
      return {
        success: false,
        rawText: `APK evidence ${input.evidenceId} not found in case ${ctx.caseId}.`,
        confidence: ConfidenceScore.UNVERIFIED,
        error: "EVIDENCE_NOT_FOUND",
        data: { evidenceId: input.evidenceId, note: "not-found" },
      };
    }
    const apkBytes = await storageService.readEvidence(ev.minioPath);
    const text = apkBytes.toString("latin1");
    const { urls, domains, ips, phones, emails, wallets } = extractApkIocsFromText(text);
    const findings =
      urls.length + domains.length + ips.length + phones.length + emails.length + wallets.length;
    const confidence =
      findings >= 20 ? ConfidenceScore.HIGH : findings >= 5 ? ConfidenceScore.MEDIUM : ConfidenceScore.LOW;
    return {
      success: true,
      rawText: `APK ${ev.fileName}: urls=${urls.length}, domains=${domains.length}, ips=${ips.length}, phones=${phones.length}, emails=${emails.length}, wallets=${wallets.length}.`,
      confidence,
      data: {
        evidenceId: input.evidenceId,
        fileName: ev.fileName,
        analysis: {
          urls,
          domains,
          ips,
          phones,
          emails,
          wallets,
          screenshotBase64: buildApkPreviewB64(input.evidenceId, {
            urls: urls.length,
            domains: domains.length,
            ips: ips.length,
            phones: phones.length,
            emails: emails.length,
            wallets: wallets.length,
          }),
        },
      },
    };
  },
  shouldScreenshot: true,
  tier: "DOCKER",
  requiresKey: null,
};

export const lookupTelegramIdTool: AgentTool<{ telegramId: string }, { telegramId: string; note: string }> = {
  name: "lookup_telegram_id",
  description:
    "Look up a Telegram user/channel identifier using a Playwright sidecar (TGStat). Use when Telegram identifiers appear in evidence.",
  inputSchema: z.object({
    telegramId: z.string().min(1).describe("Telegram numeric user ID or username"),
  }),
  execute: async (input) => {
    const res = await enrichTelegramEntity(input.telegramId);
    return {
      success: Boolean(res.success),
      data: res.data ? ({ ...res.data, flags: res.flags, source: res.source } as any) : ({ telegramId: input.telegramId } as any),
      rawText: `Telegram ${input.telegramId}: success=${res.success} confidence=${ConfidenceScore[res.confidence]} source=${res.source}.`,
      confidence: res.confidence ?? ConfidenceScore.UNVERIFIED,
      error: res.success ? undefined : res.error,
    };
  },
  shouldScreenshot: true,
  tier: "DOCKER",
  requiresKey: null,
};

export const captureWebsiteTool: AgentTool<{ url: string; reason: string }, Record<string, unknown>> = {
  name: "capture_website",
  description:
    "Capture a full-page screenshot + visible text/links for a URL to document evidence. Use for any suspicious URL found in evidence.",
  inputSchema: z.object({
    url: z.string().url().describe("Full URL including https://"),
    reason: z.string().min(1).describe("Why this URL is captured"),
  }),
  execute: async (input) => {
    const parsed = new URL(input.url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return {
        success: false,
        rawText: `Unsupported URL protocol for website capture: ${parsed.protocol}`,
        confidence: ConfidenceScore.UNVERIFIED,
        error: "UNSUPPORTED_PROTOCOL",
        data: { url: input.url, note: "unsupported-protocol" },
      };
    }
    if (isBlockedHost(parsed.hostname)) {
      return {
        success: false,
        rawText: `Blocked local/private target for website capture: ${parsed.hostname}`,
        confidence: ConfidenceScore.UNVERIFIED,
        error: "BLOCKED_HOST",
        data: { url: input.url, note: "blocked-host" },
      };
    }
    const browser = await getCaptureBrowser();
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1280, height: 720 });
      await page.goto(input.url, { waitUntil: "domcontentloaded", timeout: 20_000 });
      await new Promise<void>((resolve) => setTimeout(resolve, 1500));
      const collected = await collectWebsiteCaptureData(page as unknown as WebsiteCapturePageLike, input);
      return {
        success: true,
        rawText: collected.rawText,
        confidence: ConfidenceScore.MEDIUM,
        data: collected.data,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        rawText: `Website capture failed for ${input.url}: ${message}`,
        confidence: ConfidenceScore.UNVERIFIED,
        error: message,
        data: { url: input.url, note: "capture-failed" },
      };
    } finally {
      await page.close();
    }
  },
  shouldScreenshot: true,
  tier: "DOCKER",
  requiresKey: null,
};
