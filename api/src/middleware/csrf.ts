import { Request, Response, NextFunction } from "express";
import { config, isOriginAllowed } from "../config";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Cookie-auth CSRF mitigation for browser clients:
 * - Allow requests with no cookie (Bearer-only / public)
 * - For cookie-authenticated mutating requests, require Origin/Referer match
 *   OR custom header `X-Graas-Client: 1` (cannot be set by cross-site form posts)
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  const hasAuthCookie = Boolean(cookies?.graas_token);
  if (!hasAuthCookie) {
    next();
    return;
  }

  const clientHeader = String(req.headers["x-graas-client"] ?? "");
  if (clientHeader === "1") {
    next();
    return;
  }

  const origin = String(req.headers.origin ?? "").replace(/\/$/, "");
  if (origin && isOriginAllowed(origin)) {
    next();
    return;
  }

  const referer = String(req.headers.referer ?? "");
  if (referer) {
    try {
      if (isOriginAllowed(new URL(referer).origin)) {
        next();
        return;
      }
    } catch {
      /* malformed Referer — fall through to the CSRF rejection below */
    }
  }

  // Dev convenience: same-host without Origin (curl / health tools with cookie)
  if (config.nodeEnv !== "production" && !origin && !referer) {
    next();
    return;
  }

  res.status(403).json({
    error: "CSRF check failed — send Origin matching CORS_ORIGIN or X-Graas-Client: 1",
    code: "CSRF_REJECTED",
  });
}
