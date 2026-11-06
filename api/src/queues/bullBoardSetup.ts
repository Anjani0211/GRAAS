import type { Express } from "express";
import { createBullBoard } from "@bull-board/api";
import { BullAdapter } from "@bull-board/api/bullAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { getPipelineQueue } from "./pipelineQueue";
import { authenticate, requireRole } from "../middleware/auth";
import { ADMIN_ROLES } from "../models";
import { logger } from "../utils/logger";

export function mountBullBoard(app: Express): void {
  const q = getPipelineQueue();
  if (!q) {
    return;
  }
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath("/admin/queues");
  createBullBoard({ queues: [new BullAdapter(q)], serverAdapter });
  app.use("/admin/queues", authenticate, requireRole(...ADMIN_ROLES), serverAdapter.getRouter());
  logger.info("[App] Bull Board mounted at /admin/queues");
}
