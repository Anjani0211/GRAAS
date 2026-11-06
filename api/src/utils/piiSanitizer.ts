import crypto from "crypto";
import { logger } from "./logger";

/**
 * Mask a phone number to only the last 4 digits.
 * e.g. "+919876543210" → "******3210"
 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return "****";
  return "*".repeat(digits.length - 4) + digits.slice(-4);
}

/**
 * Mask an email address, preserving the first char and domain.
 * e.g. "suspect@gmail.com" → "s*******@gmail.com"
 */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "****";
  const masked = local.charAt(0) + "*".repeat(Math.max(local.length - 1, 3));
  return `${masked}@${domain}`;
}

/**
 * Mask a UPI ID, showing only the bank suffix.
 * e.g. "suspect@ybl" → "****@ybl"
 */
export function maskUpi(upi: string): string {
  const atIdx = upi.indexOf("@");
  if (atIdx === -1) return "****";
  return "****" + upi.slice(atIdx);
}

/**
 * Mask a crypto wallet address to first 4 + last 4 chars.
 * e.g. "bc1qxy2k..." → "bc1q...8xyz"
 */
export function maskWallet(address: string): string {
  if (address.length <= 8) return "****";
  return address.slice(0, 4) + "..." + address.slice(-4);
}

/**
 * SHA-256 hex of a value. Used when sending identifiers to non-Indian APIs
 * where sending raw PII is not permitted.
 */
export function hashValue(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Generic mask — detects type and applies appropriate masking.
 * Fallback: first 2 chars + **** + last 2 chars.
 */
export function mask(value: string): string {
  if (/^\+?[\d\s\-().]{7,15}$/.test(value)) return maskPhone(value);
  if (value.includes("@") && value.includes(".")) {
    if (/^[a-zA-Z0-9._\-]+@[a-zA-Z]{2,}$/.test(value)) return maskUpi(value);
    return maskEmail(value);
  }
  if (value.length <= 4) return "****";
  return value.slice(0, 2) + "*".repeat(Math.max(value.length - 4, 3)) + value.slice(-2);
}

/**
 * Hash an account number (UPI, bank account, etc.) for use with non-Indian APIs.
 * Returns the full SHA-256 hex string — deterministic but irreversible.
 */
export function hashAccountNumber(acc: string): string {
  return crypto.createHash("sha256").update(acc.trim(), "utf8").digest("hex");
}

/**
 * Strip EXIF metadata from a JPEG image buffer.
 *
 * JPEG EXIF is stored in APP1 segment (marker 0xFFE1).
 * This function removes ALL APP1 segments to eliminate EXIF, GPS, XMP data.
 * The file is returned with only the image data and non-APP1 segments intact.
 *
 * For PNG: EXIF can be in tEXt/iTXt/zTXt chunks. PNG stripping is not yet
 * implemented — the original buffer is returned with a warning.
 * Full implementation deferred to Phase 5 (MinIO intake pipeline).
 */
export function stripExif(imageBuffer: Buffer): Buffer {
  // Check for JPEG SOI marker (0xFFD8)
  if (imageBuffer.length < 4 || imageBuffer[0] !== 0xff || imageBuffer[1] !== 0xd8) {
    // Not JPEG — return original (PNG EXIF stripping: Phase 5)
    logger.debug("[PII] stripExif: non-JPEG buffer passed — returned unchanged");
    return imageBuffer;
  }

  const segments: Buffer[] = [];
  let offset = 2; // skip SOI

  // Always include JPEG SOI
  segments.push(imageBuffer.subarray(0, 2));

  while (offset < imageBuffer.length - 1) {
    // Every JPEG marker starts with 0xFF
    if (imageBuffer[offset] !== 0xff) break;

    const marker = imageBuffer[offset + 1];

    // SOF, SOS, EOI and similar markers without length fields
    if (marker === 0xd9 || marker === 0xda) {
      // SOS or EOI — rest of file is image data
      segments.push(imageBuffer.subarray(offset));
      break;
    }
    if (marker >= 0xd0 && marker <= 0xd9) {
      // RST markers — no length
      segments.push(imageBuffer.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }

    if (offset + 3 >= imageBuffer.length) break;
    const segLen = imageBuffer.readUInt16BE(offset + 2);

    // APP1 (0xFFE1) — EXIF/XMP — SKIP this segment
    if (marker === 0xe1) {
      logger.debug("[PII] stripExif: removed APP1 segment");
    } else {
      segments.push(imageBuffer.subarray(offset, offset + 2 + segLen));
    }

    offset += 2 + segLen;
  }

  return Buffer.concat(segments);
}
