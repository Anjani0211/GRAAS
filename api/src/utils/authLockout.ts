/** Login lockout policy (shared with routes + unit tests). */
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;

export type LockoutState = {
  failedLoginAttempts: number;
  lockedUntil?: Date;
};

/**
 * Apply one failed password attempt. After MAX_FAILED_ATTEMPTS consecutive
 * failures, lock for LOCKOUT_MS and reset the counter.
 */
export function applyFailedLoginAttempt(
  state: LockoutState,
  now: Date = new Date(),
): LockoutState {
  const nextAttempts = (state.failedLoginAttempts ?? 0) + 1;
  if (nextAttempts >= MAX_FAILED_ATTEMPTS) {
    return {
      failedLoginAttempts: 0,
      lockedUntil: new Date(now.getTime() + LOCKOUT_MS),
    };
  }
  return {
    failedLoginAttempts: nextAttempts,
    lockedUntil: state.lockedUntil,
  };
}

export function isAccountLocked(lockedUntil: Date | undefined | null, now: Date = new Date()): boolean {
  return !!(lockedUntil && lockedUntil.getTime() > now.getTime());
}

export function clearLockout(): LockoutState {
  return { failedLoginAttempts: 0, lockedUntil: undefined };
}
