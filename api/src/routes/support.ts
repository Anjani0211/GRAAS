import { Router, Request, Response } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { VictimSupport, Case, User } from "../models";
import { authenticate, authorize } from "../middleware/auth";
import { ANALYST_ROLES } from "../models";
import { logger } from "../utils/logger";
import { logEvent } from "../services/auditLog";

const router = Router();
const victimOnly = [authenticate, authorize("victim")] as const;
const staffOnly = [authenticate, authorize(...ANALYST_ROLES)] as const;

const PARTNERS = [
  {
    id: "adv-lakshmi-nair",
    name: "Adv. Lakshmi Nair",
    supportType: "legal" as const,
    specialization: "Cybercrime & Digital Law",
    available: true,
  },
  {
    id: "adv-rohit-malhotra",
    name: "Adv. Rohit Malhotra",
    supportType: "legal" as const,
    specialization: "Financial Fraud & Banking Law",
    available: true,
  },
  {
    id: "adv-sneha-iyer",
    name: "Adv. Sneha Iyer",
    supportType: "legal" as const,
    specialization: "Data Privacy & IT Act",
    available: false,
  },
  {
    id: "dr-anita-verma",
    name: "Dr. Anita Verma",
    supportType: "psychological" as const,
    specialization: "Trauma & Cyber Harassment",
    available: true,
  },
  {
    id: "dr-suresh-menon",
    name: "Dr. Suresh Menon",
    supportType: "psychological" as const,
    specialization: "Anxiety & Crisis Intervention",
    available: true,
  },
];

async function victimOwnsCase(userId: string, caseDoc: InstanceType<typeof Case>): Promise<boolean> {
  const user = await User.findById(userId);
  if (!user) return false;
  return (
    (caseDoc.victimUserId != null && caseDoc.victimUserId.toString() === userId) ||
    caseDoc.victimEmail.toLowerCase() === user.email.toLowerCase()
  );
}

/** Public directory of support partners (static, curated). */
router.get("/partners", (_req: Request, res: Response) => {
  res.json({ partners: PARTNERS });
});

const BookSchema = z.object({
  caseId: z.string().min(1).optional(),
  supportType: z.enum(["legal", "psychological"]),
  partnerId: z.string().min(1),
  scheduledAt: z.string().datetime().optional(),
  notes: z.string().max(2000).optional(),
  contactPreference: z.enum(["call", "video", "either"]).default("either"),
});

/** Victim books a support session. */
router.post("/bookings", ...victimOnly, async (req: Request, res: Response) => {
  try {
    const data = BookSchema.parse(req.body);
    const partner = PARTNERS.find((p) => p.id === data.partnerId);
    if (!partner) {
      res.status(404).json({ error: "Partner not found" });
      return;
    }
    if (!partner.available) {
      res.status(409).json({ error: "Partner is currently unavailable", code: "UNAVAILABLE" });
      return;
    }
    if (partner.supportType !== data.supportType) {
      res.status(400).json({ error: "supportType does not match partner" });
      return;
    }

    let caseObjectId: mongoose.Types.ObjectId | undefined;
    if (data.caseId) {
      const isOid = /^[a-f\d]{24}$/i.test(data.caseId);
      const caseDoc = isOid
        ? await Case.findById(data.caseId)
        : await Case.findOne({ caseNumber: data.caseId });
      if (!caseDoc) {
        res.status(404).json({ error: "Case not found" });
        return;
      }
      if (!(await victimOwnsCase(req.auth!.userId, caseDoc))) {
        res.status(403).json({ error: "You do not have access to this case" });
        return;
      }
      caseObjectId = caseDoc._id as mongoose.Types.ObjectId;
    }

    const booking = await VictimSupport.create({
      caseId: caseObjectId,
      victimUserId: new mongoose.Types.ObjectId(req.auth!.userId),
      supportType: data.supportType,
      advisorId: partner.id,
      partnerName: partner.name,
      scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : undefined,
      notes: data.notes,
      contactPreference: data.contactPreference,
      status: "requested",
    });

    await logEvent({
      userId: req.auth!.userId,
      action: "SUPPORT_BOOKING_CREATED",
      resourceId: String(booking._id),
      outcome: "SUCCESS",
      ip: req.ip ?? "unknown",
      metadata: { partnerId: partner.id, supportType: data.supportType },
    });

    logger.info({ bookingId: booking._id, partnerId: partner.id }, "[Support] Booking requested");

    res.status(201).json({ booking: booking.toJSON() });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Validation failed", details: err.issues });
      return;
    }
    res.status(500).json({ error: "Failed to create booking" });
  }
});

/** Victim lists own bookings. */
router.get("/bookings/mine", ...victimOnly, async (req: Request, res: Response) => {
  try {
    const rows = await VictimSupport.find({ victimUserId: req.auth!.userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.json({
      bookings: rows.map((r) => ({
        id: String(r._id),
        caseId: r.caseId ? String(r.caseId) : undefined,
        supportType: r.supportType,
        advisorId: r.advisorId,
        partnerName: r.partnerName,
        scheduledAt: r.scheduledAt,
        notes: r.notes,
        contactPreference: r.contactPreference,
        status: r.status,
        createdAt: (r as { createdAt?: Date }).createdAt,
      })),
    });
  } catch {
    res.status(500).json({ error: "Failed to list bookings" });
  }
});

/** Staff lists recent support bookings. */
router.get("/bookings", ...staffOnly, async (req: Request, res: Response) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const filter = status ? { status } : {};
    const rows = await VictimSupport.find(filter).sort({ createdAt: -1 }).limit(100).lean();
    res.json({ bookings: rows });
  } catch {
    res.status(500).json({ error: "Failed to list bookings" });
  }
});

const ResolveSchema = z.object({
  status: z.enum(["confirmed", "completed", "cancelled"]),
  notes: z.string().max(2000).optional(),
  scheduledAt: z.string().datetime().optional(),
});

router.patch("/bookings/:id", ...staffOnly, async (req: Request<{ id: string }>, res: Response) => {
  try {
    const data = ResolveSchema.parse(req.body);
    const booking = await VictimSupport.findById(req.params.id);
    if (!booking) {
      res.status(404).json({ error: "Booking not found" });
      return;
    }
    booking.status = data.status;
    if (data.notes !== undefined) booking.notes = data.notes;
    if (data.scheduledAt) booking.scheduledAt = new Date(data.scheduledAt);
    await booking.save();
    res.json({ booking: booking.toJSON() });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Validation failed", details: err.issues });
      return;
    }
    res.status(500).json({ error: "Failed to update booking" });
  }
});

export default router;
