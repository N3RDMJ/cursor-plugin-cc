/**
 * Exponential-backoff retry for short-lived SDK calls (whoami, models.list,
 * model validation). Streaming `Run`s are intentionally **not** retried — the
 * SDK manages reconnects internally and re-running the prompt would duplicate
 * work that may have already started against a partial response.
 */

export interface RetryOptions {
  /** Total number of attempts including the first. Default 3. */
  attempts?: number;
  /** Initial delay before the second attempt, in ms. Default 200ms. */
  baseDelayMs?: number;
  /** Cap on backoff delay between attempts, in ms. Default 4000ms. */
  maxDelayMs?: number;
  /**
   * Decide whether an error is worth another attempt. Defaults to checking
   * `error.isRetryable === true` — the property the Cursor SDK sets on its
   * error classes for transient codes (network, 503, 504, 429-with-retry).
   */
  shouldRetry?: (error: unknown) => boolean;
  /**
   * Sleep implementation; injected by tests so they can drive virtual time
   * without setTimeout. Defaults to a real `setTimeout` Promise.
   */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 200;
const DEFAULT_MAX_DELAY_MS = 4000;

function defaultShouldRetry(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as { isRetryable?: unknown }).isRetryable === true;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `fn` and retry on transient failures with exponential backoff. The error
 * from the final attempt is rethrown unchanged so callers see the SDK's typed
 * error (RateLimitError, NetworkError, etc.) rather than a generic wrapper.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
  const base = Math.max(0, options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);
  const cap = Math.max(base, options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS);
  const shouldRetry = options.shouldRetry ?? defaultShouldRetry;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isLast = attempt === attempts - 1;
      if (isLast || !shouldRetry(err)) throw err;
      const delay = Math.min(cap, base * 2 ** attempt);
      await sleep(delay);
    }
  }
  throw lastError;
}
