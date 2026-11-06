import fs from "fs";
import path from "path";
import type { Request, Response, NextFunction } from "express";
import { logEvent } from "../services/auditLog";

const uploadsRoot = path.join(process.cwd(), "uploads");

/**
 * Serves files only under uploads/ after audit log. No direct static listing.
 * Replaces express.static("/uploads") — paths must not contain "..".
 */
export function serveUploads(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.status(405).end();
    return;
  }
  // Mounted at /uploads — req.path is e.g. /cases/foo.jpg or /evidence/GRS-2026/abc/file.jpg
  const rel = (req.path || "/").replace(/^\/+/, "");
  if (!rel || rel.includes("..")) {
    res.status(400).json({ error: "Invalid path" });
    return;
  }
  const abs = path.join(uploadsRoot, rel);
  if (!abs.startsWith(uploadsRoot)) {
    res.status(403).end();
    return;
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    res.status(404).end();
    return;
  }

  const userId = req.auth?.userId ?? "anonymous";
  logEvent({
    userId,
    action: "EVIDENCE_ACCESS",
    resourceId: rel,
    outcome: "SUCCESS",
    ip: req.ip ?? "unknown",
    metadata: { method: req.method, path: rel },
  }).catch(() => {/* fire-and-forget */});

  res.sendFile(abs, (err) => {
    if (err) next(err);
  });
}
