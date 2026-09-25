import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chunkImportItems, mergeImportItems, retrieveDocuments } from "../../scripts/lib/evidence-retrieve.mjs";
import { api, idem, startTestHost, type TestHost } from "./helpers";

// End-to-end path for primary evidence, with a FIXTURE page standing in for the publisher (this is not a
// live retrieval): retrieval loop → import file → owner import → draft → publish → the claim shows as
// source checked with its locator, excerpt and retrieval time, and history keeps the previous status.

let h: TestHost;
beforeAll(async () => {
  h = await startTestHost();
});
afterAll(async () => {
  await h?.mf.dispose();
});

type Claim = { label: string; display: string; status: string; locator: string | null; excerpt: string | null; method: string; document: { id: string; url: string; retrievedAt: string | null } };
type Deal = { terms: Array<{ metric: string; ev: string[] }>; evidence: Record<string, Claim> };

describe("evidence retrieval → Research maintenance import → published source check (fixture page)", () => {
  it("publishes only what the owner confirms, with the real attempt time and the matched value", async () => {
    const deal = (await api<Deal>(h, "/api/finance/deals/kimberly-clark-kenvue")).json;
    const claimId = deal.terms.find((t) => t.metric === "enterprise_value")?.ev[0] as string;
    const claim = deal.evidence[claimId] as Claim;
    expect(claim.status).toBe("search_corroborated");
    const url = claim.document.url;
    const origin = new URL(url).origin;
    const fixture = `<html><body><p>Fixture paragraph standing in for the publisher's page in this test only.</p><p>The transaction values the target at an enterprise value of approximately $48.7 billion for 100% of the shares.</p></body></html>`;
    const run = await retrieveDocuments({
      docs: [{ documentId: claim.document.id, url, claims: [claimId] }],
      claims: { [claimId]: { display: claim.display } },
      ua: "FinanceDesk-evidence/test",
      fetchImpl: async (u: string) => (u === `${origin}/robots.txt` ? new Response("", { status: 404 }) : u === url ? new Response(fixture, { headers: { "content-type": "text/html" } }) : new Response("no", { status: 404 })),
      sleepImpl: async () => {},
    });
    expect(run.candidates).toHaveLength(1);
    const [file] = chunkImportItems(mergeImportItems([], run.candidates));
    const body = { format: "finance-research-import-v1", items: file?.items };

    const preview = await api<{ items: Array<{ action: string; evaluation?: { ok: boolean; errors: unknown[] } }> }>(h, "/api/finance/admin/import/preview", { method: "POST", as: "owner", body });
    expect(preview.status).toBe(200);
    expect(preview.json.items[0]?.evaluation?.errors).toEqual([]);
    const imported = await api<{ created: Array<{ draftId: string }> }>(h, "/api/finance/admin/import", { method: "POST", as: "owner", body, idem: idem("imp") });
    expect(imported.status).toBe(201);
    const draftId = imported.json.created[0]?.draftId as string;
    // Nothing is published by importing: the claim is unchanged until the owner publishes the draft.
    expect((await api<Deal>(h, "/api/finance/deals/kimberly-clark-kenvue")).json.evidence[claimId]?.status).toBe("search_corroborated");

    const draft = await api<{ draft: { id: string; revision: number } }>(h, `/api/finance/admin/drafts/${draftId}`, { as: "owner" });
    const pub = await api<{ changeId: string }>(h, `/api/finance/admin/drafts/${draftId}/publish`, { method: "POST", as: "owner", body: { revision: draft.json.draft.revision, note: "Checked against the retrieved announcement (test fixture)." }, idem: idem("pub") });
    expect(pub.status).toBe(200);

    const after = (await api<Deal>(h, "/api/finance/deals/kimberly-clark-kenvue")).json.evidence[claimId] as Claim;
    expect(after).toMatchObject({ status: "source_checked", method: "document_retrieval", locator: run.candidates[0]?.locator, excerpt: run.candidates[0]?.excerpt });
    expect(after.document.retrievedAt).toBe(run.candidates[0]?.retrievedAt.replace(/\.\d+Z$/, "Z"));
    const hist = await api<{ items: Array<{ changeId: string; previous?: { status: string } }>; warnings: unknown[] }>(h, "/api/finance/admin/history", { as: "owner" });
    expect(hist.json.items.find((x) => x.changeId === pub.json.changeId)?.previous?.status).toBe("search_corroborated");
    expect(hist.json.warnings).toEqual([]);
  });
});
