import { logger } from "./logger";
import { logEvent } from "../services/auditLog";

/**
 * States:
 *   CLOSED     — normal operation, requests pass through.
 *   OPEN       — failing; requests rejected immediately.
 *   HALF_OPEN  — testing: one request let through to probe recovery.
 */
type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

const FAILURE_THRESHOLD = 3;       // consecutive failures before OPEN
const FAILURE_WINDOW_MS = 60_000;  // window in which failures are counted
const RECOVERY_TIMEOUT_MS = 300_000; // 5 min before OPEN → HALF_OPEN

interface ProviderState {
  state: CircuitState;
  failureCount: number;
  firstFailureAt: number;
  openedAt: number;
}

/** In-memory circuit breaker state keyed by provider name. */
const providerStates = new Map<string, ProviderState>();

function getState(provider: string): ProviderState {
  if (!providerStates.has(provider)) {
    providerStates.set(provider, {
      state: "CLOSED",
      failureCount: 0,
      firstFailureAt: 0,
      openedAt: 0,
    });
  }
  return providerStates.get(provider)!;
}

/** Returns true if the circuit is OPEN and requests should be blocked. */
export function isOpen(provider: string): boolean {
  const s = getState(provider);
  if (s.state === "CLOSED") return false;

  if (s.state === "OPEN") {
    const elapsed = Date.now() - s.openedAt;
    if (elapsed >= RECOVERY_TIMEOUT_MS) {
      s.state = "HALF_OPEN";
      logger.info({ provider }, "[CircuitBreaker] OPEN → HALF_OPEN (recovery probe)");
      return false;
    }
    return true;
  }

  // HALF_OPEN: let one request through
  return false;
}

/** Record a successful call — resets the circuit to CLOSED. */
export function recordSuccess(provider: string): void {
  const s = getState(provider);
  if (s.state !== "CLOSED") {
    logger.info({ provider, prevState: s.state }, "[CircuitBreaker] → CLOSED (recovery succeeded)");
    logEvent({
      userId: "system",
      action: "PIPELINE_RUN",
      outcome: "SUCCESS",
      ip: "system",
      metadata: { event: "circuit_closed", provider },
    }).catch(() => {/* fire-and-forget */});
  }
  s.state = "CLOSED";
  s.failureCount = 0;
  s.firstFailureAt = 0;
}

/** Record a failed call — may trip the circuit to OPEN. */
export function recordFailure(provider: string): void {
  const s = getState(provider);

  const now = Date.now();

  // Reset failure window if the first failure was too long ago
  if (s.firstFailureAt > 0 && now - s.firstFailureAt > FAILURE_WINDOW_MS) {
    s.failureCount = 0;
    s.firstFailureAt = 0;
  }

  if (s.firstFailureAt === 0) s.firstFailureAt = now;
  s.failureCount += 1;

  if (s.state === "HALF_OPEN") {
    s.state = "OPEN";
    s.openedAt = now;
    logger.warn({ provider }, "[CircuitBreaker] HALF_OPEN → OPEN (probe failed)");
    return;
  }

  if (s.state === "CLOSED" && s.failureCount >= FAILURE_THRESHOLD) {
    s.state = "OPEN";
    s.openedAt = now;
    logger.warn(
      { provider, failures: s.failureCount, windowMs: FAILURE_WINDOW_MS },
      "[CircuitBreaker] CLOSED → OPEN (threshold reached)",
    );
    logEvent({
      userId: "system",
      action: "PIPELINE_RUN",
      outcome: "FAILURE",
      ip: "system",
      metadata: { event: "circuit_opened", provider, failureCount: s.failureCount },
    }).catch(() => {/* fire-and-forget */});
  }
}

/**
 * Wrap a provider call with circuit breaker logic.
 * Returns the result or throws with a circuit-open error.
 */
export async function withCircuitBreaker<T>(
  provider: string,
  fn: () => Promise<T>,
  timeoutMs = 15_000,
): Promise<T> {
  if (isOpen(provider)) {
    throw new Error(`[CircuitBreaker] ${provider} circuit is OPEN`);
  }

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`${provider} timed out after ${timeoutMs}ms`)), timeoutMs),
  );

  try {
    const result = await Promise.race([fn(), timeout]);
    recordSuccess(provider);
    return result;
  } catch (err) {
    // Don't count configuration errors (missing key) as circuit failures
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("API key not configured") && !msg.includes("circuit is OPEN")) {
      recordFailure(provider);
    }
    throw err;
  }
}

/** Semaphore for rate-limiting concurrent requests per provider. */
export class Semaphore {
  private permits: number;
  private readonly queue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.permits++;
    }
  }
}
