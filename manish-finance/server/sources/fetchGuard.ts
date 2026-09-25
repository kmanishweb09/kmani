/**
 * Server-side fetch guard for source connectors. There is no generic proxy: callers pass the
 * connector's registered host allowlist and every request (including each redirect hop) is checked.
 *
 * Rejected: non-HTTPS schemes, credentials in URLs, IP literals (IPv4 in dotted/decimal/hex/octal
 * forms, IPv6), localhost and internal-looking names, hosts outside the allowlist, redirects
 * outside it, more than `maxRedirects` hops, oversize bodies and slow responses.
 */

export class FetchGuardError extends Error {
  constructor(
    readonly code: "INVALID_URL" | "SCHEME_NOT_ALLOWED" | "CREDENTIALS_IN_URL" | "IP_LITERAL" | "HOST_NOT_ALLOWED" | "PRIVATE_HOST" | "TOO_MANY_REDIRECTS" | "REDIRECT_NOT_ALLOWED" | "RESPONSE_TOO_LARGE" | "TIMEOUT" | "NETWORK_ERROR",
    message: string,
  ) {
    super(message);
    this.name = "FetchGuardError";
  }
}

const INTERNAL_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home", ".corp", ".arpa"];

function looksLikeIpv4(host: string): boolean {
  // Dotted quads, and also single-number (decimal/hex/octal) and mixed forms that URL parsers may normalise.
  if (/^[0-9.]+$/.test(host)) return true;
  if (/^0x[0-9a-f]+$/i.test(host)) return true;
  return host.split(".").every((p) => /^(0x[0-9a-f]+|0[0-7]*|[0-9]+)$/i.test(p)) && host.split(".").length <= 4;
}

/** Validates a URL against an allowlist. Returns the parsed URL or throws FetchGuardError. */
export function checkUrl(raw: string, allowedHosts: readonly string[] | null): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchGuardError("INVALID_URL", "Not a valid absolute URL.");
  }
  if (url.protocol !== "https:") throw new FetchGuardError("SCHEME_NOT_ALLOWED", "Only https URLs are fetched.");
  if (url.username || url.password) throw new FetchGuardError("CREDENTIALS_IN_URL", "URLs containing credentials are rejected.");
  if (url.port && url.port !== "443") throw new FetchGuardError("HOST_NOT_ALLOWED", "Non-standard ports are not allowed.");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[") || host.includes(":")) throw new FetchGuardError("IP_LITERAL", "IPv6 literals are rejected.");
  if (looksLikeIpv4(host)) throw new FetchGuardError("IP_LITERAL", "IP address literals are rejected.");
  if (host === "localhost" || INTERNAL_SUFFIXES.some((s) => host.endsWith(s)) || !host.includes(".")) {
    throw new FetchGuardError("PRIVATE_HOST", "Internal or single-label host names are rejected.");
  }
  if (allowedHosts !== null && !allowedHosts.map((h) => h.toLowerCase()).includes(host)) {
    throw new FetchGuardError("HOST_NOT_ALLOWED", `Host ${host} is not in this source's registered allowlist.`);
  }
  url.hostname = host;
  return url;
}

/** Validates a link that will be stored and shown but never fetched (manual sources, corrections). */
export function checkPublicLink(raw: string): URL {
  return checkUrl(raw, null);
}

export interface GuardedFetchOptions {
  allowedHosts: readonly string[];
  fetcher: typeof fetch;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  etag?: string | null;
  lastModified?: string | null;
}

export interface GuardedResponse {
  status: number;
  finalUrl: string;
  notModified: boolean;
  etag: string | null;
  lastModified: string | null;
  contentType: string | null;
  /** Raw Retry-After header (seconds or HTTP date), if the upstream sent one. */
  retryAfter: string | null;
  text: string;
}

async function readLimited(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared && declared > maxBytes) throw new FetchGuardError("RESPONSE_TOO_LARGE", `Response exceeds ${maxBytes} bytes.`);
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new FetchGuardError("RESPONSE_TOO_LARGE", `Response exceeds ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(buf);
}

/** Fetches with manual redirect handling so each hop is re-validated against the allowlist. */
export async function guardedFetch(rawUrl: string, opts: GuardedFetchOptions): Promise<GuardedResponse> {
  const maxRedirects = opts.maxRedirects ?? 3;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;
  let url = checkUrl(rawUrl, opts.allowedHosts);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let hop = 0; ; hop++) {
      const headers: Record<string, string> = { accept: "application/json, application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8", ...(opts.headers ?? {}) };
      if (hop === 0 && opts.etag) headers["if-none-match"] = opts.etag;
      if (hop === 0 && opts.lastModified) headers["if-modified-since"] = opts.lastModified;
      let res: Response;
      try {
        res = await opts.fetcher(url.toString(), { method: "GET", headers, redirect: "manual", signal: controller.signal });
      } catch (e) {
        if (controller.signal.aborted) throw new FetchGuardError("TIMEOUT", `No response within ${timeoutMs} ms.`);
        throw new FetchGuardError("NETWORK_ERROR", e instanceof Error ? e.message.slice(0, 200) : "Network error");
      }
      if (res.status >= 300 && res.status < 400 && res.status !== 304) {
        const loc = res.headers.get("location");
        await res.body?.cancel().catch(() => undefined);
        if (!loc) throw new FetchGuardError("REDIRECT_NOT_ALLOWED", "Redirect without a Location header.");
        if (hop + 1 > maxRedirects) throw new FetchGuardError("TOO_MANY_REDIRECTS", `More than ${maxRedirects} redirects.`);
        let next: URL;
        try {
          next = new URL(loc, url);
        } catch {
          throw new FetchGuardError("REDIRECT_NOT_ALLOWED", "Invalid redirect target.");
        }
        try {
          url = checkUrl(next.toString(), opts.allowedHosts);
        } catch (e) {
          throw new FetchGuardError("REDIRECT_NOT_ALLOWED", `Redirect rejected: ${(e as Error).message}`);
        }
        continue;
      }
      const common = { status: res.status, finalUrl: url.toString(), etag: res.headers.get("etag"), lastModified: res.headers.get("last-modified"), contentType: res.headers.get("content-type"), retryAfter: res.headers.get("retry-after") };
      if (res.status === 304) {
        await res.body?.cancel().catch(() => undefined);
        return { ...common, notModified: true, text: "" };
      }
      const text = await readLimited(res, maxBytes);
      return { ...common, notModified: false, text };
    }
  } catch (e) {
    if (e instanceof FetchGuardError) throw e;
    if (controller.signal.aborted) throw new FetchGuardError("TIMEOUT", `No response within ${timeoutMs} ms.`);
    throw new FetchGuardError("NETWORK_ERROR", e instanceof Error ? e.message.slice(0, 200) : "Network error");
  } finally {
    clearTimeout(timer);
  }
}

/** Removes tracking parameters and fragments so the same document dedupes across links. */
export function canonicalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ref$|ref_src$)/i.test(k)) u.searchParams.delete(k);
    }
    u.hostname = u.hostname.toLowerCase().replace(/\.$/, "");
    if ((u.protocol === "https:" && u.port === "443") || (u.protocol === "http:" && u.port === "80")) u.port = "";
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.replace(/\/+$/, "");
    return u.toString();
  } catch {
    return raw.trim();
  }
}
