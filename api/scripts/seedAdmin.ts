/**
 * GRASS — First-boot admin seed script
 *
 * Usage:
 *   npx tsx scripts/seedAdmin.ts --password 'YourStrongPass1!'
 *   npx tsx scripts/seedAdmin.ts --email admin@grass.local --password '...' --badge BADGE001
 *
 * --password is REQUIRED (min 12 chars). Idempotent if email exists.
 */

import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import path from "path";
import { buildCaseInsensitiveEmailQuery, normalizeEmailForLookup } from "../src/utils/authUtils";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const args = process.argv.slice(2);
const get = (flag: string, def?: string) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};

const EMAIL = get("--email", "admin@grass.in")!;
const PASSWORD = get("--password");
const BADGE = get("--badge", "BADGE-ADMIN-001")!;
const NAME = get("--name", "GRASS Administrator")!;

const WEAK = new Set(["admin123", "password", "changeme", "GrassAdmin@2026", "12345678"]);

if (!PASSWORD || PASSWORD.length < 12 || WEAK.has(PASSWORD)) {
  console.error(`
❌ seedAdmin requires a strong --password (min 12 characters, not a known default).

   Example:
   npx tsx scripts/seedAdmin.ts --password 'ReplaceWithStrongPass!'
`);
  process.exit(1);
}

const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  role: { type: String, default: "admin" },
  badgeId: { type: String },
  name: { type: String },
  isActive: { type: Boolean, default: true },
  failedLoginAttempts: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
}, { collection: "users" });

const User = mongoose.models.User || mongoose.model("User", UserSchema);

async function seed() {
  const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/graas";
  console.log(`\nGRASS Admin Seed Script`);
  console.log(`   Connecting to: ${uri}`);

  await mongoose.connect(uri);
  console.log(`   MongoDB connected`);

  const normalizedEmail = normalizeEmailForLookup(EMAIL);
  const existing = await User.findOne(buildCaseInsensitiveEmailQuery(normalizedEmail));
  if (existing) {
    console.log(`\n   User ${EMAIL} already exists (role: ${existing.role}) — skipping.`);
    console.log(`   Run with --email new@email.com to create a different user.\n`);
    await mongoose.disconnect();
    return;
  }

  const password = await bcrypt.hash(PASSWORD, 12);
  await User.create({
    email: normalizedEmail,
    password,
    role: "admin",
    badgeId: BADGE,
    name: NAME,
    isActive: true,
    failedLoginAttempts: 0,
  });

  console.log(`\n   Admin user created.`);
  console.log(`   Email : ${EMAIL}`);
  console.log(`   Role  : admin`);
  console.log(`   Badge : ${BADGE}`);
  console.log(`   (password not echoed)\n`);

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
