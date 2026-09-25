import { describe, expect, it } from "vitest";
import type { CompiledCompany } from "../../shared/archive/compile";
import { buildPeerMatrix, PEER_MIN_SAMPLE } from "../../shared/peers";
import type { PeerSet } from "../../shared/schemas/research";
import { getResearch } from "../../server/research";

type Obs = CompiledCompany["observations"][number];
const FY = (end: string) => ({ type: "FY" as const, end, months: 12, label: `FY to ${end}` });
const obs = (id: string, metric: string, value: number, extra: Partial<Obs> = {}): Obs =>
  ({ id, metric, value, unit: "currency", currency: "INR", scale: "crore", period: FY("2025-03-31"), scope: "consolidated", basis: "reported", ev: [`ev-${id}`], ...extra }) as Obs;
const co = (id: string, observations: Obs[]) => [id, { id, displayName: id.toUpperCase(), subsector: "IT services", country: "IN", observations } as unknown as CompiledCompany] as const;

const SET: PeerSet = {
  id: "test-set",
  name: "Test set",
  description: "A synthetic peer set used to test the peer matrix rules.",
  sector: "tmt",
  companyIds: ["a", "b", "c", "d"],
  metrics: ["revenue", "net_income", "ebit_margin"],
  periods: [
    { end: "2024-03-31", label: "FY24" },
    { end: "2025-03-31", label: "FY25" },
  ],
  preferredScope: "consolidated",
};

describe("peer matrix rules (synthetic)", () => {
  const companies = new Map([
    co("a", [obs("a1", "revenue", 1000), obs("a0", "revenue", 900, { period: FY("2024-03-31") }), obs("a2", "net_income", 100), obs("aq", "net_income", 30, { period: { type: "Q", end: "2025-03-31", months: 3, label: "Q4" } })]),
    co("b", [obs("b1", "revenue", 15, { scale: "billion" }), obs("b0", "revenue", 1400, { period: FY("2024-03-31"), scope: "standalone" })]),
    co("c", [obs("c1", "revenue", 2000), obs("cs", "revenue", 5000, { scope: "segment" })]),
    co("d", [obs("d1", "revenue", 300, { currency: "USD", scale: "million" })]),
  ]);
  const m = buildPeerMatrix(SET, companies);
  const cell = (id: string, metric: string, end = "2025-03-31") => m.cells.find((c) => c.companyId === id && c.metric === metric && c.periodEnd === end);

  it("converts within a currency exactly (₹15 billion = ₹1,500 crore) and never across currencies", () => {
    expect(cell("b", "revenue")?.normalized).toEqual({ value: 1500, unitLabel: "INR crore" });
    expect(cell("b", "revenue")?.display).toMatch(/15/);
    expect(cell("d", "revenue")?.normalized?.unitLabel).toBe("USD million");
  });
  it("uses 12-month periods for flows and ignores quarterly and segment observations", () => {
    expect(cell("a", "net_income")?.value).toBe(100);
    expect(cell("c", "revenue")?.value).toBe(2000);
  });
  it("calculates growth only when both years share unit and scope", () => {
    const ga = m.derived.find((d) => d.companyId === "a" && d.metric === "revenue_growth");
    expect(ga?.value).toBeCloseTo(1000 / 900 - 1, 10);
    const gb = m.derived.find((d) => d.companyId === "b" && d.metric === "revenue_growth");
    expect(gb?.value).toBeNull();
    expect(gb?.reason).toMatch(/scope/);
    expect(m.derived.find((d) => d.companyId === "a" && d.metric === "net_margin")?.value).toBeCloseTo(0.1, 10);
  });
  it(`pools only like-for-like values and needs ${PEER_MIN_SAMPLE} for a median`, () => {
    const s = m.stats.find((x) => x.metric === "revenue" && x.periodEnd === "2025-03-31");
    expect(s?.n).toBe(3);
    expect(s?.median).toBe(1500);
    expect(s?.excluded).toEqual([{ companyId: "d", reason: "Different unit (USD million)" }]);
    const ni = m.stats.find((x) => x.metric === "net_income" && x.periodEnd === "2025-03-31");
    expect(ni?.median).toBeNull();
    expect(ni?.note).toMatch(/Only 1/);
    expect(m.coverage).toMatchObject({ filled: m.cells.length, expected: 4 * 3 * 2 });
  });
});

describe("real peer sets in the archive", () => {
  it("the Indian bank set covers 7 banks with FY24–FY26 ratios and profit where sourced", async () => {
    const view = await getResearch(undefined);
    const { archive } = await import("../../server/research");
    const banks = archive.peerSets.find((p) => p.id === "india-banks") as PeerSet;
    const m = buildPeerMatrix(banks, view.companyById);
    expect(m.companies).toHaveLength(7);
    for (const end of ["2024-03-31", "2025-03-31", "2026-03-31"]) {
      const gnpa = m.stats.find((s) => s.metric === "gnpa_ratio" && s.periodEnd === end);
      expect(gnpa?.n, end).toBe(7);
      expect(gnpa?.median, end).not.toBeNull();
    }
    // Every cell carries evidence.
    expect(m.cells.every((c) => c.ev.length > 0)).toBe(true);
    // SBI's quarterly profit is not used as an annual figure.
    expect(m.cells.find((c) => c.companyId === "state-bank-of-india" && c.metric === "net_income" && c.periodEnd === "2026-03-31")?.value).toBe(800.32);
  });
  it("the Indian IT services set normalises Wipro's ₹ billion to crore and keeps Tech Mahindra's US$ revenue apart", async () => {
    const view = await getResearch(undefined);
    const { archive } = await import("../../server/research");
    const it = archive.peerSets.find((p) => p.id === "india-it-services") as PeerSet;
    const m = buildPeerMatrix(it, view.companyById);
    expect(m.cells.find((c) => c.companyId === "wipro" && c.metric === "revenue" && c.periodEnd === "2025-03-31")?.normalized).toEqual({ value: 89090, unitLabel: "INR crore" });
    const rev26 = m.stats.find((s) => s.metric === "revenue" && s.periodEnd === "2026-03-31");
    expect(rev26?.unitLabel).toBe("INR crore");
    expect(rev26?.excluded.map((e) => e.companyId)).toContain("tech-mahindra");
    expect(m.coverage.missing).toEqual([]);
  });
});
