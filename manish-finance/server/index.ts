import { assertSameOriginWrite, isMaintenanceCaller, requireOwner, resolveViewer } from "./auth";
import { newId } from "./db";
import { errorJson, HttpError, withHeadSupport } from "./http";
import { runMaintenanceJobs, type MaintenanceOptions, type MaintenanceReport } from "./jobs/runner";
import { classifyFinanceRequest, financePageResponse, isFinanceApiPath } from "./pages";
import { registerAdminRoutes } from "./routes/admin";
import { registerAiRoutes } from "./routes/ai";
import { registerCurationRoutes } from "./routes/curation";
import { registerFeedRoutes } from "./routes/feed";
import { registerPrivateRoutes } from "./routes/private";
import { registerPublicRoutes } from "./routes/public";
import { registerStatusRoutes } from "./routes/status";
import { Router } from "./router";
import type { ExecutionContextLike, FinanceEnv, FinanceOptions, RequestContext } from "./types";

export type { FinanceEnv, FinanceOptions } from "./types";
export { classifyFinanceRequest, financePageResponse } from "./pages";

const DEFAULT_BODY_LIMIT = 256 * 1024;

function buildRouter(): Router {
  const r = new Router();
  registerStatusRoutes(r);
  registerPublicRoutes(r);
  registerFeedRoutes(r);
  registerPrivateRoutes(r);
  registerAdminRoutes(r);
  registerCurationRoutes(r);
  registerAiRoutes(r);
  return r;
}

export interface FinanceModule {
  /** Handles /api/finance and /api/finance/* only. */
  fetch(request: Request, env: FinanceEnv, ctx?: ExecutionContextLike): Promise<Response>;
  /** Bounded, idempotent maintenance jobs for a scheduler or the host. */
  runMaintenance(env: FinanceEnv, options?: MaintenanceOptions): Promise<MaintenanceReport>;
  /** Serves a /finance page route from the host's finance.html asset (or redirects/404s). */
  page(request: Request, html: string | null | undefined): Response;
}

export function createFinance(options: FinanceOptions): FinanceModule {
  if (typeof options?.getUser !== "function") throw new Error("createFinance: getUser(request, env) is required");
  if (typeof options?.database !== "function") throw new Error("createFinance: database(env) is required");
  const clock = options.clock ?? (() => new Date());
  const fetcher: typeof fetch = options.fetcher ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const opts = { ...options, clock, fetcher };
  const router = buildRouter();
  const log = options.log ?? (() => undefined);

  async function handle(request: Request, env: FinanceEnv, ctx?: ExecutionContextLike): Promise<Response> {
    const url = new URL(request.url);
    const requestId = newId("r").slice(0, 14);
    if (!isFinanceApiPath(url.pathname)) return errorJson(404, "NOT_FOUND", "Not a finance API route.", undefined, requestId);
    if (request.method === "OPTIONS") {
      // Cross-origin preflights are never granted.
      return errorJson(405, "METHOD_NOT_ALLOWED", "CORS is not enabled for the finance API.", undefined, requestId, { Allow: "GET, HEAD, POST, PATCH, PUT, DELETE" });
    }
    const match = router.match(request.method, url.pathname);
    if (match.kind === "not_found") return withHeadSupport(request, errorJson(404, "NOT_FOUND", "Unknown finance API route.", undefined, requestId));
    if (match.kind === "method_not_allowed") {
      return errorJson(405, "METHOD_NOT_ALLOWED", `Use ${match.allowed.join(", ")}.`, undefined, requestId, { Allow: match.allowed.join(", ") });
    }
    const viewer = await resolveViewer(request, env, opts);
    const maintenance = isMaintenanceCaller(request, env);
    const c: RequestContext = {
      request,
      url,
      env,
      ctx,
      db: options.database(env),
      viewer,
      params: match.params,
      now: clock(),
      requestId,
      options: opts,
      maintenance,
    };
    try {
      const { route } = match;
      if (route.access === "owner") requireOwner(c);
      if (route.access === "owner_or_maintenance" && !maintenance) requireOwner(c);
      const isWrite = request.method !== "GET" && request.method !== "HEAD";
      if (isWrite && !maintenance) assertSameOriginWrite(c);
      if (isWrite) {
        const declared = Number(request.headers.get("Content-Length") ?? "0");
        if (declared > (route.bodyLimit ?? DEFAULT_BODY_LIMIT)) {
          // Tell the runtime the body will not be read, so the early 413 does not race the upload.
          await request.body?.cancel().catch(() => undefined);
          throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
        }
      }
      const res = await route.handler(c);
      return withHeadSupport(request, res);
    } catch (err) {
      if (err instanceof HttpError) {
        return withHeadSupport(request, errorJson(err.status, err.code, err.message, err.details, requestId, err.headers));
      }
      log({ level: "error", message: "finance request failed", data: { requestId, path: url.pathname, error: err instanceof Error ? err.message.slice(0, 200) : "unknown" } });
      return withHeadSupport(request, errorJson(500, "INTERNAL_ERROR", "The finance service hit an unexpected error. Try again; the request ID helps diagnose it.", undefined, requestId));
    }
  }

  return {
    fetch: handle,
    runMaintenance: (env, mOptions) => runMaintenanceJobs({ env, db: options.database(env), now: clock(), fetcher, log }, mOptions),
    page: (request, html) => financePageResponse(request, html),
  };
}

/** Convenience for hosts: classify first, then dispatch (see docs/DEPLOYMENT_HANDOFF.md). */
export function routeKind(request: Request): ReturnType<typeof classifyFinanceRequest> {
  return classifyFinanceRequest(request);
}
