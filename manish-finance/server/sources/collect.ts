import { addDays, localDate } from "../../shared/dates";
import { parseJsonColumn } from "../db";
import { sha256Hex } from "../http";
import { getResearch, type ResearchView } from "../research";
import type { D1Database, FinanceEnv } from "../types";
import { canonicalizeUrl, FetchGuardError, guardedFetch, type GuardedResponse } from "./fetchGuard";
import { classifyHeadline, clusterKey, linkEntities, sectorsFor, type FeedEntity } from "./link";
import { getSource, type SourceDefinition, type SourceStateRow } from "./registry";
import { FeedParseError, parseFeed } from "./rss";
import { parseSubmissions, SecParseError, secEventType } from "./sec";

/**
 * Source collection: fetch permitted metadata → normalise → deduplicate → link entities → store as
 * source documents and feed items (leads) → queue deal-linked items for owner review. Nothing here
 * edits a deal record; publication happens only through the review queue.
 */

export interface CollectDeps {
  db: D1Database;
  env: FinanceEnv;
  now: Date;
  fetcher: typeof fetch;
  log?: (e: { level: "info" | "warn" | "error"; message: string; data?: Record<string, unknown> }) => void;
}

export type RefreshStatus = "working" | "not_modified" | "manual" | "not_configured" | "disabled" | "backoff" | "busy" | "rate_limited" | "access_unavailable" | "failed";

export interface RefreshOutcome {
  sourceId: string;
  status: RefreshStatus;
  httpStatus: number | null;
  fetched: number;
  inserted: number;
  updated: number;
  duplicates: number;
  reviewItems: number;
  message: string | null;
  retryAt: string | null;
  firstLiveSuccess: boolean;
}

export interface NormalizedItem {
  providerItemId: string | null;
  url: string;
  title: string;
  publishedAt: string | null;
  publishedDate: string | null;
  eventDate: string | null;
  eventType: string;
  excerpt: string | null;
  locator: string;
  companyIds: string[];
}

export class SourceError extends Error {
  constructor(
    readonly status: "rate_limited" | "access_unavailable" | "failed",
    message: string,
    readonly httpStatus: number | null = null,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "SourceError";
  }
}

const BASE_BACKOFF_MS = 30 * 60_000;
const MAX_BACKOFF_MS = 24 * 3_600_000;
const NEWLY_DISCOVERED_DAYS = 7;
const SEC_LOOKBACK_DAYS = 45;
const SEC_SPACING_MS = 250;

export function backoffMs(consecutiveFailures: number): number {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, consecutiveFailures - 1));
}

export function parseRetryAfter(raw: string | null, now: Date): number | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^\d{1,6}$/.test(s)) return Number(s) * 1000;
  const t = Date.parse(s);
  return Number.isFinite(t) ? Math.max(0, t - now.getTime()) : null;
}

/** Removes configured secret values from any message before it is stored or shown. */
export function redact(message: string, env: FinanceEnv): string {
  let out = message;
  for (const [k, v] of Object.entries(env)) {
    if (!k.startsWith("FINANCE_") || k === "FINANCE_PUBLIC_ORIGIN" || typeof v !== "string" || v.length < 8) continue;
    out = out.split(v).join("[redacted]");
  }
  return out.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 400);
}

/** Maps an upstream HTTP status to a source health category with an actionable message. */
export function classifyHttp(res: Pick<GuardedResponse, "status" | "retryAfter">, now: Date): SourceError | null {
  const s = res.status;
  if (s >= 200 && s < 300) return null;
  if (s === 304) return null;
  const retry = parseRetryAfter(res.retryAfter, now);
  if (s === 429) return new SourceError("rate_limited", "The source returned HTTP 429 (too many requests). Backing off; cached data is kept.", s, retry);
  if (s === 503 && retry !== null) return new SourceError("rate_limited", "The source returned HTTP 503 with Retry-After. Backing off; cached data is kept.", s, retry);
  if (s === 401 || s === 403 || s === 451) return new SourceError("access_unavailable", `Access refused (HTTP ${s}) by the source or by a network policy between this server and it. This is not bypassed; use the manual source workflow if needed.`, s);
  if (s === 404 || s === 410) return new SourceError("failed", `The registered endpoint returned HTTP ${s}. The URL may have moved; verify it on the publisher's site before changing the registry.`, s);
  if (s >= 500) return new SourceError("failed", `The source had a server error (HTTP ${s}). It will be retried with backoff.`, s);
  return new SourceError("failed", `Unexpected HTTP ${s} from the source.`, s);
}

function fromFetchError(e: unknown): SourceError {
  if (e instanceof SourceError) return e;
  if (e instanceof FetchGuardError) {
    if (e.code === "TIMEOUT") return new SourceError("failed", "The source did not respond in time. It will be retried with backoff.");
    if (e.code === "NETWORK_ERROR") return new SourceError("failed", `Network error reaching the source: ${e.message}`);
    if (e.code === "REDIRECT_NOT_ALLOWED") return new SourceError("access_unavailable", `The source redirected outside its registered hosts (${e.message}). Redirects are not followed off the allowlist.`);
    return new SourceError("failed", `Request blocked by the fetch guard (${e.code}): ${e.message}`);
  }
  if (e instanceof FeedParseError) return new SourceError("failed", `The response could not be parsed as a feed (${e.code}): ${e.message}`);
  if (e instanceof SecParseError) return new SourceError("failed", `The SEC response could not be parsed: ${e.message}`);
  return new SourceError("failed", e instanceof Error ? e.message : "Unknown error");
}

function userAgent(def: SourceDefinition, env: FinanceEnv): string {
  if (def.connector === "sec_submissions") return String(env.FINANCE_SEC_USER_AGENT ?? "").trim();
  const origin = typeof env.FINANCE_PUBLIC_ORIGIN === "string" && env.FINANCE_PUBLIC_ORIGIN.trim() ? env.FINANCE_PUBLIC_ORIGIN.trim().replace(/\/+$/, "") : "https://kmanish.live";
  return `FinanceDesk/0.1 (+${origin}/finance)`;
}

function dateIn(iso: string | null, tz: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? localDate(d, tz ?? "UTC") : null;
}

// ---------------------------------------------------------------- connectors

async function collectRss(def: SourceDefinition, deps: CollectDeps, state: SourceStateRow | undefined): Promise<{ items: NormalizedItem[]; httpStatus: number; notModified: boolean; etag: string | null; lastModified: string | null; config: Record<string, unknown> | null }> {
  if (!def.endpoint) throw new SourceError("failed", "No endpoint registered.");
  const res = await guardedFetch(def.endpoint, {
    allowedHosts: def.allowedHosts,
    fetcher: deps.fetcher,
    headers: { "user-agent": userAgent(def, deps.env) },
    etag: state?.etag ?? null,
    lastModified: state?.last_modified ?? null,
  });
  const err = classifyHttp(res, deps.now);
  if (err) throw err;
  if (res.notModified) return { items: [], httpStatus: 304, notModified: true, etag: res.etag ?? state?.etag ?? null, lastModified: res.lastModified ?? state?.last_modified ?? null, config: null };
  let feed;
  try {
    feed = parseFeed(res.text);
  } catch (e) {
    if (e instanceof FeedParseError && e.code === "NOT_A_FEED" && /html/i.test(res.contentType ?? "")) {
      throw new SourceError("access_unavailable", "The source returned an HTML page instead of the feed (often an access-check or block page). Automated access is not forced; cached data is kept.", res.status);
    }
    throw e;
  }
  const items: NormalizedItem[] = [];
  for (const it of feed.items) {
    if (!it.link) continue;
    const publishedDate = dateIn(it.publishedAt, def.timeZone);
    items.push({
      providerItemId: it.guid,
      url: canonicalizeUrl(it.link),
      title: it.title,
      publishedAt: it.publishedAt,
      publishedDate,
      // RSS gives a publication time, not the date of the underlying event.
      eventDate: null,
      eventType: classifyHeadline(it.title),
      excerpt: it.summary ? it.summary.slice(0, 280) : null,
      locator: it.guid ? `Feed item ${it.guid.slice(0, 120)}` : "Feed item",
      companyIds: [],
    });
  }
  return { items, httpStatus: res.status, notModified: false, etag: res.etag, lastModified: res.lastModified, config: null };
}

const SEC_8K_ITEMS = new Set(["1.01", "2.01", "5.01"]);
const SEC_6K_CAP = 10;

async function collectSec(def: SourceDefinition, deps: CollectDeps, state: SourceStateRow | undefined): Promise<{ items: NormalizedItem[]; httpStatus: number; notModified: boolean; etag: string | null; lastModified: string | null; config: Record<string, unknown> | null; partial: string[] }> {
  if (!def.endpoint || !def.secCiks?.length) throw new SourceError("failed", "No SEC endpoint or CIK list registered.");
  const config = parseJsonColumn<{ cond?: Record<string, { etag: string | null; lastModified: string | null }> }>(state?.config_json ?? null, {});
  const cond = { ...(config.cond ?? {}) };
  const sinceDate = addDays(localDate(deps.now, "America/New_York"), -SEC_LOOKBACK_DAYS);
  const items: NormalizedItem[] = [];
  const partial: string[] = [];
  let lastStatus = 0;
  let anyOk = false;
  let allNotModified = true;
  for (let i = 0; i < def.secCiks.length; i++) {
    const entry = def.secCiks[i] as NonNullable<SourceDefinition["secCiks"]>[number];
    if (i > 0) await new Promise((r) => setTimeout(r, SEC_SPACING_MS));
    const url = def.endpoint.replace("{cik}", entry.cik);
    let res: GuardedResponse;
    try {
      res = await guardedFetch(url, {
        allowedHosts: def.allowedHosts,
        fetcher: deps.fetcher,
        headers: { "user-agent": userAgent(def, deps.env), accept: "application/json" },
        timeoutMs: 12_000,
        maxBytes: 4 * 1024 * 1024,
        etag: cond[entry.cik]?.etag ?? null,
        lastModified: cond[entry.cik]?.lastModified ?? null,
      });
    } catch (e) {
      // The same host serves every CIK: a network-level failure applies to all of them.
      throw fromFetchError(e);
    }
    lastStatus = res.status;
    const err = classifyHttp(res, deps.now);
    if (err) {
      // Rate limits and access refusals apply to the whole host: stop immediately.
      if (err.status !== "failed") throw err;
      const perCik = err.httpStatus === 404 || err.httpStatus === 410;
      if (!perCik && !anyOk) throw err;
      partial.push(`${entry.name}: HTTP ${err.httpStatus ?? "error"}`);
      continue;
    }
    anyOk = true;
    cond[entry.cik] = { etag: res.etag, lastModified: res.lastModified };
    if (res.notModified) continue;
    allNotModified = false;
    const subs = parseSubmissions(res.text, { sinceDate, max: 60 });
    let sixK = 0;
    for (const f of subs.filings) {
      if (f.form.startsWith("8-K") && !(f.items ?? "").split(",").some((x) => SEC_8K_ITEMS.has(x.trim()))) continue;
      if (f.form === "6-K" && ++sixK > SEC_6K_CAP) continue;
      const desc = f.description && f.description.toUpperCase() !== f.form.toUpperCase() ? ` — ${f.description}` : "";
      items.push({
        providerItemId: f.accession,
        url: f.url,
        title: `${subs.name || entry.name}: Form ${f.form}${desc}${f.items ? ` (items ${f.items})` : ""}`.slice(0, 300),
        // acceptanceDateTime is not reliably UTC; keep the filing date only.
        publishedAt: null,
        publishedDate: f.filingDate,
        eventDate: f.filingDate,
        eventType: secEventType(f),
        excerpt: null,
        locator: `EDGAR accession ${f.accession}, form ${f.form}${f.items ? `, items ${f.items}` : ""}`,
        companyIds: entry.companyId ? [entry.companyId] : [],
      });
    }
  }
  if (!anyOk) throw new SourceError("failed", `No CIK could be retrieved (${partial.slice(0, 3).join("; ")}).`, lastStatus || null);
  return { items, httpStatus: lastStatus, notModified: allNotModified, etag: null, lastModified: null, config: { ...config, cond }, partial };
}

// ---------------------------------------------------------------- storage

interface ExistingDoc {
  id: string;
  dedupe_key: string;
  content_hash: string;
  canonical_url: string;
}

async function hashId(prefix: string, key: string): Promise<string> {
  return `${prefix}${await sha256Hex(key, 24)}`;
}

async function selectIn<T>(db: D1Database, sql: (placeholders: string) => string, head: unknown[], values: string[]): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < values.length; i += 80) {
    const chunk = values.slice(i, i + 80);
    const rows = await db
      .prepare(sql(chunk.map(() => "?").join(", ")))
      .bind(...head, ...chunk)
      .all<T>();
    out.push(...(rows.results ?? []));
  }
  return out;
}

export async function storeItems(
  def: SourceDefinition,
  items: NormalizedItem[],
  deps: CollectDeps,
  view: ResearchView,
): Promise<{ inserted: number; updated: number; duplicates: number; reviewItems: number }> {
  const db = deps.db;
  const nowIso = deps.now.toISOString();
  const today = localDate(deps.now, "Asia/Kolkata");
  const prepared = await Promise.all(
    items.map(async (it) => {
      const dedupeKey = `${def.id}:${it.providerItemId ? `id:${it.providerItemId}` : `url:${it.url}`}`.slice(0, 600);
      const contentHash = await sha256Hex(`${it.title}|${it.publishedAt ?? it.publishedDate ?? ""}|${it.excerpt ?? ""}`, 32);
      return { it, dedupeKey, contentHash, docId: await hashId("d_", dedupeKey) };
    }),
  );
  // Collapse duplicates inside one response.
  const unique = [...new Map(prepared.map((p) => [p.dedupeKey, p])).values()];
  const existing = new Map<string, ExistingDoc>();
  for (const r of await selectIn<ExistingDoc>(db, (ph) => `SELECT id, dedupe_key, content_hash, canonical_url FROM finance_source_documents WHERE dedupe_key IN (${ph})`, [], unique.map((p) => p.dedupeKey))) existing.set(r.dedupe_key, r);
  const sameUrl = new Set((await selectIn<{ canonical_url: string }>(db, (ph) => `SELECT canonical_url FROM finance_source_documents WHERE canonical_url IN (${ph})`, [], unique.map((p) => p.it.url))).map((r) => r.canonical_url));
  const sameContent = new Set(
    (await selectIn<{ content_hash: string }>(db, (ph) => `SELECT content_hash FROM finance_source_documents WHERE source_id = ? AND content_hash IN (${ph})`, [def.id], unique.map((p) => p.contentHash))).map((r) => r.content_hash),
  );

  let inserted = 0;
  let updated = 0;
  let duplicates = items.length - unique.length;
  let reviewItems = 0;
  for (const p of unique) {
    const prev = existing.get(p.dedupeKey);
    if (prev) {
      if (prev.content_hash === p.contentHash) {
        duplicates++;
        continue;
      }
      // Same provider item, changed metadata: keep one document, bump its version.
      await db.batch([
        db.prepare("UPDATE finance_source_documents SET title = ?, excerpt = ?, content_hash = ?, published_at = COALESCE(?, published_at), published_date = COALESCE(?, published_date), retrieved_at = ?, version = version + 1 WHERE id = ?").bind(p.it.title, p.it.excerpt, p.contentHash, p.it.publishedAt, p.it.publishedDate, nowIso, prev.id),
        db.prepare("UPDATE finance_feed_items SET title = ?, excerpt = ? WHERE document_id = ?").bind(p.it.title, p.it.excerpt, prev.id),
      ]);
      updated++;
      continue;
    }
    if (sameUrl.has(p.it.url) || sameContent.has(p.contentHash)) {
      duplicates++;
      continue;
    }
    const entities: FeedEntity[] = linkEntities(`${p.it.title} ${p.it.excerpt ?? ""}`, view, p.it.companyIds);
    const sectors = sectorsFor(entities, view, def.defaultSectors);
    const refDate = p.it.eventDate ?? p.it.publishedDate;
    const newly = refDate ? refDate < addDays(today, -NEWLY_DISCOVERED_DAYS) : false;
    const deals = entities.filter((e) => e.type === "deal");
    const verification = entities.some((e) => e.confidence === "exact_alias") ? "linked" : "lead";
    const ins = await db
      .prepare("INSERT INTO finance_source_documents (id, source_id, provider_item_id, canonical_url, title, published_at, published_date, retrieved_at, content_hash, excerpt, locator, version, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?) ON CONFLICT(dedupe_key) DO NOTHING")
      .bind(p.docId, def.id, p.it.providerItemId, p.it.url, p.it.title, p.it.publishedAt, p.it.publishedDate, nowIso, p.contentHash, p.it.excerpt, p.it.locator, p.dedupeKey)
      .run();
    if (!ins.meta.changes) {
      duplicates++;
      continue;
    }
    sameUrl.add(p.it.url);
    sameContent.add(p.contentHash);
    const stmts = [
      db
        .prepare("INSERT INTO finance_feed_items (id, document_id, source_id, title, url, event_type, event_date, published_at, published_date, discovered_at, sectors_json, entities_json, verification, newly_discovered, cluster_key, excerpt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(document_id) DO NOTHING")
        .bind(await hashId("f_", p.dedupeKey), p.docId, def.id, p.it.title, p.it.url, p.it.eventType, p.it.eventDate, p.it.publishedAt, p.it.publishedDate, nowIso, JSON.stringify(sectors), JSON.stringify(entities), verification, newly ? 1 : 0, clusterKey(p.it.title, refDate), p.it.excerpt),
    ];
    for (const d of deals.slice(0, 3)) {
      const dedupe = `feed:${p.docId}:${d.id}`;
      stmts.push(
        db
          .prepare("INSERT INTO finance_review_queue (id, kind, subject_type, subject_id, field, proposal_json, evidence_json, origin, status, dedupe_key, created_at) VALUES (?, 'feed_lead', 'deal', ?, 'events', ?, ?, ?, 'pending', ?, ?) ON CONFLICT(dedupe_key) DO NOTHING")
          .bind(
            await hashId("rv_", dedupe),
            d.id,
            JSON.stringify({
              dealId: d.id,
              dealTitle: d.name,
              match: d.confidence,
              event: { feedType: p.it.eventType, date: refDate ?? today, title: p.it.title.slice(0, 200) },
              note: "Proposed from feed metadata only. Read the linked document before publishing; publishing appends an event, it never changes deal terms or status.",
            }),
            JSON.stringify({ documentId: p.docId, url: p.it.url, title: p.it.title, sourceId: def.id, publishedDate: p.it.publishedDate, locator: p.it.locator }),
            `connector:${def.id}`,
            dedupe,
            nowIso,
          ),
      );
    }
    const res = await db.batch(stmts);
    inserted++;
    reviewItems += res.slice(1).reduce((n, r) => n + (r.meta.changes ?? 0), 0);
  }
  return { inserted, updated, duplicates, reviewItems };
}

// ---------------------------------------------------------------- leases and state

export async function acquireLease(db: D1Database, name: string, holder: string, ttlMs: number, now: Date): Promise<boolean> {
  const res = await db
    .prepare("INSERT INTO finance_leases (name, holder, expires_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET holder = excluded.holder, expires_at = excluded.expires_at WHERE finance_leases.expires_at < ?")
    .bind(name, holder, new Date(now.getTime() + ttlMs).toISOString(), now.toISOString())
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function releaseLease(db: D1Database, name: string, holder: string): Promise<void> {
  await db.prepare("DELETE FROM finance_leases WHERE name = ? AND holder = ?").bind(name, holder).run();
}

export async function ensureSourceState(db: D1Database, def: SourceDefinition, now: Date): Promise<SourceStateRow> {
  await db.prepare("INSERT INTO finance_source_state (source_id, enabled, updated_at) VALUES (?, ?, ?) ON CONFLICT(source_id) DO NOTHING").bind(def.id, def.defaultEnabled ? 1 : 0, now.toISOString()).run();
  return (await db.prepare("SELECT * FROM finance_source_state WHERE source_id = ?").bind(def.id).first<SourceStateRow>()) as SourceStateRow;
}

export function missingEnv(def: SourceDefinition, env: FinanceEnv): string[] {
  return (def.requiresEnv ?? []).filter((k) => typeof env[k] !== "string" || !(env[k] as string).trim()) as string[];
}

export function isDue(def: SourceDefinition, state: SourceStateRow | undefined, now: Date): boolean {
  if (!def.refreshIntervalMinutes) return false;
  if (!state?.last_attempt_at) return true;
  // Five minutes of slack so a scheduler running exactly on the interval is not skipped.
  return now.getTime() - Date.parse(state.last_attempt_at) >= (def.refreshIntervalMinutes - 5) * 60_000;
}

/**
 * Runs one connector once. `mode` "scheduled" respects the refresh interval and backoff; "manual"
 * (owner refresh) ignores the interval but respects backoff; "test" (owner connection test) ignores
 * both and runs even when the source is disabled. A per-source lease prevents concurrent runs.
 */
export async function refreshSource(sourceId: string, deps: CollectDeps, mode: "scheduled" | "manual" | "test"): Promise<RefreshOutcome> {
  const base: RefreshOutcome = { sourceId, status: "failed", httpStatus: null, fetched: 0, inserted: 0, updated: 0, duplicates: 0, reviewItems: 0, message: null, retryAt: null, firstLiveSuccess: false };
  const def = getSource(sourceId);
  if (!def) return { ...base, message: "Unknown source." };
  if (!def.connector) return { ...base, status: "manual", message: "Manual source; nothing to fetch." };
  const missing = missingEnv(def, deps.env);
  if (missing.length) return { ...base, status: "not_configured", message: `Set ${missing.join(", ")} to enable this connector.` };
  const db = deps.db;
  const state = await ensureSourceState(db, def, deps.now);
  if (!state.enabled && mode !== "test") return { ...base, status: "disabled", message: "Disabled by the owner." };
  if (mode === "scheduled" && !isDue(def, state, deps.now)) return { ...base, status: "backoff", message: "Not due yet.", retryAt: state.last_attempt_at ? new Date(Date.parse(state.last_attempt_at) + (def.refreshIntervalMinutes ?? 0) * 60_000).toISOString() : null };
  if (mode !== "test" && state.next_allowed_at && Date.parse(state.next_allowed_at) > deps.now.getTime()) {
    return { ...base, status: "backoff", message: "Backing off after earlier failures.", retryAt: state.next_allowed_at };
  }
  const holder = `${mode}:${crypto.randomUUID()}`;
  const leaseName = `source:${def.id}`;
  if (!(await acquireLease(db, leaseName, holder, 3 * 60_000, deps.now))) return { ...base, status: "busy", message: "Another refresh of this source is running." };
  const nowIso = deps.now.toISOString();
  try {
    await db.prepare("UPDATE finance_source_state SET last_attempt_at = ?, updated_at = ? WHERE source_id = ?").bind(nowIso, nowIso, def.id).run();
    try {
      const r = def.connector === "rss" ? { ...(await collectRss(def, deps, state)), partial: [] as string[] } : await collectSec(def, deps, state);
      const view = await getResearch(db);
      const stored = r.items.length ? await storeItems(def, r.items, deps, view) : { inserted: 0, updated: 0, duplicates: 0, reviewItems: 0 };
      const firstLive = !state.live_verified_at;
      const message = r.partial.length ? `Partial: ${r.partial.slice(0, 3).join("; ")}` : null;
      await db
        .prepare(
          "UPDATE finance_source_state SET last_success_at = ?, last_status = 'working', last_error = ?, last_http_status = ?, etag = ?, last_modified = ?, consecutive_failures = 0, next_allowed_at = NULL, last_item_count = ?, live_verified_at = COALESCE(live_verified_at, ?), config_json = COALESCE(?, config_json), updated_at = ? WHERE source_id = ?",
        )
        .bind(nowIso, message ? redact(message, deps.env) : null, r.httpStatus, r.etag, r.lastModified, r.items.length, nowIso, r.config ? JSON.stringify(r.config) : null, nowIso, def.id)
        .run();
      deps.log?.({ level: "info", message: "source refreshed", data: { sourceId: def.id, fetched: r.items.length, ...stored } });
      return { ...base, status: r.notModified ? "not_modified" : "working", httpStatus: r.httpStatus, fetched: r.items.length, ...stored, message, firstLiveSuccess: firstLive };
    } catch (e) {
      const err = fromFetchError(e);
      const failures = (state.consecutive_failures ?? 0) + 1;
      const wait = Math.max(backoffMs(failures), err.retryAfterMs ?? 0);
      const retryAt = new Date(deps.now.getTime() + Math.min(wait, MAX_BACKOFF_MS)).toISOString();
      const message = redact(err.message, deps.env);
      await db
        .prepare("UPDATE finance_source_state SET last_status = ?, last_error = ?, last_http_status = ?, consecutive_failures = ?, next_allowed_at = ?, updated_at = ? WHERE source_id = ?")
        .bind(err.status, message, err.httpStatus, failures, retryAt, nowIso, def.id)
        .run();
      deps.log?.({ level: "warn", message: "source refresh failed", data: { sourceId: def.id, status: err.status, httpStatus: err.httpStatus } });
      return { ...base, status: err.status, httpStatus: err.httpStatus, message, retryAt };
    }
  } finally {
    await releaseLease(db, leaseName, holder);
  }
}
