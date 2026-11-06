import { Router } from "express";
import authRouter from "./auth";
import casesRouter from "./cases";
import triageRouter from "./triage";
import osintRouter from "./osint";
import escalationRouter from "./escalation";
import notificationsRouter from "./notifications";
import adminRouter from "./admin";
import dispatchWebhookRouter from "./dispatchWebhook";
import threatGraphRouter from "./threatGraph";
import supportRouter from "./support";
import { authenticate, authorize, optionalAuth } from "../middleware/auth";
import { globalLimiter, authLimiter } from "../middleware/rateLimiter";
import { ANALYST_ROLES, SENIOR_ANALYST_ROLES, ADMIN_ROLES } from "../models";

const router = Router();

// Global rate limiter applied to all routes
router.use(globalLimiter);

// Dispatch webhook intake — PUBLIC, HMAC-authenticated. Mounted before
// /osint so the auth middleware on /osint doesn't intercept it.
router.use("/dispatch-webhook", dispatchWebhookRouter);

// Public routes with stricter rate limiting
router.use("/auth", authLimiter, authRouter);

// Case submission is public (optional JWT links complaint to account).
router.use("/cases", optionalAuth, casesRouter);

// Triage is public (used during submission)
router.use("/triage", triageRouter);

// OSINT — requires ANALYST role or above
router.use("/osint", authenticate, authorize(...ANALYST_ROLES), osintRouter);

// Threat-intelligence graph (cross-case) — ANALYST role or above
router.use(
  "/threat-graph",
  authenticate,
  authorize(...ANALYST_ROLES),
  threatGraphRouter,
);

// Escalation — requires SENIOR_ANALYST or above
router.use(
  "/escalation",
  authenticate,
  authorize(...SENIOR_ANALYST_ROLES),
  escalationRouter,
);

// Notifications — requires ANALYST role or above
router.use(
  "/notifications",
  authenticate,
  authorize(...ANALYST_ROLES),
  notificationsRouter,
);

// Victim support directory + bookings (auth enforced per-route)
router.use("/support", supportRouter);

// Admin panel — ADMIN only
router.use("/admin", authenticate, authorize(...ADMIN_ROLES), adminRouter);

export default router;
