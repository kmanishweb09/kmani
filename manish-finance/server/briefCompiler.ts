import type { CompiledDeal } from "../shared/archive/compile";
import { addDays, daysBetween, localDate } from "../shared/dates";
import { DEAL_STATUS_LABEL, EVENT_TYPE_LABEL, SECTOR_NAMES, type SectorSlugValue } from "../shared/labels";
import type { BriefItemOut, BriefOut, BriefRow } from "./briefs";
import { newId, parseJsonColumn } from "./db";
import { type FeedRow, runtimeClaimId } from "./feedStore";
import { sha256Hex } from "./http";
import { archive, type ResearchView } from "./research";
import { getSource } from "./sources/registry";
import type { D1Database } from "./types";

/**
 * Deterministic brief compiler (no AI). Candidates come from connector feed items, owner-published
 * updates and dated archive events; they are ranked with explicit, documented weights and each
 * item states why it appears. Nothing is invented: every item cites a stored document or claim.
 */

export const BRIEF_TZ = "Asia/Kolkata";
export const RANKING_VERSION = "rank-v1";

/** Explicit weights (documented in docs/DATA_SOURCES.md). */
export const WEIGHTS = {
  watchedEntity: 4,
  followedSector: 3,
  coveredDeal: 3,
  coveredCompany: 1,
  primarySource: 2,
  curatedResearch: 2,
  within24h: 2,
  within72h: 1,
  newlyDiscoveredPenalty: -2,
  ambiguousOnlyPenalty: -1,
} as const;

const EVENT_WEIGHT: Record<string, number> = {
  completion: 3,
  termination: 3,
  withdrawal: 3,
  regulatory_decision: 3,
  regulatory_approval: 3,
  approval: 3,
  shareholder_approval: 2,
  court_approval: 2,
  open_offer: 3,
  tender_offer: 3,
  merger_document: 3,
  completion_filing: 3,
  announcement: 2,
  revision: 3,
  deal_news: 2,
  material_agreement: 2,
  proposed_rule: 2,
  rule: 2,
  enforcement: 1,
  monetary_policy: 1,
  ownership_filing: 1,
  regulatory_filing: 1,
  subsequent: 1,
  filing: 0,
  rumour: 0,
};

/** Why an event type may matter — analysis, stated generally and labelled as such in the UI. */
const WHY: Record<string, string> = {
  completion: "Completion ends deal risk and starts integration; from here the questions are synergy delivery and reported numbers.",
  termination: "A terminated deal returns both sides to their standalone plans; check break fees and what the parties say next.",
  withdrawal: "A withdrawn proposal shows where price, regulation or financing did not work; the reasons are often more useful than the deal.",
  regulatory_decision: "A regulatory decision sets conditions or outcomes that change deal value, timing or the perimeter.",
  regulatory_approval: "An approval moves a deal toward completion. An approval is not completion; other conditions may remain.",
  approval: "Regulatory approvals move transactions and licences forward. An approval is not completion; check remaining conditions.",
  shareholder_approval: "Shareholder approval removes one condition; check which regulatory or court steps remain.",
  court_approval: "Court or tribunal sanction is usually one of the last steps in a scheme; check the effective date.",
  open_offer: "Open and tender offers set the price minority holders can accept and show how much control the buyer ends up with.",
  tender_offer: "Tender-offer documents set the offer price, conditions and timetable; they are primary evidence for terms.",
  merger_document: "Merger documents (S-4/F-4, proxy, Rule 425) carry terms, background of the deal and fairness opinions — the primary source for terms.",
  completion_filing: "An 8-K Item 2.01 reports completion of an acquisition or disposition; confirm the filing refers to the deal you think it does.",
  material_agreement: "An 8-K Item 1.01 reports a material definitive agreement, which may or may not be an M&A agreement.",
  revision: "Revised terms change the price or structure; compare against the original terms rather than overwriting them.",
  announcement: "A new announcement starts the deal clock: stated rationale, price and structure are the baseline to test later.",
  deal_news: "A deal-related headline is a lead: confirm it against a primary filing before treating the terms as fact.",
  proposed_rule: "A proposal, not an effective rule. Watch for the final version and its effective date before changing any valuation view.",
  rule: "An issued rule or circular: check its effective date and which regulated entities it covers.",
  enforcement: "Supervisory actions show regulator priorities (for example, KYC, governance or conduct) that also come up in diligence.",
  monetary_policy: "Policy-rate decisions move funding costs, margins and discount rates, especially for banks and NBFCs.",
  ownership_filing: "Ownership filings can signal stake-building or activism ahead of a transaction.",
  regulatory_filing: "A filing adds primary evidence; read the document before drawing conclusions from the title.",
  subsequent: "A later development tests whether the original deal thesis is holding.",
  filing: "A filing is primary evidence, but its title alone rarely shows whether it matters; open it before drawing conclusions.",
  rumour: "Unconfirmed; treat as a lead until a party or regulator confirms it.",
};

const MECHANISM: Record<string, string> = {
  proposed_rule: "if finalised, the rule changes the cost or feasibility of certain structures; until then it is an option on a change, not a change.",
  rule: "compliance cost and permitted structures change from the effective date, which shifts which deals are attractive.",
  approval: "approvals remove a condition to closing, lowering completion risk for the transactions they cover.",
  regulatory_approval: "approvals remove a condition to closing, lowering completion risk for the transactions they cover.",
  enforcement: "enforcement raises the expected cost of weak controls, which diligence and pricing then have to reflect.",
  monetary_policy: "funding costs feed through to net interest margins, loan growth and the discount rates used in valuation.",
  completion: "a closed deal changes the competitive set and gives the first read on integration.",
};

export interface RankContext {
  followedSectors: Set<string>;
  watchedDeals: Set<string>;
  watchedCompanies: Set<string>;
  personalised: boolean;
}

interface Candidate {
  key: string;
  headline: string;
  whatChanged: string;
  eventDate: { date: string; precision: "day" | "month" | "quarter" | "year" };
  publishedDate: string | null;
  eventType: string;
  sectors: string[];
  entities: Array<{ type: "deal" | "company" | "sector"; id: string; confidence?: string }>;
  ev: string[];
  url: string | null;
  primary: boolean;
  curated: boolean;
  newlyDiscovered: boolean;
  recencyDate: string;
  uncertainty: string;
  sourceLabel: string;
  /** Documents behind the candidate (archive document IDs and canonical URLs) — used to merge duplicates. */
  docKeys: string[];
  /** Authored, item-specific analysis; otherwise a context-specific or generic explanation is built. */
  whyItMatters: string | null;
  /** Deal context used to make a generic explanation specific (status move), when known. */
  dealContext: { title: string; statusAfter: string | null } | null;
  /** Other origins merged into this candidate (e.g. "Sector playbook"). */
  alsoIn: string[];
}

function urlKey(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const x = new URL(u);
    return `url:${x.hostname.replace(/^www\./, "").toLowerCase()}${x.pathname.replace(/\/+$/, "")}${x.search}`;
  } catch {
    return null;
  }
}

function claimDocKeys(view: ResearchView, ev: string[]): string[] {
  const keys = new Set<string>();
  for (const id of ev) {
    const docId = view.claims[id]?.documentId;
    if (!docId) continue;
    keys.add(`doc:${docId}`);
    const k = urlKey(view.documents[docId]?.url);
    if (k) keys.add(k);
  }
  return [...keys];
}

function titleTokens(t: string): Set<string> {
  const stop = new Set(["the", "a", "an", "of", "on", "in", "and", "to", "for", "with", "by", "at", "its", "is", "as", "from", "that", "this", "not", "yet"]);
  return new Set(
    t
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !stop.has(w)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

const ORIGIN_PRIORITY = (c: Candidate): number => (c.curated && c.entities.some((e) => e.type === "deal") ? 0 : c.curated ? 1 : c.primary ? 2 : 3);

/**
 * One development reported through several origins (feed item, deal timeline, sector playbook) becomes
 * one brief item. Two candidates are the same development when their dates are within a day and they
 * share a source document or URL, or their titles overlap strongly and they concern the same entity or
 * sector. The richest origin leads; evidence, entities and sectors are combined.
 */
export function mergeDuplicateCandidates(cands: Candidate[]): Candidate[] {
  const parent = cands.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i] as number)));
  const tokens = cands.map((c) => titleTokens(c.headline));
  for (let i = 0; i < cands.length; i++) {
    for (let j = i + 1; j < cands.length; j++) {
      const a = cands[i] as Candidate;
      const b = cands[j] as Candidate;
      if (Math.abs(daysBetween(a.eventDate.date, b.eventDate.date)) > 1) continue;
      const sharedDoc = a.docKeys.some((k) => b.docKeys.includes(k));
      const sharedSubject =
        a.entities.some((e) => b.entities.some((f) => f.type === e.type && f.id === e.id && e.confidence !== "ambiguous" && f.confidence !== "ambiguous")) || a.sectors.some((s) => b.sectors.includes(s));
      if (sharedDoc || (sharedSubject && jaccard(tokens[i] as Set<string>, tokens[j] as Set<string>) >= 0.5)) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, Candidate[]>();
  cands.forEach((c, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), c]);
  });
  const out: Candidate[] = [];
  for (const members of groups.values()) {
    if (members.length === 1) {
      out.push(members[0] as Candidate);
      continue;
    }
    const sorted = [...members].sort((a, b) => ORIGIN_PRIORITY(a) - ORIGIN_PRIORITY(b) || a.key.localeCompare(b.key));
    const lead = sorted[0] as Candidate;
    const others = sorted.slice(1);
    const strongest = [...members].sort((a, b) => (EVENT_WEIGHT[b.eventType] ?? 0) - (EVENT_WEIGHT[a.eventType] ?? 0))[0] as Candidate;
    const entities = [...lead.entities];
    for (const o of others) for (const e of o.entities) if (!entities.some((x) => x.type === e.type && x.id === e.id)) entities.push(e);
    const alsoIn = [...new Set(others.map((o) => o.sourceLabel).filter((l) => l !== lead.sourceLabel))];
    const proposal = members.some((m) => m.uncertainty.startsWith("Proposed, not effective."));
    out.push({
      ...lead,
      key: sorted.map((m) => m.key).join("+"),
      eventType: strongest.eventType,
      sectors: [...new Set(members.flatMap((m) => m.sectors))],
      entities,
      ev: [...new Set(members.flatMap((m) => m.ev))],
      docKeys: [...new Set(members.flatMap((m) => m.docKeys))],
      primary: members.some((m) => m.primary),
      curated: members.some((m) => m.curated),
      newlyDiscovered: members.every((m) => m.newlyDiscovered),
      whyItMatters: lead.whyItMatters ?? others.find((o) => o.whyItMatters)?.whyItMatters ?? null,
      dealContext: lead.dealContext ?? others.find((o) => o.dealContext)?.dealContext ?? null,
      uncertainty: proposal && !lead.uncertainty.startsWith("Proposed, not effective.") ? `Proposed, not effective. ${lead.uncertainty}` : lead.uncertainty,
      alsoIn: [...new Set([...lead.alsoIn, ...alsoIn])],
    });
  }
  return out;
}

/** Item-specific explanation when authored or derivable from the deal's status move; otherwise the generic note for the event type. */
export function explainWhy(c: Pick<Candidate, "whyItMatters" | "eventType" | "dealContext">): { text: string; basis: "item" | "generic" } {
  if (c.whyItMatters) return { text: c.whyItMatters, basis: "item" };
  const generic = WHY[c.eventType] ?? WHY.subsequent ?? "";
  if (c.dealContext?.statusAfter) {
    const label = DEAL_STATUS_LABEL[c.dealContext.statusAfter as keyof typeof DEAL_STATUS_LABEL] ?? c.dealContext.statusAfter;
    return { text: `${c.dealContext.title} moved to “${label}”. ${generic}`, basis: "item" };
  }
  return { text: generic, basis: "generic" };
}

export function scoreCandidate(c: Pick<Candidate, "entities" | "sectors" | "eventType" | "primary" | "curated" | "newlyDiscovered" | "recencyDate">, ctx: RankContext, view: Pick<ResearchView, "dealById" | "companyById">, today: string): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const exact = c.entities.filter((e) => e.confidence !== "ambiguous");
  const watched = exact.find((e) => (e.type === "deal" && ctx.watchedDeals.has(e.id)) || (e.type === "company" && ctx.watchedCompanies.has(e.id)));
  if (watched) {
    score += WEIGHTS.watchedEntity;
    reasons.push(`on your watchlist (${watched.type === "deal" ? (view.dealById.get(watched.id)?.title ?? watched.id) : (view.companyById.get(watched.id)?.displayName ?? watched.id)})`);
  }
  const followed = c.sectors.filter((s) => ctx.followedSectors.has(s));
  if (followed.length) {
    score += WEIGHTS.followedSector;
    reasons.push(`${ctx.personalised ? "a sector you follow" : "a desk focus sector"} (${followed.map((s) => SECTOR_NAMES[s as SectorSlugValue] ?? s).join(", ")})`);
  }
  const deal = exact.find((e) => e.type === "deal" && view.dealById.has(e.id));
  if (deal) {
    score += WEIGHTS.coveredDeal;
    reasons.push(`linked to a covered deal (${view.dealById.get(deal.id)?.title})`);
  } else if (exact.some((e) => e.type === "company" && view.companyById.has(e.id))) {
    score += WEIGHTS.coveredCompany;
    const co = exact.find((e) => e.type === "company" && view.companyById.has(e.id));
    reasons.push(`mentions a covered company (${co ? view.companyById.get(co.id)?.displayName : ""})`);
  } else if (c.entities.length) {
    score += WEIGHTS.ambiguousOnlyPenalty;
    reasons.push("entity match is by name only and uncertain");
  }
  if (c.curated) {
    score += WEIGHTS.curatedResearch;
    reasons.push("recorded in the research archive with citations");
  } else if (c.primary) {
    score += WEIGHTS.primarySource;
    reasons.push("from a primary source (regulator, company or exchange)");
  }
  const ew = EVENT_WEIGHT[c.eventType] ?? 0;
  score += ew;
  if (ew >= 2) reasons.push(`${(EVENT_TYPE_LABEL[c.eventType] ?? c.eventType.replace(/_/g, " ")).toLowerCase()} events rank high`);
  if (c.recencyDate >= addDays(today, -1)) {
    score += WEIGHTS.within24h;
    reasons.push("dated within the last day");
  } else if (c.recencyDate >= addDays(today, -3)) {
    score += WEIGHTS.within72h;
    reasons.push("dated within the last three days");
  }
  if (c.newlyDiscovered) {
    score += WEIGHTS.newlyDiscoveredPenalty;
    reasons.push("older document newly discovered (not newly announced)");
  }
  return { score, reasons };
}

function feedUncertainty(entities: Candidate["entities"], primary: boolean): string {
  const parts = ["Source-linked lead: only the feed metadata was retrieved; the document itself has not been read."];
  if (entities.some((e) => e.confidence === "ambiguous")) parts.push("Entity links are name matches and may be wrong.");
  if (!primary) parts.push("Secondary reporting; confirm against a primary document.");
  return parts.join(" ");
}

function claimUncertainty(view: ResearchView, ev: string[]): string {
  const statuses = new Set(ev.map((id) => view.claims[id]?.status).filter(Boolean));
  if (statuses.has("conflict")) return "Sources disagree on at least one point; see the evidence for the active interpretation.";
  if (statuses.has("pending")) return "At least one cited claim is pending: recorded but not yet matched to retrieved evidence.";
  if (statuses.has("search_corroborated")) return "Corroborated by search results; the primary document was not retrieved by the builder.";
  if (statuses.has("human_reviewed")) return "Reviewed by the site owner; see the cited documents.";
  return "Matched to retrieved evidence; details beyond the cited passage may still change.";
}

async function feedCandidates(db: D1Database | undefined, sinceIso: string, sinceDate: string): Promise<Candidate[]> {
  if (!db) return [];
  let rows: FeedRow[] = [];
  try {
    rows =
      (
        await db
          .prepare("SELECT * FROM finance_feed_items WHERE verification != 'rejected' AND (discovered_at >= ? OR COALESCE(event_date, published_date) >= ?) ORDER BY discovered_at DESC LIMIT 400")
          .bind(sinceIso, sinceDate)
          .all<FeedRow>()
      ).results ?? [];
  } catch {
    return [];
  }
  // Repeated coverage of one event becomes one item with several sources.
  const clusters = new Map<string, FeedRow[]>();
  for (const r of rows) {
    const list = clusters.get(r.cluster_key) ?? [];
    list.push(r);
    clusters.set(r.cluster_key, list);
  }
  const out: Candidate[] = [];
  for (const [key, list] of clusters) {
    const lead = [...list].sort((a, b) => a.discovered_at.localeCompare(b.discovered_at))[0] as FeedRow;
    const src = getSource(lead.source_id);
    const primary = src ? ["regulator", "company", "exchange", "competition_authority"].includes(src.kind) : false;
    const entities = parseJsonColumn<Candidate["entities"]>(lead.entities_json, []);
    const date = lead.event_date ?? lead.published_date ?? lead.discovered_at.slice(0, 10);
    out.push({
      key: `feed:${key}`,
      headline: lead.title,
      whatChanged: `${src?.publisher ?? lead.source_id} published: “${lead.title}”.${lead.excerpt ? ` ${lead.excerpt}` : ""}${list.length > 1 ? ` (${list.length} source items merged.)` : ""}`,
      eventDate: { date, precision: "day" },
      publishedDate: lead.published_date,
      eventType: lead.event_type,
      sectors: parseJsonColumn<string[]>(lead.sectors_json, []),
      entities,
      ev: list.slice(0, 4).map((r) => runtimeClaimId(r.document_id)),
      url: lead.url,
      primary,
      curated: false,
      newlyDiscovered: Boolean(lead.newly_discovered),
      recencyDate: date,
      uncertainty: feedUncertainty(entities, primary),
      sourceLabel: src?.name ?? lead.source_id,
      docKeys: [...new Set(list.flatMap((r) => [`feeddoc:${r.document_id}`, urlKey(r.url)]).filter((k): k is string => Boolean(k)))],
      whyItMatters: null,
      dealContext: null,
      alsoIn: [],
    });
  }
  return out;
}

function archiveCandidates(view: ResearchView, sinceDate: string, today: string): Candidate[] {
  const out: Candidate[] = [];
  for (const d of view.deals) {
    for (const e of d.events) {
      if (e.date.precision !== "day" || e.date.date < sinceDate || e.date.date > today) continue;
      out.push({
        key: `event:${e.id}`,
        headline: `${d.title}: ${e.title}`,
        whatChanged: e.detail ?? e.title,
        eventDate: e.date,
        publishedDate: e.publishedDate,
        eventType: e.type,
        sectors: [d.sector],
        entities: [{ type: "deal", id: d.id }],
        ev: e.ev,
        url: e.ev.map((id) => view.documents[view.claims[id]?.documentId ?? ""]?.url).find(Boolean) ?? null,
        primary: true,
        curated: true,
        newlyDiscovered: false,
        recencyDate: e.date.date,
        uncertainty: claimUncertainty(view, e.ev),
        sourceLabel: e.origin === "published_update" ? "Owner-published update" : "Deal timeline",
        docKeys: claimDocKeys(view, e.ev),
        whyItMatters: e.whyItMatters ?? null,
        dealContext: { title: d.title, statusAfter: e.statusAfter },
        alsoIn: [],
      });
    }
  }
  for (const s of archive.sectors) {
    for (const w of s.whatChanged) {
      if (w.date < sinceDate || w.date > today) continue;
      const type = w.stage === "proposal" || w.stage === "consultation" ? "proposed_rule" : w.stage === "approval" ? "approval" : w.stage === "market_event" ? "announcement" : "rule";
      out.push({
        key: `sector:${s.slug}:${w.date}:${w.title}`,
        headline: `${s.name}: ${w.title}`,
        whatChanged: w.detail,
        eventDate: { date: w.date, precision: "day" },
        publishedDate: null,
        eventType: type,
        sectors: [s.slug],
        entities: [{ type: "sector", id: s.slug }],
        ev: w.ev,
        url: w.ev.map((id) => view.documents[view.claims[id]?.documentId ?? ""]?.url).find(Boolean) ?? null,
        primary: true,
        curated: true,
        newlyDiscovered: false,
        recencyDate: w.date,
        uncertainty: `${w.stage === "proposal" || w.stage === "consultation" ? "Proposed, not effective. " : ""}${claimUncertainty(view, w.ev)}`,
        sourceLabel: `${s.name} playbook`,
        docKeys: claimDocKeys(view, w.ev),
        whyItMatters: w.whyItMatters ?? null,
        dealContext: null,
        alsoIn: [],
      });
    }
  }
  return out;
}

function sentenceList(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join("; ")}; and ${parts[parts.length - 1]}`;
}

function toItem(c: Candidate, rank: number, reasons: string[]): BriefItemOut {
  const why = reasons.length ? `Appears because it is ${sentenceList(reasons)}.` : "Appears as the most recent item in the window.";
  const explained = explainWhy(c);
  return {
    rank,
    headline: c.headline.slice(0, 240),
    whatChanged: `${c.whatChanged}${c.alsoIn.length ? ` Also recorded in: ${c.alsoIn.join(", ")}.` : ""}`.slice(0, 700),
    eventDate: c.eventDate,
    publishedDate: c.publishedDate,
    whyItMatters: explained.text,
    whyBasis: explained.basis,
    uncertainty: c.uncertainty,
    eventType: c.eventType,
    sectors: c.sectors,
    entities: c.entities.filter((e) => e.confidence !== "ambiguous").map((e) => ({ type: e.type, id: e.id })),
    whyThisAppears: why,
    newlyDiscovered: c.newlyDiscovered,
    ev: c.ev,
    url: c.url,
  };
}

function hashIndex(seed: string, n: number): number {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return n ? h % n : 0;
}

export interface CompileInput {
  db: D1Database | undefined;
  view: ResearchView;
  now: Date;
  kind: "daily" | "weekly";
  scope: "public" | "private";
  userKey: string;
  ctx: RankContext;
  openQuestions?: string[];
}

export type CompileResult = { ok: true; content: Omit<BriefOut, "evidence" | "id" | "origin" | "scope" | "version" | "correctionNote">; periodStart: string; periodEnd: string; inputVersion: string } | { ok: false; code: "NO_MATERIAL"; message: string };

export async function compileBriefContent(input: CompileInput): Promise<CompileResult> {
  const { view, now, kind } = input;
  const today = localDate(now, BRIEF_TZ);
  const windows = kind === "daily" ? [1, 3, 7] : [7];
  const limit = kind === "daily" ? 5 : 8;
  let chosen: Array<{ c: Candidate; score: number; reasons: string[] }> = [];
  let windowDays = windows[0] as number;
  for (const days of windows) {
    windowDays = days;
    const sinceDate = addDays(today, -days);
    const sinceIso = new Date(now.getTime() - days * 86_400_000).toISOString();
    const cands = mergeDuplicateCandidates([...(await feedCandidates(input.db, sinceIso, sinceDate)), ...archiveCandidates(view, sinceDate, today)]);
    chosen = cands
      .map((c) => ({ c, ...scoreCandidate(c, input.ctx, view, today) }))
      .sort((a, b) => b.score - a.score || b.c.recencyDate.localeCompare(a.c.recencyDate) || a.c.headline.localeCompare(b.c.headline))
      .slice(0, limit);
    if (chosen.length >= 3 || (kind === "daily" && days === 7)) break;
  }
  if (!chosen.length) {
    return { ok: false, code: "NO_MATERIAL", message: `No developments in the last ${windowDays} days from connected sources, owner-published updates or the dated archive. The previous brief is kept; nothing was invented to fill the gap.` };
  }
  const items = chosen.map((x, i) => toItem(x.c, i + 1, x.reasons));
  const top = chosen[0]?.c as Candidate;
  const topDeal = chosen.map((x) => x.c.entities.find((e) => e.type === "deal" && e.confidence !== "ambiguous" && view.dealById.has(e.id))).find(Boolean);
  let deepDive: BriefOut["deepDive"];
  if (topDeal) {
    const d = view.dealById.get(topDeal.id) as CompiledDeal;
    deepDive = { entity: { type: "deal", id: d.id }, title: d.title, why: `Linked to one of this ${kind === "daily" ? "brief" : "week"}'s ranked developments. Re-read the terms, the status history and the evidence, then note what the new item changes.` };
  } else {
    const autopsies = view.deals.filter((d) => d.autopsy).sort((a, b) => a.id.localeCompare(b.id));
    const d = autopsies[hashIndex(today, autopsies.length)];
    deepDive = d ? { entity: { type: "deal", id: d.id }, title: d.title, why: "Rotating deal autopsy: compare what was assumed at announcement with what is known now." } : null;
  }
  const sectorSlug = (top.sectors.find((s) => input.ctx.followedSectors.has(s)) ?? top.sectors[0] ?? "fig") as SectorSlugValue;
  const sector = archive.sectors.find((s) => s.slug === sectorSlug);
  const sectorImplication: BriefOut["sectorImplication"] = sector
    ? {
        sector: sectorSlug,
        causalChain: [
          `Fact: ${top.headline} (${top.eventDate.date}; ${top.sourceLabel}).`,
          `Mechanism: ${MECHANISM[top.eventType] ?? "the development changes information available about a transaction or its conditions, which is what prices and timelines are set on."}`,
          `What to check in ${sector.name}: ${sector.diligenceQuestions[hashIndex(`${today}|${sectorSlug}`, sector.diligenceQuestions.length)] ?? ""}`,
        ],
        label: "Analysis",
      }
    : null;
  let questionText: string;
  const qDeal = topDeal ? view.dealById.get(topDeal.id) : undefined;
  if (qDeal && !["completed", "withdrawn", "terminated"].includes(qDeal.status.value)) questionText = `What still has to happen before ${qDeal.title} can complete, and which primary document would confirm each step?`;
  else if (qDeal) questionText = `Which assumption made at the announcement of ${qDeal.title} does this development test, and what would falsify it?`;
  else if (top.eventType === "proposed_rule" || top.eventType === "rule") questionText = `Is “${top.headline.slice(0, 120)}” a proposal or an effective rule, from which date, and which ${sector?.name ?? "sector"} companies does it touch?`;
  else questionText = `What would have to be true for “${top.headline.slice(0, 120)}” to change a deal or valuation view you hold?`;

  let weekly: BriefOut["weekly"] = null;
  if (kind === "weekly") {
    const since = addDays(today, -7);
    const statusChanges = view.deals
      .flatMap((d) => d.events.filter((e) => e.statusAfter && e.date.precision === "day" && e.date.date >= since && e.date.date <= today).map((e) => ({ dealId: d.id, change: `${DEAL_STATUS_LABEL[e.statusAfter as keyof typeof DEAL_STATUS_LABEL] ?? e.statusAfter} (${e.date.date}): ${e.title}` })))
      .slice(0, 10);
    const pending = view.deals
      .filter((d) => d.status.value === "pending_approvals" || d.status.value === "announced")
      .sort((a, b) => b.status.asOf.localeCompare(a.status.asOf))
      .slice(0, 3)
      .map((d) => `What remains before ${d.title} can complete?`);
    weekly = { statusChanges, openQuestions: [...(input.openQuestions ?? []), ...pending].slice(0, 6), reflectionPrompt: "What changed my view this week, and which source changed it?" };
  }
  const periodStart = addDays(today, -windowDays);
  const inputVersion = `${view.version}|${RANKING_VERSION}|${await sha256Hex(chosen.map((x) => `${x.c.key}:${x.c.ev.join(",")}`).join("|"), 16)}`;
  return {
    ok: true,
    periodStart,
    periodEnd: today,
    inputVersion,
    content: {
      kind,
      title: `${kind === "weekly" ? "Weekly review" : "Daily brief"} · ${today}`,
      label: input.scope === "private" ? "Compiled brief (personalised, no AI)" : "Compiled brief (no AI)",
      periodStart,
      periodEnd: today,
      cutoffAt: now.toISOString(),
      generatedAt: now.toISOString(),
      method: "compiled",
      items,
      deepDive,
      sectorImplication,
      question: { text: questionText, template: "research_question" },
      weekly,
    },
  };
}

/**
 * Compiles and stores a brief. An unchanged input returns the existing brief; changed input for the
 * same date creates a new version that supersedes (never overwrites) the earlier one.
 */
export async function compileAndStore(input: CompileInput & { db: D1Database; reason: string }): Promise<{ ok: true; id: string; created: boolean; version: number } | { ok: false; code: "NO_MATERIAL"; message: string }> {
  const db = input.db;
  const res = await compileBriefContent(input);
  const today = localDate(input.now, BRIEF_TZ);
  if (!res.ok) {
    await db
      .prepare("INSERT INTO finance_meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .bind(`brief_error:${input.scope}:${input.kind}`, JSON.stringify({ at: input.now.toISOString(), code: res.code, message: res.message }), input.now.toISOString())
      .run();
    return res;
  }
  const latest = await db
    .prepare("SELECT * FROM finance_briefs WHERE scope = ? AND user_key = ? AND kind = ? AND brief_date = ? ORDER BY version DESC LIMIT 1")
    .bind(input.scope, input.userKey, input.kind, today)
    .first<BriefRow>();
  if (latest && latest.input_version === res.inputVersion) return { ok: true, id: latest.id, created: false, version: latest.version };
  const version = (latest?.version ?? 0) + 1;
  const id = `${input.scope === "private" ? "p" : "b"}_${newId()}`;
  const evidenceIds = [...new Set(res.content.items.flatMap((i) => i.ev))];
  await db
    .prepare(
      "INSERT INTO finance_briefs (id, scope, user_key, kind, brief_date, period_start, period_end, cutoff_at, generated_at, method, provider, model, content_json, evidence_json, input_version, version, supersedes_id, correction_note, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'compiled', NULL, NULL, ?, ?, ?, ?, ?, ?, 'published')",
    )
    .bind(
      id,
      input.scope,
      input.userKey,
      input.kind,
      today,
      res.periodStart,
      res.periodEnd,
      res.content.cutoffAt,
      res.content.generatedAt,
      JSON.stringify(res.content),
      JSON.stringify(evidenceIds),
      res.inputVersion,
      version,
      latest?.id ?? null,
      latest ? `Version ${version} recompiled at ${input.now.toISOString().slice(11, 16)} UTC (${input.reason}) with newer material; version ${latest.version} is kept unchanged.` : null,
    )
    .run();
  await db.prepare("DELETE FROM finance_meta WHERE key = ?").bind(`brief_error:${input.scope}:${input.kind}`).run();
  return { ok: true, id, created: true, version };
}

export async function lastBriefError(db: D1Database | undefined, scope: "public" | "private", kind: "daily" | "weekly"): Promise<{ at: string; code: string; message: string } | null> {
  if (!db) return null;
  try {
    const row = await db.prepare("SELECT value FROM finance_meta WHERE key = ?").bind(`brief_error:${scope}:${kind}`).first<{ value: string }>();
    return row ? parseJsonColumn(row.value, null) : null;
  } catch {
    return null;
  }
}
