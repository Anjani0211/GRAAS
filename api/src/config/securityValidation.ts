import { config } from "./index";
import { logger } from "../utils/logger";

const INSECURE_JWT_SECRETS = new Set([
  "dev-secret-key-change-in-production",
  "dev-secret-key-change-me",
  "changeme-minimum-32-chars-in-production",
]);

const WEAK_PASSWORDS = new Set([
  "grasspass123",
  "grasssecret123",
  "changeme",
  "password",
  "neo4j",
]);

/** Fail fast in production when critical security settings are weak. */
export function validateSecurityConfig(): void {
  const isProd = config.nodeEnv === "production";

  if (isProd) {
    if (!config.jwtSecret || INSECURE_JWT_SECRETS.has(config.jwtSecret) || config.jwtSecret.length < 32) {
      throw new Error(
        "JWT_SECRET must be a unique secret of at least 32 characters in production",
      );
    }
    if (!config.ssrfProtectionEnabled) {
      throw new Error("SSRF_PROTECTION must remain enabled in production");
    }
    if (config.corsOrigins.includes("*")) {
      throw new Error("CORS_ORIGIN must not be '*' in production");
    }
    if (!config.neo4jPassword || WEAK_PASSWORDS.has(config.neo4jPassword)) {
      throw new Error("NEO4J_PASSWORD must be a strong non-default value in production");
    }
    if (!config.minioSecretKey || WEAK_PASSWORDS.has(config.minioSecretKey)) {
      throw new Error("MINIO_SECRET_KEY must be a strong non-default value in production");
    }
    if (config.requireRedisInProduction && !process.env.REDIS_HOST && !process.env.REDIS_URL) {
      throw new Error("REDIS_HOST or REDIS_URL is required in production (set REQUIRE_REDIS=false to override)");
    }
    if (!process.env.REDIS_HOST && !process.env.REDIS_URL) {
      logger.warn("[Security] REDIS_HOST/URL unset in production — token blocklist may be in-memory only");
    }
  } else if (INSECURE_JWT_SECRETS.has(config.jwtSecret)) {
    logger.warn("[Security] Default JWT_SECRET in use — set a strong secret before production");
  }

  if (!config.ssrfProtectionEnabled) {
    logger.warn("[Security] SSRF protection disabled — only use for local debugging");
  }
}
