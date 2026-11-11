const INFO_KEYS = ["Title", "Author", "Subject", "Creator", "Producer", "CreationDate", "ModDate"] as const;

function readPdfLiteral(text: string, key: string): string | null {
  const keyAt = text.indexOf(`/${key}`);
  if (keyAt < 0) return null;
  let i = keyAt + key.length + 1;
  while (i < text.length && /\s/.test(text[i]!)) i++;
  if (text[i] !== "(") return null;
  i++;
  let out = "";
  while (i < text.length && out.length < 200) {
    const ch = text[i]!;
    if (ch === "\\") {
      const next = text[i + 1];
      if (next) {
        out += next;
        i += 2;
        continue;
      }
    }
    if (ch === ")") break;
    out += ch;
    i++;
  }
  const cleaned = out.replace(/\s+/g, " ").trim();
  return cleaned || null;
}

/** Read the PDF Info dictionary (Author, Creator, timestamps) from a local file buffer. */
export function extractPdfInfo(buffer: Buffer): Record<string, string> {
  const window =
    buffer.length > 1_500_000
      ? Buffer.concat([buffer.subarray(0, 500_000), buffer.subarray(buffer.length - 200_000)])
      : buffer;
  const text = window.toString("latin1");
  const out: Record<string, string> = {};
  for (const key of INFO_KEYS) {
    const value = readPdfLiteral(text, key);
    if (value) out[key] = value;
  }
  return out;
}
