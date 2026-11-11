import { Router, Request, Response } from "express";
import { z } from "zod";
import { CATEGORIES } from "../models";
import { getLlmModel, getOpenAIClient, isLlmConfigured } from "../services/llmClient";
import { getEffectiveLlm } from "../services/runtimeSettings";
import { logger } from "../utils/logger";

const router = Router();

const TriageSchema = z.object({
  text: z.string().min(1),
  category: z.enum(CATEGORIES).optional(),
  monetaryLoss: z.number().optional(),
  complainantIsMinor: z.boolean().optional(),
  involvesMinor: z.boolean().optional(),
});

const HIGH_SEVERITY_KEYWORDS = [
  "suicide", "self-harm", "kill", "death threat", "blackmail",
  "sextortion", "child", "minor", "ransom", "kidnap",
];

const FINANCIAL_KEYWORDS = [
  "bank", "upi", "transaction", "otp", "account", "money",
  "debit", "credit", "transfer", "payment", "invest",
];

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  financial_fraud: FINANCIAL_KEYWORDS,
  cyberbullying: ["bully", "harass", "threat", "abuse", "stalk", "defam"],
  sextortion: ["intimate", "nude", "private photo", "blackmail", "sex"],
  deepfake: ["deepfake", "fake video", "ai generated", "morphed"],
  account_hacking: ["hack", "password", "unauthorized", "compromised", "breach"],
  identity_theft: ["identity", "impersonat", "aadhaar", "pan card", "forged"],
  phishing: ["phishing", "fake website", "fake email", "click link", "verify account"],
  corporate: ["business email", "ceo fraud", "invoice", "vendor", "corporate"],
};

const MINOR_KEYWORDS = ["child", "minor", "underage", "school student", "kid "];

function keywordTriage(data: z.infer<typeof TriageSchema>) {
  const textLower = data.text.toLowerCase();
  const flags: string[] = [];

  let severity: "high" | "medium" | "low" = "low";

  for (const keyword of HIGH_SEVERITY_KEYWORDS) {
    if (textLower.includes(keyword)) {
      severity = "high";
      if (["suicide", "self-harm", "kill"].includes(keyword)) {
        flags.push("self_harm_signal");
      }
      if (["blackmail", "sextortion", "ransom"].includes(keyword)) {
        flags.push("financial_urgency");
      }
      break;
    }
  }

  if (data.complainantIsMinor) {
    flags.push("complainant_is_minor");
    flags.push("possible_minor_involved");
    severity = "high";
  }
  if (data.involvesMinor) {
    flags.push("possible_minor_involved");
    severity = "high";
  }

  if (MINOR_KEYWORDS.some((k) => textLower.includes(k))) {
    if (!flags.includes("possible_minor_involved")) flags.push("possible_minor_involved");
    severity = "high";
  }

  if (data.monetaryLoss && data.monetaryLoss > 100000) {
    severity = "high";
    flags.push("high_value_loss");
  } else if (data.monetaryLoss && data.monetaryLoss > 10000) {
    if (severity !== "high") severity = "medium";
  }

  if (severity === "low") {
    for (const keyword of FINANCIAL_KEYWORDS) {
      if (textLower.includes(keyword)) {
        severity = "medium";
        break;
      }
    }
  }

  let category: (typeof CATEGORIES)[number] = data.category || "financial_fraud";
  let maxScore = 0;

  if (!data.category) {
    for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      const score = keywords.filter((kw) => textLower.includes(kw)).length;
      if (score > maxScore && (CATEGORIES as readonly string[]).includes(cat)) {
        maxScore = score;
        category = cat as (typeof CATEGORIES)[number];
      }
    }
  }

  const confidence = Math.min(0.95, 0.5 + maxScore * 0.1);
  return { category, severity, confidence, flags, engine: "keyword" as const };
}

async function llmTriage(data: z.infer<typeof TriageSchema>) {
  const client = getOpenAIClient();
  const response = await client.chat.completions.create({
    model: getLlmModel(),
    temperature: 0,
    max_tokens: 400,
    messages: [
      {
        role: "system",
        content: `You triage Indian cybercrime complaints for GRAAS.
Return ONLY JSON:
{
  "category": one of ${JSON.stringify(CATEGORIES)},
  "severity": "high"|"medium"|"low",
  "confidence": 0.0-1.0,
  "flags": string[]  // e.g. self_harm_signal, financial_urgency, possible_minor_involved, high_value_loss
}
Rules: do not invent facts; flag possible minors; high severity for sextortion/self-harm/large loss.`,
      },
      {
        role: "user",
        content: `Complaint:\n${data.text.slice(0, 6000)}\n\nSuggested category: ${data.category ?? "none"}\nMonetary loss INR: ${data.monetaryLoss ?? "unknown"}`,
      },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  const fenced = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  const jsonText = fenced ? fenced[1]!.trim() : raw.trim();
  const start = jsonText.indexOf("{");
  const end = jsonText.lastIndexOf("}");
  const slice = start !== -1 && end > start ? jsonText.slice(start, end + 1) : jsonText;
  const parsed = JSON.parse(slice) as {
    category?: string;
    severity?: string;
    confidence?: number;
    flags?: string[];
  };

  const category = CATEGORIES.includes(parsed.category as (typeof CATEGORIES)[number])
    ? (parsed.category as string)
    : data.category || "financial_fraud";
  const severity =
    parsed.severity === "high" || parsed.severity === "medium" || parsed.severity === "low"
      ? parsed.severity
      : "medium";
  const confidence =
    typeof parsed.confidence === "number"
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0.7;
  const flags = Array.isArray(parsed.flags) ? parsed.flags.map(String) : [];

  if (data.monetaryLoss && data.monetaryLoss > 100000 && !flags.includes("high_value_loss")) {
    flags.push("high_value_loss");
  }
  if (data.complainantIsMinor) {
    if (!flags.includes("complainant_is_minor")) flags.push("complainant_is_minor");
    if (!flags.includes("possible_minor_involved")) flags.push("possible_minor_involved");
  }
  if (data.involvesMinor && !flags.includes("possible_minor_involved")) {
    flags.push("possible_minor_involved");
  }
  const finalSeverity =
    data.complainantIsMinor || data.involvesMinor || flags.includes("possible_minor_involved")
      ? "high"
      : severity;

  return { category, severity: finalSeverity, confidence, flags, engine: "llm" as const };
}

router.post("/", async (req: Request, res: Response) => {
  try {
    const data = TriageSchema.parse(req.body);

    const llm = getEffectiveLlm();
    if (isLlmConfigured() && llm.isCloud) {
      try {
        const result = await llmTriage(data);
        res.json(result);
        return;
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "[Triage] LLM failed — keyword fallback",
        );
      }
    } else if (isLlmConfigured() && !llm.isCloud) {
      // Local small models are unreliable for structured triage — keep keyword, try LLM best-effort.
      try {
        const result = await llmTriage(data);
        res.json(result);
        return;
      } catch {
        /* keyword below */
      }
    }

    res.json(keywordTriage(data));
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Validation failed", details: err.issues });
      return;
    }
    res.status(500).json({ error: "Triage failed" });
  }
});

export default router;
