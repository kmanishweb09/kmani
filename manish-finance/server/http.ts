import type { ApiErrorBody } from "../shared/api";

/**
 * Response helpers. Public research responses may be cached; anything that depends on the viewer
 * or contains private data is `private, no-store`. Finance-only security headers are applied here
 * so no site-wide policy is imposed on other kmanish.live routes.
 */

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Resource-Policy": "same-origin",
};

export class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;
  headers?: Record<string, string>;
  constructor(status: number, code: string, message: string, details?: unknown, headers?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    if (headers) this.headers = headers;
  }
}

function baseHeaders(extra?: Record<string, string>): Headers {
  const h = new Headers({ "Content-Type": "application/json; charset=utf-8", ...SECURITY_HEADERS });
  if (extra) for (const [k, v] of Object.entries(extra)) h.set(k, v);
  return h;
}

export function privateJson(data: unknown, status = 200, extra?: Record<string, string>): Response {
  const h = baseHeaders(extra);
  h.set("Cache-Control", "private, no-store");
  h.set("Vary", "Cookie, Authorization");
  return new Response(JSON.stringify(data), { status, headers: h });
}

/** Public research data: cacheable, identical for every viewer, validated with a strong ETag. */
export async function publicJson(request: Request, data: unknown, opts: { maxAge?: number; etagSeed?: string } = {}): Promise<Response> {
  const body = JSON.stringify(data);
  const etag = `"${await sha256Hex(`${opts.etagSeed ?? ""}|${body}`, 24)}"`;
  const h = baseHeaders();
  h.set("Cache-Control", `public, max-age=${opts.maxAge ?? 60}, stale-while-revalidate=300`);
  h.set("ETag", etag);
  const inm = request.headers.get("If-None-Match");
  if (inm && inm.split(",").map((s) => s.trim()).includes(etag)) {
    return new Response(null, { status: 304, headers: h });
  }
  return new Response(body, { status: 200, headers: h });
}

export function errorJson(status: number, code: string, message: string, details?: unknown, requestId?: string, extra?: Record<string, string>): Response {
  const body: ApiErrorBody = { error: { code, message, ...(details !== undefined ? { details } : {}), ...(requestId ? { requestId } : {}) } };
  const h = baseHeaders(extra);
  h.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { status, headers: h });
}

export function textResponse(body: string, contentType: string, opts: { status?: number; filename?: string; private?: boolean } = {}): Response {
  const h = new Headers({ "Content-Type": contentType, ...SECURITY_HEADERS });
  h.set("Cache-Control", opts.private ? "private, no-store" : "public, max-age=60");
  if (opts.filename) h.set("Content-Disposition", `attachment; filename="${opts.filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`);
  return new Response(body, { status: opts.status ?? 200, headers: h });
}

export async function sha256Hex(input: string, length = 64): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, length);
}

/** Reads a JSON body with a size limit and content-type check. */
export async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const ct = request.headers.get("Content-Type") ?? "";
  if (!ct.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Send the request body as application/json.");
  }
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (declared > maxBytes) throw new HttpError(413, "PAYLOAD_TOO_LARGE", `Request body exceeds ${maxBytes} bytes.`);
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "EMPTY_BODY", "Request body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, "PAYLOAD_TOO_LARGE", `Request body exceeds ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  const text = new TextDecoder().decode(buf);
  if (!text.trim()) throw new HttpError(400, "EMPTY_BODY", "Request body is required.");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body is not valid JSON.");
  }
}

/** Converts zod-style issues into a stable validation error. */
export function validationError(issues: Array<{ path: PropertyKey[]; message: string }>): HttpError {
  return new HttpError(
    400,
    "VALIDATION_FAILED",
    "Some fields are invalid.",
    issues.slice(0, 20).map((i) => ({ path: i.path.map(String).join("."), message: i.message })),
  );
}

export function withHeadSupport(request: Request, response: Response): Response {
  if (request.method !== "HEAD") return response;
  return new Response(null, { status: response.status, headers: response.headers });
}
