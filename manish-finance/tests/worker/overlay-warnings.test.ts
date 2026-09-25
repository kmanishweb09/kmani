import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, startTestHost, type TestHost } from "./helpers";

// Published changes recorded against an earlier archive version (rows inserted directly, as if the
// archive had since been rebuilt) must never be applied to a different record: each is skipped or
// partly applied, and the owner sees a warning.

let h: TestHost;
beforeAll(async () => {
  h = await startTestHost();
});
afterAll(async () => {
  await h?.mf.dispose();
});

type Warning = { changeId: string; code: string; applied: "no" | "partly"; entity: string; message: string };
type Term = { id: string; metric: string; label: string; asOf: string; correction?: unknown; ev: string[] };
type Claim = { label: string; display: string; status: string; document: { id: string } };
type Deal = { title: string; terms: Term[]; evidence: Record<string, Claim>; history: Array<{ changeId: string; warning?: { applied: string; code: string } }> };

let n = 0;
async function insertChange(entityType: string, entityId: string, changeType: string, payload: unknown, evidence: unknown = {}) {
  const id = `pc_test_${changeType}_${n++}`;
  await h.db
    .prepare("INSERT INTO finance_published_changes (id, entity_type, entity_id, change_type, payload_json, evidence_json, note, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, entityType, entityId, changeType, JSON.stringify(payload), JSON.stringify(evidence), "Recorded against an earlier archive version (test)", "2026-09-20T10:00:00.000Z")
    .run();
  return id;
}
const history = async () => (await api<{ items: Array<{ changeId: string; warning?: { code: string } }>; warnings: Warning[] }>(h, "/api/finance/admin/history", { as: "owner" })).json;
const deal = async (id: string) => (await api<Deal>(h, `/api/finance/deals/${id}`)).json;

describe("published changes that no longer match the archive", () => {
  it("a verification for a claim that no longer exists is not applied and is reported", async () => {
    const id = await insertChange("claim", "ev-no-such-claim", "claim_status", { claimId: "ev-no-such-claim", status: "source_checked", checkedAt: "2026-09-20", method: "document_retrieval", note: "test" });
    const w = (await history()).warnings.find((x) => x.changeId === id);
    expect(w).toMatchObject({ code: "CLAIM_NOT_FOUND", applied: "no" });
  });

  it("a verification recorded against different claim content is withheld; a matching one applies", async () => {
    const before = await deal("kimberly-clark-kenvue");
    const ev = before.terms.find((t) => t.metric === "enterprise_value")?.ev[0] as string;
    const claim = before.evidence[ev] as Claim;
    expect(claim.status).toBe("search_corroborated");
    // Simulates a check made when this ID pointed at another term (e.g. before terms were reordered).
    const stale = await insertChange("claim", ev, "claim_status", {
      claimId: ev,
      status: "source_checked",
      checkedAt: "2026-09-20",
      method: "document_retrieval",
      note: "test",
      claimFingerprint: { label: "Consideration per Kenvue share", display: "US$3.5 cash plus 0.14625 Kimberly-Clark shares", documentId: claim.document.id },
    });
    const w = (await history()).warnings.find((x) => x.changeId === stale);
    expect(w).toMatchObject({ code: "CLAIM_CHANGED", applied: "no" });
    expect((await deal("kimberly-clark-kenvue")).evidence[ev]?.status).toBe("search_corroborated");

    const good = await insertChange("claim", ev, "claim_status", { claimId: ev, status: "source_checked", checkedAt: "2026-09-21", method: "document_retrieval", note: "test", claimFingerprint: { label: claim.label, display: claim.display, documentId: claim.document.id } });
    expect((await history()).warnings.some((x) => x.changeId === good)).toBe(false);
    expect((await deal("kimberly-clark-kenvue")).evidence[ev]?.status).toBe("source_checked");
  });

  it("a revision whose superseded term changed is added without marking another term as revised", async () => {
    const before = await deal("torrent-jb-chemicals");
    const headline = before.terms.find((t) => t.metric === "equity_value") as Term;
    const id = await insertChange("deal", "torrent-jb-chemicals", "term_revision", {
      term: { ...headline, id: "torrent-jb-chemicals-r-test", label: "Equity valuation (revised, test)", asOf: "2026-01-21", ev: [] },
      supersedesTermId: headline.id,
      supersedesFingerprint: { metric: "equity_value", label: "Open offer price", asOf: "2025-06-29" },
    });
    const after = await deal("torrent-jb-chemicals");
    expect(after.terms.some((t) => t.label === "Equity valuation (revised, test)")).toBe(true);
    expect(after.terms.find((t) => t.id === headline.id)?.correction ?? null).toBeNull();
    expect(after.history.find((x) => x.changeId === id)?.warning).toMatchObject({ code: "SUPERSEDED_CHANGED", applied: "partly" });
  });

  it("edits to a missing deal and a new record whose ID the archive now uses are not applied", async () => {
    const edit = await insertChange("deal", "deal-removed-from-archive", "deal_edit", { fields: { title: "Should not apply" } });
    const create = await insertChange("deal", "hdfc-hdfc-bank-merger", "deal_create", { deal: { id: "hdfc-hdfc-bank-merger", title: "Overwritten title (test)" } });
    const ws = (await history()).warnings;
    expect(ws.find((x) => x.changeId === edit)).toMatchObject({ code: "DEAL_NOT_FOUND", applied: "no" });
    expect(ws.find((x) => x.changeId === create)).toMatchObject({ code: "ID_TAKEN", applied: "no" });
    expect((await deal("hdfc-hdfc-bank-merger")).title).not.toBe("Overwritten title (test)");
  });

  it("warnings are owner-only", async () => {
    expect((await api(h, "/api/finance/admin/history")).status).toBe(401);
    expect((await api(h, "/api/finance/admin/history", { as: "visitor" })).status).toBe(403);
  });
});
