/**
 * Client-side OSINT helpers: IOC extraction and report scaffolding.
 * Complements mock /api/osint tool endpoints (whois, ip, urlscan, shodan).
 */

const IPV4_RE = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.|$)){4}\b/g;
const IPV6_RE = /\b(?:[0-9a-f]{1,4}:){2,}[0-9a-f]{1,4}\b/gi;
const DOMAIN_RE = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}\b/gi;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const URL_RE = /\bhttps?:\/\/[^\s<>"{}|\\^`[\]]+/gi;

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

export function extractIocFromText(text: string): {
  ipv4: string[];
  ipv6: string[];
  domains: string[];
  emails: string[];
  urls: string[];
} {
  const ipv4 = uniq((text.match(IPV4_RE) ?? []).map((s) => s.replace(/\.$/, "")));
  const ipv6 = uniq(text.match(IPV6_RE) ?? []);
  const domains = uniq(
    (text.match(DOMAIN_RE) ?? []).map((d) => d.toLowerCase()).filter((d) => !d.includes("@")),
  );
  const emails = uniq((text.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()));
  const urls = uniq((text.match(URL_RE) ?? []).map((u) => u.replace(/[.,;]+$/, "")));
  return { ipv4, ipv6, domains, emails, urls };
}

export function formatIocMarkdownBlock(text: string): string {
  const ioc = extractIocFromText(text);
  const lines: string[] = ["### Extracted IOCs (auto)", ""];
  if (ioc.urls.length) lines.push("**URLs**", ...ioc.urls.map((u) => `- ${u}`), "");
  if (ioc.domains.length) lines.push("**Domains**", ...ioc.domains.map((d) => `- ${d}`), "");
  if (ioc.ipv4.length) lines.push("**IPv4**", ...ioc.ipv4.map((ip) => `- ${ip}`), "");
  if (ioc.ipv6.length) lines.push("**IPv6**", ...ioc.ipv6.map((ip) => `- ${ip}`), "");
  if (ioc.emails.length) lines.push("**Emails**", ...ioc.emails.map((e) => `- ${e}`), "");
  if (lines.length <= 2) return "";
  return lines.join("\n");
}

export function buildOsintReportSkeleton(params: {
  caseNumber: string;
  categoryLabel: string;
  victimName: string;
  state?: string;
  district?: string;
  description: string;
}): string {
  return [
    `# OSINT Investigation Report`,
    ``,
    `**Case:** ${params.caseNumber}`,
    `**Category:** ${params.categoryLabel}`,
    `**Victim:** ${params.victimName}`,
    `**Location:** ${params.district || "—"}, ${params.state || "—"}`,
    ``,
    `## 1. Incident summary`,
    params.description.slice(0, 2000) + (params.description.length > 2000 ? "…" : ""),
    ``,
    `## 2. Evidence & OCR`,
    `_(Add artifact names and extracted text below.)_`,
    ``,
    `## 3. Technical findings`,
    `_(WHOIS, IP, URL reputation, Shodan — paste tool outputs.)_`,
    ``,
    `## 4. Timeline`,
    `| Date | Event |`,
    `|------|--------|`,
    ``,
    `## 5. Recommendations`,
    `- `,
    ``,
    `## 6. Analyst`,
    `- Name: `,
    `- Date: ${new Date().toLocaleDateString("en-IN")}`,
  ].join("\n");
}

export function simulateOcrFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "");
  return `[Simulated OCR — ${fileName}]\n\nExtracted placeholder text for "${base}". Replace with real OCR output or paste manually.`;
}
