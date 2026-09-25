import { HttpError, privateJson, sha256Hex } from "./http";
import type { D1Database, RequestContext } from "./types";

export function requireDb(c: Pick<RequestContext, "db">): D1Database {
  if (!c.db) throw new HttpError(503, "DATABASE_UNAVAILABLE", "The finance database binding (DB) is not available.");
  return c.db;
}

/** 128-bit random identifier, URL-safe. */
export function newId(prefix = ""): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  const b64 = btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${prefix}${b64}`;
}

export function nowIso(c: Pick<RequestContext, "now">): string {
  return c.now.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function parseJsonColumn<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

const IDEM_RE = /^[A-Za-z0-9_-]{8,80}$/;

export function idempotencyKey(c: RequestContext, required: boolean): string | null {
  const key = c.request.headers.get("Idempotency-Key");
  if (!key) {
    if (required) throw new HttpError(400, "IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key header (8–80 URL-safe characters) so retries cannot duplicate records.");
    return null;
  }
  if (!IDEM_RE.test(key)) throw new HttpError(400, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key must be 8–80 URL-safe characters.");
  return key;
}

/**
 * Runs a create-style operation at most once per (user, Idempotency-Key). A retry with the same key
 * and body replays the stored response; a different body with the same key is rejected.
 */
export async function idempotent(
  c: RequestContext,
  userKey: string,
  route: string,
  requestBody: unknown,
  fn: () => Promise<{ status: number; body: unknown }>,
  opts: { required?: boolean } = {},
): Promise<Response> {
  const db = requireDb(c);
  const key = idempotencyKey(c, opts.required ?? true);
  if (!key) {
    const r = await fn();
    return privateJson(r.body, r.status);
  }
  const requestHash = await sha256Hex(`${route}|${JSON.stringify(requestBody ?? null)}`, 32);
  const claimed = await db
    .prepare("INSERT INTO finance_idempotency (user_key, idem_key, route, request_hash, status, response_json, created_at) VALUES (?, ?, ?, ?, 0, 'null', ?) ON CONFLICT(user_key, idem_key) DO NOTHING")
    .bind(userKey, key, route, requestHash, c.now.toISOString())
    .run();
  if (!claimed.meta.changes) {
    const row = await db
      .prepare("SELECT route, request_hash, status, response_json FROM finance_idempotency WHERE user_key = ? AND idem_key = ?")
      .bind(userKey, key)
      .first<{ route: string; request_hash: string; status: number; response_json: string }>();
    if (!row) throw new HttpError(409, "IDEMPOTENCY_CONFLICT", "Retry the request.");
    if (row.route !== route || row.request_hash !== requestHash) {
      throw new HttpError(422, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used for a different request.");
    }
    if (row.status === 0) throw new HttpError(409, "REQUEST_IN_PROGRESS", "The same request is still being processed. Retry shortly.");
    return privateJson(JSON.parse(row.response_json), row.status, { "Idempotent-Replayed": "true" });
  }
  try {
    const r = await fn();
    await db
      .prepare("UPDATE finance_idempotency SET status = ?, response_json = ? WHERE user_key = ? AND idem_key = ?")
      .bind(r.status, JSON.stringify(r.body), userKey, key)
      .run();
    return privateJson(r.body, r.status);
  } catch (err) {
    await db.prepare("DELETE FROM finance_idempotency WHERE user_key = ? AND idem_key = ? AND status = 0").bind(userKey, key).run();
    throw err;
  }
}

/** Fixed-window rate limiter stored in D1. Returns remaining count or throws 429. */
export async function rateLimit(c: RequestContext, name: string, subject: string, limit: number, windowSeconds: number): Promise<number> {
  const db = requireDb(c);
  const windowStart = Math.floor(c.now.getTime() / 1000 / windowSeconds) * windowSeconds;
  const bucket = `${name}:${subject}:${windowStart}`;
  const row = await db
    .prepare(
      "INSERT INTO finance_rate_limits (bucket, window_start, count) VALUES (?, ?, 1) ON CONFLICT(bucket) DO UPDATE SET count = count + 1 RETURNING count",
    )
    .bind(bucket, new Date(windowStart * 1000).toISOString())
    .first<{ count: number }>();
  const count = row?.count ?? 1;
  if (count > limit) {
    const retryAfter = windowStart + windowSeconds - Math.floor(c.now.getTime() / 1000);
    throw new HttpError(429, "RATE_LIMITED", `Too many requests. Try again in ${retryAfter} seconds.`, undefined, { "Retry-After": String(Math.max(1, retryAfter)) });
  }
  return limit - count;
}
