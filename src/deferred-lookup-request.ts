/**
 * The deferred web→app install lookup request, shared by the bare React Native and the
 * Expo SDK so both time it, classify its failures and report them the same way.
 *
 * Only the time to the response HEADERS is bounded (DEFERRED_LOOKUP_TIMEOUT_MS). Reading
 * the body happens after the timer is cleared, so an answer whose headers arrive inside
 * the bound is never reported as a failure, however slowly its body follows.
 */

/** Time the lookup waits for the server's response headers before giving up. */
export const DEFERRED_LOOKUP_TIMEOUT_MS = 10000;

/**
 * Why a lookup produced no usable answer:
 * - `timeout`: no response headers within DEFERRED_LOOKUP_TIMEOUT_MS
 * - `network`: the request failed before any answer (offline, DNS, TLS, reset)
 * - `http_4xx` / `http_5xx` / `http_other`: the server answered with a non-2xx status
 * - `decode`: a 2xx whose body is not JSON
 */
export type DeferredLookupErrorClass = 'timeout' | 'network' | 'http_4xx' | 'http_5xx' | 'http_other' | 'decode';

export interface DeferredLookupFailure {
  error_class: DeferredLookupErrorClass;
  /** Milliseconds from sending the request to the failure. */
  elapsed_ms: number;
  /** The HTTP status, only for the http_* classes. */
  http_status?: number;
}

export type DeferredLookupOutcome =
  | { ok: true; response: Response; elapsedMs: number; startedAt: number }
  | { ok: false; failure: DeferredLookupFailure; error?: unknown };

export function httpStatusClass(status: number): DeferredLookupErrorClass {
  if (status >= 400 && status < 500) return 'http_4xx';
  if (status >= 500 && status < 600) return 'http_5xx';
  return 'http_other';
}

/**
 * Send the lookup and resolve to the response, or to a classified failure. Never throws.
 * A non-2xx answer resolves `ok: true` with its response: the caller decides retry vs.
 * terminal from the status, and builds its failure with `httpFailure()`.
 */
export async function sendDeferredLookup(
  url: string,
  init: RequestInit,
  timeoutMs: number = DEFERRED_LOOKUP_TIMEOUT_MS,
): Promise<DeferredLookupOutcome> {
  const controller = new AbortController();
  let timedOut = false;
  const startedAt = Date.now();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return { ok: true, response, elapsedMs: Date.now() - startedAt, startedAt };
  } catch (error) {
    return {
      ok: false,
      failure: { error_class: timedOut ? 'timeout' : 'network', elapsed_ms: Date.now() - startedAt },
      error,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function httpFailure(status: number, elapsedMs: number): DeferredLookupFailure {
  return { error_class: httpStatusClass(status), elapsed_ms: elapsedMs, http_status: status };
}
