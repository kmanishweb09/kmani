import type { ApiErrorBody } from "../../shared/api";

/** Browser API client. Writes carry the CSRF header and an Idempotency-Key so retries never duplicate records. */

export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;
  requestId: string | null;
  constructor(status: number, code: string, message: string, details?: unknown, requestId?: string | null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId ?? null;
  }
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError(res.status, "INVALID_RESPONSE", `The server returned an unexpected response (${res.status}).`);
    }
  }
  if (!res.ok) {
    const e = (data as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, e?.code ?? "HTTP_ERROR", e?.message ?? `Request failed (${res.status}).`, e?.details, e?.requestId);
  }
  return data as T;
}

function networkError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof DOMException && err.name === "AbortError") return new ApiError(0, "ABORTED", "Request cancelled.");
  return new ApiError(0, "NETWORK", navigator.onLine === false ? "You appear to be offline." : "Could not reach the finance server.");
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  try {
    // "no-cache" revalidates with the server's ETag (a cheap 304 when unchanged) so an in-app refetch after an
    // owner action never shows a stale copy from the browser's HTTP cache. Shared/CDN caching is unaffected.
    const res = await fetch(path, { credentials: "same-origin", cache: "no-cache", headers: { Accept: "application/json" }, ...(signal ? { signal } : {}) });
    return await parse<T>(res);
  } catch (err) {
    throw networkError(err);
  }
}

export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function apiSend<T>(method: "POST" | "PATCH" | "PUT" | "DELETE", path: string, body?: unknown, opts: { idempotencyKey?: string; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", "X-Finance-Request": "1" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  try {
    const res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    return await parse<T>(res);
  } catch (err) {
    throw networkError(err);
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
