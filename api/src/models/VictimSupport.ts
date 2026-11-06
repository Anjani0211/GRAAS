import mongoose, { Schema, Document } from "mongoose";
import { idJsonTransform } from "./schemaUtils";

export interface IVictimSupport extends Document {
  caseId?: mongoose.Types.ObjectId;
  victimUserId?: mongoose.Types.ObjectId;
  supportType: "legal" | "psychological";
  advisorId?: string;
  partnerName?: string;
  scheduledAt?: Date;
  notes?: string;
  contactPreference?: "call" | "video" | "either";
  status: "requested" | "confirmed" | "completed" | "cancelled";
  createdAt: Date;
  updatedAt: Date;
}

const VictimSupportSchema = new Schema<IVictimSupport>(
  {
    caseId: { type: Schema.Types.ObjectId, ref: "Case", index: true },
    victimUserId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    supportType: { type: String, required: true, enum: ["legal", "psychological"] },
    advisorId: String,
    partnerName: String,
    scheduledAt: Date,
    notes: String,
    contactPreference: {
      type: String,
      enum: ["call", "video", "either"],
      default: "either",
    },
    status: {
      type: String,
      enum: ["requested", "confirmed", "completed", "cancelled"],
      default: "requested",
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: { transform: idJsonTransform },
  },
);

export const VictimSupport = mongoose.model<IVictimSupport>("VictimSupport", VictimSupportSchema);
