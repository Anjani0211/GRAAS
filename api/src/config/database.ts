import mongoose from "mongoose";
import { config } from "./index";

export async function connectDatabase(): Promise<void> {
  try {
    await mongoose.connect(config.mongoUri);
    console.log(`[db] Connected to MongoDB at ${config.mongoUri}`);
  } catch (error) {
    console.error("[db] MongoDB connection failed:", error);
    process.exit(1);
  }
}

mongoose.connection.on("error", (err) => {
  console.error("[db] MongoDB error:", err);
});

mongoose.connection.on("disconnected", () => {
  console.warn("[db] MongoDB disconnected");
});
