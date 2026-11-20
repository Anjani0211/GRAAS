import { Router, Request, Response } from "express";
import { z } from "zod";
import { Case } from "../models";
import { logEvent } from "../services/auditLog";
import { buildEscalationPack } from "../services/escalationPack";

const router = Router();

const EscalationSchema = z.object({
  caseId: z.string().min(1),
  actionType: z.string().min(1),
  platformTarget: z.string().optional(),
  templateUsed: z.string().optional(),
  note: z.string().max(2000).optional(),
});

const TEMPLATES: Record<string, { subject: string; body: string }> = {
  bank_freeze: {
    subject: "Urgent: Account Freeze Request - Case {case_number}",
    body: "Dear Sir/Madam,\n\nThis is an official request from the Cyber Crime Investigation Unit to immediately freeze the following account(s) in connection with case {case_number}.\n\nDetails of the suspicious transaction and beneficiary account are attached.\n\nPlease treat this as URGENT.\n\nRegards,\nGRAAS Investigation Unit",
  },
  takedown_social_media: {
    subject: "Content Takedown Request - Case {case_number}",
    body: "To Whom It May Concern,\n\nWe request the immediate removal of the following content which is part of an active cybercrime investigation (Case: {case_number}).\n\nContent URL(s): [URLs]\nNature of Violation: [Description]\n\nPlease confirm takedown within 24 hours.\n\nRegards,\nGRAAS Legal Team",
  },
  cert_in_report: {
    subject: "Incident Report to CERT-In - Case {case_number}",
    body: "Subject: Reporting Cyber Security Incident\n\nIncident Type: [Phishing/Malware/Data Breach]\nCase Reference: {case_number}\nAffected Domain/URL: [URL]\nTimestamp of Incident: [Date/Time]\n\nDescription: [Auto-filled from case description]\n\nRegards,\nGRAAS Automated Reporting System",
  },
  law_enforcement_alert: {
    subject: "Priority Alert: Cybercrime Escalation - Case {case_number}",
    body: "To the Superintendent of Police (Cyber Cell),\n\nThis is a priority escalation for case {case_number} involving [crime_type]. Immediate intervention is requested.\n\nVictim details and evidence package are attached.\n\nRegards,\nGRAAS Escalation Unit",
  },
};

function interpolate(
  template: { subject: string; body: string },
  caseNumber: string,
  category: string,
): { subject: string; body: string } {
  const sub = template.subject.split("{case_number}").join(caseNumber);
  const body = template.body
    .split("{case_number}")
    .join(caseNumber)
    .split("[crime_type]")
    .join(category.replace(/_/g, " "));
  return { subject: sub, body };
}

async function lookupCase(idOrNumber: string) {
  const isObjectId = /^[a-f\d]{24}$/i.test(idOrNumber);
  if (isObjectId) {
    return Case.findById(idOrNumber);
  }
  return Case.findOne({ caseNumber: idOrNumber });
}

router.post("/", async (req: Request, res: Response) => {
  try {
    const data = EscalationSchema.parse(req.body);
    const template = TEMPLATES[data.actionType];

    const doc = await lookupCase(data.caseId);
    if (!doc) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    const filled = template
      ? interpolate(template, doc.caseNumber, doc.category)
      : null;

    doc.actions.push({
      actionType: data.actionType,
      platformTarget: data.platformTarget,
      templateUsed: data.templateUsed ?? data.actionType,
      sentBy: req.auth?.userId ?? "system",
      sentAt: new Date(),
      responseReceived: data.note,
    });
    await doc.save();

    await logEvent({
      userId: req.auth?.userId ?? "system",
      action: "ESCALATION_DRAFT",
      resourceId: doc.caseNumber,
      outcome: "SUCCESS",
      ip: req.ip ?? "unknown",
      metadata: {
        escalationType: data.actionType,
        platformTarget: data.platformTarget ?? "",
        delivery: "manual",
      },
    });

    res.json({
      status: "recorded",
      delivery: "manual",
      actionType: data.actionType,
      template: filled,
      platformTarget: data.platformTarget,
      message: template
        ? `Escalation draft recorded for ${doc.caseNumber}. No outbound email was sent — use Dispatch panel or export the template.`
        : `Custom escalation action recorded for ${doc.caseNumber}. No outbound delivery was performed.`,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Validation failed", details: err.issues });
      return;
    }
    res.status(500).json({ error: "Escalation failed" });
  }
});

router.get("/templates", (_req: Request, res: Response) => {
  const templates = Object.entries(TEMPLATES).map(([id, val]) => ({
    id,
    subject: val.subject,
  }));
  res.json({ templates });
});

/** LE-ready pack: entities, hashes, related cases, portal deep-links — no outbound send. */
router.get("/pack/:caseId", async (req: Request, res: Response) => {
  try {
    const doc = await lookupCase(String(req.params.caseId));
    if (!doc) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    const pack = buildEscalationPack(doc);
    await logEvent({
      userId: req.auth?.userId ?? "system",
      action: "ESCALATION_PACK",
      resourceId: doc.caseNumber,
      outcome: "SUCCESS",
      ip: req.ip ?? "unknown",
      metadata: { entityCount: pack.entities.length, hashCount: pack.evidenceHashes.length },
    });
    res.json(pack);
  } catch {
    res.status(500).json({ error: "Failed to build escalation pack" });
  }
});

export default router;
