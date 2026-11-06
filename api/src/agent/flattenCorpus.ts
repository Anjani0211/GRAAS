import type { EvidenceCorpus } from "./evidenceCorpus";

/** Flatten assembled corpus into LLM/regex extraction entries (one per source). */
export function flattenCorpusForAnalysis(corpus: EvidenceCorpus): Array<{ text: string; sourceFile: string }> {
  const entries: Array<{ text: string; sourceFile: string }> = [];

  const complaint = corpus.complaintText.trim();
  if (complaint) {
    const sections = complaint.split(/\n\n--- Evidence: /);
    const head = sections[0]?.trim();
    if (head) {
      entries.push({ text: head, sourceFile: "case_description_and_evidence" });
    }
    for (let i = 1; i < sections.length; i++) {
      const chunk = sections[i] ?? "";
      const nl = chunk.indexOf(" ---\n");
      if (nl === -1) continue;
      const fileName = chunk.slice(0, nl).trim();
      const text = chunk.slice(nl + 5).trim();
      if (text) entries.push({ text, sourceFile: fileName || `evidence_${i}` });
    }
  }

  for (const img of corpus.imageOcrTexts) {
    if (img.text.trim()) entries.push({ text: img.text, sourceFile: img.fileName });
  }
  for (const aud of corpus.audioTranscripts) {
    if (aud.text.trim()) entries.push({ text: aud.text, sourceFile: aud.fileName });
  }

  return entries;
}
