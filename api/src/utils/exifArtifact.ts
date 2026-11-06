/* eslint-disable @typescript-eslint/no-require-imports */
const ExifParser = require("exif-parser") as {
  create: (b: Buffer) => { parse: () => { tags?: Record<string | number, unknown> } };
};

/**
 * Extract EXIF tags from image buffer (JPEG/TIFF). Returns null if none or parse fails.
 */
export function extractExifTags(buffer: Buffer): Record<string, unknown> | null {
  try {
    const parser = ExifParser.create(buffer);
    const result = parser.parse();
    const tags = result.tags;
    if (!tags || typeof tags !== "object") return null;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(tags)) {
      out[String(k)] = v;
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}
