import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, idem, startTestHost, type TestHost } from "./helpers";

/**
 * Optional AI tests. The Anthropic Messages API is replaced by a local fake (Miniflare outbound
 * interceptor); no paid request is made and no real key is used. The key below is a dummy string.
 */

const DUMMY_KEY = "sk-ant-dummy-test-key-not-real-000000";
type Captured = { url: string; headers: Record<string, string>; body: Record<string, unknown> };
const captured: Captured[] = [];
let reply: () => Response = () => new Response("no reply configured", { status: 500 });

function message(out: unknown, extra: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({ id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5", content: [{ type: "text", text: JSON.stringify(out) }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 300 }, ...extra }),
    { headers: { "content-type": "application/json" } },
  );
}

const AI_ENV = {
  FINANCE_AI_PROVIDER: "anthropic",
  FINANCE_AI_MODEL: "claude-opus-5",
  FINANCE_AI_API_KEY: DUMMY_KEY,
  FINANCE_AI_DAILY_BUDGET: "2",
  FINANCE_AI_PRICE_INPUT_PER_MTOK: "5",
  FINANCE_AI_PRICE_OUTPUT_PER_MTOK: "25",
  FINANCE_AI_PRICE_DATE: "2026-06-24",
};

let h: TestHost;
beforeAll(async () => {
  h = await startTestHost({
    bindings: AI_ENV,
    outbound: async (req) => {
      if (req.url.startsWith("https://api.anthropic.com/v1/messages")) {
        captured.push({ url: req.url, headers: Object.fromEntries(req.headers), body: (await req.json()) as Record<string, unknown> });
        return reply();
      }
      return new Response("unexpected", { status: 599 });
    },
  });
});
afterAll(async () => {
  await h?.mf.dispose();
});

const DEAL = { type: "deal", id: "hdfc-hdfc-bank-merger" };
type Preview = { items: Array<{ id: string; label: string; private: boolean }>; estimatedMaxCostUsd: number | null; enabled: boolean };

async function claimWithNumber(): Promise<{ id: string; num: string }> {
  const p = await api<Preview>(h, "/api/finance/ai/summarize/preview", { method: "POST", as: "owner", body: { subject: DEAL } });
  for (const item of p.json.items) {
    const ev = await api<{ display: string; excerpt: string | null; label: string }>(h, `/api/finance/evidence/${item.id}`);
    const m = /\d{2,}(?:\.\d+)?/.exec(`${ev.json.display} ${ev.json.excerpt ?? ""}`);
    if (m) return { id: item.id, num: m[0] };
  }
  throw new Error("no claim with a number");
}

describe("AI disabled by default", () => {
  it("returns a clear setup state, offers the deterministic alternative and makes no request", async () => {
    const off = await startTestHost({ outbound: () => new Response("should not be called", { status: 599 }) });
    try {
      const s = await api<{ enabled: boolean; reason: string }>(off, "/api/finance/ai/status", { as: "owner" });
      expect(s.json).toMatchObject({ enabled: false });
      expect(s.json.reason).toMatch(/AI is off/);
      const r = await api<{ error: { code: string; details: { alternative: string } } }>(off, "/api/finance/ai/summarize", { method: "POST", as: "owner", body: { subject: DEAL }, idem: idem() });
      expect(r.status).toBe(503);
      expect(r.json.error.code).toBe("AI_DISABLED");
      expect(r.json.error.details.alternative).toBeTruthy();
      const p = await api<Preview>(off, "/api/finance/ai/summarize/preview", { method: "POST", as: "owner", body: { subject: DEAL } });
      expect(p.json.enabled).toBe(false);
      expect(p.json.items.length).toBeGreaterThan(0);
    } finally {
      await off.mf.dispose();
    }
  });
  it("AI endpoints are owner-only", async () => {
    expect((await api(h, "/api/finance/ai/status")).status).toBe(401);
    expect((await api(h, "/api/finance/ai/summarize", { method: "POST", as: "visitor", body: { subject: DEAL }, idem: idem() })).status).toBe(403);
  });
});

describe("grounded AI output (fake provider)", () => {
  it("keeps cited, supported sections and holds invented citations and unsupported numbers", async () => {
    const { id, num } = await claimWithNumber();
    reply = () =>
      message({
        title: "HDFC merger summary",
        sections: [
          { kind: "fact", text: `The record shows ${num} for this item.`, citations: [id] },
          { kind: "fact", text: "The deal was worth 999,999 crore.", citations: [id] },
          { kind: "fact", text: "Advisers were Example Bank.", citations: ["ev-invented01"] },
          { kind: "analysis", text: "Deposit franchise matters more than branch count.", citations: [] },
        ],
        uncertainty: "Limited to the stored evidence.",
      });
    const r = await api<{ sections: Array<{ text: string }>; held: Array<{ reasons: string[] }>; usage: { estimate: boolean; estCostUsd: number; priceDate: string }; meta: { model: string; evidenceVersion: string } }>(h, "/api/finance/ai/summarize", { method: "POST", as: "owner", body: { subject: DEAL }, idem: idem() });
    expect(r.status).toBe(200);
    expect(r.json.sections.map((s) => s.text)).toEqual([`The record shows ${num} for this item.`, "Deposit franchise matters more than branch count."]);
    expect(r.json.held).toHaveLength(2);
    expect(r.json.held.flatMap((x) => x.reasons).join(" ")).toMatch(/not in the input.*|Numbers not found/);
    expect(r.json.usage).toMatchObject({ estimate: true, priceDate: "2026-06-24" });
    expect(r.json.usage.estCostUsd).toBeCloseTo((1200 * 5 + 300 * 25) / 1e6, 6);
    expect(r.json.meta.evidenceVersion).toBeTruthy();
    expect(r.text).not.toContain(DUMMY_KEY);

    const req = captured.at(-1) as Captured;
    expect(req.headers["x-api-key"]).toBe(DUMMY_KEY);
    expect(req.headers["anthropic-version"]).toBeTruthy();
    expect(req.headers["anthropic-beta"]).toContain("server-side-fallback-2026-07-01");
    expect(req.body).toMatchObject({ model: "claude-opus-5", fallbacks: "default", output_config: { format: { type: "json_schema" } } });
    expect(req.body.tools).toBeUndefined();
    expect(String(req.body.system)).toMatch(/untrusted data/);

    const hist = await api<{ items: Array<{ status: string; inputTokens: number; outputTokens: number }> }>(h, "/api/finance/ai/history", { as: "owner" });
    expect(hist.json.items[0]).toMatchObject({ status: "partial", inputTokens: 1200, outputTokens: 300 });
  });

  it("rejects a response where nothing is grounded, but still records usage", async () => {
    reply = () => message({ title: "x", sections: [{ kind: "fact", text: "EBITDA was 4,321 crore.", citations: ["ev-madeup"] }], uncertainty: "" });
    const r = await api<{ error: { code: string } }>(h, "/api/finance/ai/summarize", { method: "POST", as: "owner", body: { subject: DEAL }, idem: idem() });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe("AI_OUTPUT_REJECTED");
    const hist = await api<{ items: Array<{ status: string; estCostUsd: number }> }>(h, "/api/finance/ai/history", { as: "owner" });
    expect(hist.json.items[0]).toMatchObject({ status: "rejected" });
    expect(hist.json.items[0]?.estCostUsd).toBeGreaterThan(0);
  });

  it("maps provider failures without leaking the key", async () => {
    reply = () => new Response(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "slow down" } }), { status: 429, headers: { "content-type": "application/json", "retry-after": "30" } });
    const a = await api(h, "/api/finance/ai/questions", { method: "POST", as: "owner", body: { subject: DEAL }, idem: idem() });
    expect(a.status).toBe(429);
    expect(a.json).toMatchObject({ error: { code: "AI_RATE_LIMITED" } });
    reply = () => new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "overloaded" } }), { status: 529, headers: { "content-type": "application/json" } });
    const b = await api(h, "/api/finance/ai/questions", { method: "POST", as: "owner", body: { subject: DEAL }, idem: idem() });
    expect(b.status).toBe(503);
    reply = () => new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: `invalid x-api-key ${DUMMY_KEY}` } }), { status: 401, headers: { "content-type": "application/json" } });
    const c = await api(h, "/api/finance/ai/questions", { method: "POST", as: "owner", body: { subject: DEAL }, idem: idem() });
    expect(c.status).toBe(502);
    expect(c.text).not.toContain(DUMMY_KEY);
    const hist = await api(h, "/api/finance/ai/history", { as: "owner" });
    expect(hist.text).not.toContain(DUMMY_KEY);
  });

  it("handles a refusal stop reason", async () => {
    reply = () => message({}, { content: [], stop_reason: "refusal", stop_details: { type: "refusal", category: null, explanation: null } });
    const r = await api(h, "/api/finance/ai/summarize", { method: "POST", as: "owner", body: { subject: DEAL }, idem: idem() });
    expect(r.status).toBe(422);
    expect(r.json).toMatchObject({ error: { code: "AI_REFUSED" } });
  });

  it("sends private notes only when selected, and shows them in the preview", async () => {
    const note = await api<{ note: { id: string } }>(h, "/api/finance/notes", { method: "POST", as: "owner", body: { title: "Private view on HDFC", body: "SECRET-NOTE-MARKER my private thesis" }, idem: idem() });
    const { id } = await claimWithNumber();
    reply = () => message({ title: "Draft", sections: [{ kind: "analysis", text: "The owner's note argues the thesis.", citations: [`note:${note.json.note.id}`] }, { kind: "fact", text: "See the record.", citations: [id] }], uncertainty: "" });
    await api(h, "/api/finance/ai/draft_note", { method: "POST", as: "owner", body: { subject: DEAL }, idem: idem() });
    expect(JSON.stringify(captured.at(-1)?.body)).not.toContain("SECRET-NOTE-MARKER");
    const preview = await api<Preview>(h, "/api/finance/ai/draft_note/preview", { method: "POST", as: "owner", body: { subject: DEAL, noteIds: [note.json.note.id] } });
    expect(preview.json.items.find((i) => i.id === `note:${note.json.note.id}`)).toMatchObject({ private: true });
    const r = await api<{ sections: unknown[] }>(h, "/api/finance/ai/draft_note", { method: "POST", as: "owner", body: { subject: DEAL, noteIds: [note.json.note.id] }, idem: idem() });
    expect(r.status).toBe(200);
    expect(JSON.stringify(captured.at(-1)?.body)).toContain("SECRET-NOTE-MARKER");
    expect(r.json.sections).toHaveLength(2);
  });

  it("interview feedback scores the answer against the rubric and is stored with the attempt", async () => {
    const { id, num } = await claimWithNumber();
    const attempt = await api<{ id: string }>(h, "/api/finance/interview", {
      method: "POST",
      as: "owner",
      body: { promptId: "walk-deal", subject: DEAL, response: `HDFC Ltd merged into HDFC Bank. I believe the figure was ${num}. The rationale was funding and cross-sell; the risk is margin pressure.`, durationSec: 95, selfRubric: { accuracy: 2 }, reflection: "" },
      idem: idem(),
    });
    reply = () =>
      message({
        criteria: [
          { criterion: "accuracy", score: 2, comment: `Correctly states ${num}.`, citations: [id] },
          { criterion: "risk", score: 1, comment: "Names margin pressure but no falsifier.", citations: [] },
        ],
        overall: "Solid outline.",
        uncertainty: "Only stored evidence was used.",
      });
    const r = await api<{ criteria: Array<{ criterion: string; score: number }> }>(h, "/api/finance/ai/interview_feedback", { method: "POST", as: "owner", body: { attemptId: attempt.json.id }, idem: idem() });
    expect(r.status).toBe(200);
    expect(r.json.criteria.map((c) => c.criterion)).toEqual(["accuracy", "risk"]);
    expect(JSON.stringify(r.json)).not.toMatch(/hir(e|ing) (probability|chance)/i);
    const list = await api<{ items: Array<{ id: string; aiFeedback: { criteria: unknown[] } | null }> }>(h, "/api/finance/interview", { as: "owner" });
    expect(list.json.items.find((a) => a.id === attempt.json.id)?.aiFeedback?.criteria).toHaveLength(2);
  });

  it("extraction proposals go to the review queue, never straight to the record", async () => {
    const doc = await api<{ documentId: string }>(h, "/api/finance/admin/manual-source", {
      method: "POST",
      as: "owner",
      body: { url: "https://www.example.org/test-fixture-order", publisher: "Test publisher", title: "Test fixture: approval dated 2026-09-20", publishedDate: "2026-09-21", excerpt: "Approval granted on 2026-09-20 (fixture).", eventType: "subsequent" },
      idem: idem(),
    });
    const evId = `ev-u-${doc.json.documentId}`;
    reply = () => message({ proposals: [{ eventType: "regulatory_approval", date: "2026-09-20", title: "Approval granted", citations: [evId] }, { eventType: "completion", date: "2026-10-01", title: "Completion", citations: [evId] }], uncertainty: "" });
    const before = await api(h, "/api/finance/deals/hdfc-hdfc-bank-merger");
    const r = await api<{ proposals: unknown[]; held: unknown[]; queuedReviewItems: string[] }>(h, "/api/finance/ai/extract", { method: "POST", as: "owner", body: { subject: DEAL, documentId: doc.json.documentId }, idem: idem() });
    expect(r.status).toBe(200);
    expect(r.json.proposals).toHaveLength(1);
    expect(r.json.held).toHaveLength(1);
    expect(r.json.queuedReviewItems).toHaveLength(1);
    const after = await api(h, "/api/finance/deals/hdfc-hdfc-bank-merger");
    expect(after.json).toEqual(before.json);
    const q = await api<{ items: Array<{ id: string; kind: string; origin: string }> }>(h, "/api/finance/admin/review?status=pending", { as: "owner" });
    expect(q.json.items.find((i) => i.id === r.json.queuedReviewItems[0])).toMatchObject({ kind: "ai_extraction", origin: "ai:claude-opus-5" });
  });
});

describe("spending cap", () => {
  it("refuses before calling the provider when the reservation would exceed the daily budget", async () => {
    const tight = await startTestHost({ bindings: { ...AI_ENV, FINANCE_AI_DAILY_BUDGET: "0.0001" }, outbound: () => new Response("should not be called", { status: 599 }) });
    try {
      const r = await api<{ error: { code: string } }>(tight, "/api/finance/ai/summarize", { method: "POST", as: "owner", body: { subject: DEAL }, idem: idem() });
      expect(r.status).toBe(429);
      expect(r.json.error.code).toBe("AI_BUDGET_EXHAUSTED");
    } finally {
      await tight.mf.dispose();
    }
  });
});

describe("historical cutoff (As announced mode) limits the evidence pack", () => {
  it("sends only evidence published by the cutoff and labels the header as historical", async () => {
    const disney = { type: "deal", id: "disney-21st-century-fox" };
    const now = await api<Preview>(h, "/api/finance/ai/summarize/preview", { method: "POST", as: "owner", body: { subject: disney } });
    const then = await api<Preview>(h, "/api/finance/ai/summarize/preview", { method: "POST", as: "owner", body: { subject: disney, asOf: "2017-12-14" } });
    expect(now.status).toBe(200);
    expect(then.status).toBe(200);
    expect(then.json.items.length).toBeGreaterThan(0);
    expect(then.json.items.length).toBeLessThan(now.json.items.length);
    for (const item of then.json.items) {
      const ev = await api<{ document: { publishedDate: { date: string } | null } }>(h, `/api/finance/evidence/${item.id}`);
      expect(ev.json.document.publishedDate?.date ?? "9999", item.id).toBe("2017-12-14");
    }
    expect(JSON.stringify(then.json)).not.toMatch(/71\.3|Comcast|amended|bidding contest/i);
    expect((then.json as unknown as { header: string }).header).toMatch(/as it stood on 2017-12-14 \(historical view\)/);
    const bad = await api(h, "/api/finance/ai/summarize/preview", { method: "POST", as: "owner", body: { subject: { type: "company", id: "disney" }, asOf: "2017-12-14" } });
    expect(bad.status).toBe(400);
  });
});
