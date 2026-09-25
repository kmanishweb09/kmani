import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, idem, startTestHost, type TestHost } from "./helpers";

// Simulated-host checks (harness + release bundle in workerd with D1). Not a test of the live site.
let h: TestHost;
beforeAll(async () => {
  h = await startTestHost();
});
afterAll(async () => {
  await h?.mf.dispose();
});

describe("existing host routes are untouched", () => {
  it("serves existing sentinels and the generic /api branch", async () => {
    expect((await api(h, "/api/planner")).json).toMatchObject({ sentinel: "planner" });
    expect((await api(h, "/api/excel/x")).json).toMatchObject({ sentinel: "excel" });
    expect((await api(h, "/api/study")).json).toMatchObject({ sentinel: "study" });
    expect((await api(h, "/api/missions/1")).json).toMatchObject({ sentinel: "missions" });
    expect((await api(h, "/api/unknown")).status).toBe(404);
    const atlas = await api(h, "/atlas");
    expect(atlas.status).toBe(301);
    expect(atlas.headers.get("location")).toMatch(/\/Atlas$/);
  });
  it("does not claim look-alike paths", async () => {
    expect((await api(h, "/api/financex")).json).toEqual({ error: "Not found" });
    expect((await api(h, "/financex")).status).toBe(404);
  });
  it("serves /finance pages from finance.html with finance-only headers", async () => {
    const r = await api(h, "/finance/deals");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/text\/html/);
    expect(r.headers.get("content-security-policy")).toBeTruthy();
    expect(r.text).not.toContain("dev-owner");
  });
});

describe("access control (identity only from the host's getUser)", () => {
  it("public research is readable anonymously with cache validators", async () => {
    const r = await api(h, "/api/finance/deals");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toMatch(/^public/);
    const etag = r.headers.get("etag") as string;
    const again = await api(h, "/api/finance/deals", { headers: { "If-None-Match": etag } });
    expect(again.status).toBe(304);
  });
  it("status is private and never cached", async () => {
    const r = await api(h, "/api/finance/status", { as: "owner" });
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.json).toMatchObject({ viewer: { role: "owner", signedIn: true } });
    expect(JSON.stringify(r.json)).not.toContain("dev-owner");
  });
  it("private routes: anonymous 401, signed-in non-owner 403, owner 200", async () => {
    expect((await api(h, "/api/finance/notes")).status).toBe(401);
    expect((await api(h, "/api/finance/notes", { as: "visitor" })).status).toBe(403);
    const ok = await api(h, "/api/finance/notes", { as: "owner" });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("private, no-store");
  });
  it("ignores user IDs in query strings, bodies and client headers", async () => {
    for (const r of [
      await api(h, "/api/finance/notes?userId=dev-owner&user_id=dev-owner", { as: "visitor" }),
      await api(h, "/api/finance/notes", { as: "visitor", headers: { "X-User-Id": "dev-owner", "X-Forwarded-User": "dev-owner", "Cf-Access-Authenticated-User-Email": "owner@example.com" } }),
      await api(h, "/api/finance/notes", { method: "POST", as: "visitor", body: { title: "x", userId: "dev-owner" }, idem: idem() }),
    ]) {
      expect(r.status).toBe(403);
    }
  });
  it("admin and AI endpoints are owner-only", async () => {
    for (const path of ["/api/finance/admin/sources", "/api/finance/admin/review"]) {
      expect((await api(h, path)).status).toBe(401);
      expect((await api(h, path, { as: "visitor" })).status).toBe(403);
    }
    expect((await api(h, "/api/finance/admin/refresh", { method: "POST", as: "visitor", body: {}, idem: idem() })).status).toBe(403);
  });
  it("maintenance endpoint accepts only the bearer secret (never a URL token)", async () => {
    expect((await api(h, "/api/finance/admin/jobs/run", { method: "POST", noCsrf: true })).status).toBe(401);
    expect((await api(h, "/api/finance/admin/jobs/run", { method: "POST", noCsrf: true, headers: { Authorization: "Bearer wrong-secret-wrong-secret-wrong-secret" } })).status).toBe(401);
    expect((await api(h, `/api/finance/admin/jobs/run?token=${h.jobSecret}`, { method: "POST", noCsrf: true })).status).toBe(401);
    const ok = await api<{ ok: boolean; jobs: Array<{ job: string; status: string }> }>(h, "/api/finance/admin/jobs/run", { method: "POST", noCsrf: true, headers: { Authorization: `Bearer ${h.jobSecret}` }, body: { jobs: ["cleanup"] } });
    expect(ok.status).toBe(200);
    expect(ok.json.jobs[0]).toMatchObject({ job: "cleanup", status: "succeeded" });
  });
});

describe("CSRF and CORS", () => {
  const body = { title: "CSRF probe" };
  it("rejects writes without the finance header, from other origins, or cross-site", async () => {
    expect((await api(h, "/api/finance/notes", { method: "POST", as: "owner", body, idem: idem(), headers: { "X-Finance-Request": "0" } })).json).toMatchObject({ error: { code: "CSRF_HEADER_MISSING" } });
    expect((await api(h, "/api/finance/notes", { method: "POST", as: "owner", body, idem: idem(), headers: { Origin: "https://evil.example" } })).json).toMatchObject({ error: { code: "ORIGIN_MISMATCH" } });
    expect((await api(h, "/api/finance/notes", { method: "POST", as: "owner", body, idem: idem(), headers: { "Sec-Fetch-Site": "cross-site" } })).json).toMatchObject({ error: { code: "CROSS_SITE_REQUEST" } });
  });
  it("never grants CORS preflights", async () => {
    const r = await api(h, "/api/finance/notes", { method: "OPTIONS", noCsrf: true, headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" } });
    expect(r.status).toBe(405);
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
  });
  it("rejects oversize bodies and wrong content types", async () => {
    // A route with a small body limit (4 KB) is used so the whole request fits in the socket buffer:
    // with a multi-hundred-KB upload the server's (correct) early 413 can race the client's write (ECONNRESET).
    const big = await api(h, "/api/finance/admin/jobs/run", { method: "POST", as: "owner", body: { jobs: ["cleanup"], pad: "x".repeat(6_000) } });
    expect(big.status).toBe(413);
    expect(big.json).toMatchObject({ error: { code: "PAYLOAD_TOO_LARGE" } });
    const wrong = await api(h, "/api/finance/preferences", { method: "PATCH", as: "owner", body: { theme: "dark" }, headers: { "Content-Type": "text/plain" } });
    expect(wrong.status).toBe(415);
  });
});

describe("owner not configured → public mode, private features fail closed", () => {
  let h2: TestHost;
  beforeAll(async () => {
    h2 = await startTestHost({ bindings: { FINANCE_OWNER_USER_ID: "" } });
  });
  afterAll(async () => {
    await h2?.mf.dispose();
  });
  it("never treats the first visitor as owner", async () => {
    expect((await api(h2, "/api/finance/deals")).status).toBe(200);
    const s = await api<{ viewer: { role: string; ownerConfigured: boolean } }>(h2, "/api/finance/status", { as: "owner" });
    expect(s.json.viewer).toMatchObject({ role: "user", ownerConfigured: false });
    const r = await api(h2, "/api/finance/notes", { as: "owner" });
    expect(r.status).toBe(503);
    expect(r.json).toMatchObject({ error: { code: "OWNER_NOT_CONFIGURED" } });
  });
});
