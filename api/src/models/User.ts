import mongoose, { Schema, Document } from "mongoose";
import bcrypt from "bcryptjs";
import { idJsonTransform } from "./schemaUtils";

/**
 * Role hierarchy (ascending privilege):
 *   victim < intake_officer ≈ osint_analyst < case_manager ≈ legal_team ≈ senior_analyst
 *   < le_portal < admin ≈ super_admin
 *
 * Phase 1 adds `senior_analyst` and `le_portal`.
 * The plan's simplified model maps to:
 *   VICTIM         → victim
 *   ANALYST        → intake_officer | osint_analyst
 *   SENIOR_ANALYST → case_manager | legal_team | senior_analyst
 *   LE_PORTAL      → le_portal
 *   ADMIN          → admin | super_admin
 */
const ROLES = [
  "victim",
  "intake_officer",
  "osint_analyst",
  "case_manager",
  "legal_team",
  "senior_analyst",
  "le_portal",
  "admin",
  "super_admin",
] as const;

export type UserRole = (typeof ROLES)[number];

/** Roles that are considered ANALYST tier or above (can access OSINT queue). */
export const ANALYST_ROLES: UserRole[] = [
  "intake_officer",
  "osint_analyst",
  "case_manager",
  "legal_team",
  "senior_analyst",
  "le_portal",
  "admin",
  "super_admin",
];

/** Roles that are SENIOR_ANALYST tier or above (can finalize/submit to LE). */
export const SENIOR_ANALYST_ROLES: UserRole[] = [
  "case_manager",
  "legal_team",
  "senior_analyst",
  "le_portal",
  "admin",
  "super_admin",
];

export const ADMIN_ROLES: UserRole[] = ["admin", "super_admin"];

export interface IUser extends Document {
  name: string;
  email: string;
  /** Stored as bcrypt hash, cost 12. Hidden from all query results by default. */
  password: string;
  role: UserRole;
  phone?: string;
  /** Required for SENIOR_ANALYST+ to finalize or submit to LE (HITL gate). */
  badgeId?: string;
  isActive: boolean;
  /** Incremented on each failed login. Resets to 0 on successful login. */
  failedLoginAttempts: number;
  /** Account locked until this timestamp after 5 consecutive failures. */
  lockedUntil?: Date;
  lastLoginAt?: Date;
  /** Stored hashed (SHA-256) — never raw IP in DB. */
  lastLoginIp?: string;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidate: string): Promise<boolean>;
  isLocked(): boolean;
}

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 8, select: false },
    role: { type: String, required: true, enum: ROLES, default: "victim" },
    phone: { type: String, trim: true },
    badgeId: { type: String, trim: true, sparse: true, unique: true },
    isActive: { type: Boolean, default: true },
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date },
    lastLoginAt: { type: Date },
    lastLoginIp: { type: String, select: false },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc: unknown, ret: Record<string, unknown>) {
        idJsonTransform(doc, ret);
        delete ret.password;
        delete ret.failedLoginAttempts;
        delete ret.lockedUntil;
        delete ret.lastLoginIp;
        return ret;
      },
    },
  },
);

UserSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 12);
});

UserSchema.methods.comparePassword = async function (candidate: string): Promise<boolean> {
  return bcrypt.compare(candidate, this.password);
};

UserSchema.methods.isLocked = function (): boolean {
  return !!(this.lockedUntil && this.lockedUntil > new Date());
};

export const User = mongoose.model<IUser>("User", UserSchema);
