import { graphDB } from "./graphDB";
import { logger } from "../utils/logger";
import type { IOsintEntity } from "../models/Case";

const ENTITY_LABEL: Record<string, string> = {
  phone:    "PhoneNumber",
  upi:      "UpiID",
  ipv4:     "IPAddress",
  ip:       "IPAddress",
  url:      "Domain",
  domain:   "Domain",
  email:    "Email",
  wallet:   "CryptoWallet",
  telegram: "TelegramID",
};

function entityTypeToLabel(type: string): string {
  return ENTITY_LABEL[type] ?? "Entity";
}

/**
 * Ingest a case and its extracted entities into Neo4j.
 *
 * Fire-and-forget: called at end of Stage 3, never blocks the pipeline.
 * If Neo4j is unavailable, silently returns.
 */
export async function ingestCaseEntities(
  caseId: string,
  date: Date,
  lossInr: number,
  entities: IOsintEntity[],
): Promise<void> {
  if (!graphDB.isAvailable()) {
    await graphDB.ensureConnected();
  }
  if (!graphDB.isAvailable()) return;

  try {
    // Merge Case node
    await graphDB.writeQuery(
      `MERGE (c:Case {caseId: $caseId})
       SET c.date = $date, c.lossInr = $lossInr, c.updatedAt = $now`,
      { caseId, date: date.toISOString(), lossInr, now: new Date().toISOString() },
    );

    // Ingest entities in batches of 20 to avoid overwhelming the session
    for (const entity of entities) {
      const label = entityTypeToLabel(entity.type);
      try {
        await graphDB.writeQuery(
          `MERGE (e:${label} {value: $value})
           WITH e
           MATCH (c:Case {caseId: $caseId})
           MERGE (c)-[r:INVOLVED]->(e)
           SET r.confidence = $confidence,
               r.source = $source,
               r.updatedAt = $now`,
          {
            value: entity.value,
            caseId,
            confidence: entity.valid ? "HIGH" : "UNVERIFIED",
            source: entity.sourceFile ?? "extraction",
            now: new Date().toISOString(),
          },
        );
      } catch (entityErr) {
        // Log but continue — one failed entity must not abort ingestion
        logger.warn(
          { err: entityErr, caseId, type: entity.type },
          "[GraphIngestion] Entity merge failed (skipped)",
        );
      }
    }

    logger.info(
      { caseId, entityCount: entities.length },
      "[GraphIngestion] Entities ingested to Neo4j",
    );
  } catch (err) {
    logger.warn({ err, caseId }, "[GraphIngestion] Case ingestion failed (non-fatal)");
  }
}
