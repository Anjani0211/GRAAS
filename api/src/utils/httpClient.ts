import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from "axios";
import dns from "dns/promises";
import net from "net";
import { URL } from "url";
import { config } from "../config";

const PRIVATE_HOST_PATTERNS = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^0\./,
  /^169\.254\./,
  /^::1$/,
  /^localhost$/i,
  /^fc00:/i,
  /^fd[0-9a-f]{2}:/i,
  /^metadata\.google\.internal$/i,
];

function hostnameLooksPrivate(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "");
  return PRIVATE_HOST_PATTERNS.some((re) => re.test(h));
}

/** Block RFC1918 / loopback / link-local / ULA / CGNAT / metadata. */
export function isPrivateIpAddress(ip: string): boolean {
  const addr = ip.replace(/^\[|\]$/g, "");
  if (net.isIP(addr) === 4) {
    const parts = addr.split(".").map(Number);
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b !== undefined && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  if (net.isIP(addr) === 6) {
    const lower = addr.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
    if (lower.startsWith("fe80:")) return true; // link-local
    // IPv4-mapped
    if (lower.startsWith("::ffff:")) {
      const v4 = lower.slice(7);
      return isPrivateIpAddress(v4);
    }
    return false;
  }
  return true;
}

/**
 * Resolve the fully-qualified URL for SSRF checks (handles relative URLs + baseURL).
 */
function resolveRequestUrl(cfg: InternalAxiosRequestConfig): string {
  const raw = cfg.url ?? "";
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = cfg.baseURL ?? "";
  try {
    return new URL(raw, base || "http://invalid.local/").href;
  } catch {
    return raw;
  }
}

/** Hostname / literal IP private check (sync). */
export function isSsrfTarget(urlString: string): boolean {
  if (!config.ssrfProtectionEnabled) return false;
  try {
    const u = new URL(urlString);
    if (u.protocol !== "http:" && u.protocol !== "https:") return true;
    const host = u.hostname.replace(/^\[|\]$/g, "");
    if (hostnameLooksPrivate(host)) return true;
    if (net.isIP(host) && isPrivateIpAddress(host)) return true;
    return false;
  } catch {
    return true;
  }
}

/**
 * DNS-pinning SSRF check: resolve A/AAAA and reject if any address is private.
 * Fail closed on DNS errors.
 */
export async function isSsrfTargetAsync(urlString: string): Promise<boolean> {
  if (!config.ssrfProtectionEnabled) return false;
  if (isSsrfTarget(urlString)) return true;
  try {
    const u = new URL(urlString);
    const host = u.hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(host)) return isPrivateIpAddress(host);
    const results = await dns.lookup(host, { all: true, verbatim: true });
    if (!results.length) return true;
    return results.some((r) => isPrivateIpAddress(r.address));
  } catch {
    return true;
  }
}

/**
 * Axios instance that blocks requests to private / loopback hosts (SSRF mitigation),
 * including DNS rebinding via resolve-then-check.
 */
export function createSafeAxios(): AxiosInstance {
  const instance = axios.create({ timeout: 15_000 });
  instance.interceptors.request.use(async (reqConfig) => {
    const full = resolveRequestUrl(reqConfig);
    if (full && (await isSsrfTargetAsync(full))) {
      throw new Error(`SSRF_BLOCKED: ${full}`);
    }
    return reqConfig;
  });
  return instance;
}

export const safeHttp = createSafeAxios();

/** Internal services (e.g. Whisper) — URL comes only from env, not user input. */
export const internalHttp = axios.create({ timeout: 120_000 });
