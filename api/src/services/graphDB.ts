import neo4j, { type Driver, type Session } from "neo4j-driver";
import { config } from "../config";
import { logger } from "../utils/logger";

const CONNECT_RETRIES = parseInt(process.env.NEO4J_CONNECT_RETRIES || "12", 10);
const CONNECT_RETRY_MS = parseInt(process.env.NEO4J_CONNECT_RETRY_MS || "5000", 10);

class GraphDB {
  private driver: Driver | null = null;

  /**
   * Connect to Neo4j with retries (Neo4j often starts slower than the API container).
   * Non-fatal: pipeline continues with MongoDB-only correlation if all retries fail.
   */
  async connect(): Promise<void> {
    if (!config.neo4jUri) {
      logger.info("[GraphDB] NEO4J_URI not set — graph features disabled");
      return;
    }

    for (let attempt = 1; attempt <= CONNECT_RETRIES; attempt++) {
      try {
        await this.openDriver();
        logger.info({ attempt }, "[GraphDB] Neo4j connected");
        return;
      } catch (err) {
        this.driver = null;
        if (attempt < CONNECT_RETRIES) {
          logger.warn(
            { err, attempt, max: CONNECT_RETRIES, uri: config.neo4jUri },
            "[GraphDB] Neo4j not ready — retrying",
          );
          await new Promise((r) => setTimeout(r, CONNECT_RETRY_MS));
        } else {
          logger.warn(
            { err, uri: config.neo4jUri },
            "[GraphDB] Neo4j unavailable — graph UI will use MongoDB fallback",
          );
        }
      }
    }
  }

  /** Retry connect when graph features are requested but startup connect failed. */
  async ensureConnected(): Promise<boolean> {
    if (this.driver) return true;
    if (!config.neo4jUri) return false;
    try {
      await this.openDriver();
      logger.info("[GraphDB] Neo4j connected (lazy reconnect)");
      return true;
    } catch (err) {
      logger.warn({ err }, "[GraphDB] Lazy reconnect failed");
      this.driver = null;
      return false;
    }
  }

  private async openDriver(): Promise<void> {
    if (this.driver) {
      try {
        await this.driver.verifyConnectivity();
        return;
      } catch {
        await this.driver.close().catch(() => undefined);
        this.driver = null;
      }
    }

    this.driver = neo4j.driver(
      config.neo4jUri,
      neo4j.auth.basic(config.neo4jUser, config.neo4jPassword),
      { maxConnectionPoolSize: 10 },
    );
    await this.driver.verifyConnectivity();
    await this.ensureIndexes();
  }

  isAvailable(): boolean {
    return this.driver !== null;
  }

  /** Run a read-only Cypher query. Returns typed result rows. */
  async runQuery<T = Record<string, unknown>>(
    cypher: string,
    params: Record<string, unknown> = {},
  ): Promise<T[]> {
    if (!this.driver) throw new Error("Neo4j not available");
    const session: Session = this.driver.session({ defaultAccessMode: neo4j.session.READ });
    try {
      const result = await session.run(cypher, params, { timeout: 10_000 });
      return result.records.map((r) => r.toObject() as T);
    } finally {
      await session.close();
    }
  }

  /** Run a write Cypher query. */
  async writeQuery(cypher: string, params: Record<string, unknown> = {}): Promise<void> {
    if (!this.driver) throw new Error("Neo4j not available");
    const session: Session = this.driver.session({ defaultAccessMode: neo4j.session.WRITE });
    try {
      await session.run(cypher, params, { timeout: 10_000 });
    } finally {
      await session.close();
    }
  }

  /** Create indexes for common query patterns. Idempotent — safe to call on every startup. */
  private async ensureIndexes(): Promise<void> {
    const indexes: Array<[string, string]> = [
      ["Case", "caseId"],
      ["PhoneNumber", "value"],
      ["UpiID", "value"],
      ["IPAddress", "value"],
      ["Domain", "value"],
      ["Email", "value"],
      ["CryptoWallet", "value"],
      ["TelegramID", "value"],
    ];
    for (const [label, prop] of indexes) {
      await this.writeQuery(
        `CREATE INDEX ${label.toLowerCase()}_${prop}_idx IF NOT EXISTS FOR (n:${label}) ON (n.${prop})`,
      );
    }
    logger.debug("[GraphDB] Indexes ensured");
  }

  async close(): Promise<void> {
    await this.driver?.close();
    this.driver = null;
  }
}

export const graphDB = new GraphDB();
