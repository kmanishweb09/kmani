import { describe, expect, it } from "vitest";
import { compileArchive, findUnresolvedReferences } from "../../shared/archive/compile";
import { buildArchive } from "../../scripts/lib/archive-entry";

// Unresolved cross-references are dropped at compile time (never rendered as broken links) and must be
// reported, so the build and verify:content can warn about them.

describe("unresolved cross-references", () => {
  const { source, unresolved } = buildArchive();

  it("the shipped archive has none", () => {
    expect(unresolved).toEqual([]);
  });

  it("reports and drops a comparable, a peer, a party link and a peer-set member that do not exist", () => {
    const src = structuredClone(source);
    const deal = src.deals.find((d) => d.id === "kimberly-clark-kenvue") as (typeof src.deals)[number];
    deal.comparables.push({ dealId: "no-such-deal", reason: "test" });
    deal.acquirer.companyId = "no-such-acquirer";
    const co = src.companies.find((c) => c.id === "hdfc-bank") as (typeof src.companies)[number];
    co.peers.push({ companyId: "no-such-company", reason: "test" });
    (src.peerSets[0] as (typeof src.peerSets)[number]).companyIds.push("no-such-bank");
    const refs = findUnresolvedReferences(src).map((u) => `${u.from} ${u.field} → ${u.ref}`);
    expect(refs).toEqual(
      expect.arrayContaining(["deal:kimberly-clark-kenvue comparables → no-such-deal", "deal:kimberly-clark-kenvue acquirer → no-such-acquirer", "company:hdfc-bank peers → no-such-company", "peerSet:india-banks companyIds → no-such-bank"]),
    );
    const compiled = compileArchive(src);
    const d = compiled.deals.find((x) => x.id === "kimberly-clark-kenvue");
    expect(d?.comparables.some((c) => c.dealId === "no-such-deal")).toBe(false);
    expect(d?.acquirer.companyId).toBeNull();
    expect(d?.acquirer.name).toBe(deal.acquirer.name);
    expect(compiled.companies.find((c) => c.id === "hdfc-bank")?.peers.some((p) => p.companyId === "no-such-company")).toBe(false);
    expect(compiled.peerSets.find((p) => p.id === "india-banks")?.companyIds).not.toContain("no-such-bank");
  });
});
