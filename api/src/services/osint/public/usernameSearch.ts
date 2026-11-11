import { safeHttp } from "../../../utils/httpClient";
import {
  USERNAME_SITES,
  classifyProfileResponse,
  profileUrl,
  type ProfileVerdict,
  type UsernameSite,
} from "./usernameSites";

export interface UsernameCheck {
  platform: string;
  url: string;
  status: number | null;
  verdict: ProfileVerdict;
}

const CONCURRENCY = 6;

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

async function checkSite(site: UsernameSite, username: string): Promise<UsernameCheck> {
  const url = profileUrl(site, username);
  try {
    const response = await safeHttp.get<string>(url, {
      timeout: 7000,
      maxRedirects: 2,
      responseType: "text",
      maxContentLength: 80_000,
      validateStatus: (status) => status < 500,
      headers: {
        "User-Agent": "GRAAS-OSINT/1.0 (public profile check)",
        Accept: "text/html",
      },
    });
    const body = typeof response.data === "string" ? response.data.slice(0, 12_000) : "";
    return {
      platform: site.name,
      url,
      status: response.status,
      verdict: classifyProfileResponse(site, response.status, body),
    };
  } catch {
    return { platform: site.name, url, status: null, verdict: "unknown" };
  }
}

/** Public username footprint. Does not use API keys or login sessions. */
export async function searchPublicProfiles(username: string): Promise<{
  username: string;
  checks: UsernameCheck[];
  likelyProfiles: string[];
}> {
  const checks = await mapPool(USERNAME_SITES, CONCURRENCY, (site) => checkSite(site, username));
  return {
    username,
    checks,
    likelyProfiles: checks.filter((c) => c.verdict === "found").map((c) => c.url),
  };
}
