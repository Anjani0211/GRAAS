import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { config, isOriginAllowed } from "./config";
import { validateSecurityConfig } from "./config/securityValidation";
import { connectDatabase } from "./config/database";
import { graphDB } from "./services/graphDB";
import apiRouter from "./routes";
import { logger } from "./utils/logger";
import { authenticate, authorize } from "./middleware/auth";
import { ANALYST_ROLES } from "./models";
import { serveUploads } from "./middleware/secureUploads";
import { storageService } from "./services/storageService";
import { closeBrowser } from "./services/pdfService";
import { redisClient } from "./utils/redisClient";
import { initPipelineQueue } from "./queues/pipelineQueue";
import { startPipelineWorker } from "./workers/pipelineWorker";
import { mountBullBoard } from "./queues/bullBoardSetup";
import { scheduleRetentionJob } from "./jobs/retentionJob";
import { isLlmConfigured, getLlmModel } from "./services/llmClient";
import { getEffectiveLlm, refreshRuntimeSettings } from "./services/runtimeSettings";
import { csrfProtection } from "./middleware/csrf";

const app = express();

app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      // Non-browser clients (curl, server-to-server) send no Origin header.
      if (!origin) return callback(null, true);
      return callback(null, isOriginAllowed(origin));
    },
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(csrfProtection);

/** Audited file delivery — staff only. Victims use case-scoped evidence routes. */
app.use("/uploads", authenticate, authorize(...ANALYST_ROLES), serveUploads);

app.get("/api/health", (_req, res) => {
  const llm = getEffectiveLlm();
  res.json({
    status: "healthy",
    service: "GRAAS API",
    stack: "Node.js + MongoDB",
    llm: {
      configured: Boolean(llm.apiKey) || Boolean(llm.baseUrl),
      cloud: llm.isCloud,
      model: llm.model,
      baseUrl: llm.isCloud ? llm.baseUrl : "local",
      vision: llm.visionEnabled,
      tools: llm.toolsEnabled,
      provider: llm.provider,
      fromSettings: llm.fromSettings,
    },
  });
});

app.use("/api", apiRouter);
mountBullBoard(app);

app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

async function start(): Promise<void> {
  validateSecurityConfig();
  await connectDatabase();
  await refreshRuntimeSettings();
  await redisClient.connect();
  if (
    config.nodeEnv === "production" &&
    config.requireRedisInProduction &&
    !redisClient.isAvailable()
  ) {
    throw new Error("Redis is required in production but connection failed");
  }
  initPipelineQueue();
  startPipelineWorker();
  // Neo4j: connect after Mongo; non-fatal if unavailable
  await graphDB.connect();
  await storageService.connect();
  scheduleRetentionJob();
  app.listen(config.port, () => {
    logger.info(`GRAAS API running on http://localhost:${config.port}`);
    logger.info(`Health check: http://localhost:${config.port}/api/health`);
    const llm = getEffectiveLlm();
    logger.info(
      {
        llm: isLlmConfigured() ? (llm.isCloud ? "cloud" : "local") : "none",
        model: getLlmModel(),
        provider: llm.provider,
        fromSettings: llm.fromSettings,
      },
      "[Startup] LLM backend",
    );
  });
}

start().catch((err: unknown) => {
  logger.error({ err }, "Fatal: server failed to start");
  process.exit(1);
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Shutting down");
  await closeBrowser();
  await redisClient.close();
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

export default app;
