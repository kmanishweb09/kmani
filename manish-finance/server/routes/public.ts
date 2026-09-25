import type { CompanyDetail, DealDetail, DealSummary, Page, SearchHit } from "../../shared/api";
import { collectEvidenceIds } from "../../shared/archive/derive";
import { compareDeals } from "../../shared/compare";
import { dealQueryToParams, filtersOnly, matchesFilters, normalizeSearchText, parseDealQuery, sortDeals } from "../../shared/dealQuery";
import { SECTOR_NAMES, SECTOR_SLUGS, type SectorSlug } from "../../shared/schemas/research";
import { toCsv } from "../../shared/text/csv";
import { HttpError, publicJson, textResponse } from "../http";
import { archive, evidenceMap, getResearch, type ResearchView } from "../research";
import type { Router } from "../router";
import type { RequestContext } from "../types";

const ID_PARAM = /^[a-z0-9][a-z0-9-]{0,95}$/;

function checkId(id: string | undefined, what: string): string {
  if (!id || !ID_PARAM.test(id)) throw new HttpError(404, "NOT_FOUND", `${what} not found.`);
  return id;
}

export function dealDetail(view: ResearchView, id: string): DealDetail | null {
  const d = view.dealById.get(id);
  const s = view.summaryById.get(id);
  if (!d || !s) return null;
  return {
    ...s,
    perimeter: d.perimeter,
    stakeNote: d.stake.note,
    stakeEv: d.stake.ev,
    effective: d.effective,
    otherParties: d.otherParties,
    terms: d.terms,
    payment: d.payment,
    financing: d.financing,
    events: [...d.events].sort((a, b) => a.date.date.localeCompare(b.date.date)),
    advisers: d.advisers,
    rationale: d.rationale,
    sectorContext: d.sectorContext,
    comparables: d.comparables.map((c) => ({ ...c, title: view.dealById.get(c.dealId)?.title ?? null })),
    afterDeal: d.afterDeal,
    autopsy: d.autopsy,
    researchCutoff: d.researchCutoff,
    recordUpdated: d.recordUpdated,
    evidence: evidenceMap(view, collectEvidenceIds(d)),
    archiveVersion: view.archiveVersion,
  };
}

function filteredDeals(view: ResearchView, params: URLSearchParams): { items: DealSummary[]; query: ReturnType<typeof parseDealQuery>["query"] } {
  const { query, errors } = parseDealQuery(params);
  if (errors.length) throw new HttpError(400, "INVALID_FILTER", errors.join(" "), { errors });
  const f = filtersOnly(query);
  const items = sortDeals(
    view.summaries.filter((d) => matchesFilters(d, f, view.dealSearch.get(d.id))),
    query.sort ?? "announced",
    query.dir ?? "desc",
  );
  return { items, query };
}

function dealsCsv(view: ResearchView, items: DealSummary[]): string {
  const header = [
    "deal_id", "title", "announcement_date", "announcement_date_precision", "acquirer", "acquirer_country", "target", "target_country",
    "sector", "subsector", "deal_type", "buyer_type", "status", "status_as_of", "stake_acquired_pct", "stake_held_after_pct",
    "value_amount", "value_currency", "value_unit", "value_basis", "value_ownership_pct", "payment_mix", "cross_border",
    "claims_source_checked", "claims_search_corroborated", "claims_pending", "value_source_urls", "announcement_source_urls",
    "research_cutoff", "archive_version",
  ];
  const urls = (ev: string[]) =>
    [...new Set(ev.map((id) => view.claims[id]?.documentId).filter(Boolean).map((docId) => view.documents[docId as string]?.url).filter(Boolean))].join(" ");
  const rows = items.map((d) => {
    const full = view.dealById.get(d.id);
    return [
      d.id, d.title, d.announced.date, d.announced.precision, d.acquirer.name, d.acquirer.country, d.target.name, d.target.country,
      SECTOR_NAMES[d.sector], d.subsector, d.dealType, d.buyerType, d.status, d.statusAsOf, d.stake.acquiredPct, d.stake.resultingPct,
      d.headline?.amount ?? null, d.headline?.currency ?? null, d.headline?.unit ?? null, d.headline?.valueBasis ?? "undisclosed",
      d.headline?.ownershipPct ?? null, d.paymentMix.join("|"), d.crossBorder,
      d.verification.source_checked, d.verification.search_corroborated, d.verification.pending,
      urls(d.headline?.ev ?? []), urls(d.announced.ev), full?.researchCutoff ?? archive.cutoff, view.archiveVersion,
    ];
  });
  return toCsv(header, rows);
}

function searchAll(view: ResearchView, q: string, limit: number): SearchHit[] {
  const terms = normalizeSearchText(q).split(" ").filter(Boolean);
  if (!terms.length) return [];
  const hits: SearchHit[] = [];
  const score = (hay: string, title: string): number => {
    if (!terms.every((t) => hay.includes(t))) return 0;
    const nt = normalizeSearchText(title);
    const joined = terms.join(" ");
    if (nt === joined) return 100;
    if (nt.startsWith(joined)) return 80;
    if (nt.includes(joined)) return 60;
    return 40;
  };
  for (const d of view.summaries) {
    const s = score(view.dealSearch.get(d.id) ?? "", d.title);
    if (s) hits.push({ type: "deal", id: d.id, title: d.title, subtitle: `${SECTOR_NAMES[d.sector]} · ${d.announced.date.slice(0, 4)} · ${d.status.replace("_", " ")}`, href: `/finance/deals/${d.id}`, score: s + 5 });
  }
  for (const c of view.companySummaries) {
    const hay = normalizeSearchText([c.displayName, c.legalName, ...c.aliases, ...c.tickers.map((t) => t.symbol)].join(" "));
    const s = score(hay, c.displayName);
    if (s) hits.push({ type: "company", id: c.id, title: c.displayName, subtitle: `${SECTOR_NAMES[c.sector]} · ${c.country}${c.lifecycle !== "active" ? ` · ${c.lifecycle}` : ""}`, href: `/finance/companies/${c.id}`, score: s + 4 });
  }
  for (const s of archive.sectors) {
    const sc = score(normalizeSearchText(`${s.name} ${s.tagline} ${s.subsectors.map((x) => x.name).join(" ")}`), s.name);
    if (sc) hits.push({ type: "sector", id: s.slug, title: s.name, subtitle: s.tagline, href: `/finance/sectors/${s.slug}`, score: sc + 6 });
  }
  for (const g of archive.glossary) {
    const sc = score(normalizeSearchText(`${g.term} ${g.definition}`), g.term);
    if (sc) hits.push({ type: "glossary", id: g.id, title: g.term, subtitle: g.definition.slice(0, 90), href: `/finance/notebook?tab=learn&term=${g.id}`, score: sc });
  }
  for (const m of archive.modules) {
    const sc = score(normalizeSearchText(`${m.title} ${m.summary}`), m.title);
    if (sc) hits.push({ type: "module", id: m.id, title: `Module ${m.number}: ${m.title}`, subtitle: m.summary.slice(0, 90), href: `/finance/notebook?tab=learn&module=${m.id}`, score: sc });
  }
  for (const s of archive.sectors) {
    for (const m of s.metrics) {
      const sc = score(normalizeSearchText(`${m.name} ${m.formula}`), m.name);
      if (sc) hits.push({ type: "metric", id: `${s.slug}:${m.id}`, title: m.name, subtitle: `${s.name} metric · ${m.formula.slice(0, 70)}`, href: `/finance/sectors/${s.slug}?tab=metrics#metric-${m.id}`, score: sc - 2 });
    }
  }
  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}

export function registerPublicRoutes(r: Router): void {
  r.add({
    method: "GET",
    pattern: "/api/finance/deals",
    access: "public",
    handler: async (c) => {
      const view = await getResearch(c.db);
      const { items, query } = filteredDeals(view, c.url.searchParams);
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 25;
      const body: Page<DealSummary> = {
        items: items.slice((page - 1) * pageSize, page * pageSize),
        total: items.length,
        page,
        pageSize,
        meta: {
          scope: "Covered transactions within this curated database (not the whole market).",
          archiveVersion: view.archiveVersion,
          archiveCutoff: archive.cutoff,
          canonicalQuery: dealQueryToParams(query).toString(),
          totalInDatabase: view.summaries.length,
        },
      };
      return publicJson(c.request, body, { etagSeed: view.version });
    },
  });

  r.add({
    method: "GET",
    pattern: "/api/finance/deals/export.csv",
    access: "public",
    handler: async (c) => {
      const view = await getResearch(c.db);
      const { items } = filteredDeals(view, c.url.searchParams);
      return textResponse(dealsCsv(view, items), "text/csv; charset=utf-8", { filename: `finance-deals-${archive.cutoff}.csv` });
    },
  });

  r.add({
    method: "GET",
    pattern: "/api/finance/deals/compare",
    access: "public",
    handler: async (c) => {
      const ids = [...new Set((c.url.searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
      if (ids.length < 2 || ids.length > 4) throw new HttpError(400, "INVALID_COMPARISON", "Select two to four deals to compare.");
      const view = await getResearch(c.db);
      const deals = ids.map((id) => view.summaryById.get(id));
      const missing = ids.filter((_, i) => !deals[i]);
      if (missing.length) throw new HttpError(404, "NOT_FOUND", `Deal(s) not found: ${missing.join(", ")}`);
      const summaries = deals as DealSummary[];
      const comparison = compareDeals(summaries);
      const ev = new Set(summaries.flatMap((d) => [...d.announced.ev, ...d.statusEv, ...(d.headline?.ev ?? [])]));
      return publicJson(c.request, { deals: summaries, comparison, evidence: evidenceMap(view, ev) }, { etagSeed: view.version });
    },
  });

  r.add({
    method: "GET",
    pattern: "/api/finance/deals/:id",
    access: "public",
    handler: async (c) => {
      const id = checkId(c.params.id, "Deal");
      const view = await getResearch(c.db);
      const detail = dealDetail(view, id);
      if (!detail) throw new HttpError(404, "NOT_FOUND", "Deal not found.");
      return publicJson(c.request, detail, { etagSeed: view.version });
    },
  });

  r.add({
    method: "GET",
    pattern: "/api/finance/companies",
    access: "public",
    handler: async (c) => {
      const view = await getResearch(c.db);
      const p = c.url.searchParams;
      const q = normalizeSearchText(p.get("q") ?? "");
      const sector = p.get("sector");
      const country = p.get("country");
      const lifecycle = p.get("lifecycle");
      if (sector && !(SECTOR_SLUGS as readonly string[]).includes(sector)) throw new HttpError(400, "INVALID_FILTER", "Unknown sector.");
      let items = view.companySummaries.filter((co) => {
        if (sector && co.sector !== sector) return false;
        if (country === "IN" && co.country !== "IN") return false;
        if (country === "non-IN" && co.country === "IN") return false;
        if (lifecycle === "active" && co.lifecycle !== "active") return false;
        if (lifecycle === "historical" && co.lifecycle === "active") return false;
        if (q) {
          const hay = normalizeSearchText([co.displayName, co.legalName, ...co.aliases, ...co.tickers.map((t) => t.symbol)].join(" "));
          if (!q.split(" ").every((t) => hay.includes(t))) return false;
        }
        return true;
      });
      items = items.sort((a, b) => a.displayName.localeCompare(b.displayName));
      const page = Math.max(1, Number(p.get("page") ?? "1") || 1);
      const pageSize = Math.min(100, Math.max(1, Number(p.get("pageSize") ?? "50") || 50));
      const body: Page<(typeof items)[number]> = { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize, meta: { archiveCutoff: archive.cutoff } };
      return publicJson(c.request, body, { etagSeed: view.version });
    },
  });

  r.add({
    method: "GET",
    pattern: "/api/finance/companies/:id",
    access: "public",
    handler: async (c) => {
      const id = checkId(c.params.id, "Company");
      const view = await getResearch(c.db);
      const co = view.companyById.get(id);
      const summary = view.companySummaries.find((s) => s.id === id);
      if (!co || !summary) throw new HttpError(404, "NOT_FOUND", "Company not found.");
      const deals = view.summaries
        .filter((d) => d.acquirer.companyId === id || d.target.companyId === id || view.dealById.get(d.id)?.otherParties.some((p) => p.companyId === id))
        .sort((a, b) => b.announced.date.localeCompare(a.announced.date));
      const corrections = view.companyCorrections.get(id) ?? [];
      const evIds = new Set<string>([...co.identityEv, ...co.observations.flatMap((o) => o.ev), ...co.ownership.flatMap((o) => o.ev), ...corrections.flatMap((x) => x.ev)]);
      const detail: CompanyDetail = {
        ...summary,
        formerNames: co.formerNames.map((f) => ({ name: f.name, until: f.until ?? null })),
        tickerDetails: co.tickers.map((t) => ({ exchange: t.exchange, symbol: t.symbol, note: t.note ?? null, active: t.active })),
        lifecycleDetail: { status: co.lifecycle.status, note: co.lifecycle.note ?? null, validTo: co.lifecycle.validTo ?? null, successorId: co.lifecycle.successorId ?? null, parentId: co.lifecycle.parentId ?? null },
        website: co.website ?? null,
        irUrl: co.irUrl ?? null,
        identityEv: co.identityEv,
        businessModel: { ...co.businessModel, basisNote: co.businessModel.basisNote ?? null },
        observations: co.observations.map((o) => ({
          id: o.id,
          metric: o.metric,
          label: o.label ?? o.metric,
          value: o.value,
          nullReason: o.nullReason ?? null,
          unit: o.unit,
          currency: o.currency ?? null,
          scale: o.scale ?? null,
          period: o.period,
          scope: o.scope,
          basis: o.basis,
          definition: o.definition ?? null,
          ev: o.ev,
        })),
        peers: co.peers.map((p) => ({ ...p, displayName: view.companyById.get(p.companyId)?.displayName ?? null })),
        ownership: co.ownership.map((o) => ({ holder: o.holder, pct: o.pct, asOf: o.asOf, ev: o.ev })),
        deals,
        corrections,
        evidence: evidenceMap(view, evIds),
        recordUpdated: co.recordUpdated,
      };
      return publicJson(c.request, detail, { etagSeed: view.version });
    },
  });

  r.add({
    method: "GET",
    pattern: "/api/finance/sectors",
    access: "public",
    handler: async (c) => {
      const view = await getResearch(c.db);
      const items = archive.sectors.map((s) => ({
        slug: s.slug,
        name: s.name,
        tagline: s.tagline,
        subsectors: s.subsectors.map((x) => ({ id: x.id, name: x.name })),
        dealCount: view.summaries.filter((d) => d.sector === s.slug).length,
        companyCount: view.companySummaries.filter((co) => co.sector === s.slug).length,
        latestChange: [...s.whatChanged].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null,
      }));
      return publicJson(c.request, { items }, { etagSeed: view.version });
    },
  });

  r.add({
    method: "GET",
    pattern: "/api/finance/sectors/:slug",
    access: "public",
    handler: async (c) => {
      const slug = c.params.slug as SectorSlug;
      const s = archive.sectors.find((x) => x.slug === slug);
      if (!s) throw new HttpError(404, "NOT_FOUND", "Sector not found.");
      const view = await getResearch(c.db);
      const deals = view.summaries.filter((d) => d.sector === slug).sort((a, b) => b.announced.date.localeCompare(a.announced.date));
      const companies = view.companySummaries.filter((co) => co.sector === slug || s.players.some((p) => p.companyId === co.id));
      const questions = archive.questions.filter((q) => s.practiceQuestionIds.includes(q.id));
      const evIds = new Set<string>([...s.regulators.flatMap((x) => x.ev), ...s.whatChanged.flatMap((x) => x.ev)]);
      return publicJson(c.request, { sector: s, deals, companies, questions, evidence: evidenceMap(view, evIds) }, { etagSeed: view.version });
    },
  });

  r.add({
    method: "GET",
    pattern: "/api/finance/evidence/:id",
    access: "public",
    handler: async (c) => {
      const id = c.params.id ?? "";
      if (!/^ev-[a-z0-9]{6,16}$/.test(id) && !/^ev-u-[A-Za-z0-9_-]{8,64}$/.test(id)) throw new HttpError(404, "NOT_FOUND", "Evidence not found.");
      const view = await getResearch(c.db);
      const m = evidenceMap(view, [id]);
      const claim = m[id];
      if (!claim) throw new HttpError(404, "NOT_FOUND", "Evidence not found.");
      return publicJson(c.request, claim, { etagSeed: view.version });
    },
  });

  r.add({
    method: "GET",
    pattern: "/api/finance/search",
    access: "public",
    handler: async (c) => {
      const q = (c.url.searchParams.get("q") ?? "").slice(0, 120);
      const limit = Math.min(30, Math.max(1, Number(c.url.searchParams.get("limit") ?? "12") || 12));
      const view = await getResearch(c.db);
      return publicJson(c.request, { q, items: searchAll(view, q, limit), scope: "public" }, { etagSeed: view.version, maxAge: 30 });
    },
  });

  r.add({
    method: "GET",
    pattern: "/api/finance/glossary",
    access: "public",
    handler: async (c) => publicJson(c.request, { items: archive.glossary }, { etagSeed: archive.version, maxAge: 300 }),
  });

  r.add({
    method: "GET",
    pattern: "/api/finance/learn",
    access: "public",
    handler: async (c) =>
      publicJson(
        c.request,
        { items: archive.modules.map((m) => ({ id: m.id, number: m.number, title: m.title, summary: m.summary, minutes: m.minutes, questionCount: m.questionIds.length })) },
        { etagSeed: archive.version, maxAge: 300 },
      ),
  });

  r.add({
    method: "GET",
    pattern: "/api/finance/learn/:id",
    access: "public",
    handler: async (c) => {
      const m = archive.modules.find((x) => x.id === c.params.id);
      if (!m) throw new HttpError(404, "NOT_FOUND", "Module not found.");
      const questions = archive.questions.filter((q) => m.questionIds.includes(q.id));
      return publicJson(c.request, { module: m, questions }, { etagSeed: archive.version, maxAge: 300 });
    },
  });

  r.add({
    method: "GET",
    pattern: "/api/finance/questions",
    access: "public",
    handler: async (c) => {
      const type = c.url.searchParams.get("topicType");
      const id = c.url.searchParams.get("topicId");
      const items = archive.questions.filter((q) => (!type || q.topic.type === type) && (!id || q.topic.id === id));
      return publicJson(c.request, { items, total: items.length }, { etagSeed: archive.version, maxAge: 300 });
    },
  });

  r.add({
    method: "GET",
    pattern: "/api/finance/training-models",
    access: "public",
    handler: async (c) => publicJson(c.request, { items: archive.training, label: "Training examples: fictional, deliberately constructed data excluded from research statistics." }, { etagSeed: archive.version, maxAge: 300 }),
  });
}

export { searchAll };
