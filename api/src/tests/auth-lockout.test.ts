import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_MS,
  applyFailedLoginAttempt,
  clearLockout,
  isAccountLocked,
} from "../utils/authLockout";

test("lockout engages after MAX_FAILED_ATTEMPTS consecutive failures", () => {
  const now = new Date("2026-01-15T12:00:00.000Z");
  let state: { failedLoginAttempts: number; lockedUntil?: Date } = {
    failedLoginAttempts: 0,
  };

  for (let i = 1; i < MAX_FAILED_ATTEMPTS; i++) {
    state = applyFailedLoginAttempt(state, now);
    assert.equal(state.failedLoginAttempts, i);
    assert.equal(state.lockedUntil, undefined);
    assert.equal(isAccountLocked(state.lockedUntil, now), false);
  }

  state = applyFailedLoginAttempt(state, now);
  assert.equal(state.failedLoginAttempts, 0);
  assert.ok(state.lockedUntil);
  assert.equal(state.lockedUntil!.getTime(), now.getTime() + LOCKOUT_MS);
  assert.equal(isAccountLocked(state.lockedUntil, now), true);
});

test("lockout expires after LOCKOUT_MS", () => {
  const lockedAt = new Date("2026-01-15T12:00:00.000Z");
  const lockedUntil = new Date(lockedAt.getTime() + LOCKOUT_MS);
  assert.equal(isAccountLocked(lockedUntil, lockedAt), true);
  assert.equal(isAccountLocked(lockedUntil, new Date(lockedUntil.getTime() + 1)), false);
});

test("clearLockout resets counters", () => {
  const cleared = clearLockout();
  assert.equal(cleared.failedLoginAttempts, 0);
  assert.equal(cleared.lockedUntil, undefined);
});
