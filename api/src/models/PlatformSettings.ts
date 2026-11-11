import mongoose, { Schema, Document } from "mongoose";
import { idJsonTransform } from "./schemaUtils";
import type { AiProviderId } from "../config/keyCatalog";

export interface IAiSettings {
  /** env = follow process env; otherwise Settings overrides. */
  provider: AiProviderId;
  /** AES-GCM sealed API key (empty = none stored). */
  apiKeyEnc?: string;
  baseUrl?: string;
  /** Free-form model id — any provider/model string. */
  model?: string;
  visionEnabled?: boolean | null;
  toolsEnabled?: boolean | null;
}

export interface IStoredKey {
  valueEnc: string;
  label?: string;
  updatedAt: Date;
}

export interface IPlatformSettings extends Document {
  /** Singleton marker — always "default". */
  key: string;
  ai: IAiSettings;
  /** Integration + custom secrets keyed by id (e.g. VIRUSTOTAL_API_KEY). */
  keys: Map<string, IStoredKey> | Record<string, IStoredKey>;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AiSettingsSchema = new Schema<IAiSettings>(
  {
    provider: {
      type: String,
      enum: ["env", "openrouter", "openai", "nvidia", "custom", "local"],
      default: "env",
    },
    apiKeyEnc: { type: String, default: "" },
    baseUrl: { type: String, default: "" },
    model: { type: String, default: "" },
    visionEnabled: { type: Boolean, default: null },
    toolsEnabled: { type: Boolean, default: null },
  },
  { _id: false },
);

const StoredKeySchema = new Schema<IStoredKey>(
  {
    valueEnc: { type: String, required: true },
    label: { type: String },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const PlatformSettingsSchema = new Schema<IPlatformSettings>(
  {
    key: { type: String, required: true, unique: true, default: "default" },
    ai: { type: AiSettingsSchema, default: () => ({ provider: "env" }) },
    keys: { type: Map, of: StoredKeySchema, default: () => new Map() },
    updatedBy: { type: String },
  },
  {
    timestamps: true,
    toJSON: { transform: idJsonTransform },
  },
);

export const PlatformSettings = mongoose.model<IPlatformSettings>(
  "PlatformSettings",
  PlatformSettingsSchema,
);

export const SETTINGS_DOC_ID = "default";
