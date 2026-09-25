// Starts the simulated host (release bundle + harness) in workerd with an in-memory D1 for Worker tests.
import { startHost } from "../../scripts/lib/miniflare-host.mjs";

export interface TestHost {
  mf: { dispatchFetch: (url: string, init?: Record<string, unknown>) => Promise<Response>; dispose: () => Promise<void> };
  db: { prepare: (sql: string) => { bind: (...v: unknown[]) => { run: () => Promise<unknown>; first: <T>() => Promise<T | null>; all: <T>() => Promise<{ results: T[] }> }; run: () => Promise<unknown>; first: <T>() => Promise<T | null>; all: <T>() => Promise<{ results: T[] }> } };
  jobSecret: string;
}

export type Outbound = (request: Request) => Response | Promise<Response>;

export async function startTestHost(opts: { bindings?: Record<string, string>; outbound?: Outbound } = {}): Promise<TestHost> {
  // Outbound fetches never reach the network in tests: an unmatched request fails loudly.
  const outbound: Outbound = opts.outbound ?? ((req) => new Response(`unexpected outbound fetch to ${req.url}`, { status: 599 }));
  // Upstreams are always fixtures here, and the Worker is told so (no fixture response counts as live).
  const h = await startHost({ root: process.cwd(), bindings: { FINANCE_UPSTREAM_FIXTURES: "1", ...(opts.bindings ?? {}) }, outboundService: outbound });
  return h as unknown as TestHost;
}

export interface ApiResult<T = Record<string, unknown>> {
  status: number;
  headers: Headers;
  json: T;
  text: string;
}

export async function api<T = Record<string, unknown>>(
  h: TestHost,
  path: string,
  opts: { method?: string; body?: unknown; as?: "owner" | "visitor"; headers?: Record<string, string>; idem?: string; noCsrf?: boolean } = {},
): Promise<ApiResult<T>> {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.as) headers.Cookie = `harness_session=${opts.as}`;
  if (method !== "GET" && method !== "HEAD" && !opts.noCsrf) {
    headers.Origin ??= "http://localhost";
    headers["X-Finance-Request"] ??= "1";
  }
  if (opts.body !== undefined) headers["Content-Type"] ??= "application/json";
  if (opts.idem) headers["Idempotency-Key"] = opts.idem;
  const res = await h.mf.dispatchFetch(`http://localhost${path}`, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, redirect: "manual" });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, json: json as T, text };
}

let seq = 0;
export const idem = (label = "k"): string => `${label}-${Date.now().toString(36)}-${(seq++).toString(36)}-test`.slice(0, 80);
