import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, startTestHost, type TestHost } from "./helpers";

// Research depth added in the September 2026 follow-up, checked through the public API of the simulated host.
let h: TestHost;
beforeAll(async () => {
  h = await startTestHost();
});
afterAll(async () => {
  await h?.mf.dispose();
});

describe("peer sets", () => {
  it("lists both peer sets and serves a matrix with evidence for every value", async () => {
    const list = await api<{ items: Array<{ id: string; companyIds: string[] }> }>(h, "/api/finance/peer-sets");
    expect(list.json.items.map((x) => x.id)).toEqual(["india-banks", "india-it-services"]);
    const banks = await api<{ companies: unknown[]; cells: Array<{ ev: string[] }>; evidence: Record<string, unknown>; coverage: { filled: number; expected: number } }>(h, "/api/finance/peer-sets/india-banks");
    expect(banks.status).toBe(200);
    expect(banks.headers.get("cache-control")).toMatch(/^public/);
    expect(banks.json.companies).toHaveLength(7);
    for (const c of banks.json.cells) for (const id of c.ev) expect(banks.json.evidence[id], id).toBeTruthy();
    expect(banks.json.coverage.filled).toBeGreaterThan(banks.json.coverage.expected * 0.8);
    expect((await api(h, "/api/finance/peer-sets/no-such-set")).status).toBe(404);
  });
  it("company pages report their peer-set membership", async () => {
    const tcs = await api<{ peerSets: Array<{ id: string }>; observations: unknown[] }>(h, "/api/finance/companies/tcs");
    expect(tcs.status).toBe(200);
    expect(tcs.json.peerSets.map((p) => p.id)).toEqual(["india-it-services"]);
    expect(tcs.json.observations.length).toBeGreaterThanOrEqual(8);
  });
});

describe("counterparties, advisers and transaction multiples", () => {
  it("links former plain-name counterparties to dossiers", async () => {
    const d = await api<{ acquirer: { companyId: string | null }; target: { companyId: string | null } }>(h, "/api/finance/deals/chevron-hess");
    expect(d.json.acquirer.companyId).toBe("chevron");
    expect(d.json.target.companyId).toBe("hess");
    const hess = await api<{ lifecycle: string; lifecycleDetail: { successorId: string | null } }>(h, "/api/finance/companies/hess");
    expect(hess.json.lifecycle).toBe("acquired");
    expect(hess.json.lifecycleDetail.successorId).toBe("chevron");
  });
  it("lists sourced adviser roles", async () => {
    const d = await api<{ advisers: { disclosure: string; list: Array<{ side: string; role: string; name: string; ev: string[] }> } }>(h, "/api/finance/deals/exxonmobil-pioneer");
    expect(d.json.advisers.disclosure).toBe("disclosed");
    expect(d.json.advisers.list.find((a) => a.name.startsWith("Davis Polk"))).toMatchObject({ side: "buyer", role: "legal" });
    expect(d.json.advisers.list.every((a) => a.ev.length > 0)).toBe(true);
  });
  it("exposes disclosed and third-party multiples with their denominator basis", async () => {
    const list = await api<{ items: Array<{ id: string; multipleDetails: { evEbitda: { value: number; status: string; basis: { periodType: string; accountingBasis: string; adjusted: boolean } } | null } }> }>(h, "/api/finance/deals?pageSize=100");
    const kv = list.json.items.find((x) => x.id === "kimberly-clark-kenvue")?.multipleDetails.evEbitda;
    expect(kv).toMatchObject({ value: 14.3, status: "reported", basis: { periodType: "LTM", accountingBasis: "US GAAP", adjusted: true } });
    const jb = list.json.items.find((x) => x.id === "torrent-jb-chemicals")?.multipleDetails.evEbitda;
    expect(jb).toMatchObject({ value: 24.8, status: "derived", basis: { periodType: "FY", accountingBasis: "Ind AS" } });
    // Different peer groups: the two are never pooled into one median.
    const cmp = await api<{ comparison: { metrics: Array<{ metric: string; stats: { median: number | null }; observations: Array<{ dealId: string; eligible: boolean }> }> } }>(h, "/api/finance/deals/compare?ids=kimberly-clark-kenvue,torrent-jb-chemicals");
    const ev = cmp.json.comparison.metrics.find((m) => m.metric === "evEbitda");
    expect(ev?.stats.median).toBeNull();
    expect(ev?.observations.find((o) => o.dealId === "torrent-jb-chemicals")?.eligible).toBe(false);
  });
});
