import { requireOwner } from "../auth";
import { archiveBriefOut, archiveBriefs, type BriefOut, type BriefRow, briefToMarkdown, rowToBriefOut, todayLocal } from "../briefs";
import { listFeed } from "../feedStore";
import { HttpError, privateJson, publicJson, textResponse } from "../http";
import { getResearch } from "../research";
import type { Router } from "../router";
import type { RequestContext } from "../types";
import { schedulerStatus } from "./status";

async function scheduleNote(c: RequestContext): Promise<string> {
  const s = await schedulerStatus(c);
  if (s.scheduler === "observed") return "The daily brief is compiled at about 07:30 IST by the connected scheduler.";
  if (s.scheduler === "stale") return "The background scheduler has not run recently; the owner can compile a brief on demand.";
  return "Background schedule not configured: the daily brief (target 07:30 IST) is compiled only when the owner requests it.";
}

async function d1Briefs(c: RequestContext, where: string, binds: unknown[], limit = 60): Promise<BriefRow[]> {
  if (!c.db) return [];
  try {
    const rows = await c.db.prepare(`SELECT * FROM finance_briefs WHERE status = 'published' AND ${where} ORDER BY brief_date DESC, version DESC LIMIT ?`).bind(...binds, limit).all<BriefRow>();
    // Keep only the latest version per (scope, user, kind, date).
    const seen = new Set<string>();
    return (rows.results ?? []).filter((r) => {
      const k = `${r.scope}|${r.user_key}|${r.kind}|${r.brief_date}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  } catch {
    return [];
  }
}

function summary(b: BriefOut) {
  return {
    id: b.id,
    kind: b.kind,
    title: b.title,
    label: b.label,
    periodStart: b.periodStart,
    periodEnd: b.periodEnd,
    cutoffAt: b.cutoffAt,
    generatedAt: b.generatedAt,
    method: b.method,
    origin: b.origin,
    itemCount: b.items.length,
    sectors: [...new Set(b.items.flatMap((i) => i.sectors))],
    scope: b.scope,
  };
}

async function loadBrief(c: RequestContext, id: string): Promise<BriefOut> {
  const view = await getResearch(c.db);
  const ab = archiveBriefs().find((b) => b.id === id);
  if (ab) return archiveBriefOut(ab, view);
  if (!/^[bp]_[A-Za-z0-9_-]{8,64}$/.test(id) || !c.db) throw new HttpError(404, "NOT_FOUND", "Brief not found.");
  if (id.startsWith("p_")) {
    const userId = requireOwner(c);
    const row = await c.db.prepare("SELECT * FROM finance_briefs WHERE id = ? AND scope = 'private' AND user_key = ?").bind(id, userId).first<BriefRow>();
    if (!row) throw new HttpError(404, "NOT_FOUND", "Brief not found.");
    return rowToBriefOut(row, view, c.db);
  }
  const row = await c.db.prepare("SELECT * FROM finance_briefs WHERE id = ? AND scope = 'public'").bind(id).first<BriefRow>();
  if (!row) throw new HttpError(404, "NOT_FOUND", "Brief not found.");
  return rowToBriefOut(row, view, c.db);
}

export function registerFeedRoutes(r: Router): void {
  r.add({
    method: "GET",
    pattern: "/api/finance/feed",
    access: "public",
    handler: async (c) => {
      const days = Math.min(90, Math.max(1, Number(c.url.searchParams.get("days") ?? "7") || 7));
      const sector = c.url.searchParams.get("sector") ?? undefined;
      const page = Math.max(1, Number(c.url.searchParams.get("page") ?? "1") || 1);
      const since = new Date(c.now.getTime() - days * 86_400_000).toISOString();
      const res = await listFeed(c.db, { sinceIso: since, ...(sector ? { sector } : {}), limit: 50, offset: (page - 1) * 50 });
      return publicJson(c.request, { ...res, page, pageSize: 50, windowDays: days, note: "Source-linked items discovered by connectors. Leads are not verified deal terms." }, { maxAge: 60 });
    },
  });

  r.add({
    method: "GET",
    pattern: "/api/finance/briefs",
    access: "public",
    handler: async (c) => {
      const kind = c.url.searchParams.get("kind");
      const sector = c.url.searchParams.get("sector");
      const scope = c.url.searchParams.get("scope") === "private" ? "private" : "public";
      const view = await getResearch(c.db);
      let rows: BriefRow[];
      if (scope === "private") {
        const userId = requireOwner(c);
        rows = await d1Briefs(c, "scope = 'private' AND user_key = ?", [userId]);
      } else {
        rows = await d1Briefs(c, "scope = 'public'", []);
      }
      const generated = await Promise.all(rows.map((row) => rowToBriefOut(row, view, c.db)));
      const all = [...generated, ...(scope === "public" ? archiveBriefs().map((b) => archiveBriefOut(b, view)) : [])]
        .filter((b) => !kind || b.kind === kind)
        .filter((b) => !sector || b.items.some((i) => i.sectors.includes(sector)))
        .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd) || b.generatedAt.localeCompare(a.generatedAt));
      const today = todayLocal(c);
      const todays = generated.find((b) => b.kind === "daily" && b.periodEnd === today) ?? null;
      const body = { items: all.map(summary), today, todaysBriefId: todays?.id ?? null, scheduleNote: await scheduleNote(c) };
      return scope === "private" ? privateJson(body) : publicJson(c.request, body, { maxAge: 60 });
    },
  });

  r.add({
    method: "GET",
    pattern: "/api/finance/briefs/today",
    access: "public",
    handler: async (c) => {
      const view = await getResearch(c.db);
      const today = todayLocal(c);
      let todayRow: BriefRow | undefined;
      let latestRow: BriefRow | undefined;
      if (c.viewer.role === "owner" && c.viewer.userId) {
        const priv = await d1Briefs(c, "scope = 'private' AND user_key = ? AND kind = 'daily'", [c.viewer.userId], 5);
        todayRow = priv.find((r) => r.brief_date === today);
        latestRow = priv[0];
      }
      const pub = await d1Briefs(c, "scope = 'public' AND kind = 'daily'", [], 5);
      todayRow = todayRow ?? pub.find((r) => r.brief_date === today);
      latestRow = latestRow ?? pub[0];
      const brief = todayRow ? await rowToBriefOut(todayRow, view, c.db) : null;
      let latest: BriefOut | null = null;
      if (!brief) {
        if (latestRow) latest = await rowToBriefOut(latestRow, view, c.db);
        else {
          const ex = [...archiveBriefs()].filter((b) => b.kind === "daily").sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0];
          latest = ex ? archiveBriefOut(ex, view) : null;
        }
      }
      return privateJson({ today, brief, latest, scheduleNote: await scheduleNote(c) });
    },
  });

  r.add({
    method: "GET",
    pattern: "/api/finance/briefs/:id/export.md",
    access: "public",
    handler: async (c) => {
      const b = await loadBrief(c, c.params.id ?? "");
      return textResponse(briefToMarkdown(b), "text/markdown; charset=utf-8", { filename: `finance-brief-${b.periodEnd}.md`, private: b.scope === "private" });
    },
  });

  r.add({
    method: "GET",
    pattern: "/api/finance/briefs/:id",
    access: "public",
    handler: async (c) => {
      const b = await loadBrief(c, c.params.id ?? "");
      return b.scope === "private" ? privateJson(b) : publicJson(c.request, b, { maxAge: 300 });
    },
  });
}
