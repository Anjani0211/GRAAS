import { logger } from "../utils/logger";
import { CaseClassificationZ, type CaseClassification } from "../types/investigationMemory";
import type { EvidenceCorpus } from "./evidenceCorpus";
import { getLlmModel, getOpenAIClient, isLlmConfigured } from "../services/llmClient";

const CLASSIFICATION_SYSTEM_PROMPT = `You are a senior cybercrime investigator.
Your task is to read the victim's evidence and:
1) Classify the scam type
2) Explain reasoning with specific textual indicators (quotes)
3) Provide an investigation strategy (plain text)
4) Provide a priority list of tool names to call first (snake_case)

Output ONLY valid JSON matching this schema:
{
  "primaryType": "TASK_FRAUD|INVESTMENT_FRAUD|KYC_FRAUD|SEXTORTION|LOAN_APP_FRAUD|OTHER",
  "confidence": 0.0,
  "indicators": ["..."],
  "strategy": "...",
  "priorityTools": ["lookup_phone", "lookup_upi"]
}

Rules:
- Do not invent facts.
- Use exact snippets from evidence in indicators[].
- If evidence is insufficient, set primaryType=OTHER and confidence low.
`;

/** Strip markdown fences and isolate a JSON object from model prose. */
function extractJson(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenced) return fenced[1]!.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function buildUserPrompt(corpus: EvidenceCorpus): string {
  const ocr = corpus.imageOcrTexts
    .map((i) => `[${i.fileName}]\n${i.text.slice(0, 4000)}`)
    .join("\n\n");
  const audio = corpus.audioTranscripts
    .map((a) => `[${a.fileName}]\n${a.text.slice(0, 4000)}`)
    .join("\n\n");

  return `CASE ID: ${corpus.caseId}

COMPLAINT + TEXT EVIDENCE:
${corpus.complaintText.slice(0, 20_000)}

OCR FROM IMAGES:
${ocr || "(none)"}

AUDIO TRANSCRIPTS:
${audio || "(none)"}

APK FILES:
${corpus.apkFiles.map((a) => `${a.fileName} (${a.evidenceId})`).join("\n") || "(none)"}
`;
}

/** Keyword-based fallback when the local model returns prose instead of JSON. */
function classifyHeuristic(corpus: EvidenceCorpus): CaseClassification | null {
  const text = corpus.complaintText.toLowerCase();
  const indicators: string[] = [];

  if (/upi|smishing|collect request|imps|debit|yes bank|paytm/i.test(text)) {
    if (text.includes("upi")) indicators.push("UPI payment rail mentioned in evidence");
    if (text.includes("smishing") || text.includes("sms")) indicators.push("Smishing / SMS vector");
    if (text.includes("collect")) indicators.push("UPI collect request pattern");
    return CaseClassificationZ.parse({
      primaryType: "KYC_FRAUD",
      confidence: 0.72,
      indicators,
      strategy:
        "Prioritize fraudster phone, UPI/bank settlement trail (IFSC/RRN), and cross-case correlation on shared VPAs.",
      priorityTools: ["lookup_phone", "lookup_upi", "whois_domain"],
    });
  }
  if (/investment|trading|returns|profit/i.test(text)) {
    return CaseClassificationZ.parse({
      primaryType: "INVESTMENT_FRAUD",
      confidence: 0.65,
      indicators: ["Investment/trading language in complaint"],
      strategy: "Trace payment wallets, domains, and recruiter contact channels.",
      priorityTools: ["lookup_phone", "trace_crypto_wallet", "scan_url"],
    });
  }
  return null;
}

export async function classifyCase(corpus: EvidenceCorpus): Promise<CaseClassification> {
  const heuristic = classifyHeuristic(corpus);
  if (!isLlmConfigured()) {
    return (
      heuristic ??
      CaseClassificationZ.parse({
        primaryType: "OTHER",
        confidence: 0,
        indicators: [],
        strategy: "",
        priorityTools: [],
      })
    );
  }

  try {
    const client = getOpenAIClient();
    const prompt = buildUserPrompt(corpus);
    const response = await client.chat.completions.create({
      model: getLlmModel(),
      temperature: 0,
      max_tokens: 1024,
      messages: [
        { role: "system", content: CLASSIFICATION_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
    });

    const text = extractJson(response.choices[0]?.message?.content ?? "{}");
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const allowed = new Set([
      "TASK_FRAUD",
      "INVESTMENT_FRAUD",
      "KYC_FRAUD",
      "SEXTORTION",
      "LOAN_APP_FRAUD",
      "OTHER",
    ]);
    const rawType = String(parsed.primaryType ?? "OTHER").toUpperCase().replace(/\s+/g, "_");
    if (!allowed.has(rawType)) parsed.primaryType = "OTHER";
    else parsed.primaryType = rawType;
    return CaseClassificationZ.parse(parsed);
  } catch (err) {
    logger.warn({ err }, "[Agent] classifyCase failed — using heuristic fallback if available");
    if (heuristic) return heuristic;
    return CaseClassificationZ.parse({
      primaryType: "OTHER",
      confidence: 0,
      indicators: [],
      strategy: "",
      priorityTools: [],
    });
  }
}
