/**
 * Minimal Worker and D1 type definitions (kept local so the module has no runtime dependency on
 * Cloudflare type packages and so Node APIs cannot be used accidentally).
 */

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: { changes?: number; last_row_id?: number; duration?: number; [k: string]: unknown };
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  raw<T = unknown[]>(): Promise<T[]>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<Array<D1Result<T>>>;
  exec(query: string): Promise<unknown>;
}

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
}

/** Environment values read by the finance module. The host supplies DB and secrets. */
export interface FinanceEnv {
  DB?: D1Database;
  FINANCE_OWNER_USER_ID?: string;
  FINANCE_PUBLIC_ORIGIN?: string;
  FINANCE_AI_PROVIDER?: string;
  FINANCE_AI_MODEL?: string;
  FINANCE_AI_API_KEY?: string;
  FINANCE_AI_DAILY_BUDGET?: string;
  FINANCE_AI_PRICE_INPUT_PER_MTOK?: string;
  FINANCE_AI_PRICE_OUTPUT_PER_MTOK?: string;
  FINANCE_AI_PRICE_DATE?: string;
  FINANCE_AI_MAX_OUTPUT_TOKENS?: string;
  FINANCE_AI_DAILY_REQUESTS?: string;
  FINANCE_JOB_SECRET?: string;
  FINANCE_SEC_USER_AGENT?: string;
  FINANCE_SCHEDULE_EXPECTED_MINUTES?: string;
  /**
   * Set to "1" only by the simulated host when upstream fetches are answered by local test fixtures.
   * A fixture response then never counts as live verification of a real endpoint. Never set in production.
   */
  FINANCE_UPSTREAM_FIXTURES?: string;
  [key: string]: unknown;
}

export type HostUser = Record<string, unknown> | null | undefined;

export interface FinanceOptions {
  /** Trusted host identity helper; returns the signed-in user or null. Never reads client-supplied headers itself. */
  getUser: (request: Request, env: FinanceEnv) => HostUser | Promise<HostUser>;
  /** Returns the D1 binding. */
  database: (env: FinanceEnv) => D1Database | undefined;
  /** Extracts a stable account ID from the host user object (default: id, then sub, then userId). */
  userIdOf?: (user: NonNullable<HostUser>) => string | null;
  clock?: () => Date;
  fetcher?: typeof fetch;
  /** Optional structured logger; receives redacted events only. */
  log?: (event: { level: "info" | "warn" | "error"; message: string; data?: Record<string, unknown> }) => void;
  /** Sign-in/out URLs of the host (defaults match kmanish.live). */
  signInPath?: string;
  signOutPath?: string;
}

export type Role = "anonymous" | "user" | "owner";

export interface Viewer {
  role: Role;
  userId: string | null;
  ownerConfigured: boolean;
}

export interface RequestContext {
  request: Request;
  url: URL;
  env: FinanceEnv;
  ctx: ExecutionContextLike | undefined;
  db: D1Database | undefined;
  viewer: Viewer;
  params: Record<string, string>;
  now: Date;
  requestId: string;
  options: Required<Pick<FinanceOptions, "clock" | "fetcher">> & FinanceOptions;
  /** True when authenticated with the maintenance secret (restricted scope). */
  maintenance: boolean;
}
