import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { config } from "../config";

/** Global limiter — 100 req/min per IP. */
export const globalLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMaxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests — please slow down" },
});

/** Auth routes — 10 req/min per IP (brute-force protection). */
export const authLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication attempts — please try again later" },
  skipSuccessfulRequests: false,
});

/**
 * Pipeline run — 5 req/min per authenticated user (req.auth after authenticate).
 * Falls back to IP if unauthenticated.
 */
export const pipelineLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: 5,
  keyGenerator: (req) => {
    const userId = req.auth?.userId;
    if (userId) return `pipeline:user:${userId}`;
    return `pipeline:ip:${ipKeyGenerator(req.ip ?? "unknown")}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Pipeline run rate limit reached — please wait before running again" },
});
