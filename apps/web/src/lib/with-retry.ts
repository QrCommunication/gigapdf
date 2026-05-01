/**
 * Retry an async operation with exponential backoff.
 *
 * Designed for transient backend hiccups (Redis flap, network blip, brief
 * 5xx). The default schedule (200ms / 600ms / 1.8s) covers the typical
 * recovery window without blocking the UI noticeably.
 *
 * Stops retrying on:
 *   - 4xx responses other than 408/425/429 (client error — won't fix itself)
 *   - AbortError (caller cancelled)
 */

interface WithRetryOptions {
  /** Max attempts including the first try. Default: 3. */
  maxAttempts?: number;
  /** Initial delay in ms. Each retry triples it. Default: 200. */
  baseDelayMs?: number;
  /** Optional callback per attempt — useful for surfacing the failure to the user. */
  onAttemptFailed?: (attempt: number, error: unknown) => void;
}

const NON_RETRYABLE_STATUSES = new Set([400, 401, 403, 404, 422]);

function isRetryable(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return false;
  // Some clients attach `status` directly, others use `response.status`
  const e = err as { status?: number; response?: { status?: number } };
  const status = e?.status ?? e?.response?.status;
  if (typeof status === "number" && NON_RETRYABLE_STATUSES.has(status)) {
    return false;
  }
  return true;
}

export async function withRetry<T>(
  op: () => Promise<T>,
  { maxAttempts = 3, baseDelayMs = 200, onAttemptFailed }: WithRetryOptions = {},
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await op();
    } catch (err) {
      lastErr = err;
      onAttemptFailed?.(attempt, err);
      if (attempt === maxAttempts || !isRetryable(err)) break;
      const delay = baseDelayMs * Math.pow(3, attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
