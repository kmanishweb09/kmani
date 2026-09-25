import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, idem, startTestHost, type TestHost } from "./helpers";

// Owner research maintenance (drafts → preview → edit → publish → history/rollback) in the simulated host.

let h: TestHost;
beforeAll(async () => {
  h = await startTestHost();
});
afterAll(async () => {
  await h?.mf.dispose();
});

type Issue = { path: string; code: string; message: string };
type Evaluation = { ok: boolean; errors: Issue[]; warnings: Issue[]; duplicates: Array<{ exact: boolean; reason: string }>; diff: Array<{ field: string }>; entity: { type: string; id: string } };
type Draft = { id: string; revision: number; status: string; conflict?: boolean; evaluation?: Evaluation; publishedChangeId?: string | null };

const doc = (ref: string, url: string, extra: Record<string, unknown> = {}) => ({ ref, url, publisher: "Test publisher", title: `Document ${ref}`, documentType: "press_release", isPrimary: true, publishedDate: { date: "2026-05-02", precision: "day" }, retrievedAt: null, ...extra });
const cite = (d: string, extra: Record<string, unknown> = {}) => ({ doc: d, locator: null, excerpt: null, status: "human_reviewed", checkedAt: null, method: "owner_entry", ...extra });

async function create(kind: string, payload: unknown, evidence: unknown = { documents: [] }) {
  return api<{ draft: Draft; error?: { code: string } }>(h, "/api/finance/admin/drafts", { method: "POST", as: "owner", body: { kind, payload, evidence }, idem: idem("draft") });
}
async function publish(d: Pick<Draft, "id" | "revision">, note = "Published in test") {
  return api<{ changeId: string; error?: { code: string; details?: { evaluation?: Evaluation } } }>(h, `/api/finance/admin/drafts/${d.id}/publish`, { method: "POST", as: "owner", body: { revision: d.revision, note }, idem: idem("pub") });
}

const OBS = (value: number | null, extra: Record<string, unknown> = {}) => ({
  metric: "revenue",
  value,
  unit: "currency",
  currency: "INR",
  scale: "crore",
  period: { type: "FY", end: "2026-03-31", months: 12, label: "FY2026" },
  scope: "consolidated",
  basis: "reported",
  cites: [cite("ar")],
  ...extra,
});

describe("access: research maintenance is owner-only", () => {
  it("anonymous 401, signed-in non-owner 403 on every maintenance route", async () => {
    const routes: Array<[string, string]> = [
      ["GET", "/api/finance/admin/drafts"],
      ["POST", "/api/finance/admin/drafts"],
      ["POST", "/api/finance/admin/drafts/preview"],
      ["POST", "/api/finance/admin/import/preview"],
      ["POST", "/api/finance/admin/import"],
      ["GET", "/api/finance/admin/history"],
      ["POST", "/api/finance/admin/changes/pc_x/revert"],
      ["POST", "/api/finance/admin/drafts/dr_x/publish"],
    ];
    for (const [method, path] of routes) {
      const body = method === "POST" ? { kind: "observation", payload: {} } : undefined;
      expect((await api(h, path, { method, body, idem: idem() })).status, `${method} ${path}`).toBe(401);
      expect((await api(h, path, { method, body, as: "visitor", idem: idem() })).status, `${method} ${path}`).toBe(403);
    }
  });
});

describe("dated company observations", () => {
  const evidence = { documents: [doc("ar", "https://www.example-company.in/annual-report-fy2026.pdf", { documentType: "annual_report" })] };
  let firstId = "";
  it("requires evidence and a period that has ended; missing values need a reason", async () => {
    const noDocs = await api<{ evaluation: Evaluation }>(h, "/api/finance/admin/drafts/preview", { method: "POST", as: "owner", body: { kind: "observation", payload: { companyId: "tata-motors", observation: OBS(100, { cites: [cite("missing")] }) }, evidence: { documents: [] } } });
    expect(noDocs.json.evaluation.ok).toBe(false);
    expect(noDocs.json.evaluation.errors.map((e) => e.code)).toEqual(expect.arrayContaining(["EVIDENCE_REQUIRED", "UNKNOWN_DOCUMENT"]));
    const future = await api<{ evaluation: Evaluation }>(h, "/api/finance/admin/drafts/preview", { method: "POST", as: "owner", body: { kind: "observation", payload: { companyId: "tata-motors", observation: OBS(null, { period: { type: "FY", end: "2099-03-31", months: 12, label: "FY2099" } }) }, evidence } });
    expect(future.json.evaluation.errors.map((e) => e.code)).toEqual(expect.arrayContaining(["FUTURE_PERIOD", "NULL_REASON_REQUIRED"]));
  });
  it("creates, previews, edits and publishes an observation; the company page shows it with its source", async () => {
    const r = await create("observation", { companyId: "tata-motors", observation: OBS(1000) }, evidence);
    expect(r.status).toBe(201);
    expect(r.json.draft.evaluation?.ok).toBe(true);
    // Owner edits the proposal before publishing (revision 1 → 2).
    const edited = await api<{ draft: Draft }>(h, `/api/finance/admin/drafts/${r.json.draft.id}`, { method: "PATCH", as: "owner", body: { revision: 1, payload: { companyId: "tata-motors", observation: OBS(1234.5) } } });
    expect(edited.status).toBe(200);
    expect(edited.json.draft.revision).toBe(2);
    // A stale revision is refused, not silently overwritten.
    const stale = await api<{ error: { code: string } }>(h, `/api/finance/admin/drafts/${r.json.draft.id}`, { method: "PATCH", as: "owner", body: { revision: 1, note: "old tab" } });
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe("STALE_DRAFT");
    const p = await publish(edited.json.draft);
    expect(p.status).toBe(200);
    const co = await api<{ observations: Array<{ id: string; value: number; ev: string[]; supersededBy: unknown }>; evidence: Record<string, { status: string; document: { url: string } }>; history: Array<{ changeType: string }> }>(h, "/api/finance/companies/tata-motors");
    const o = co.json.observations.find((x) => x.value === 1234.5);
    expect(o).toBeTruthy();
    firstId = o?.id ?? "";
    expect(co.json.evidence[o?.ev[0] as string]).toMatchObject({ status: "human_reviewed", document: { url: "https://www.example-company.in/annual-report-fy2026.pdf" } });
    expect(co.json.history.map((x) => x.changeType)).toContain("company_observation");
  });
  it("blocks an exact duplicate and requires an explicit supersession for a different value", async () => {
    const dup = await create("observation", { companyId: "tata-motors", observation: OBS(1234.5) }, evidence);
    expect(dup.json.draft.evaluation?.errors.map((e) => e.code)).toContain("DUPLICATE");
    expect((await publish(dup.json.draft)).json.error?.code).toBe("DRAFT_INVALID");
    const clash = await create("observation", { companyId: "tata-motors", observation: OBS(1300) }, evidence);
    expect(clash.json.draft.evaluation?.errors.map((e) => e.code)).toContain("OBSERVATION_EXISTS");
    const fixed = await api<{ draft: Draft }>(h, `/api/finance/admin/drafts/${clash.json.draft.id}`, { method: "PATCH", as: "owner", body: { revision: 1, payload: { companyId: "tata-motors", observation: OBS(1300), supersedesObservationId: firstId } } });
    expect(fixed.json.draft.evaluation?.ok).toBe(true);
    expect((await publish(fixed.json.draft)).status).toBe(200);
    const co = await api<{ observations: Array<{ id: string; value: number; supersededBy: { id: string } | null }> }>(h, "/api/finance/companies/tata-motors");
    expect(co.json.observations.find((x) => x.id === firstId)?.supersededBy).toBeTruthy();
    expect(co.json.observations.find((x) => x.value === 1300)?.supersededBy).toBeNull();
  });
});

describe("claim verification (source check) and rollback", () => {
  it("needs a retrieval time, locator, excerpt and checked value; publishing upgrades the claim; rollback restores it", async () => {
    const deal = await api<{ terms: Array<{ metric: string; amount: number; ev: string[] }> }>(h, "/api/finance/deals/disney-21st-century-fox");
    const claimId = deal.json.terms.find((t) => t.amount === 52.4)?.ev[0] as string;
    const before = await api<{ status: string }>(h, `/api/finance/evidence/${claimId}`);
    expect(before.json.status).toBe("search_corroborated");
    const r = await create("claim_verification", { claimId, status: "source_checked", checkedValue: "", locator: "", excerpt: "", retrievedAt: null });
    expect(r.json.draft.evaluation?.errors.map((e) => e.code)).toEqual(expect.arrayContaining(["RETRIEVAL_REQUIRED", "LOCATOR_REQUIRED", "EXCERPT_REQUIRED", "CHECKED_VALUE_REQUIRED"]));
    const future = await api<{ draft: Draft }>(h, `/api/finance/admin/drafts/${r.json.draft.id}`, { method: "PATCH", as: "owner", body: { revision: 1, payload: { claimId, status: "source_checked", checkedValue: "$52.4 billion", locator: "Paragraph 1", excerpt: "…for $52.4 billion in stock", retrievedAt: "2099-01-01T00:00:00Z" } } });
    expect(future.json.draft.evaluation?.errors.map((e) => e.code)).toContain("FUTURE_RETRIEVAL");
    const good = await api<{ draft: Draft }>(h, `/api/finance/admin/drafts/${r.json.draft.id}`, { method: "PATCH", as: "owner", body: { revision: 2, payload: { claimId, status: "source_checked", checkedValue: "$52.4 billion", locator: "Paragraph 1", excerpt: "to acquire Twenty-First Century Fox … for $52.4 billion in stock", retrievedAt: "2026-09-20T10:00:00Z" } } });
    expect(good.json.draft.evaluation?.ok).toBe(true);
    const p = await publish(good.json.draft);
    expect(p.status).toBe(200);
    const after = await api<{ status: string; method: string; locator: string; excerpt: string; document: { retrievedAt: string; retrievalStatus: string } }>(h, `/api/finance/evidence/${claimId}`);
    expect(after.json).toMatchObject({ status: "source_checked", method: "document_retrieval", locator: "Paragraph 1", document: { retrievedAt: "2026-09-20T10:00:00Z", retrievalStatus: "retrieved" } });
    // Rollback: the claim returns to its earlier status; history keeps both entries.
    const rb = await api<{ id: string }>(h, `/api/finance/admin/changes/${p.json.changeId}/revert`, { method: "POST", as: "owner", body: { note: "Test rollback of the source check" }, idem: idem("rb") });
    expect(rb.status).toBe(200);
    expect((await api<{ status: string }>(h, `/api/finance/evidence/${claimId}`)).json.status).toBe("search_corroborated");
    const hist = await api<{ items: Array<{ changeId: string; changeType: string; revertedBy: string | null }> }>(h, `/api/finance/admin/history?entity=claim:${claimId}`, { as: "owner" });
    expect(hist.json.items.find((x) => x.changeId === p.json.changeId)?.revertedBy).toBe(rb.json.id);
    expect(hist.json.items.some((x) => x.changeType === "revert")).toBe(true);
    const again = await api<{ error: { code: string } }>(h, `/api/finance/admin/changes/${rb.json.id}/revert`, { method: "POST", as: "owner", body: { note: "Revert the revert" }, idem: idem("rb") });
    expect(again.json.error.code).toBe("CANNOT_REVERT_REVERT");
  });
});

describe("revised terms and transaction multiples", () => {
  it("requires a denominator basis for a multiple; published multiples reach deal summaries", async () => {
    const evidence = { documents: [doc("pr", "https://corporate.exxonmobil.com/test/pioneer-multiple", { publishedDate: { date: "2023-10-11", precision: "day" } })] };
    const noBasis = await api<{ evaluation: Evaluation }>(h, "/api/finance/admin/drafts/preview", { method: "POST", as: "owner", body: { kind: "term_revision", payload: { dealId: "exxonmobil-pioneer", term: { metric: "ev_ebitda", ratio: 7.5, amount: null, kind: "announced", asOf: "2023-10-11", status: "calculated", cites: [cite("pr")] } }, evidence } });
    expect(noBasis.json.evaluation.errors.map((e) => e.code)).toContain("MULTIPLE_BASIS_REQUIRED");
    const r = await create("term_revision", { dealId: "exxonmobil-pioneer", term: { metric: "ev_ebitda", ratio: 7.5, amount: null, kind: "announced", asOf: "2023-10-11", status: "calculated", multipleBasis: { periodType: "LTM", periodEnd: "2023-06-30", periodLabel: "LTM Jun 2023", accountingBasis: "US GAAP", perimeter: "Pioneer, consolidated", adjusted: false }, cites: [cite("pr")] } }, evidence);
    expect(r.json.draft.evaluation?.ok).toBe(true);
    expect((await publish(r.json.draft)).status).toBe(200);
    const list = await api<{ items: Array<{ id: string; multiples: { evEbitda: number | null }; multipleDetails: { evEbitda: { basis: { periodType: string } } | null } }> }>(h, "/api/finance/deals?pageSize=100");
    const x = list.json.items.find((d) => d.id === "exxonmobil-pioneer");
    expect(x?.multiples.evEbitda).toBe(7.5);
    expect(x?.multipleDetails.evEbitda?.basis.periodType).toBe("LTM");
  });
});

describe("historical events imported later never regress the current status", () => {
  it("adds an older status event to the timeline with a warning, keeping the current status", async () => {
    const evidence = { documents: [doc("f", "https://www.sec.gov/test/pioneer-hsr-2023", { documentType: "regulatory_filing", publishedDate: { date: "2023-12-01", precision: "day" } })] };
    const r = await create("deal_event", { dealId: "exxonmobil-pioneer", event: { type: "regulatory_filing", date: { date: "2023-12-01", precision: "day" }, publishedDate: "2023-12-01", title: "Test historical filing moving status to pending approvals", statusAfter: "pending_approvals", cites: [cite("f")] } }, evidence);
    expect(r.json.draft.evaluation?.warnings.map((w) => w.code)).toContain("HISTORICAL_STATUS");
    expect((await publish(r.json.draft)).status).toBe(200);
    const d = await api<{ status: string; statusAsOf: string; events: Array<{ title: string }>; history: Array<{ changeType: string; statusNotApplied?: boolean }> }>(h, "/api/finance/deals/exxonmobil-pioneer");
    expect(d.json.status).toBe("completed");
    expect(d.json.statusAsOf).toBe("2024-05-03");
    expect(d.json.events.map((e) => e.title)).toContain("Test historical filing moving status to pending approvals");
    expect(d.json.history.find((x) => x.changeType === "event_append")?.statusNotApplied).toBe(true);
  });
});

describe("revision conflicts, duplicate drafts and rollback order", () => {
  const evidence = { documents: [doc("n", "https://www.example.org/zee-sony-note")] };
  it("a draft prepared before another change to the same field must be rebased before publishing", async () => {
    const a = await create("deal_edit", { dealId: "zee-sony-merger", fields: { perimeter: "Test perimeter A for the proposed merger of Zee and Sony Pictures Networks India." }, cites: [cite("n")] }, evidence);
    const b = await create("deal_edit", { dealId: "zee-sony-merger", fields: { perimeter: "Test perimeter B for the proposed merger of Zee and Sony Pictures Networks India." }, cites: [cite("n")] }, evidence);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const pa = await publish(a.json.draft);
    expect(pa.status).toBe(200);
    const pb = await publish(b.json.draft);
    expect(pb.status).toBe(409);
    expect(pb.json.error?.code).toBe("REVISION_CONFLICT");
    const loaded = await api<{ draft: Draft }>(h, `/api/finance/admin/drafts/${b.json.draft.id}`, { as: "owner" });
    expect(loaded.json.draft.conflict).toBe(true);
    const rebased = await api<{ draft: Draft }>(h, `/api/finance/admin/drafts/${b.json.draft.id}`, { method: "PATCH", as: "owner", body: { revision: loaded.json.draft.revision, rebase: true } });
    expect(rebased.json.draft.conflict).toBe(false);
    const pb2 = await publish(rebased.json.draft);
    expect(pb2.status).toBe(200);
    // Rollback must go newest first.
    const older = await api<{ error: { code: string } }>(h, `/api/finance/admin/changes/${pa.json.changeId}/revert`, { method: "POST", as: "owner", body: { note: "Out of order" }, idem: idem() });
    expect(older.json.error.code).toBe("LATER_CHANGES");
    expect((await api(h, `/api/finance/admin/changes/${pb2.json.changeId}/revert`, { method: "POST", as: "owner", body: { note: "Undo B" }, idem: idem() })).status).toBe(200);
    expect((await api<{ perimeter: string }>(h, "/api/finance/deals/zee-sony-merger")).json.perimeter).toMatch(/^Test perimeter A/);
    expect((await api(h, `/api/finance/admin/changes/${pa.json.changeId}/revert`, { method: "POST", as: "owner", body: { note: "Undo A" }, idem: idem() })).status).toBe(200);
    expect((await api<{ perimeter: string }>(h, "/api/finance/deals/zee-sony-merger")).json.perimeter).not.toMatch(/^Test perimeter/);
  });
  it("refuses a second open draft for the same proposal and edits to uncited fields without evidence", async () => {
    const payload = { dealId: "zee-sony-merger", fields: { tags: ["test-tag"] }, cites: [cite("n")] };
    expect((await create("deal_edit", payload, evidence)).status).toBe(201);
    const again = await create("deal_edit", payload, evidence);
    expect(again.status).toBe(409);
    expect(again.json.error?.code).toBe("DUPLICATE_DRAFT");
    const noCites = await api<{ evaluation: Evaluation }>(h, "/api/finance/admin/drafts/preview", { method: "POST", as: "owner", body: { kind: "deal_edit", payload: { dealId: "zee-sony-merger", fields: { title: "Zee and Sony renamed" }, cites: [] }, evidence: { documents: [] } } });
    expect(noCites.json.evaluation.errors.map((e) => e.code)).toContain("EVIDENCE_REQUIRED");
  });
  it("adds a sourced counterparty and adviser through a deal edit", async () => {
    const ev = { documents: [doc("pr", "https://www.example.org/ubs-cs-advisers", { publishedDate: { date: "2023-03-19", precision: "day" } })] };
    const r = await create("deal_edit", { dealId: "ubs-credit-suisse", fields: { advisers: { disclosure: "partial", list: [{ side: "buyer", role: "legal", name: "Test Law LLP", cites: [cite("pr", { locator: "Advisers section" })] }], note: null } } }, ev);
    expect(r.json.draft.evaluation?.ok).toBe(true);
    expect((await publish(r.json.draft)).status).toBe(200);
    const d = await api<{ advisers: { list: Array<{ name: string; ev: string[] }> }; evidence: Record<string, { document: { url: string } }> }>(h, "/api/finance/deals/ubs-credit-suisse");
    const adv = d.json.advisers.list.find((a) => a.name === "Test Law LLP");
    expect(adv).toBeTruthy();
    expect(d.json.evidence[adv?.ev[0] as string]?.document.url).toBe("https://www.example.org/ubs-cs-advisers");
  });
});

describe("new companies and deals", () => {
  const evidence = { documents: [doc("id", "https://www.example-newco.in/about", { documentType: "company_page" })] };
  const company = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
    id,
    legalName: `${name} Limited`,
    displayName: name,
    aliases: [],
    tickers: [],
    country: "IN",
    sector: "fig",
    subsector: "Banks (private sector)",
    lifecycle: { status: "active" },
    identityCites: [cite("id")],
    businessModel: { summary: "A test bank used only in the automated test suite for research maintenance.", customers: "Test customers", products: "Test products", revenueModel: "Net interest income", costDrivers: "Deposits and staff", positioning: "Test positioning", risks: ["Credit", "Liquidity"] },
    observations: [],
    peers: [],
    ownership: [],
    recordUpdated: "2026-09-20",
    ...extra,
  });
  it("blocks a company that duplicates an existing name, publishes a new one, and rolls a creation back", async () => {
    const dup = await create("company_create", { company: company("hdfc-bank-copy", "HDFC Bank") }, evidence);
    expect(dup.json.draft.evaluation?.duplicates.some((d) => d.exact)).toBe(true);
    expect((await publish(dup.json.draft)).json.error?.code).toBe("DRAFT_INVALID");
    const ok = await create("company_create", { company: company("test-newco-bank", "Test Newco Bank") }, evidence);
    expect(ok.json.draft.evaluation?.ok).toBe(true);
    const p = await publish(ok.json.draft);
    expect(p.status).toBe(200);
    expect((await api(h, "/api/finance/companies/test-newco-bank")).status).toBe(200);
    expect((await api(h, `/api/finance/admin/changes/${p.json.changeId}/revert`, { method: "POST", as: "owner", body: { note: "Remove test company" }, idem: idem() })).status).toBe(200);
    expect((await api(h, "/api/finance/companies/test-newco-bank")).status).toBe(404);
  });
  it("blocks a deal with the same parties announced within 180 days", async () => {
    const ev = { documents: [doc("pr", "https://www.example.org/hdfc-merger-copy", { publishedDate: { date: "2022-04-04", precision: "day" } })] };
    const deal = {
      id: "hdfc-merger-copy",
      title: "HDFC merges into HDFC Bank (duplicate test)",
      dealType: "merger",
      buyerType: "strategic",
      sector: "fig",
      subsector: "Banks and housing finance",
      peerGroup: "banks",
      acquirer: { companyId: "hdfc-bank", name: "HDFC Bank Limited", country: "IN", cites: [cite("pr")] },
      target: { companyId: "hdfc-ltd", name: "Housing Development Finance Corporation Limited", country: "IN", cites: [cite("pr")] },
      perimeter: "Duplicate test perimeter for the HDFC merger.",
      stake: { acquiredPct: 100, resultingPct: 100, cites: [cite("pr")] },
      announced: { date: "2022-04-04", precision: "day", cites: [cite("pr")] },
      status: { value: "announced", asOf: "2022-04-04", cites: [cite("pr")] },
      payment: { mix: ["stock"], text: "All stock.", cites: [cite("pr")] },
      events: [{ type: "announcement", date: { date: "2022-04-04", precision: "day" }, title: "Announcement (duplicate test)", cites: [cite("pr")] }],
      advisers: { disclosure: "not_researched", list: [] },
      researchCutoff: "2026-09-20",
      recordUpdated: "2026-09-20",
    };
    const r = await create("deal_create", { deal }, ev);
    const reasons = r.json.draft.evaluation?.duplicates.filter((d) => d.exact).map((d) => d.reason) ?? [];
    expect(reasons.join(" ")).toMatch(/same acquirer and target/);
  });
});

describe("import: preview, in-file duplicates and idempotent draft creation", () => {
  const evidence = { documents: [doc("ar", "https://www.example-import.in/ar-fy2026.pdf", { documentType: "annual_report" })] };
  const item = (value: number, end = "2026-03-31") => ({ kind: "observation", payload: { companyId: "larsen-toubro", observation: OBS(value, { period: { type: "FY", end, months: 12, label: `FY${end.slice(0, 4)}` } }) }, evidence });
  const file = { format: "finance-research-import-v1", items: [item(100), item(100), item(90, "2025-03-31"), { kind: "observation", payload: { companyId: "no-such-co", observation: OBS(1) }, evidence }] };
  it("previews each item without writing", async () => {
    const r = await api<{ items: Array<{ index: number; action: string }>; summary: { total: number } }>(h, "/api/finance/admin/import/preview", { method: "POST", as: "owner", body: file });
    expect(r.status).toBe(200);
    expect(r.json.items.map((x) => x.action)).toEqual(["create_draft", "skip_duplicate_in_file", "create_draft", "create_draft_with_errors"]);
    expect((await api<{ items: unknown[] }>(h, "/api/finance/admin/drafts?status=draft", { as: "owner" })).json.items.some((d) => JSON.stringify(d).includes("larsen-toubro"))).toBe(false);
  });
  it("creates drafts once; re-importing the same file skips open drafts", async () => {
    const first = await api<{ created: unknown[] }>(h, "/api/finance/admin/import", { method: "POST", as: "owner", body: file, idem: idem("imp") });
    expect(first.status).toBe(201);
    expect(first.json.created).toHaveLength(3);
    const second = await api<{ created: unknown[]; skipped: Array<{ action: string }> }>(h, "/api/finance/admin/import", { method: "POST", as: "owner", body: file, idem: idem("imp") });
    expect(second.json.created).toHaveLength(0);
    expect(second.json.skipped.map((x) => x.action)).toContain("skip_open_draft");
  });
  it("rejects an unknown format", async () => {
    expect((await api(h, "/api/finance/admin/import/preview", { method: "POST", as: "owner", body: { ...file, format: "v0" } })).status).toBe(400);
  });
});

describe("cross-user isolation", () => {
  it("drafts belonging to another account are invisible and cannot be edited or published", async () => {
    await h.db
      .prepare("INSERT INTO finance_research_drafts (id, owner_id, kind, entity_type, entity_id, payload_json, evidence_json, base_seq, revision, status, origin, dedupe_key, created_at, updated_at) VALUES ('dr_other', 'another-account', 'deal_edit', 'deal', 'zee-sony-merger', '{}', '{}', 0, 1, 'draft', 'manual', 'k-other', '2026-09-20T00:00:00Z', '2026-09-20T00:00:00Z')")
      .run();
    expect((await api(h, "/api/finance/admin/drafts/dr_other", { as: "owner" })).status).toBe(404);
    expect((await api(h, "/api/finance/admin/drafts/dr_other", { method: "PATCH", as: "owner", body: { revision: 1, note: "x" } })).status).toBe(404);
    expect((await publish({ id: "dr_other", revision: 1 })).status).toBe(404);
    const list = await api<{ items: Array<{ id: string }> }>(h, "/api/finance/admin/drafts?status=all", { as: "owner" });
    expect(list.json.items.map((d) => d.id)).not.toContain("dr_other");
    expect(list.headers.get("cache-control")).toBe("private, no-store");
  });
});
