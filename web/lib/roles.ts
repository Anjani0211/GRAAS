import type { UserRole } from "./types";

/** Staff roles that can access /admin/* (aligned with API ANALYST_ROLES). */
export const STAFF_ROLES: UserRole[] = [
  "intake_officer",
  "osint_analyst",
  "case_manager",
  "legal_team",
  "senior_analyst",
  "le_portal",
  "admin",
  "super_admin",
];

export const ADMIN_ROLES: UserRole[] = ["admin", "super_admin"];

export function isStaffRole(role: UserRole | string | undefined): boolean {
  return !!role && (STAFF_ROLES as readonly string[]).includes(role);
}

export function isAdminRole(role: UserRole | string | undefined): boolean {
  return !!role && (ADMIN_ROLES as readonly string[]).includes(role);
}
