import type { SourceHealth, SourceStatusView, StatusResponse } from "../../shared/api";
import { CALC_VERSION } from "../../shared/calc/result";
import { readAiConfig } from "../ai/config";
import { signInUrl, signOutUrl } from "../auth";
import { privateJson, publicJson } from "../http";
import { archive, getResearch } from "../research";
import type { Router } from "../router";
import { loadSourceStates, SOURCES, sourceStatusView } from "../sources/registry";
import type { RequestContext } from "../types";

export const APP_VERSION = "0.1.0";

export async function schedulerStatus(c: RequestContext): Promise<StatusResponse["capabilities"]["maintenance"]> {
  const expectedMin = Number(c.env.FINANCE_SCHEDULE_EXPECTED_MINUTES ?? "360") || 360;
  if (!c.db) return { scheduler: "not_configured", lastScheduledRunAt: null, lastRunAt: null };
  try {
    const sched = await c.db.prepare("SELECT MAX(started_at) AS t FROM finance_jobs WHERE requested_by = 'scheduler'").first<{ t: string | null }>();
    const any = await c.db.prepare("SELECT MAX(started_at) AS t FROM finance_jobs").first<{ t: string | null }>();
    const last = sched?.t ?? null;
    if (!last) return { scheduler: "not_configured", lastScheduledRunAt: null, lastRunAt: any?.t ?? null };
    const age = c.now.getTime() - Date.parse(last);
    return { scheduler: age > expectedMin * 2 * 60_000 ? "stale" : "observed", lastScheduledRunAt: last, lastRunAt: any?.t ?? null };
  } catch {
    return { scheduler: "not_configured", lastScheduledRunAt: null, lastRunAt: null };
  }
}

export async function sourceViews(c: RequestContext, detailed: boolean): Promise<SourceStatusView[]> {
  const states = await loadSourceStates(c.db);
  return SOURCES.map((s) => sourceStatusView(s, states.get(s.id), c.env, c.now, detailed));
}

export function registerStatusRoutes(r: Router): void {
  r.add({
    method: "GET",
    pattern: "/api/finance/status",
    access: "public",
    handler: async (c) => {
      const view = await getResearch(c.db);
      const sources = await sourceViews(c, false);
      const summary = { working: 0, cached: 0, stale: 0, manual: 0, not_configured: 0, rate_limited: 0, access_unavailable: 0, failed: 0, never_run: 0 } as Record<SourceHealth, number>;
      for (const s of sources) summary[s.health] += 1;
      const lastSuccessAt = sources.map((s) => s.lastSuccessAt).filter(Boolean).sort().pop() ?? null;
      let feedItems = 0;
      if (c.db) {
        try {
          feedItems = (await c.db.prepare("SELECT COUNT(*) AS n FROM finance_feed_items").first<{ n: number }>())?.n ?? 0;
        } catch {
          feedItems = 0;
        }
      }
      const ai = readAiConfig(c.env);
      const returnTo = c.url.searchParams.get("return_to") ?? "/finance";
      const body: StatusResponse = {
        app: { name: "Finance Desk", version: APP_VERSION, archiveVersion: view.archiveVersion, archiveCutoff: archive.cutoff, calcVersion: CALC_VERSION },
        viewer: { signedIn: c.viewer.role !== "anonymous", role: c.viewer.role, ownerConfigured: c.viewer.ownerConfigured },
        capabilities: {
          privateData: c.viewer.role === "owner" && Boolean(c.db),
          ai: c.viewer.role === "owner" ? { enabled: ai.enabled, reason: ai.reason } : { enabled: false, reason: ai.enabled ? "Available to the site owner." : "AI features are off." },
          maintenance: await schedulerStatus(c),
        },
        sources: { summary, lastSuccessAt, items: sources.map((s) => ({ id: s.id, name: s.name, health: s.health, healthLabel: s.healthLabel, lastSuccessAt: s.lastSuccessAt })) },
        counts: { deals: view.summaries.length, companies: view.companySummaries.length, sectors: archive.sectors.length, feedItems },
        serverTime: c.now.toISOString(),
        signInUrl: signInUrl(c.options, returnTo),
        signOutUrl: signOutUrl(c.options, returnTo),
      };
      return privateJson(body);
    },
  });

  r.add({
    method: "GET",
    pattern: "/api/finance/sources",
    access: "public",
    handler: async (c) => {
      const items = await sourceViews(c, false);
      return publicJson(c.request, { items, scheduler: await schedulerStatus(c) }, { maxAge: 30 });
    },
  });
}
