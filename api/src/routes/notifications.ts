import { Router, Request, Response } from "express";
import { z } from "zod";
import { Notification } from "../models";
import { logger } from "../utils/logger";
import { deliverNotification } from "../services/notificationDelivery";

const router = Router();

router.get("/recent", async (_req: Request, res: Response) => {
  try {
    const rows = await Notification.find()
      .sort({ sentAt: -1 })
      .limit(25)
      .populate("caseId", "caseNumber")
      .lean();

    const notifications = rows.map((n) => {
      const raw = n as {
        _id: unknown;
        caseId: unknown;
        channel: string;
        message: string;
        sentAt: Date;
        status: string;
        recipient: string;
      };
      const cid = raw.caseId as { _id?: unknown; caseNumber?: string } | null;
      const populated = cid && typeof cid === "object" && "caseNumber" in cid;
      const caseIdStr = populated && cid._id != null ? String(cid._id) : String(raw.caseId ?? "");
      const recipient = raw.recipient ?? "";
      const redacted =
        recipient.includes("@")
          ? recipient.replace(/^(.{2}).*(@.*)$/, "$1***$2")
          : recipient.length > 4
            ? `${"*".repeat(Math.max(0, recipient.length - 4))}${recipient.slice(-4)}`
            : "****";
      return {
        id: String(raw._id),
        caseId: caseIdStr,
        caseNumber: populated ? cid.caseNumber ?? "—" : "—",
        channel: raw.channel,
        message: raw.message.length > 120 ? `${raw.message.slice(0, 120)}…` : raw.message,
        recipient: redacted,
        sentAt: raw.sentAt,
        status: raw.status,
      };
    });

    res.json({ notifications });
  } catch {
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

const SendNotificationSchema = z.object({
  caseId: z.string().min(1),
  channel: z.enum(["sms", "email", "whatsapp"]),
  recipient: z.string().min(1),
  message: z.string().min(1),
  subject: z.string().optional(),
});

router.post("/send", async (req: Request, res: Response) => {
  try {
    const data = SendNotificationSchema.parse(req.body);

    const delivery = await deliverNotification({
      channel: data.channel,
      recipient: data.recipient,
      message: data.message,
      subject: data.subject ?? `GRAAS update — case ${data.caseId}`,
    });

    const status = delivery.delivered ? "sent" : "queued";
    const notification = await Notification.create({
      caseId: data.caseId,
      channel: data.channel,
      recipient: data.recipient,
      message: data.message,
      status,
    });

    logger.info(
      {
        notificationId: notification._id,
        channel: data.channel,
        status,
        provider: delivery.delivered ? delivery.provider : undefined,
        reason: delivery.delivered ? undefined : delivery.reason,
      },
      "[Notifications] Processed",
    );

    res.json({
      status,
      delivery: delivery.delivered
        ? { ok: true, provider: delivery.provider, providerId: delivery.providerId }
        : { ok: false, reason: delivery.reason },
      note: delivery.delivered
        ? "Message handed to provider."
        : `Stored as queued — ${delivery.reason}`,
      channel: data.channel,
      recipient: data.recipient,
      messagePreview:
        data.message.length > 100 ? data.message.slice(0, 100) + "..." : data.message,
      caseId: data.caseId,
      notificationId: notification._id,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Validation failed", details: err.issues });
      return;
    }
    res.status(500).json({ error: "Failed to process notification" });
  }
});

router.get("/history/:caseId", async (req: Request, res: Response) => {
  try {
    const notifications = await Notification.find({ caseId: req.params.caseId })
      .sort({ sentAt: -1 })
      .lean();

    res.json({
      caseId: req.params.caseId,
      notifications,
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch notification history" });
  }
});

export default router;
