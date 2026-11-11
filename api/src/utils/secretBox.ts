import crypto from "crypto";
import { config } from "../config";
import { logger } from "./logger";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

let warnedWeakKey = false;

function deriveKey(): Buffer {
  const dedicated = process.env.SETTINGS_ENCRYPTION_KEY?.trim();
  const material = dedicated || config.jwtSecret;
  if (!material) {
    throw new Error(
      "SETTINGS_ENCRYPTION_KEY or JWT_SECRET is required to encrypt platform settings",
    );
  }
  if (!dedicated && config.nodeEnv === "production" && !warnedWeakKey) {
    warnedWeakKey = true;
    logger.warn(
      "[Settings] SETTINGS_ENCRYPTION_KEY unset — deriving from JWT_SECRET. Set a dedicated key so JWT rotation does not brick stored secrets.",
    );
  }
  if (!dedicated && config.nodeEnv !== "production" && !warnedWeakKey) {
    warnedWeakKey = true;
    logger.warn(
      "[Settings] Using JWT_SECRET to encrypt settings in development. Prefer SETTINGS_ENCRYPTION_KEY.",
    );
  }
  return crypto.scryptSync(material, "graas-platform-settings-v1", 32);
}

/** Encrypt a UTF-8 secret → base64(iv | tag | ciphertext). */
export function sealSecret(plain: string): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, deriveKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

/** Decrypt a sealSecret() payload. Returns null if tampered/invalid. */
export function openSecret(sealed: string): string | null {
  try {
    const buf = Buffer.from(sealed, "base64");
    if (buf.length < IV_LEN + TAG_LEN + 1) return null;
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const data = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = crypto.createDecipheriv(ALGO, deriveKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Mask for UI: show last 4 chars only. */
export function maskSecret(plain: string): string {
  if (!plain) return "";
  if (plain.length <= 4) return "••••";
  return `••••${plain.slice(-4)}`;
}
