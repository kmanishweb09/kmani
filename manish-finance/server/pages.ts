import BUILD from "virtual:finance-build-info";
import { SECURITY_HEADERS } from "./http";

/**
 * Finance page routing helpers for the host. Only documented /finance routes serve the SPA shell;
 * unknown extension-less /finance paths get the shell with status 404 (the app renders its own
 * not-found view); paths that look like files never receive HTML.
 */

export type FinanceRoute =
  | { kind: "api" }
  | { kind: "page"; status: 200 | 404 }
  | { kind: "redirect"; location: string; status: 301 | 308 }
  | { kind: "asset_miss" }
  | null;

const PAGE_PATTERNS: RegExp[] = [
  /^\/finance$/,
  /^\/finance\/(deals|sectors|companies|lab|briefs|notebook|sources|settings)$/,
  /^\/finance\/deals\/compare$/,
  /^\/finance\/deals\/[a-z0-9][a-z0-9-]{0,95}$/,
  /^\/finance\/sectors\/[a-z0-9][a-z0-9-]{0,95}$/,
  /^\/finance\/companies\/[a-z0-9][a-z0-9-]{0,95}$/,
  /^\/finance\/briefs\/[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/,
  /^\/finance\/notebook\/[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/,
];

export function isFinanceApiPath(pathname: string): boolean {
  return pathname === "/api/finance" || pathname.startsWith("/api/finance/");
}

export function classifyFinanceRequest(request: Request | URL | string): FinanceRoute {
  const url = typeof request === "string" ? new URL(request) : request instanceof URL ? request : new URL(request.url);
  const path = url.pathname;
  if (isFinanceApiPath(path)) return { kind: "api" };
  if (path !== "/finance" && !path.startsWith("/finance/")) return null;
  if (path.length > 1 && path.endsWith("/")) {
    const trimmed = path.replace(/\/+$/, "");
    if (trimmed === "/finance" || trimmed.startsWith("/finance/")) {
      return { kind: "redirect", location: `${trimmed}${url.search}`, status: 308 };
    }
  }
  const last = path.split("/").pop() ?? "";
  if (last.includes(".")) return { kind: "asset_miss" };
  if (PAGE_PATTERNS.some((re) => re.test(path))) return { kind: "page", status: 200 };
  return { kind: "page", status: 404 };
}

export function financeContentSecurityPolicy(): string {
  const scriptHash = BUILD.pageScriptHash ? ` 'sha256-${BUILD.pageScriptHash}'` : "";
  return [
    "default-src 'self'",
    `script-src 'self'${scriptHash}`,
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** Builds the response for a /finance page request given the finance.html shell from the host's assets. */
export function financePageResponse(request: Request, html: string | null | undefined): Response {
  const route = classifyFinanceRequest(request);
  if (!route || route.kind === "api") {
    return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", ...SECURITY_HEADERS } });
  }
  if (route.kind === "redirect") {
    return new Response(null, { status: route.status, headers: { Location: route.location, "Cache-Control": "no-cache", ...SECURITY_HEADERS } });
  }
  if (route.kind === "asset_miss" || !html) {
    return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache", ...SECURITY_HEADERS } });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8", ...SECURITY_HEADERS } });
  }
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache",
    "Content-Security-Policy": financeContentSecurityPolicy(),
    ...SECURITY_HEADERS,
  });
  return new Response(request.method === "HEAD" ? null : html, { status: route.status, headers });
}

export const FINANCE_BUILD = BUILD;
