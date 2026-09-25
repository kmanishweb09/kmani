import { describe, expect, it } from "vitest";
import { announcedCutoff, dealAsOf, knownBy, mentionsLaterYear, periodEnd } from "../../shared/archive/historical";
import { getResearch } from "../../server/research";
import { dealDetail } from "../../server/routes/public";

async function detail(id: string) {
  const view = await getResearch(undefined);
  const d = dealDetail(view, id);
  if (!d) throw new Error(`missing deal ${id}`);
  return d;
}

describe("date knowability", () => {
  it("counts a period only once it has ended", () => {
    expect(periodEnd({ date: "2017-12-01", precision: "month" })).toBe("2017-12-31");
    expect(periodEnd({ date: "2024-02-01", precision: "month" })).toBe("2024-02-29");
    expect(periodEnd({ date: "2024-04-01", precision: "quarter" })).toBe("2024-06-30");
    expect(periodEnd({ date: "2024-01-01", precision: "year" })).toBe("2024-12-31");
    expect(knownBy({ date: "2024-01-01", precision: "quarter" }, "2024-03-30")).toBe(false);
    expect(knownBy({ date: "2024-03-31", precision: "day" }, "2024-03-31")).toBe(true);
    expect(knownBy(null, "2024-03-31")).toBe(false);
    expect(mentionsLaterYear("Completed in 2019 after approvals", "2017-12-14")).toBe(true);
    expect(mentionsLaterYear("Announced 14 Dec 2017", "2017-12-14")).toBe(false);
  });
});

describe("as-announced view of the real Disney–21st Century Fox record (audit regression)", () => {
  it("shows the original $52.4bn all-stock agreement and nothing learned later", async () => {
    const d = await detail("disney-21st-century-fox");
    // The current view carries the revised terms — the leak the audit found.
    expect(d.headline?.amount).toBe(71.3);
    expect(d.paymentMix).toContain("cash");

    const cutoff = announcedCutoff(d);
    expect(cutoff).toBe("2017-12-14");
    const h = dealAsOf(d, cutoff);
    const s = h.deal;
    expect(s.headline).toMatchObject({ amount: 52.4, currency: "USD", unit: "billion", valueBasis: "equity" });
    expect(s.terms.map((t) => t.amount)).not.toContain(71.3);
    expect(s.terms.every((t) => t.kind !== "revised" && t.asOf <= cutoff)).toBe(true);
    expect(s.paymentMix).toEqual(["stock"]);
    expect(s.payment.text).not.toMatch(/amended|cash/i);
    expect(s.title).not.toMatch(/bidding contest|Comcast/i);
    expect(h.titleReplaced).toBe(true);
    expect(s.otherParties.map((p) => p.name)).not.toContain("Comcast Corporation");
    expect(s.events.map((e) => e.date.date)).toEqual(["2017-12-14"]);
    expect(s.status).toBe("announced");
    expect(s.effective).toBeNull();
    expect(s.sectorContext).toBeNull();
    expect(s.afterDeal).toEqual([]);
    expect(s.comparables).toEqual([]); // Reliance–Disney Star India was announced in 2024.
    // Evidence offered in this view is contemporaneous only.
    for (const c of Object.values(s.evidence)) expect(knownBy(c.document.publishedDate, cutoff)).toBe(true);
    expect(JSON.stringify(s)).not.toMatch(/71\.3|dis-pr-2018-06-20|Comcast/);
    // Withheld items are listed (without revealing their content).
    expect(h.hiddenFields).toEqual(expect.arrayContaining(["terms.later", "events.later", "effective", "otherParties", "rationale", "sectorContext", "afterDeal", "comparables"]));
    expect(JSON.stringify(h.hidden)).not.toMatch(/Comcast|71\.3/);
  });
});

describe("as-announced invariants across every deal in the archive", () => {
  it("never shows later terms, events, outcomes or later-dated evidence", async () => {
    const view = await getResearch(undefined);
    for (const summary of view.summaries) {
      const d = dealDetail(view, summary.id);
      if (!d) throw new Error(summary.id);
      const cutoff = announcedCutoff(d);
      const { deal: s } = dealAsOf(d, cutoff);
      const where = `${d.id} @ ${cutoff}`;
      for (const t of s.terms) {
        expect(t.asOf <= cutoff, where).toBe(true);
        expect(t.kind, where).not.toBe("final");
        expect(t.ev.length, where).toBeGreaterThan(0);
      }
      if (s.headline) expect(s.terms.some((t) => t.id === s.headline?.termId), where).toBe(true);
      for (const e of s.events) expect(knownBy(e.date, cutoff), where).toBe(true);
      if (s.effective) expect(knownBy(s.effective, cutoff), where).toBe(true);
      expect(s.afterDeal, where).toEqual([]);
      expect(s.sectorContext, where).toBeNull();
      for (const c of Object.values(s.evidence)) expect(knownBy(c.document.publishedDate, cutoff), `${where} ${c.id}`).toBe(true);
      for (const text of [s.payment.text, s.stakeNote, s.financing?.text, s.perimeter, ...s.rationale.map((r) => r.text)]) {
        expect(mentionsLaterYear(text, cutoff), `${where}: ${text}`).toBe(false);
      }
      const shownIds = new Set(Object.keys(s.evidence));
      for (const id of [...s.statusEv, ...s.payment.ev, ...s.stakeEv, ...(s.headline?.ev ?? [])]) expect(shownIds.has(id), `${where} ${id}`).toBe(true);
    }
  });
});
