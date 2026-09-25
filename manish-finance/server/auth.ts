import { HttpError } from "./http";
import type { FinanceEnv, FinanceOptions, HostUser, RequestContext, Viewer } from "./types";

/**
 * Authorization. Identity comes only from the host's trusted getUser helper; the finance module
 * never trusts user IDs in bodies, query strings or client-controlled headers. Owner access is
 * granted only when the host user ID equals FINANCE_OWNER_USER_ID (fail closed when unset).
 */

export function defaultUserIdOf(user: NonNullable<HostUser>): string | null {
  for (const key of ["id", "sub", "userId", "user_id"]) {
    const v = (user as Record<string, unknown>)[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

export async function resolveViewer(request: Request, env: FinanceEnv, options: FinanceOptions): Promise<Viewer> {
  const ownerId = typeof env.FINANCE_OWNER_USER_ID === "string" ? env.FINANCE_OWNER_USER_ID.trim() : "";
  const ownerConfigured = ownerId.length > 0;
  let user: HostUser = null;
  try {
    user = await options.getUser(request, env);
  } catch {
    // A failing identity helper is treated as signed out (fail closed).
    user = null;
  }
  if (!user) return { role: "anonymous", userId: null, ownerConfigured };
  const userId = (options.userIdOf ?? defaultUserIdOf)(user);
  if (!userId) return { role: "anonymous", userId: null, ownerConfigured };
  const isOwner = ownerConfigured && timingSafeEqual(userId, ownerId);
  return { role: isOwner ? "owner" : "user", userId, ownerConfigured };
}

export function requireOwner(c: RequestContext): string {
  if (c.viewer.role === "anonymous") throw new HttpError(401, "SIGN_IN_REQUIRED", "Sign in as the site owner to use private research features.");
  if (!c.viewer.ownerConfigured) {
    throw new HttpError(503, "OWNER_NOT_CONFIGURED", "Private features are disabled until FINANCE_OWNER_USER_ID is configured on the server.");
  }
  if (c.viewer.role !== "owner" || !c.viewer.userId) throw new HttpError(403, "OWNER_ONLY", "This action is limited to the site owner.");
  return c.viewer.userId;
}

/** Constant-time string comparison for identifiers and secrets. */
export function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

export function allowedOrigin(c: Pick<RequestContext, "env" | "url">): string {
  const configured = typeof c.env.FINANCE_PUBLIC_ORIGIN === "string" ? c.env.FINANCE_PUBLIC_ORIGIN.trim().replace(/\/+$/, "") : "";
  return configured || c.url.origin;
}

/**
 * CSRF / same-origin protection for cookie-authenticated state changes: the Origin (or Referer)
 * must match the finance origin, Sec-Fetch-Site must not be cross-site, and a custom header that
 * cross-origin pages cannot send without a CORS preflight (which is never granted) must be present.
 */
export function assertSameOriginWrite(c: RequestContext): void {
  const req = c.request;
  const expected = allowedOrigin(c);
  const origin = req.headers.get("Origin");
  const site = req.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin" && site !== "none") {
    throw new HttpError(403, "CROSS_SITE_REQUEST", "Cross-site requests cannot change finance data.");
  }
  if (origin) {
    if (origin !== expected) throw new HttpError(403, "ORIGIN_MISMATCH", "Request origin is not allowed.");
  } else {
    const referer = req.headers.get("Referer");
    if (referer) {
      let refOrigin = "";
      try {
        refOrigin = new URL(referer).origin;
      } catch {
        refOrigin = "";
      }
      if (refOrigin !== expected) throw new HttpError(403, "ORIGIN_MISMATCH", "Request origin is not allowed.");
    } else if (!site) {
      throw new HttpError(403, "ORIGIN_REQUIRED", "State-changing requests must come from the finance app.");
    }
  }
  if (req.headers.get("X-Finance-Request") !== "1") {
    throw new HttpError(403, "CSRF_HEADER_MISSING", "Missing X-Finance-Request header.");
  }
}

/** Verifies the restricted maintenance credential (Authorization: Bearer <FINANCE_JOB_SECRET>). Never accepted via URL. */
export function isMaintenanceCaller(request: Request, env: FinanceEnv): boolean {
  const secret = typeof env.FINANCE_JOB_SECRET === "string" ? env.FINANCE_JOB_SECRET : "";
  if (secret.length < 32) return false;
  const auth = request.headers.get("Authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) return false;
  return timingSafeEqual((m[1] as string).trim(), secret);
}

const RETURN_TO_RE = /^\/finance(?:\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*)?(?:\?[A-Za-z0-9._~!$&'()*+,;=:@%/?-]*)?$/;

/** Accepts only local /finance paths (no scheme, host, protocol-relative or backslash tricks). */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value) return "/finance";
  let v = value;
  try {
    v = decodeURIComponent(value);
  } catch {
    return "/finance";
  }
  if (v.length > 512 || v.includes("\\") || v.startsWith("//") || /[\u0000-\u001f\u007f]/.test(v)) return "/finance";
  if (!RETURN_TO_RE.test(v)) return "/finance";
  if (v.includes("/../") || v.endsWith("/..")) return "/finance";
  return v;
}

export function signInUrl(options: FinanceOptions, returnTo: string): string {
  return `${options.signInPath ?? "/signin-with-chatgpt"}?return_to=${encodeURIComponent(safeReturnTo(returnTo))}`;
}

export function signOutUrl(options: FinanceOptions, returnTo: string): string {
  return `${options.signOutPath ?? "/signout-with-chatgpt"}?return_to=${encodeURIComponent(safeReturnTo(returnTo))}`;
}
