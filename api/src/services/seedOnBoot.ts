import { User } from "../models";
import { logger } from "../utils/logger";
import { buildCaseInsensitiveEmailQuery, normalizeEmailForLookup } from "../utils/authUtils";

/**
 * Idempotent first-admin seed for ephemeral / first-boot environments.
 * Enabled only when SEED_ON_BOOT=true and SEED_ADMIN_PASSWORD is set (≥12 chars).
 */
export async function seedOnBootIfConfigured(): Promise<void> {
  if (process.env.SEED_ON_BOOT !== "true") return;

  const password = process.env.SEED_ADMIN_PASSWORD?.trim();
  if (!password || password.length < 12) {
    logger.warn("[Seed] SEED_ON_BOOT=true but SEED_ADMIN_PASSWORD missing/weak — skipped");
    return;
  }

  const email = normalizeEmailForLookup(process.env.SEED_ADMIN_EMAIL || "admin@grass.local");
  const existing = await User.findOne(buildCaseInsensitiveEmailQuery(email));
  if (existing) {
    logger.info({ email }, "[Seed] Admin already present — skipped");
    return;
  }

  await User.create({
    email,
    password,
    role: "admin",
    badgeId: process.env.SEED_ADMIN_BADGE || "BADGE-ADMIN-001",
    name: process.env.SEED_ADMIN_NAME || "GRAAS Administrator",
    isActive: true,
  });
  logger.info({ email }, "[Seed] First admin created");
}
