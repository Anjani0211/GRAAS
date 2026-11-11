import { safeHttp } from "../../../utils/httpClient";
import { extractFromHtml, mergeExtracts, type PageExtract } from "./pageExtract";

export interface SiteCrawlResult extends PageExtract {
  seedUrl: string;
  seedHost: string;
  pagesFetched: string[];
  errors: string[];
}

function sameHost(url: string, seedHost: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === seedHost || host.endsWith(`.${seedHost}`);
  } catch {
    return false;
  }
}

/**
 * Fetch a few public HTML pages on the seed host and extract contacts/links.
 * Stays on the target host. SSRF checks live in safeHttp.
 */
export async function crawlPublicSite(inputUrl: string, maxPages = 4): Promise<SiteCrawlResult> {
  const seed = new URL(inputUrl);
  const seedHost = seed.hostname.toLowerCase();
  const queue = [seed.href];
  const seen = new Set<string>();
  const pages: PageExtract[] = [];
  const pagesFetched: string[] = [];
  const errors: string[] = [];

  while (queue.length > 0 && pagesFetched.length < maxPages) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    if (!sameHost(url, seedHost)) continue;

    try {
      const response = await safeHttp.get<string>(url, {
        timeout: 8000,
        maxRedirects: 2,
        responseType: "text",
        maxContentLength: 400_000,
        validateStatus: (status) => status >= 200 && status < 400,
        headers: {
          "User-Agent": "GRAAS-OSINT/1.0 (public page extract)",
          Accept: "text/html,application/xhtml+xml",
        },
      });
      const html = typeof response.data === "string" ? response.data : "";
      if (!html) {
        errors.push(`${url}: empty body`);
        continue;
      }
      const extracted = extractFromHtml(html, url, seedHost);
      pages.push(extracted);
      pagesFetched.push(url);
      for (const link of extracted.internalLinks) {
        if (!seen.has(link) && queue.length < 20) queue.push(link);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${url}: ${message.slice(0, 180)}`);
    }
  }

  return {
    seedUrl: seed.href,
    seedHost,
    pagesFetched,
    errors: errors.slice(0, 8),
    ...mergeExtracts(pages),
  };
}
