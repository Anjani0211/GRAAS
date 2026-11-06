import mongoose, { Schema, Document } from "mongoose";
import { idJsonTransform } from "./schemaUtils";

export interface IEvidenceHash extends Document {
  caseId: string;
  fileName: string;
  originalName: string;
  /** S3/MinIO object key — not exposed in API JSON by default */
  minioPath: string;
  sha256: string;
  fileSizeBytes: number;
  mimeType: string;
  ingestedAt: Date;
  /** Truncated SHA-256 of client IP — raw IP never stored */
  ingestedByIpHash: string;
  isLocked: boolean;
}

const EvidenceHashSchema = new Schema<IEvidenceHash>(
  {
    caseId: { type: String, required: true, index: true },
    fileName: { type: String, required: true },
    originalName: { type: String, required: true },
    minioPath: { type: String, default: "", select: false },
    sha256: { type: String, required: true },
    fileSizeBytes: { type: Number, default: 0 },
    mimeType: { type: String, default: "application/octet-stream" },
    ingestedAt: { type: Date, default: Date.now },
    ingestedByIpHash: { type: String, default: "", select: false },
    isLocked: { type: Boolean, default: false },
  },
  {
    collection: "evidence_hashes",
    timestamps: false,
    toJSON: { transform: idJsonTransform },
  },
);

EvidenceHashSchema.index({ caseId: 1, sha256: 1 }, { unique: true });

/** Append-only: application code must never update these documents. */
EvidenceHashSchema.pre("findOneAndUpdate", function forbidUpdate() {
  throw new Error("evidence_hashes is append-only. Updates are forbidden.");
});
EvidenceHashSchema.pre("updateOne", function forbidUpdate() {
  throw new Error("evidence_hashes is append-only. Updates are forbidden.");
});
EvidenceHashSchema.pre("updateMany", function forbidUpdate() {
  throw new Error("evidence_hashes is append-only. Updates are forbidden.");
});
EvidenceHashSchema.pre("replaceOne", function forbidUpdate() {
  throw new Error("evidence_hashes is append-only. Updates are forbidden.");
});
EvidenceHashSchema.pre("deleteOne", function forbidDelete() {
  throw new Error("evidence_hashes is append-only. Deletes are forbidden.");
});
EvidenceHashSchema.pre("deleteMany", function forbidDelete() {
  throw new Error("evidence_hashes is append-only. Deletes are forbidden.");
});

export const EvidenceHash = mongoose.model<IEvidenceHash>("EvidenceHash", EvidenceHashSchema);
