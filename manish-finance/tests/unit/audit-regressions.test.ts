import { describe, expect, it } from "vitest";
import type { DealSummary, MultipleDetail } from "../../shared/api";
import { residualIncomeValuation } from "../../shared/calc/residualIncome";
import { impliedValueFromStake } from "../../shared/calc/stake";
import { compareDeals, MIN_SAMPLE } from "../../shared/compare";
import { compileBriefContent, explainWhy, mergeDuplicateCandidates } from "../../server/briefCompiler";
import { isFuture } from "../../server/curation";
import { getResearch } from "../../server/research";
import { computeComps, compsBase, precedentRows } from "../../src/pages/lab/ComparablesTab";
import { computeFig, figBase } from "../../src/pages/lab/FigTab";

// Regressions for the defects listed in the September 2026 audit. The Lab tests call computeComps /
// computeFig — the functions the Lab tabs render from — rather than a helper the UI does not use.

describe("minority stake: implied value is validated (audit: 500 / 150% = 333.33, negative accepted)", () => {
  const withMinority = (minority: Partial<ReturnType<typeof compsBase>["minority"]>) => {
    const a = compsBase();
    return computeComps({ ...a, minority: { ...a.minority, ...minority } }).minority;
  };
  it("rejects a stake above 100%", () => {
    const r = withMinority({ consideration: 500, stakePct: 150 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toContain("INVALID_STAKE");
  });
  it("rejects zero or negative consideration and zero stake", () => {
    for (const [consideration, stakePct, code] of [
      [-500, 25, "INVALID_CONSIDERATION"],
      [0, 25, "INVALID_CONSIDERATION"],
      [500, 0, "INVALID_STAKE"],
      [500, -10, "INVALID_STAKE"],
    ] as const) {
      const r = withMinority({ consideration, stakePct });
      expect(r.ok, `${consideration}/${stakePct}`).toBe(false);
      if (!r.ok) expect(r.errors.map((e) => e.code)).toContain(code);
    }
  });
  it("reports missing inputs as missing, never zero", () => {
    const r = withMinority({ consideration: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("MISSING_INPUT");
  });
  it("computes valid secondary and primary cases and warns on control stakes", () => {
    const sec = withMinority({ consideration: 500, stakePct: 25, structure: "secondary" });
    expect(sec.ok && sec.value.impliedEquityValue).toBe(2000);
    const pri = withMinority({ consideration: 500, stakePct: 25, structure: "primary" });
    expect(pri.ok && pri.value).toMatchObject({ impliedEquityValue: 2000, basis: "post_money", preMoney: 1500 });
    const ctrl = impliedValueFromStake({ consideration: 600, stakePct: 60, structure: "secondary" });
    expect(ctrl.ok && ctrl.warnings.map((w) => w.code)).toContain("CONTROL_STAKE");
    expect(impliedValueFromStake({ consideration: 500, stakePct: 100, structure: "primary" }).ok).toBe(false);
  });
});

describe("FIG residual income with zero book (audit: ok with Infinity ROE)", () => {
  const input = { openingBookEquity: 100, costOfEquity: 0.1, years: [{ netIncome: -100, distributions: 0, capitalChanges: 0 }, { netIncome: 5, distributions: 0, capitalChanges: 0 }] };
  it("fails instead of returning Infinity when a year opens on zero book equity", () => {
    const r = residualIncomeValuation(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatchObject({ code: "NON_POSITIVE_OPENING_BOOK", field: "years[1]" });
  });
  it("the Lab's FIG tab computation surfaces the same error", () => {
    const r = computeFig({ ...figBase(), riMode: "direct", openingBookEquity: 100, costOfEquity: 0.1, directYears: input.years });
    expect(r.ri.ok).toBe(false);
    if (!r.ri.ok) expect(r.ri.errors[0]?.code).toBe("NON_POSITIVE_OPENING_BOOK");
  });
  it("negative book after year 1 also fails; a recapitalisation keeps it valid", () => {
    expect(residualIncomeValuation({ ...input, years: [{ netIncome: -150, distributions: 0, capitalChanges: 0 }, { netIncome: 5, distributions: 0, capitalChanges: 0 }] }).ok).toBe(false);
    const recap = residualIncomeValuation({ ...input, years: [{ netIncome: -100, distributions: 0, capitalChanges: 60 }, { netIncome: 5, distributions: 0, capitalChanges: 0 }] });
    expect(recap.ok).toBe(true);
    if (recap.ok) {
      expect(recap.value.rows[1]?.roe).toBeCloseTo(5 / 60, 10);
      expect(Number.isFinite(recap.value.equityValue)).toBe(true);
    }
  });
  it("a loss that leaves the final closing book non-positive still warns", () => {
    const r = residualIncomeValuation({ ...input, years: [{ netIncome: -100, distributions: 0, capitalChanges: 0 }] });
    expect(r.ok && r.warnings.map((w) => w.code)).toContain("NON_POSITIVE_BOOK");
  });
});

function deal(id: string, over: Partial<DealSummary> & { evEbitda?: number; basis?: Partial<NonNullable<MultipleDetail["basis"]>> | null }): DealSummary {
  const detail: MultipleDetail | null =
    over.evEbitda !== undefined
      ? {
          value: over.evEbitda,
          termId: `${id}-t0`,
          status: "reported",
          basis: over.basis === null ? null : { periodType: "LTM", periodEnd: "2024-12-31", periodLabel: "LTM Dec 2024", accountingBasis: "IFRS", perimeter: "Target group, consolidated", adjusted: false, ...(over.basis ?? {}) },
          reference: null,
          ev: [],
        }
      : null;
  return {
    id,
    title: id,
    aliases: [],
    dealType: "control_acquisition",
    buyerType: "strategic",
    sector: "tmt",
    subsector: "x",
    peerGroup: "software",
    acquirer: { companyId: null, name: "A", country: "US", ev: [] },
    target: { companyId: null, name: "T", country: "US", ev: [] },
    announced: { date: "2024-01-01", precision: "day", ev: [] },
    status: "completed",
    statusAsOf: "2024-06-01",
    statusEv: [],
    stake: { acquiredPct: 100, resultingPct: 100 },
    headline: null,
    valueDisclosed: false,
    paymentMix: ["cash"],
    crossBorder: false,
    hasAutopsy: false,
    verification: { source_checked: 0, search_corroborated: 0, pending: 0, conflict: 0, human_reviewed: 0 },
    lastChangedAt: "2024-06-01",
    latestEvent: null,
    adviserNames: [],
    tags: [],
    multiples: { evRevenue: null, evEbitda: detail?.value ?? null, priceToBook: null },
    multipleDetails: { evRevenue: null, evEbitda: detail, priceToBook: null },
    ...over,
  };
}

describe("compareDeals pools only eligible multiples (audit: 8x software + 20x pharma → 14x median)", () => {
  it("does not pool a software and a pharma multiple", () => {
    const c = compareDeals([deal("soft", { evEbitda: 8 }), deal("pharma", { evEbitda: 20, sector: "healthcare", peerGroup: "pharma" })]);
    const m = c.metrics.find((x) => x.metric === "evEbitda");
    expect(m?.stats.median).toBeNull();
    expect(m?.stats.n).toBe(1);
    const pharma = m?.observations.find((o) => o.dealId === "pharma");
    expect(pharma?.eligible).toBe(false);
    expect(pharma?.excludedReason).toMatch(/Different peer group/);
    // The raw value stays visible; it is just not pooled.
    expect(pharma?.value).toEqual({ kind: "value", value: 20 });
  });
  it("excludes different denominator periods, accounting bases and missing basis, with reasons", () => {
    const c = compareDeals([
      deal("a", { evEbitda: 10 }),
      deal("b", { evEbitda: 11, basis: { periodType: "FY" } }),
      deal("c", { evEbitda: 12, basis: { accountingBasis: "US GAAP" } }),
      deal("d", { evEbitda: 13, basis: null }),
    ]);
    const m = c.metrics.find((x) => x.metric === "evEbitda");
    const reasons = Object.fromEntries((m?.observations ?? []).map((o) => [o.dealId, o.excludedReason]));
    expect(reasons.a).toBeNull();
    expect(reasons.b).toMatch(/denominator period/);
    expect(reasons.c).toMatch(/accounting basis/);
    expect(reasons.d).toMatch(/not recorded/);
  });
  it(`needs at least ${MIN_SAMPLE} eligible observations before showing a median`, () => {
    const two = compareDeals([deal("a", { evEbitda: 10 }), deal("b", { evEbitda: 14 })]).metrics.find((x) => x.metric === "evEbitda");
    expect(two?.stats.median).toBeNull();
    expect(two?.statsNote).toMatch(/Only 2 eligible/);
    const three = compareDeals([deal("a", { evEbitda: 10 }), deal("b", { evEbitda: 14 }), deal("c", { evEbitda: 12 })]).metrics.find((x) => x.metric === "evEbitda");
    expect(three?.stats.median).toBe(12);
    expect(three?.reference).toMatchObject({ dealId: "a", peerGroup: "software", periodType: "LTM", accountingBasis: "IFRS" });
  });
  it("financial institutions never get an EV/EBITDA", () => {
    const c = compareDeals([deal("bank", { evEbitda: 9, sector: "fig", peerGroup: "banks" })]);
    expect(c.metrics.find((x) => x.metric === "evEbitda")?.observations[0]?.value.kind).toBe("not_applicable");
  });
});

describe("Lab precedent table uses sourced multiples, not a hardcoded placeholder", () => {
  it("shows the recorded multiple with its basis, same peer group first", () => {
    const anchor = deal("anchor", {});
    const { keys, rows } = precedentRows(anchor, [deal("other-group", { evEbitda: 30, peerGroup: "media", announced: { date: "2025-01-01", precision: "day", ev: [] } }), deal("peer", { evEbitda: 9.5 }), deal("none", {})]);
    expect(keys).toEqual(["evEbitda", "evRevenue"]);
    expect(rows[0]?.deal.id).toBe("peer");
    expect(rows[0]?.cells[0]?.detail?.value).toBe(9.5);
    expect(rows[0]?.cells[0]?.detail?.basis?.periodType).toBe("LTM");
    expect(rows.find((r) => r.deal.id === "none")?.cells[0]?.detail).toBeNull();
  });
  it("FIG deals use P/B, not EV/EBITDA", () => {
    expect(precedentRows(deal("b", { sector: "fig", peerGroup: "banks" }), []).keys).toEqual(["priceToBook"]);
  });
});

describe("briefs: one development reported by several origins appears once (audit: 23 Sep UBS item twice)", () => {
  it("merges the UBS deal-timeline event and the FIG playbook entry into one item with an item-specific explanation", async () => {
    const view = await getResearch(undefined);
    const res = await compileBriefContent({
      db: undefined,
      view,
      now: new Date("2026-09-25T06:00:00Z"),
      kind: "daily",
      scope: "public",
      userKey: "public",
      ctx: { followedSectors: new Set(["fig"]), watchedDeals: new Set(), watchedCompanies: new Set(), personalised: false },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ubs = res.content.items.filter((i) => /UBS|upper house|Council of States/i.test(i.headline));
    expect(ubs).toHaveLength(1);
    const item = ubs[0];
    expect(item?.whatChanged).toMatch(/Also recorded in: Financial institutions playbook|Also recorded in: .*playbook/);
    expect(item?.entities).toEqual(expect.arrayContaining([{ type: "deal", id: "ubs-credit-suisse" }, { type: "sector", id: "fig" }]));
    expect(item?.uncertainty).toMatch(/^Proposed, not effective\./);
    expect(item?.whyBasis).toBe("item");
    expect(item?.whyItMatters).toMatch(/UBS/);
    // No two items in a brief share a source document.
    const docs = res.content.items.map((i) => new Set(i.ev.map((id) => view.claims[id]?.documentId).filter(Boolean)));
    for (let i = 0; i < docs.length; i++) for (let j = i + 1; j < docs.length; j++) expect([...(docs[i] as Set<string>)].some((d) => (docs[j] as Set<string>).has(d)), `items ${i} and ${j}`).toBe(false);
  });
  it("merges a feed item with an archive event that cites the same URL, and keeps distinct items apart", () => {
    const base = { eventDate: { date: "2026-09-23", precision: "day" as const }, publishedDate: null, primary: true, newlyDiscovered: false, recencyDate: "2026-09-23", uncertainty: "u", whyItMatters: null, dealContext: null, alsoIn: [] };
    const merged = mergeDuplicateCandidates([
      { ...base, key: "feed:1", headline: "UBS statement on parliamentary capital decision", whatChanged: "w", eventType: "deal_news", sectors: [], entities: [], ev: ["ev-u-1"], url: "https://www.ubs.com/x/", curated: false, sourceLabel: "UBS news", docKeys: ["url:ubs.com/x"] },
      { ...base, key: "event:1", headline: "UBS: capital rules", whatChanged: "w", eventType: "subsequent", sectors: ["fig"], entities: [{ type: "deal", id: "ubs-credit-suisse" }], ev: ["ev-a"], url: "https://ubs.com/x", curated: true, sourceLabel: "Deal timeline", docKeys: ["doc:ubs-pr", "url:ubs.com/x"] },
      { ...base, key: "event:2", headline: "RBI clarifies REIT valuation", whatChanged: "w", eventType: "rule", sectors: ["real-estate"], entities: [{ type: "sector", id: "real-estate" }], ev: ["ev-b"], url: null, curated: true, sourceLabel: "Real estate playbook", docKeys: ["doc:rbi"] },
    ]);
    expect(merged).toHaveLength(2);
    const m = merged.find((c) => c.key.includes("feed:1"));
    expect(m?.sourceLabel).toBe("Deal timeline");
    expect(m?.alsoIn).toEqual(["UBS news"]);
    expect(m?.ev.sort()).toEqual(["ev-a", "ev-u-1"]);
    expect(m?.eventType).toBe("deal_news"); // the more informative event type of the two
  });
  it("falls back to a labelled generic explanation only when nothing specific is known", () => {
    expect(explainWhy({ whyItMatters: null, eventType: "rule", dealContext: null }).basis).toBe("generic");
    expect(explainWhy({ whyItMatters: null, eventType: "completion", dealContext: { title: "X buys Y", statusAfter: "completed" } })).toMatchObject({ basis: "item", text: expect.stringMatching(/^X buys Y moved to “Completed”/) });
  });
});

describe("retrieval times are compared as instants, not strings (found in the September 2026 follow-up)", () => {
  it("a retrieval in the same second as the request is not 'in the future'", () => {
    // As strings, "…:05Z" sorts after "…:05.500Z" because "Z" > ".".
    expect("2026-09-25T18:51:05Z" > "2026-09-25T18:51:05.500Z").toBe(true);
    expect(isFuture("2026-09-25T18:51:05Z", "2026-09-25T18:51:05.500Z")).toBe(false);
    expect(isFuture("2026-09-25T18:51Z", "2026-09-25T18:51:30.000Z")).toBe(false);
  });
  it("allows five minutes of device-clock skew and rejects anything later", () => {
    expect(isFuture("2026-09-25T18:55:00Z", "2026-09-25T18:51:05.000Z")).toBe(false);
    expect(isFuture("2026-09-25T18:57:00Z", "2026-09-25T18:51:05.000Z")).toBe(true);
  });
});
