/**
 * Idempotent migration: uploads local evidence files to MinIO and sets minioPath on EvidenceHash.
 *
 * Run: npx tsx scripts/migrateEvidenceToMinio.ts
 *
 * Uses raw collection.updateOne — the ONLY allowed bypass of EvidenceHash append-only hooks.
 * Do not delete local files until MinIO verification is complete.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { config } from "../src/config";
import { EvidenceHash } from "../src/models/EvidenceHash";
import { storageService } from "../src/services/storageService";
import { logger } from "../src/utils/logger";

function resolveLocalPath(caseId: string, sha256: string, fileName: string): string | null {
  const candidates = [
    path.join(process.cwd(), "uploads", "evidence", caseId, sha256, fileName),
    path.join(process.cwd(), "uploads", caseId, fileName),
    path.join(process.cwd(), "uploads", fileName),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}

async function migrate(): Promise<void> {
  await mongoose.connect(config.mongoUri);
  await storageService.connect();

  if (!storageService.isAvailable()) {
    logger.error("[Migrate] MinIO not available — set MINIO_* env and retry");
    process.exit(1);
  }

  const hashes = await EvidenceHash.find({
    $or: [{ minioPath: "" }, { minioPath: { $exists: false } }],
  }).lean();

  logger.info(`[Migrate] Found ${hashes.length} evidence_hashes rows to migrate`);

  for (const hash of hashes) {
    const localPath = resolveLocalPath(hash.caseId, hash.sha256, hash.fileName);
    if (!localPath) {
      logger.warn(
        { sha256: hash.sha256.slice(0, 8), caseId: hash.caseId },
        "[Migrate] Local file not found — skipping",
      );
      continue;
    }
    const buffer = fs.readFileSync(localPath);
    const computed = storageService.computeSha256(buffer);
    if (computed !== hash.sha256) {
      logger.error(
        { stored: hash.sha256.slice(0, 12), computed: computed.slice(0, 12) },
        "[Migrate] SHA-256 mismatch — skipping (possible corruption)",
      );
      continue;
    }

    const stored = await storageService.upload({
      caseId: hash.caseId,
      fileName: hash.fileName,
      mimeType: hash.mimeType || "application/octet-stream",
      buffer,
    });

    await EvidenceHash.collection.updateOne(
      { _id: hash._id },
      { $set: { minioPath: stored.minioPath, isLocked: true } },
    );
    logger.info({ file: hash.fileName }, "[Migrate] Uploaded to MinIO");
  }

  logger.info("[Migrate] Complete. Verify objects in MinIO before deleting local copies.");
  await mongoose.disconnect();
}

migrate().catch((err) => {
  logger.error({ err }, "[Migrate] Failed");
  process.exit(1);
});
