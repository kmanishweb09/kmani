import type { D1Database, FinanceEnv } from "../types";

export interface MaintenanceOptions {
  jobs?: string[];
  requestedBy?: "scheduler" | "maintenance" | "owner" | "owner_session";
  idempotencyKey?: string;
}

export interface MaintenanceReport {
  ok: boolean;
  jobs: Array<{ job: string; status: string; detail?: unknown }>;
}

export async function runMaintenanceJobs(
  _deps: { env: FinanceEnv; db: D1Database | undefined; now: Date; fetcher: typeof fetch; log: (e: { level: "info" | "warn" | "error"; message: string; data?: Record<string, unknown> }) => void },
  _options: MaintenanceOptions = {},
): Promise<MaintenanceReport> {
  return { ok: true, jobs: [] };
}
