import { safeHttp } from "../../../utils/httpClient";

/**
 * Certificate Transparency names via the public crt.sh JSON endpoint.
 * Same free source TheHarvester and SpiderFoot use for hostnames. No API key.
 */
export function parseCertificateNames(rows: unknown, apex: string, limit = 40): string[] {
  if (!Array.isArray(rows)) return [];
  const apexL = apex.toLowerCase();
  const names = new Set<string>();
  for (const row of rows) {
    const nameValue = String((row as { name_value?: unknown })?.name_value ?? "");
    for (const part of nameValue.split(/\s+/)) {
      const host = part.trim().toLowerCase().replace(/^\*\./, "").replace(/\.$/, "");
      if (!host || host.includes("*") || host.includes("@")) continue;
      if (host !== apexL && !host.endsWith(`.${apexL}`)) continue;
      names.add(host);
      if (names.size >= limit) return [...names];
    }
  }
  return [...names];
}

export async function lookupCertificateHosts(apex: string): Promise<{ hosts: string[]; error?: string }> {
  const q = encodeURIComponent(`%.${apex}`);
  try {
    const response = await safeHttp.get<unknown>(`https://crt.sh/?q=${q}&output=json`, {
      timeout: 20_000,
      maxRedirects: 2,
      validateStatus: (status) => status >= 200 && status < 300,
      headers: { Accept: "application/json", "User-Agent": "GRAAS-OSINT/1.0" },
    });
    return { hosts: parseCertificateNames(response.data, apex) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { hosts: [], error: message.slice(0, 200) };
  }
}
