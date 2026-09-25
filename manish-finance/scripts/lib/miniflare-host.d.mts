// Types for the simulated-host helper used by Worker tests, Playwright and `npm run dev`.
import type { Miniflare } from "miniflare";

export function splitSql(sql: string): string[];
export function applyMigrations(db: unknown, root: string): Promise<string[]>;
export function startHost(opts: {
  root: string;
  port?: number;
  persistDir?: string;
  bindings?: Record<string, string>;
  outboundService?: (request: Request) => Response | Promise<Response>;
  log?: boolean;
}): Promise<{ mf: Miniflare; url: URL; db: unknown; jobSecret: string; options: Record<string, unknown> }>;
