import { Router, Request, Response } from "express";
import { z } from "zod";
import { User, ADMIN_ROLES } from "../models";
import {
  authenticate,
  optionalAuth,
  signToken,
  blockToken,
  setAuthCookie,
  clearAuthCookie,
} from "../middleware/auth";
import { logEvent, hashIp } from "../services/auditLog";
import { logger } from "../utils/logger";
import { buildCaseInsensitiveEmailQuery, normalizeEmailForLookup } from "../utils/authUtils";
import {
  applyFailedLoginAttempt,
  clearLockout,
  isAccountLocked,
} from "../utils/authLockout";

const router = Router();

const RegisterSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  phone: z.string().optional(),
  badgeId: z.string().optional(),
  role: z
    .enum([
      "victim",
      "intake_officer",
      "osint_analyst",
      "case_manager",
      "legal_team",
      "senior_analyst",
      "le_portal",
      "admin",
      "super_admin",
    ])
    .default("victim"),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * POST /auth/register
 * Public → forced victim. Admin JWT/cookie → any role.
 */
router.post("/register", optionalAuth, async (req: Request, res: Response) => {
  try {
    const isAdminRequest = !!(req.auth && ADMIN_ROLES.includes(req.auth.role as never));

    if (req.auth && !isAdminRequest) {
      res.status(403).json({ error: "Insufficient role" });
      return;
    }

    const creatorId = isAdminRequest ? req.auth!.userId : "public";
    const raw = RegisterSchema.parse(req.body);
    const data = isAdminRequest ? raw : { ...raw, role: "victim" as const };
    const normalizedEmail = normalizeEmailForLookup(data.email);

    const existing = await User.findOne(buildCaseInsensitiveEmailQuery(normalizedEmail)).maxTimeMS(5000).lean();
    if (existing) {
      res.status(409).json({ error: "Email already registered" });
      return;
    }

    if (data.badgeId?.trim()) {
      const badgeTaken = await User.findOne({ badgeId: data.badgeId.trim() }).lean();
      if (badgeTaken) {
        res.status(409).json({ error: "Badge ID already in use" });
        return;
      }
    }

    const user = await User.create({
      ...data,
      email: normalizedEmail,
      badgeId: data.badgeId?.trim() || undefined,
    });

    if (creatorId !== "public") {
      await logEvent({
        userId: creatorId,
        action: "USER_CREATED",
        resourceId: user.id as string,
        outcome: "SUCCESS",
        ip: req.ip ?? "unknown",
        metadata: { role: data.role, email: data.email },
      });
    }

    logger.info({ userId: user.id, role: user.role, createdBy: creatorId }, "[Auth] New user registered");

    const token = signToken(user.id as string, user.role);
    setAuthCookie(res, token);
    // Token still returned for API clients; browsers should rely on httpOnly cookie.
    res.status(201).json({ token, user: user.toJSON() });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Validation failed", details: err.issues });
      return;
    }
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: number }).code === 11000
    ) {
      res.status(409).json({ error: "Email or badge ID already registered" });
      return;
    }
    logger.error({ err }, "[Auth] Registration error");
    res.status(500).json({ error: "Registration failed" });
  }
});

/** POST /auth/login — JWT + lockout after 5 failed attempts (15 min). */
router.post("/login", async (req: Request, res: Response) => {
  try {
    const data = LoginSchema.parse(req.body);
    const normalizedEmail = normalizeEmailForLookup(data.email);

    const user = await User.findOne(buildCaseInsensitiveEmailQuery(normalizedEmail)).select("+password");

    if (!user || !user.isActive) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    if (isAccountLocked(user.lockedUntil) || user.isLocked()) {
      await logEvent({
        userId: user.id as string,
        action: "LOGIN_FAILED",
        outcome: "FAILURE",
        ip: req.ip ?? "unknown",
        metadata: { reason: "locked" },
      });
      res.status(423).json({
        error: "Account temporarily locked due to too many failed attempts. Try again later.",
      });
      return;
    }

    const valid = await user.comparePassword(data.password);

    if (!valid) {
      const next = applyFailedLoginAttempt({
        failedLoginAttempts: user.failedLoginAttempts ?? 0,
        lockedUntil: user.lockedUntil,
      });
      user.failedLoginAttempts = next.failedLoginAttempts;
      user.lockedUntil = next.lockedUntil;
      await user.save();

      await logEvent({
        userId: user.id as string,
        action: "LOGIN_FAILED",
        outcome: "FAILURE",
        ip: req.ip ?? "unknown",
      });
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const cleared = clearLockout();
    user.failedLoginAttempts = cleared.failedLoginAttempts;
    user.lockedUntil = cleared.lockedUntil;
    user.lastLoginAt = new Date();
    user.lastLoginIp = hashIp(req.ip ?? "unknown");
    await user.save();

    const token = signToken(user.id as string, user.role);

    await logEvent({
      userId: user.id as string,
      action: "LOGIN",
      outcome: "SUCCESS",
      ip: req.ip ?? "unknown",
    });

    logger.info({ userId: user.id, role: user.role }, "[Auth] Login successful");

    setAuthCookie(res, token);
    res.json({ token, user: user.toJSON() });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Validation failed", details: err.issues });
      return;
    }
    logger.error({ err }, "[Auth] Login error");
    res.status(500).json({ error: "Login failed" });
  }
});

/** POST /auth/logout — Invalidates the current token. */
router.post("/logout", authenticate, async (req: Request, res: Response) => {
  try {
    const cookieToken = (req as Request & { cookies?: Record<string, string> }).cookies?.graas_token;
    const headerToken = req.headers.authorization?.slice(7);
    const token = headerToken ?? cookieToken ?? "";
    if (token) await blockToken(token);

    clearAuthCookie(res);

    await logEvent({
      userId: req.auth!.userId,
      action: "LOGOUT",
      outcome: "SUCCESS",
      ip: req.ip ?? "unknown",
    });

    res.json({ message: "Logged out successfully" });
  } catch (err) {
    logger.error({ err }, "[Auth] Logout error");
    res.status(500).json({ error: "Logout failed" });
  }
});

/** GET /auth/me — Returns current user profile. */
router.get("/me", authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user ?? (await User.findById(req.auth!.userId).maxTimeMS(5000));
    if (!user || !user.isActive) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({ user: user.toJSON() });
  } catch (err) {
    logger.error({ err }, "[Auth] /me error");
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

/** GET /auth/users — ADMIN: list staff/victim accounts for Team page. */
router.get("/users", authenticate, async (req: Request, res: Response) => {
  try {
    if (!req.auth || !ADMIN_ROLES.includes(req.auth.role as never)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    const users = await User.find({ isActive: true })
      .select("name email role phone badgeId createdAt lastLoginAt")
      .sort({ createdAt: -1 })
      .lean();
    res.json({
      users: users.map((u) => ({
        id: String(u._id),
        name: u.name,
        email: u.email,
        role: u.role,
        phone: u.phone,
        badgeId: u.badgeId,
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt,
      })),
    });
  } catch (err) {
    logger.error({ err }, "[Auth] /users error");
    res.status(500).json({ error: "Failed to list users" });
  }
});

export default router;
