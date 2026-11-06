import { Router, Request, Response } from "express";
import { z } from "zod";
import {
  Case,
  Dispatch,
  SENIOR_ANALYST_ROLES,
  type IDispatch,
  type IDispatchRecipient,
  type RecipientStatus,
} from "../models";
import { buildReport } from "../services/reportBuilder";
import { buildDispatchPlan, enrichRegistrarContacts } from "../services/entityDispatch";
import { fetchWhoisXml } from "../services/osintExternal";
import { generatePdf } from "../services/pdfService";
import { investigationReportFilename } from "../services/docxService";
import { requireRole, requireBadge } from "../middleware/auth";
import { logEvent } from "../services/auditLog";
import { logger } from "../utils/logger";

const router = Router();

function findCaseByParam(id: string) {
  const isObjectId = /^[a-f\d]{24}$/i.test(id);
  return isObjectId ? Case.findById(id) : Case.findOne({ caseNumber: id });
}

function recomputeRollup(recipients: IDispatchRecipient[]): IDispatch["rollupStatus"] {
  if (recipients.length === 0) return "DRAFT";
  const allSent = recipients.every((r) =>
    r.status === "SENT" || r.status === "ACKED" || r.status === "SKIPPED",
  );
  const anySent = recipients.some((r) => r.status === "SENT" || r.status === "ACKED");
  if (allSent && anySent) return "ALL_SENT";
  if (anySent) return "PARTIALLY_SENT";
  return "DRAFT";
}

/**
 * GET /osint/case/:caseId/investigation/dispatch
 * Returns the most recent dispatch plan for the case (any run).
 */
router.get(
  "/case/:caseId/investigation/dispatch",
  async (req: Request<{ caseId: string }>, res: Response) => {
    try {
      const doc = await findCaseByParam(req.params.caseId);
      if (!doc) {
        res.status(404).json({ error: "Case not found" });
        return;
      }
      const plan = await Dispatch.findOne({ caseId: doc.caseNumber })
        .sort({ updatedAt: -1 })
        .lean();
      if (!plan) {
        res.json({ dispatch: null, exists: false });
        return;
      }
      res.json({ dispatch: plan, exists: true });
    } catch (err) {
      logger.error({ err }, "[Dispatch] fetch failed");
      res.status(500).json({ error: "Failed to load dispatch plan" });
    }
  },
);

/**
 * POST /osint/case/:caseId/investigation/dispatch/plan
 * Body: { regenerate?: boolean }
 *
 * Derives the dispatch plan from the current (validated) GRASSReport. If
 * a plan already exists for the latest runId it is returned as-is unless
 * `regenerate: true` is supplied, which resets DRAFT recipients while
 * preserving any already-SENT recipients (chain of custody).
 */
const PlanBody = z.object({ regenerate: z.boolean().optional() });

router.post(
  "/case/:caseId/investigation/dispatch/plan",
  requireBadge,
  async (req: Request<{ caseId: string }>, res: Response) => {
    try {
      const body = PlanBody.parse(req.body ?? {});
      const doc = await findCaseByParam(req.params.caseId);
      if (!doc) {
        res.status(404).json({ error: "Case not found" });
        return;
      }
      const inv = doc.osintInvestigation;
      if (!inv?.lastRunId) {
        res
          .status(400)
          .json({ error: "Run the pipeline first — no investigation runId on this case" });
        return;
      }

      const u = req.user!;
      const report = await buildReport(doc, u.badgeId!, u.name, { redacted: false });
      const built = buildDispatchPlan(report, doc);
      // Best-effort: fill registrar abuse-contact emails via WHOIS so the
      // analyst does not have to do the lookup manually.
      built.recipients = await enrichRegistrarContacts(built.recipients, fetchWhoisXml);

      const existing = await Dispatch.findOne({ caseId: doc.caseNumber, runId: inv.lastRunId });
      if (existing && !body.regenerate) {
        res.json({
          dispatch: existing.toJSON(),
          regenerated: false,
          unrouted: built.unrouted,
        });
        return;
      }

      if (existing && body.regenerate) {
        // Preserve recipients already SENT / ACKED; replace others.
        const keep = existing.recipients.filter(
          (r) => r.status === "SENT" || r.status === "ACKED",
        );
        const keepTargets = new Set(keep.flatMap((r) => r.actionTargets));
        const fresh = built.recipients.filter(
          (r) => !r.actionTargets.every((t) => keepTargets.has(t)),
        );
        existing.recipients = [...keep, ...fresh];
        existing.generatedAt = new Date();
        existing.generatedBy = req.auth?.userId ?? "system";
        existing.rollupStatus = recomputeRollup(existing.recipients);
        await existing.save();

        await logEvent({
          userId: req.auth!.userId,
          action: "REPORT_FINALIZE",
          resourceId: doc.caseNumber,
          outcome: "SUCCESS",
          ip: req.ip ?? "unknown",
          metadata: { dispatch: "regenerated", recipients: existing.recipients.length },
        });

        res.json({
          dispatch: existing.toJSON(),
          regenerated: true,
          unrouted: built.unrouted,
        });
        return;
      }

      const created = await Dispatch.create({
        caseId: doc.caseNumber,
        runId: inv.lastRunId,
        generatedAt: new Date(),
        generatedBy: req.auth?.userId ?? "system",
        recipients: built.recipients,
        rollupStatus: recomputeRollup(built.recipients),
      });

      await logEvent({
        userId: req.auth!.userId,
        action: "REPORT_FINALIZE",
        resourceId: doc.caseNumber,
        outcome: "SUCCESS",
        ip: req.ip ?? "unknown",
        metadata: { dispatch: "created", recipients: built.recipients.length },
      });

      res.json({ dispatch: created.toJSON(), regenerated: true, unrouted: built.unrouted });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Validation failed", details: err.issues });
        return;
      }
      logger.error({ err }, "[Dispatch] plan generation failed");
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : "Dispatch plan generation failed" });
    }
  },
);

/**
 * PATCH /osint/case/:caseId/investigation/dispatch/:dispatchId/recipient/:recipientId
 * Body: { status?, statusNote?, confirmationRef?, contactEmail? }
 */
const PatchRecipientBody = z.object({
  status: z.enum(["DRAFT", "QUEUED", "SENT", "ACKED", "REJECTED", "SKIPPED"]).optional(),
  statusNote: z.string().max(2000).optional(),
  confirmationRef: z.string().max(200).optional(),
  contactEmail: z.string().email().max(200).optional(),
  contactPortal: z.string().max(500).optional(),
});

router.patch(
  "/case/:caseId/investigation/dispatch/:dispatchId/recipient/:recipientId",
  requireRole(...SENIOR_ANALYST_ROLES),
  requireBadge,
  async (
    req: Request<{ caseId: string; dispatchId: string; recipientId: string }>,
    res: Response,
  ) => {
    try {
      const body = PatchRecipientBody.parse(req.body);
      const doc = await findCaseByParam(req.params.caseId);
      if (!doc) {
        res.status(404).json({ error: "Case not found" });
        return;
      }
      const plan = await Dispatch.findOne({
        _id: req.params.dispatchId,
        caseId: doc.caseNumber,
      });
      if (!plan) {
        res.status(404).json({ error: "Dispatch plan not found" });
        return;
      }
      const r = plan.recipients.find((x) => x.id === req.params.recipientId);
      if (!r) {
        res.status(404).json({ error: "Recipient not found in dispatch plan" });
        return;
      }
      const prevStatus = r.status;
      if (body.status) r.status = body.status as RecipientStatus;
      if (body.statusNote !== undefined) r.statusNote = body.statusNote;
      if (body.confirmationRef !== undefined) r.confirmationRef = body.confirmationRef;
      if (body.contactEmail !== undefined) r.contactEmail = body.contactEmail;
      if (body.contactPortal !== undefined) r.contactPortal = body.contactPortal;
      r.lastTouchedBy = req.auth?.userId ?? "system";
      r.lastTouchedAt = new Date();
      if ((body.status === "SENT" || body.status === "ACKED") && !r.dispatchedAt) {
        r.dispatchedAt = new Date();
      }
      plan.rollupStatus = recomputeRollup(plan.recipients);
      plan.markModified("recipients");
      await plan.save();

      await logEvent({
        userId: req.auth!.userId,
        action: "LE_SUBMIT",
        resourceId: doc.caseNumber,
        outcome: "SUCCESS",
        ip: req.ip ?? "unknown",
        metadata: {
          dispatchId: plan.id,
          recipientId: r.id,
          recipientType: r.type,
          recipientName: r.name,
          fromStatus: prevStatus,
          toStatus: r.status,
          confirmationRef: r.confirmationRef ?? "",
        },
      });

      // If the LE_CYBER recipient just transitioned to SENT for the first time,
      // mirror the high-level "submitted_to_le" lifecycle on the investigation —
      // so downstream KPIs and audit views light up consistently with the
      // pre-existing /submit-le flow.
      if (
        r.type === "LE_CYBER" &&
        (body.status === "SENT" || body.status === "ACKED") &&
        prevStatus !== "SENT" &&
        prevStatus !== "ACKED"
      ) {
        const inv = doc.osintInvestigation;
        if (inv) {
          inv.leAgency = inv.leAgency || r.name;
          inv.submittedToLeAt = inv.submittedToLeAt ?? new Date();
          inv.phase = "submitted_to_le";
          if (doc.status === "osint" || doc.status === "triaged") {
            doc.status = "action_taken";
          }
          doc.actions.push({
            actionType: "osint_le_submission",
            platformTarget: r.name,
            templateUsed: r.legalBasis,
            sentBy: req.auth?.userId ?? "system",
            sentAt: new Date(),
            responseReceived: r.confirmationRef,
          });
          await doc.save();
        }
      }

      res.json({ dispatch: plan.toJSON() });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Validation failed", details: err.issues });
        return;
      }
      logger.error({ err }, "[Dispatch] patch recipient failed");
      res.status(500).json({ error: "Failed to update recipient" });
    }
  },
);

/**
 * GET .../dispatch/:dispatchId/recipient/:recipientId/eml
 * Returns the packet rendered as RFC 5322 .eml so analysts can open it in
 * their corporate mail client to actually dispatch (we do not auto-send;
 * legal/audit policy keeps a human in the loop).
 */
router.get(
  "/case/:caseId/investigation/dispatch/:dispatchId/recipient/:recipientId/eml",
  async (
    req: Request<{ caseId: string; dispatchId: string; recipientId: string }>,
    res: Response,
  ) => {
    try {
      const doc = await findCaseByParam(req.params.caseId);
      if (!doc) {
        res.status(404).json({ error: "Case not found" });
        return;
      }
      const plan = await Dispatch.findOne({
        _id: req.params.dispatchId,
        caseId: doc.caseNumber,
      }).lean();
      if (!plan) {
        res.status(404).json({ error: "Dispatch plan not found" });
        return;
      }
      const r = plan.recipients.find((x) => x.id === req.params.recipientId);
      if (!r) {
        res.status(404).json({ error: "Recipient not found" });
        return;
      }
      const to = r.contactEmail ?? "TBD@analyst-to-fill.invalid";
      // Recipients allowed to receive the FULL (un-redacted) report — only LE
      // and the regulator. Banks/telecoms/social/exchange get the redacted
      // version so cross-case correlation data isn't leaked outside LE chain.
      const fullPdfTypes = new Set(["LE_CYBER", "LE_NCRP", "CERT_IN"]);
      const redacted = !fullPdfTypes.has(r.type);
      let pdfBuffer: Buffer | null = null;
      try {
        const u = req.user;
        if (u?.badgeId && u?.name) {
          const report = await buildReport(doc, u.badgeId, u.name, { redacted });
          pdfBuffer = await generatePdf(report);
        }
      } catch (pdfErr) {
        logger.warn(
          { err: pdfErr, recipientId: r.id, redacted },
          "[Dispatch] PDF attachment skipped — proceeding with plain .eml",
        );
      }

      const pdfFilename = investigationReportFilename(doc.caseNumber, "pdf", redacted);

      let eml: string;
      if (pdfBuffer) {
        const boundary = ("GRASS-" + doc.caseNumber + "-" + r.id).replace(/[^A-Za-z0-9-]/g, "");
        const pdfB64 = pdfBuffer.toString("base64").match(/.{1,76}/g)?.join("\r\n") ?? "";
        eml = [
          "To: " + to,
          "Subject: " + r.subject,
          "X-GRASS-Case: " + doc.caseNumber,
          "X-GRASS-Recipient-Type: " + r.type,
          "X-GRASS-Legal-Basis: " + r.legalBasis,
          "X-GRASS-Priority: " + r.priority,
          "X-GRASS-Report-Redacted: " + (redacted ? "true" : "false"),
          "MIME-Version: 1.0",
          'Content-Type: multipart/mixed; boundary="' + boundary + '"',
          "",
          "--" + boundary,
          "Content-Type: text/plain; charset=UTF-8",
          "Content-Transfer-Encoding: 8bit",
          "",
          r.body,
          "",
          "--" + boundary,
          'Content-Type: application/pdf; name="' + pdfFilename + '"',
          "Content-Transfer-Encoding: base64",
          'Content-Disposition: attachment; filename="' + pdfFilename + '"',
          "",
          pdfB64,
          "",
          "--" + boundary + "--",
        ].join("\r\n");
      } else {
        eml = [
          "To: " + to,
          "Subject: " + r.subject,
          "X-GRASS-Case: " + doc.caseNumber,
          "X-GRASS-Recipient-Type: " + r.type,
          "X-GRASS-Legal-Basis: " + r.legalBasis,
          "X-GRASS-Priority: " + r.priority,
          "X-GRASS-Report-Attached: false",
          "Content-Type: text/plain; charset=UTF-8",
          "",
          r.body,
        ].join("\r\n");
      }

      res.setHeader("Content-Type", "message/rfc822; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="GRASS_' + doc.caseNumber + "_" + r.type + "_" + r.id + '.eml"',
      );
      res.send(eml);
    } catch (err) {
      logger.error({ err }, "[Dispatch] eml render failed");
      res.status(500).json({ error: "Failed to render eml" });
    }
  },
);

export default router;
