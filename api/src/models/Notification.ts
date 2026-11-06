import mongoose, { Schema, Document } from "mongoose";
import { idJsonTransform } from "./schemaUtils";

export interface INotification extends Document {
  caseId: mongoose.Types.ObjectId;
  channel: "sms" | "email" | "whatsapp";
  recipient: string;
  message: string;
  sentAt: Date;
  status: "queued" | "sent" | "delivered" | "failed";
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    caseId: { type: Schema.Types.ObjectId, ref: "Case", required: true, index: true },
    channel: { type: String, required: true, enum: ["sms", "email", "whatsapp"] },
    recipient: { type: String, required: true },
    message: { type: String, required: true },
    sentAt: { type: Date, default: Date.now },
    status: { type: String, default: "queued", enum: ["queued", "sent", "delivered", "failed"] },
  },
  {
    timestamps: true,
    toJSON: { transform: idJsonTransform },
  },
);

NotificationSchema.index({ sentAt: -1 });
NotificationSchema.index({ status: 1, channel: 1 });

export const Notification = mongoose.model<INotification>("Notification", NotificationSchema);
