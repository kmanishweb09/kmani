import { describe, expect, it } from "vitest";
import type { CompiledArchive } from "../../shared/archive/compile";
import { checkClaimRegistry, type ClaimRegistry } from "../../scripts/lib/claim-registry";

// Claim IDs are positional; the registry catches an insertion that moves an ID onto a different claim.

type Claim = CompiledArchive["claims"][string];
const claim = (id: string, field: string, label: string, display: string, documentId = "doc-a"): Claim =>
  ({ id, subject: { type: "deal", id: "d1" }, field, label, display, documentId, locator: null, excerpt: null, status: "search_corroborated", checkedAt: "2026-09-25", method: "web_search_index", note: null }) as Claim;
const archive = (version: string, claims: Claim[]) => ({ version, claims: Object.fromEntries(claims.map((c) => [c.id, c])) }) as unknown as CompiledArchive;

const v1 = archive("archive-v1", [claim("ev-1", "terms.0", "Enterprise value", "US$48.7 billion"), claim("ev-2", "terms.1", "Consideration per share", "US$3.5 cash")]);

describe("claim ID registry", () => {
  it("registers every claim with the archive version that first contained it", () => {
    const r = checkClaimRegistry(null, v1);
    expect(r.created).toBe(true);
    expect(r.added).toEqual(["ev-1", "ev-2"]);
    expect(r.next?.claims["ev-1"]).toMatchObject({ subject: "deal:d1", field: "terms.0", label: "Enterprise value", firstSeen: "archive-v1" });
  });

  it("fails and writes nothing when an insertion moves an ID onto a different claim or removes one", () => {
    const reg = checkClaimRegistry(null, v1).next as ClaimRegistry;
    // A new multiple inserted first: terms.0 now denotes it, and ev-2's position disappears.
    const shifted = archive("archive-v2", [claim("ev-1", "terms.0", "EV / EBITDA", "14.3×"), claim("ev-3", "terms.1", "Enterprise value", "US$48.7 billion"), claim("ev-4", "terms.2", "Consideration per share", "US$3.5 cash")]);
    const r = checkClaimRegistry(reg, shifted);
    expect(r.relabelled.map((x) => x.id)).toEqual(["ev-1"]);
    expect(r.missing.map((x) => x.id)).toEqual(["ev-2"]);
    expect(r.next).toBeNull();
  });

  it("logs a value correction at the same ID as a revision and keeps firstSeen", () => {
    const reg = checkClaimRegistry(null, v1).next as ClaimRegistry;
    const corrected = archive("archive-v2", [claim("ev-1", "terms.0", "Enterprise value", "US$48.9 billion"), claim("ev-2", "terms.1", "Consideration per share", "US$3.5 cash")]);
    const r = checkClaimRegistry(reg, corrected);
    expect(r.valueChanged).toEqual([{ id: "ev-1", from: "US$48.7 billion", to: "US$48.9 billion", subject: "deal:d1" }]);
    expect(r.next?.claims["ev-1"]).toMatchObject({ display: "US$48.9 billion", firstSeen: "archive-v1", revisions: [{ archiveVersion: "archive-v2", display: ["US$48.7 billion", "US$48.9 billion"] }] });
  });

  it("accepts a deliberate relabel only when asked, recording the old label", () => {
    const reg = checkClaimRegistry(null, v1).next as ClaimRegistry;
    const renamed = archive("archive-v2", [claim("ev-1", "terms.0", "Enterprise value (at announcement)", "US$48.7 billion"), claim("ev-2", "terms.1", "Consideration per share", "US$3.5 cash")]);
    expect(checkClaimRegistry(reg, renamed).next).toBeNull();
    const r = checkClaimRegistry(reg, renamed, { acceptRelabel: true });
    expect(r.next?.claims["ev-1"]?.revisions?.[0]?.label).toEqual(["Enterprise value", "Enterprise value (at announcement)"]);
  });

  it("skips retired IDs and flags them if the archive produces them again", () => {
    const reg = checkClaimRegistry(null, v1).next as ClaimRegistry;
    const entry = reg.claims["ev-2"] as ClaimRegistry["claims"][string];
    delete reg.claims["ev-2"];
    reg.retired["ev-2"] = { reason: "Term removed after review", retiredIn: "archive-v2", entry };
    const without = archive("archive-v2", [claim("ev-1", "terms.0", "Enterprise value", "US$48.7 billion")]);
    expect(checkClaimRegistry(reg, without)).toMatchObject({ missing: [], reused: [] });
    expect(checkClaimRegistry(reg, v1).reused).toEqual(["ev-2"]);
  });
});
