import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES } from "../../shared/defaults";
import { zPreferences } from "../../shared/schemas/private";
import { api, idem, startTestHost, type TestHost } from "./helpers";

let h: TestHost;
beforeAll(async () => {
  h = await startTestHost();
});
afterAll(async () => {
  await h?.mf.dispose();
});

interface Note {
  id: string;
  title: string;
  body: string;
  template: string;
  tags: string[];
  revision: number;
  archivedAt: string | null;
}

describe("notes: idempotency, revisions and partial updates", () => {
  let note: Note;
  it("creates once per Idempotency-Key and replays retries", async () => {
    const key = idem("note");
    const body = { title: "HDFC merger view", body: "## My view\nDeposits matter.", template: "deal_note", tags: ["fig", "india"] };
    const a = await api<{ note: Note }>(h, "/api/finance/notes", { method: "POST", as: "owner", body, idem: key });
    const b = await api<{ note: Note }>(h, "/api/finance/notes", { method: "POST", as: "owner", body, idem: key });
    expect(a.status).toBe(201);
    expect(b.headers.get("idempotent-replayed")).toBe("true");
    expect(b.json.note.id).toBe(a.json.note.id);
    const list = await api<{ items: Note[] }>(h, "/api/finance/notes", { as: "owner" });
    expect(list.json.items.filter((n) => n.title === "HDFC merger view")).toHaveLength(1);
    const reused = await api(h, "/api/finance/notes", { method: "POST", as: "owner", body: { ...body, title: "Different" }, idem: key });
    expect(reused.status).toBe(422);
    note = a.json.note;
  });
  it("requires an Idempotency-Key for creates", async () => {
    const r = await api(h, "/api/finance/notes", { method: "POST", as: "owner", body: { title: "No key" } });
    expect(r.json).toMatchObject({ error: { code: "IDEMPOTENCY_KEY_REQUIRED" } });
  });
  it("archiving does not reset body, tags or template (patch without defaults)", async () => {
    const r = await api<{ note: Note }>(h, `/api/finance/notes/${note.id}`, { method: "PATCH", as: "owner", body: { revision: note.revision, archived: true } });
    expect(r.status).toBe(200);
    expect(r.json.note).toMatchObject({ body: note.body, tags: note.tags, template: "deal_note", title: note.title, revision: note.revision + 1 });
    expect(r.json.note.archivedAt).toBeTruthy();
    note = r.json.note;
  });
  it("rejects a stale revision with 409 and returns the current version", async () => {
    const r = await api<{ error: { code: string; details: { current: { revision: number } } } }>(h, `/api/finance/notes/${note.id}`, { method: "PATCH", as: "owner", body: { revision: note.revision - 1, body: "overwrite" } });
    expect(r.status).toBe(409);
    expect(r.json.error.details.current.revision).toBe(note.revision);
  });
  it("delete needs explicit confirmation", async () => {
    expect((await api(h, `/api/finance/notes/${note.id}`, { method: "DELETE", as: "owner" })).status).toBe(400);
    expect((await api(h, `/api/finance/notes/${note.id}?confirm=true`, { method: "DELETE", as: "owner" })).status).toBe(200);
    expect((await api(h, `/api/finance/notes/${note.id}`, { as: "owner" })).status).toBe(404);
  });
});

describe("preferences", () => {
  it("DEFAULT_PREFERENCES satisfies the schema exactly", () => {
    expect(zPreferences.parse({})).toEqual(DEFAULT_PREFERENCES);
    expect(zPreferences.parse(DEFAULT_PREFERENCES)).toEqual(DEFAULT_PREFERENCES);
  });
  it("a partial update changes only the supplied fields", async () => {
    const before = await api<{ prefs: Record<string, unknown>; revision: number }>(h, "/api/finance/preferences", { as: "owner" });
    const a = await api<{ prefs: Record<string, unknown>; revision: number }>(h, "/api/finance/preferences", { method: "PATCH", as: "owner", body: { followedSectors: ["fig", "tmt"], revision: before.json.revision } });
    expect(a.status).toBe(200);
    const b = await api<{ prefs: Record<string, unknown>; revision: number }>(h, "/api/finance/preferences", { method: "PATCH", as: "owner", body: { theme: "light", revision: a.json.revision } });
    expect(b.json.prefs).toMatchObject({ theme: "light", followedSectors: ["fig", "tmt"], timezone: "Asia/Kolkata" });
  });
  it("rejects unknown enum values", async () => {
    const r = await api(h, "/api/finance/preferences", { method: "PATCH", as: "owner", body: { theme: "neon" } });
    expect(r.status).toBe(400);
  });
});

describe("Deal Memory and review", () => {
  it("saving a deal twice updates one memory record", async () => {
    const deal = await api<{ statusEv: string[] }>(h, "/api/finance/deals/hdfc-hdfc-bank-merger");
    const claim = deal.json.statusEv[0] as string;
    const card = { cardType: "who_bought_what", prompt: "Who bought what?", answer: "HDFC Bank absorbed HDFC Ltd.", sourceRefs: [{ kind: "claim", id: claim }] };
    const a = await api<{ created: boolean; record: { id: string; cards: Array<{ id: string }> } }>(h, "/api/finance/memory", { method: "POST", as: "owner", body: { subject: { type: "deal", id: "hdfc-hdfc-bank-merger" }, cards: [card] }, idem: idem() });
    const b = await api<{ created: boolean; record: { id: string } }>(h, "/api/finance/memory", { method: "POST", as: "owner", body: { subject: { type: "deal", id: "hdfc-hdfc-bank-merger" }, cards: [{ ...card, answer: "HDFC Ltd merged into HDFC Bank." }] }, idem: idem() });
    expect(a.json.created).toBe(true);
    expect(b.json.created).toBe(false);
    expect(b.json.record.id).toBe(a.json.record.id);
    const cardId = a.json.record.cards[0]?.id as string;
    const key = idem("rev");
    const r1 = await api<{ stageAfter: number }>(h, "/api/finance/review", { method: "POST", as: "owner", body: { cardId, rating: "good" }, idem: key });
    const r2 = await api(h, "/api/finance/review", { method: "POST", as: "owner", body: { cardId, rating: "good" }, idem: key });
    expect(r1.status).toBeLessThan(300);
    expect(r2.headers.get("idempotent-replayed")).toBe("true");
    const hist = await api<{ items: unknown[] }>(h, "/api/finance/review/history", { as: "owner" });
    expect(hist.json.items).toHaveLength(1);
  });
  it("rejects cards citing unknown evidence", async () => {
    const r = await api(h, "/api/finance/memory", { method: "POST", as: "owner", body: { subject: { type: "deal", id: "hdfc-hdfc-bank-merger" }, cards: [{ cardType: "risk", prompt: "Risk?", answer: "x", sourceRefs: [{ kind: "claim", id: "ev-does-not-exist" }] }] }, idem: idem() });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });
});

describe("export stays private", () => {
  it("export requires the owner and is not cacheable", async () => {
    expect((await api(h, "/api/finance/export", { as: "visitor" })).status).toBe(403);
    const r = await api(h, "/api/finance/export", { as: "owner" });
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.text).not.toMatch(/FINANCE_|sk-|Bearer/);
  });
});
