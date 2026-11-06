/**
 * Dispatch webhook intake
 * ───────────────────────
 * Public endpoint for banks / CERT-In / NCRP / social platforms to confirm
 * receipt or acknowledgement of a previously dispatched packet. Closes the
 * loop without forcing an analyst to manually click "Mark acknowledged".
 *
 * Auth model: shared HMAC secret. Each provider signs the raw body with
 *   X-GRASS-Signature: sha256=<hex-digest>
 * using `DISPATCH_WEBHOOK_SECRET`. If the env var is unset, the route is
 * disabled (responds 404) so production deployments must opt in.
 *
 * Body shape:
 *   {
 *     "dispatchId": "<mongo id>",
 *     "recipientId": "<recipient id within the plan>",
 *     "status": "ACKED" | "REJECTED",
 *     "confirmationRef": "<provider ticket id>",
 *     "note": "optional human-readable note"
 *   }
 *
 * The route persists the status transition exactly like the analyst PATCH
 * path does, including the LE_CYBER → case lifecycle mirror.
 */
import crypto from "crypto";
import express, { Router, Request, Response } from "express";
import { z } from "zod";
import { Dispatch, Case } from "../models";
import { config } from "../config";
import { logEvent } from "../services/auditLog";
import { logger } from "../utils/logger";

const router = Router();

const WebhookBody = z.object({
  dispatchId: z.string().min(1),
  recipientId: z.string().min(1),
  status: z.enum(["ACKED", "REJECTED"]),
  confirmationRef: z.string().max(200).optional(),
  note: z.string().max(2000).optional(),
});

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

router.post(
  "/:provider",
  // Capture raw body for HMAC validation. We re-parse JSON ourselves below.
  express.raw({ type: "application/json", limit: "1mb" }),
  async (req: Request<{ provider: string }>, res: Response) => {
    try {
      if (!config.dispatchWebhookSecret) {
        // Webhook intake is gated by env. Don't leak existence of the route.
        res.status(404).json({ error: "Not found" });
        return;
      }

      const sigHeader = (req.header("X-GRASS-Signature") || "").trim();
      const match = /^sha256=([a-fA-F0-9]+)$/.exec(sigHeader);
      if (!match) {
        res.status(401).json({ error: "Missing or malformed signature" });
        return;
      }
      const claimed = match[1].toLowerCase();
      const rawBuf = Buffer.isBuffer(req.body) ? (req.body as Buffer) : Buffer.from("");
      const expected = crypto
        .createHmac("sha256", config.dispatchWebhookSecret)
        .update(rawBuf)
        .digest("hex");
      if (!constantTimeEqual(claimed, expected)) {
        res.status(401).json({ error: "Invalid signature" });
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBuf.toString("utf8"));
      } catch {
        res.status(400).json({ error: "Body is not valid JSON" });
        return;
      }
      const body = WebhookBody.parse(parsed);

      const plan = await Dispatch.findById(body.dispatchId);
      if (!plan) {
        res.status(404).json({ error: "Dispatch not found" });
        return;
      }
      const r = plan.recipients.find((x) => x.id === body.recipientId);
      if (!r) {
        res.status(404).json({ error: "Recipient not found" });
        return;
      }

      const prevStatus = r.status;
      r.status = body.status;
      if (body.confirmationRef) r.confirmationRef = body.confirmationRef;
      if (body.note) r.statusNote = body.note;
      r.lastTouchedBy = `webhook:${req.params.provider}`;
      r.lastTouchedAt = new Date();
      if (!r.dispatchedAt) r.dispatchedAt = new Date();

      const allSent = plan.recipients.every(
        (x) => x.status === "SENT" || x.status === "ACKED" || x.status === "SKIPPED",
      );
      const anySent = plan.recipients.some((x) => x.status === "SENT" || x.status === "ACKED");
      plan.rollupStatus = allSent && anySent
        ? "ALL_SENT"
        : anySent
          ? "PARTIALLY_SENT"
          : "DRAFT";
      plan.markModified("recipients");
      await plan.save();

      await logEvent({
        userId: `webhook:${req.params.provider}`,
        action: "LE_SUBMIT",
        resourceId: plan.caseId,
        outcome: "SUCCESS",
        ip: req.ip ?? "webhook",
        metadata: {
          webhookProvider: req.params.provider,
          dispatchId: String(plan.id),
          recipientId: r.id,
          recipientType: r.type,
          fromStatus: prevStatus,
          toStatus: r.status,
          confirmationRef: r.confirmationRef ?? "",
        },
      });

      // Mirror LE_CYBER acknowledgement onto the case lifecycle (matches the
      // analyst-side PATCH behaviour in dispatch.ts).
      if (r.type === "LE_CYBER" && body.status === "ACKED" && prevStatus !== "ACKED") {
        const caseDoc = await Case.findOne({ caseNumber: plan.caseId });
        if (caseDoc) {
          const inv = caseDoc.osintInvestigation;
          if (inv) {
            inv.leAgency = inv.leAgency || r.name;
            inv.submittedToLeAt = inv.submittedToLeAt ?? new Date();
            inv.leReferenceNumber = inv.leReferenceNumber || r.confirmationRef || "";
            inv.phase = "submitted_to_le";
            if (caseDoc.status === "osint" || caseDoc.status === "triaged") {
              caseDoc.status = "action_taken";
            }
            caseDoc.actions.push({
              actionType: "osint_le_submission",
              platformTarget: r.name,
              templateUsed: r.legalBasis,
              sentBy: `webhook:${req.params.provider}`,
              sentAt: new Date(),
              responseReceived: r.confirmationRef,
            });
            await caseDoc.save();
          }
        }
      }

      res.json({
        status: "ok",
        dispatchId: String(plan.id),
        recipientId: r.id,
        recipientStatus: r.status,
        rollup: plan.rollupStatus,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Validation failed", details: err.issues });
        return;
      }
      logger.error({ err }, "[DispatchWebhook] processing failed");
      res.status(500).json({ error: "Webhook processing failed" });
    }
  },
);

export default router;
