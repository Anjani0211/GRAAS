import Redis from "ioredis";
import { config } from "../config";
import { logger } from "./logger";

class RedisClient {
  private client: Redis | null = null;
  private available = false;
  private sawConnectError = false;

  async connect(): Promise<void> {
    try {
      this.client = new Redis({
        host: config.redisHost,
        port: config.redisPort,
        password: config.redisPassword,
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        enableOfflineQueue: false,
        retryStrategy: () => null,
        reconnectOnError: () => false,
        connectTimeout: 1500,
      });
      // Prevent noisy "Unhandled error event" when Redis is down.
      // Only log connection errors after Redis was previously available.
      this.client.on("error", (err) => {
        if (this.available) logger.warn({ err }, "[Redis] Client error");
      });
      this.client.on("end", () => {
        if (this.available) logger.warn("[Redis] Connection ended");
        this.available = false;
      });
      await this.client.connect();
      await this.client.ping();
      this.available = true;
      this.sawConnectError = false;
      logger.info("[Redis] Connected");
    } catch (err) {
      try {
        this.client?.disconnect();
      } catch {
        /* ignore */
      }
      this.client = null;
      this.available = false;
      if (!this.sawConnectError) {
        this.sawConnectError = true;
        logger.warn({ err }, "[Redis] Unavailable — token blocklist and Bull queue disabled");
      } else {
        logger.debug({ err }, "[Redis] Unavailable (repeat)");
      }
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  getClient(): Redis {
    if (!this.client || !this.available) {
      throw new Error("Redis not available");
    }
    return this.client;
  }

  async close(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        /* ignore */
      }
      this.client = null;
    }
    this.available = false;
  }
}

export const redisClient = new RedisClient();
