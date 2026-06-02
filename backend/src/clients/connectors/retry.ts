import { logger } from "../../config/logger.js";

/**
 * Connector-agnostic retry/backoff for TRANSIENT network failures only.
 *
 * Deliberately narrow: it retries undici/network-level throws (connection
 * resets, DNS hiccups, socket/timeout errors) — the kind that succeed on a
 * second attempt. It does NOT retry our own ConnectorError (rate-limit, SOAP
 * faults, auth) nor HTTP error statuses: Yuki returns its DAILY LIMIT as HTTP
 * 500, so blindly retrying responses would burn the very quota we are trying to
 * protect. Rate-limit = fail fast with a clear message; transient blip = retry.
 */

const TRANSIENT_CODES = new Set([
  "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "EAI_AGAIN", "ENOTFOUND", "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET",
]);

/** True for low-level network errors that are worth a retry. */
export function isTransientNetworkError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const code = (e as { code?: string }).code;
  const name = (e as { name?: string }).name;
  const cause = (e as { cause?: unknown }).cause;
  const msg = (((e as { message?: string }).message) ?? "").toLowerCase();
  if (code && TRANSIENT_CODES.has(code)) return true;
  if (name === "AbortError") return true;
  if (cause && cause !== e && isTransientNetworkError(cause)) return true;
  return /timeout|socket hang up|other side closed|network|connection reset|temporarily/.test(msg);
}

export interface RetryOptions {
  /** Total attempts including the first (default 3 → up to 2 retries). */
  attempts?: number;
  /** Base backoff in ms; grows ×3 per attempt (300ms, 900ms). */
  baseDelayMs?: number;
  /** Decide whether a thrown error is worth retrying (default: transient network). */
  isRetryable?: (e: unknown) => boolean;
  /** Label for logs. */
  label?: string;
}

/** Run `fn`, retrying transient failures with exponential backoff. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const base = opts.baseDelayMs ?? 300;
  const retryable = opts.isRetryable ?? isTransientNetworkError;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i === attempts - 1 || !retryable(e)) throw e;
      const delay = base * Math.pow(3, i);
      logger.warn({ label: opts.label, attempt: i + 1, delay, err: e instanceof Error ? e.message : String(e) }, "Transient connector error — retrying");
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
