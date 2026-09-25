import type { FeedItemView } from "../../shared/api";
import type { CompiledCompany, CompiledDeal } from "../../shared/archive/compile";
import { normalizeSearchText } from "../../shared/dealQuery";
import type { SectorSlugValue } from "../../shared/labels";
import type { ResearchView } from "../research";

/**
 * Deterministic entity linking and event classification for collected items. Matching is by whole
 * words against the alias index; a longer alias wins over a shorter one it contains ("HDFC Bank"
 * over "HDFC"). Anything that is not a unique exact alias is marked ambiguous — a lead, never a fact.
 */

export type FeedEntity = FeedItemView["entities"][number];

interface Span {
  start: number;
  end: number;
}

function occurrences(haystack: string, needle: string): Span[] {
  const out: Span[] = [];
  const padded = ` ${needle} `;
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(padded, from);
    if (i < 0) break;
    out.push({ start: i + 1, end: i + 1 + needle.length });
    from = i + 1;
  }
  return out;
}

const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end;

/** Words that are also company aliases but are too generic to identify a company in a headline. */
const GENERIC = new Set(["bank", "group", "holdings", "limited", "india", "capital", "finance", "energy", "power", "global"]);

export function linkEntities(text: string, view: Pick<ResearchView, "aliasIndex" | "dealById">, extraCompanyIds: string[] = []): FeedEntity[] {
  const norm = ` ${normalizeSearchText(text)} `;
  const byAlias = new Map<string, Array<{ type: "deal" | "company"; id: string; name: string }>>();
  for (const a of view.aliasIndex) {
    if (GENERIC.has(a.alias)) continue;
    const list = byAlias.get(a.alias) ?? [];
    if (!list.some((x) => x.type === a.type && x.id === a.id)) list.push({ type: a.type, id: a.id, name: a.name });
    byAlias.set(a.alias, list);
  }
  const aliases = [...byAlias.keys()].filter((a) => norm.includes(` ${a} `)).sort((a, b) => b.length - a.length || a.localeCompare(b));
  const consumed: Span[] = [];
  const hits = new Map<string, FeedEntity>();
  for (const alias of aliases) {
    const free = occurrences(norm, alias).filter((o) => !consumed.some((c) => overlaps(c, o)));
    if (!free.length) continue;
    consumed.push(...free);
    const targets = byAlias.get(alias) ?? [];
    const companies = targets.filter((t) => t.type === "company");
    const deals = targets.filter((t) => t.type === "deal");
    const ambiguous = companies.length > 1 || deals.length > 1;
    for (const t of targets) {
      const key = `${t.type}:${t.id}`;
      const prev = hits.get(key);
      const confidence: FeedEntity["confidence"] = ambiguous ? "ambiguous" : "exact_alias";
      if (!prev || (prev.confidence === "ambiguous" && confidence === "exact_alias")) hits.set(key, { type: t.type, id: t.id, name: t.name, confidence });
    }
  }
  for (const id of extraCompanyIds) {
    const key = `company:${id}`;
    const name = hits.get(key)?.name ?? [...byAlias.values()].flat().find((t) => t.type === "company" && t.id === id)?.name ?? id;
    hits.set(key, { type: "company", id, name, confidence: "exact_alias" });
  }
  // A deal is suggested (ambiguous) when both its acquirer and target are mentioned but the deal
  // itself is not named: co-mentions are common in unrelated news.
  const companyIds = new Set([...hits.values()].filter((h) => h.type === "company").map((h) => h.id));
  if (companyIds.size >= 2) {
    for (const d of view.dealById.values()) {
      if (hits.has(`deal:${d.id}`)) continue;
      const a = d.acquirer.companyId;
      const t = d.target.companyId;
      if (a && t && a !== t && companyIds.has(a) && companyIds.has(t)) hits.set(`deal:${d.id}`, { type: "deal", id: d.id, name: d.title, confidence: "ambiguous" });
    }
  }
  return [...hits.values()].sort((x, y) => (x.type === y.type ? x.name.localeCompare(y.name) : x.type === "deal" ? -1 : 1)).slice(0, 12);
}

export function sectorsFor(entities: FeedEntity[], view: { dealById: Map<string, CompiledDeal>; companyById: Map<string, CompiledCompany> }, defaults: string[]): SectorSlugValue[] {
  const out = new Set<string>(defaults);
  for (const e of entities) {
    if (e.confidence !== "exact_alias") continue;
    const s = e.type === "deal" ? view.dealById.get(e.id)?.sector : view.companyById.get(e.id)?.sector;
    if (s) out.add(s);
  }
  return [...out].sort() as SectorSlugValue[];
}

/** Feed event types (distinct from curated deal event types). Proposed and effective rules are kept apart. */
export const FEED_EVENT_TYPES = [
  "proposed_rule",
  "rule",
  "enforcement",
  "approval",
  "deal_news",
  "monetary_policy",
  "merger_document",
  "tender_offer",
  "ownership_filing",
  "completion_filing",
  "material_agreement",
  "filing",
  "announcement",
] as const;
export type FeedEventType = (typeof FEED_EVENT_TYPES)[number];

/** Keyword rules for regulator/publisher headlines. Order matters: proposals before rules. */
export function classifyHeadline(title: string): FeedEventType {
  const t = title.toLowerCase();
  // An authority approving a transaction ("CCI approves proposed combination …") is an approval, even
  // though the headline says "proposed"; it must not be read as a proposed rule.
  if (/\b(approv(es|ed|al)|clears?|cleared)\b.*\b(combination|merger|acquisition|amalgamation|stake|takeover)\b/.test(t)) return "approval";
  if (/\b(draft|consultation paper|consultation|discussion paper|comments? (invited|sought)|proposed)\b/.test(t)) return "proposed_rule";
  if (/\b(penalt(y|ies)|imposes|cancels? (the )?(licen[cs]e|certificate|registration)|adjudication order|settlement order)\b/.test(t)) return "enforcement";
  if (/\b(monetary policy|repo rate|policy rate|mpc)\b/.test(t)) return "monetary_policy";
  if (/\b(merger|amalgamation|acquisition|acquire[sd]?|takeover|open offer|stake|scheme of arrangement|demerger|combination)\b/.test(t)) return "deal_news";
  if (/\b(approv(al|es|ed)|grants?|in-principle|no objection)\b/.test(t)) return "approval";
  if (/\b(circular|master direction|directions?|regulations?|notification|amendment|guidelines|framework|rules)\b/.test(t)) return "rule";
  return "announcement";
}

/** Maps a feed event type onto a curated deal event type for owner-reviewed publication. */
export function dealEventTypeFor(feedType: string): "regulatory_filing" | "regulatory_approval" | "open_offer" | "subsequent" {
  switch (feedType) {
    case "merger_document":
    case "completion_filing":
    case "material_agreement":
    case "ownership_filing":
    case "filing":
      return "regulatory_filing";
    case "tender_offer":
      return "open_offer";
    case "approval":
      return "regulatory_approval";
    default:
      return "subsequent";
  }
}

/** Groups repeated coverage of the same event: normalised title words (stop words removed) + date. */
export function clusterKey(title: string, date: string | null): string {
  const STOP = new Set(["the", "a", "an", "of", "and", "to", "in", "on", "for", "by", "with", "from", "at", "as", "its", "is", "rbi", "sebi", "press", "release"]);
  const words = normalizeSearchText(title)
    .split(" ")
    .filter((w) => w.length > 1 && !STOP.has(w))
    .slice(0, 12)
    .sort();
  return `${date ?? "undated"}|${words.join(" ")}`.slice(0, 200);
}
