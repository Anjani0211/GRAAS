import crypto from "crypto";
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { User, type IUser, type UserRole } from "../models";
import { logger } from "../utils/logger";
import { redisClient } from "../utils/redisClient";

export interface AuthPayload {
  userId: string;
  role: UserRole;
}

declare global {
  namespace Express {
    interface Request {
      user?: IUser;
      auth?: AuthPayload;
    }
  }
}

const TOKEN_BLOCKLIST_PREFIX = "grass:token:blocked:";
/** Matches JWT expiry (8h) — blocklist entries auto-expire. */
const TOKEN_TTL_SECONDS = 8 * 60 * 60;

const localBlocklist = new Set<string>();

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export async function blockToken(token: string): Promise<void> {
  const tokenHash = hashToken(token);
  if (redisClient.isAvailable()) {
    await redisClient.getClient().set(`${TOKEN_BLOCKLIST_PREFIX}${tokenHash}`, "1", "EX", TOKEN_TTL_SECONDS);
    return;
  }
  localBlocklist.add(tokenHash);
  if (localBlocklist.size > 1000) {
    localBlocklist.clear();
    logger.warn("[Auth] In-memory token blocklist pruned (size cap)");
  }
  logger.warn("[Auth] Token blocklist using in-memory fallback (Redis unavailable)");
}

export async function isTokenBlocked(token: string): Promise<boolean> {
  const tokenHash = hashToken(token);
  if (redisClient.isAvailable()) {
    const result = await redisClient.getClient().get(`${TOKEN_BLOCKLIST_PREFIX}${tokenHash}`);
    return result !== null;
  }
  return localBlocklist.has(tokenHash);
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  const cookieToken = (req as Request & { cookies?: Record<string, string> }).cookies?.graas_token;
  return header?.startsWith("Bearer ") ? header.slice(7) : (cookieToken ?? null);
}

/**
 * Load active user from DB and attach live role (never trust JWT role alone).
 */
async function attachLiveUser(req: Request, userId: string): Promise<IUser | null> {
  const user = await User.findById(userId);
  if (!user || !user.isActive) return null;
  req.user = user;
  req.auth = { userId: String(user._id), role: user.role };
  return user;
}

/** Verify JWT, attach auth payload from DB. Returns 401 if invalid. */
export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractToken(req);

    if (!token) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    if (await isTokenBlocked(token)) {
      res.status(401).json({ error: "Token has been revoked" });
      return;
    }

    try {
      const payload = jwt.verify(token, config.jwtSecret) as AuthPayload;
      const user = await attachLiveUser(req, payload.userId);
      if (!user) {
        res.status(401).json({ error: "User not found or inactive" });
        return;
      }
      next();
    } catch (err) {
      logger.warn({ err }, "[Auth] Token verification failed");
      res.status(401).json({ error: "Invalid or expired token" });
    }
  } catch (err) {
    next(err);
  }
}

/**
 * Role-based access control middleware factory.
 * Returns 403 if the authenticated user's role is not in the allowed list.
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (allowedRoles.length > 0 && !allowedRoles.includes(req.auth.role)) {
      logger.warn({ userId: req.auth.userId, role: req.auth.role, required: allowedRoles }, "[Auth] Insufficient role");
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}

/** Alias kept for backward compatibility with existing routes. */
export const authorize = requireRole;

/**
 * HITL gate — returns 403 if the authenticated user has no badgeId.
 * Must be used after `authenticate` and `requireRole(SENIOR_ANALYST_ROLES)`.
 */
export function requireBadge(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const finish = (user: IUser | null | undefined) => {
    if (!user || !user.badgeId) {
      logger.warn({ userId: req.auth?.userId }, "[Auth] HITL gate blocked — no badge ID");
      res.status(403).json({ error: "Badge ID required for this action" });
      return;
    }
    req.user = user;
    next();
  };

  if (req.user) {
    finish(req.user);
    return;
  }

  User.findById(req.auth.userId)
    .then((user) => finish(user))
    .catch((err: unknown) => {
      logger.error({ err }, "[Auth] requireBadge DB error");
      res.status(500).json({ error: "Internal error during authorization" });
    });
}

export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractToken(req);

    if (!token || (await isTokenBlocked(token))) {
      next();
      return;
    }

    try {
      const payload = jwt.verify(token, config.jwtSecret) as AuthPayload;
      await attachLiveUser(req, payload.userId);
    } catch {
      // Invalid token — continue without auth
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function signToken(userId: string, role: UserRole): string {
  return jwt.sign({ userId, role } satisfies AuthPayload, config.jwtSecret, {
    expiresIn: (config.jwtExpiry as jwt.SignOptions["expiresIn"]) ?? "8h",
  });
}

export const AUTH_COOKIE_NAME = "graas_token";
export const AUTH_COOKIE_MAX_AGE_MS = 8 * 60 * 60 * 1000;

function authCookieOptions() {
  const secure = config.nodeEnv === "production";
  // Cross-site (Vercel UI → Render API) needs None+Secure; same-origin proxy can use Lax.
  const crossSite = process.env.AUTH_COOKIE_CROSS_SITE === "true";
  return {
    httpOnly: true,
    secure: crossSite ? true : secure,
    sameSite: (crossSite ? "none" : "lax") as "none" | "lax",
    maxAge: AUTH_COOKIE_MAX_AGE_MS,
    path: "/",
  };
}

export function setAuthCookie(res: Response, token: string): void {
  res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions());
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIE_NAME, authCookieOptions());
}
