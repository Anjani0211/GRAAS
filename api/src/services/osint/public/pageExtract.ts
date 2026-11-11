/**
 * Photon-style extraction from HTML the caller already fetched.
 * Pulls emails, social profile links, document links, and in-scope hostnames.
 */

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const HREF_RE = /href\s*=\s*["']([^"'>\s]+)["']/gi;
const FILE_RE = /\.(?:pdf|docx?|xlsx?|pptx?|csv|zip|apk|txt)(?:$|[?#])/i;
const SOCIAL_HOSTS = [
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "github.com",
  "t.me",
  "telegram.me",
  "youtube.com",
  "tiktok.com",
  "pinterest.com",
  "reddit.com",
];

export interface PageExtract {
  emails: string[];
  socialLinks: string[];
  files: string[];
  subdomains: string[];
  internalLinks: string[];
  externalLinks: string[];
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function inScope(host: string, seedHost: string): boolean {
  return host === seedHost || host.endsWith(`.${seedHost}`);
}

function isSocial(host: string): boolean {
  return SOCIAL_HOSTS.some((s) => host === s || host.endsWith(`.${s}`));
}

function keepEmail(email: string): boolean {
  return !/\.(?:png|jpe?g|gif|svg|css|js|woff2?)$/i.test(email);
}

function pushCap(set: Set<string>, value: string, cap: number): void {
  if (set.size >= cap) return;
  set.add(value);
}

export function extractFromHtml(html: string, pageUrl: string, seedHost?: string): PageExtract {
  const seed = (seedHost ?? hostOf(pageUrl) ?? "").toLowerCase();
  const emails = new Set<string>();
  const socialLinks = new Set<string>();
  const files = new Set<string>();
  const subdomains = new Set<string>();
  const internalLinks = new Set<string>();
  const externalLinks = new Set<string>();

  for (const match of html.match(EMAIL_RE) ?? []) {
    const email = match.toLowerCase();
    if (keepEmail(email)) pushCap(emails, email, 25);
  }

  for (const match of html.matchAll(HREF_RE)) {
    const raw = match[1];
    if (!raw || raw.startsWith("mailto:") || raw.startsWith("javascript:") || raw.startsWith("#")) continue;
    let absolute: URL;
    try {
      absolute = new URL(raw, pageUrl);
    } catch {
      continue;
    }
    if (absolute.protocol !== "http:" && absolute.protocol !== "https:") continue;
    absolute.hash = "";
    const href = absolute.href;
    const host = absolute.hostname.toLowerCase();

    if (FILE_RE.test(absolute.pathname) || FILE_RE.test(href)) pushCap(files, href, 25);
    if (isSocial(host)) pushCap(socialLinks, href, 25);

    if (seed && inScope(host, seed)) {
      pushCap(internalLinks, href, 40);
      if (host !== seed) pushCap(subdomains, host, 25);
    } else {
      pushCap(externalLinks, href, 25);
    }
  }

  return {
    emails: [...emails],
    socialLinks: [...socialLinks],
    files: [...files],
    subdomains: [...subdomains],
    internalLinks: [...internalLinks],
    externalLinks: [...externalLinks],
  };
}

export function mergeExtracts(parts: PageExtract[]): PageExtract {
  const take = (key: keyof PageExtract, cap: number) => {
    const set = new Set<string>();
    for (const part of parts) {
      for (const value of part[key]) {
        if (set.size >= cap) break;
        set.add(value);
      }
    }
    return [...set];
  };
  return {
    emails: take("emails", 25),
    socialLinks: take("socialLinks", 25),
    files: take("files", 25),
    subdomains: take("subdomains", 25),
    internalLinks: take("internalLinks", 40),
    externalLinks: take("externalLinks", 25),
  };
}
