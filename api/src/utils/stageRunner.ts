export interface StageRunnerOptions {
  maxRetries: number;
  backoffMs: number;
  stageName: string;
  emitLog: (msg: string, extra?: Record<string, unknown>) => void;
}

/**
 * Retry a stage with exponential backoff. Re-throws the last error after all attempts.
 */
export async function runWithRetry<T>(fn: () => Promise<T>, opts: StageRunnerOptions): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = opts.backoffMs * Math.pow(2, attempt - 1);
        opts.emitLog(`Retry ${attempt}/${opts.maxRetries} after ${delay}ms`, { stage: opts.stageName });
        await new Promise((r) => setTimeout(r, delay));
      }
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      opts.emitLog(`Stage error (attempt ${attempt + 1})`, {
        stage: opts.stageName,
        error: lastError.message,
      });
    }
  }
  throw lastError;
}
