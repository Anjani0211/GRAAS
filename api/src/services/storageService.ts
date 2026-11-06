import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { Client, type ItemBucketMetadata } from "minio";
import { createHash } from "crypto";
import { config } from "../config";
import { logger } from "../utils/logger";

export interface StoredFile {
  minioPath: string;
  sha256: string;
  fileSizeBytes: number;
  mimeType: string;
}

export interface EvidenceUploadOptions {
  caseId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}

async function readableToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

class StorageService {
  private client: Client | null = null;
  private available = false;

  async connect(): Promise<void> {
    if (!config.minioEndpoint || !config.minioAccessKey || !config.minioSecretKey) {
      logger.info("[Storage] MinIO not configured — local disk fallback only");
      return;
    }
    try {
      this.client = new Client({
        endPoint: config.minioEndpoint,
        port: config.minioPort,
        useSSL: config.minioUseSsl,
        accessKey: config.minioAccessKey,
        secretKey: config.minioSecretKey,
      });

      const exists = await this.client.bucketExists(config.minioBucket);
      if (!exists) {
        await this.client.makeBucket(config.minioBucket, "us-east-1", { ObjectLocking: true });
        try {
          await this.client.setObjectLockConfig(config.minioBucket, {
            mode: "COMPLIANCE",
            unit: "Years",
            validity: 3,
          });
          logger.info("[Storage] MinIO bucket created with default Object Lock COMPLIANCE (3yr)");
        } catch (lockErr) {
          logger.warn({ err: lockErr }, "[Storage] Object Lock config failed — enable manually in MinIO console");
        }
      }
      this.available = true;
      logger.info("[Storage] MinIO connected");
    } catch (err) {
      this.client = null;
      this.available = false;
      logger.warn({ err }, "[Storage] MinIO unavailable — local disk fallback active");
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  computeSha256(buffer: Buffer): string {
    return createHash("sha256").update(buffer).digest("hex");
  }

  /** Absolute path on local disk for fallback mirror (under process.cwd()/uploads). */
  private localPathFor(minioPath: string): string {
    return path.join(process.cwd(), "uploads", minioPath);
  }

  async upload(opts: EvidenceUploadOptions): Promise<StoredFile> {
    const sha256 = this.computeSha256(opts.buffer);
    const safeName = opts.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200) || "file";
    const minioPath = `evidence/${opts.caseId}/${sha256}/${safeName}`;

    if (this.available && this.client) {
      const metadata: ItemBucketMetadata = {
        "Content-Type": opts.mimeType,
        "X-Case-Id": opts.caseId,
        "X-Sha256": sha256,
        "X-Ingested-At": new Date().toISOString(),
      };
      await this.client.putObject(
        config.minioBucket,
        minioPath,
        opts.buffer,
        opts.buffer.length,
        metadata,
      );
      logger.info({ path: minioPath, size: opts.buffer.length }, "[Storage] Uploaded to MinIO");
    } else {
      logger.warn("[Storage] MinIO unavailable — writing local disk fallback");
    }

    // Always mirror to local uploads so pipeline OCR/audio can read without S3 round-trip
    const abs = this.localPathFor(minioPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, opts.buffer);

    return {
      minioPath,
      sha256,
      fileSizeBytes: opts.buffer.length,
      mimeType: opts.mimeType,
    };
  }

  /**
   * Read evidence bytes: local mirror first, then MinIO getObject if needed.
   */
  async readEvidence(minioPath: string): Promise<Buffer> {
    const local = this.localPathFor(minioPath);
    if (fs.existsSync(local)) {
      return fs.readFileSync(local);
    }
    if (!this.available || !this.client) {
      throw new Error(`Evidence not found locally and MinIO unavailable: ${minioPath}`);
    }
    const stream = await this.client.getObject(config.minioBucket, minioPath);
    return readableToBuffer(stream);
  }

  async getPresignedUrl(minioPath: string, expiresSeconds = 15 * 60): Promise<string> {
    if (!this.available || !this.client) {
      throw new Error("Storage not available");
    }
    return this.client.presignedGetObject(config.minioBucket, minioPath, expiresSeconds);
  }

  /**
   * Delete object from MinIO and local mirror.
   * Best-effort local cleanup is attempted even when MinIO is unavailable.
   */
  async deleteObject(minioPath: string): Promise<void> {
    if (this.available && this.client) {
      await this.client.removeObject(config.minioBucket, minioPath);
    }
    const local = this.localPathFor(minioPath);
    if (fs.existsSync(local)) {
      fs.unlinkSync(local);
    }
  }
}

export const storageService = new StorageService();
