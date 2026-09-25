// Primary-evidence retrieval loop, separated from scripts/evidence.mjs so it can be tested with a fixture
// fetch. It fetches documents one at a time with an identifying User-Agent, honours robots.txt, waits
// between requests to the same host, and never works around an access restriction: paywalls, sign-in
// pages, 401/402/403/451, CAPTCHAs and robots.txt disallows are recorded and not retried by other means.
// Every attempt is logged with its real start and finish times. Only a hash of each retrieved document
// and short (≤300-character) excerpts are kept.

import { createHash } from "node:crypto";
import { findEvidence, htmlToParagraphs, plainTextToParagraphs, robotsAllows } from "./evidence-match.mjs";

export const EGRESS_MARKERS = /host not in allowlist|x-deny-reason/i;
export const RESTRICTED_MARKERS = /(subscribe to (continue|read)|sign in to (continue|read)|log ?in to (continue|read)|captcha|are you a robot|access denied|enable javascript and cookies to continue)/i;
export const IMPORT_LIMIT = 100;

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(fetchImpl, url, ua, timeoutMs = 20_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { headers: { "User-Agent": ua, Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,application/pdf;q=0.5" }, redirect: "follow", signal: ctrl.signal });
    const type = res.headers.get("content-type") ?? "";
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, type, buf, finalUrl: res.url, denyReason: res.headers.get("x-deny-reason") };
  } finally {
    clearTimeout(t);
  }
}

/**
 * @param {object} o
 * @param {Array<{documentId: string, url: string, claims: string[]}>} o.docs documents in retrieval order
 * @param {Record<string, {display: string}>} o.claims archive claims by ID
 * @param {string} o.ua identifying User-Agent
 * @param {typeof fetch} [o.fetchImpl]
 * @param {(ms: number) => Promise<void>} [o.sleepImpl]
 * @param {number} [o.hostDelayMs]
 * @param {(line: string) => void} [o.onAttempt]
 */
export async function retrieveDocuments({ docs, claims, ua, fetchImpl = fetch, sleepImpl = realSleep, hostDelayMs = 2_000, onAttempt = () => {} }) {
  const hostState = new Map();
  const attempts = [];
  const candidates = [];
  const needsHuman = [];
  for (const d of docs) {
    const u = new URL(d.url);
    const host = u.host;
    const st = hostState.get(host) ?? { blocked: null, robots: undefined, last: 0 };
    hostState.set(host, st);
    const attemptedAt = new Date().toISOString();
    const entry = { documentId: d.documentId, url: d.url, attemptedAt, finishedAt: null, outcome: null, httpStatus: null, contentType: null, bytes: null, sha256: null, detail: null, userAgent: ua };
    try {
      if (st.blocked) {
        Object.assign(entry, { outcome: st.blocked.outcome, detail: `Not requested: ${st.blocked.detail} (same host, earlier in this run)` });
      } else {
        const wait = st.last + hostDelayMs - Date.now();
        if (wait > 0) await sleepImpl(wait);
        if (st.robots === undefined) {
          try {
            const r = await fetchText(fetchImpl, `${u.protocol}//${host}/robots.txt`, ua, 10_000);
            if (r.denyReason || EGRESS_MARKERS.test(r.buf.toString("utf8", 0, 300))) {
              st.blocked = { outcome: "egress_blocked", detail: `build environment's egress proxy refused ${host} (${r.denyReason ?? r.status})` };
              st.robots = null;
            } else st.robots = r.status === 200 ? r.buf.toString("utf8") : "";
          } catch (e) {
            st.blocked = { outcome: "network_error", detail: `robots.txt: ${e.cause?.code ?? e.message}` };
            st.robots = null;
          }
          st.last = Date.now();
        }
        if (st.blocked) Object.assign(entry, { outcome: st.blocked.outcome, detail: st.blocked.detail });
        else if (st.robots && !robotsAllows(st.robots, ua.split(/[ /]/)[0] ?? ua, u.pathname + u.search)) Object.assign(entry, { outcome: "robots_disallowed", detail: "robots.txt disallows this path for our User-Agent; not fetched" });
        else {
          const wait2 = st.last + hostDelayMs - Date.now();
          if (wait2 > 0) await sleepImpl(wait2);
          const r = await fetchText(fetchImpl, d.url, ua);
          st.last = Date.now();
          const head = r.buf.toString("utf8", 0, 4000);
          Object.assign(entry, { httpStatus: r.status, contentType: r.type, bytes: r.buf.length });
          if (r.denyReason || EGRESS_MARKERS.test(head.slice(0, 300))) {
            st.blocked = { outcome: "egress_blocked", detail: `egress proxy refused ${host}` };
            Object.assign(entry, { outcome: "egress_blocked", detail: st.blocked.detail });
          } else if ([401, 402, 403, 451].includes(r.status) || RESTRICTED_MARKERS.test(head)) {
            Object.assign(entry, { outcome: "access_restricted", detail: `publisher returned ${r.status}; not retried by other means` });
          } else if (r.status === 429) {
            st.blocked = { outcome: "rate_limited", detail: "429 from publisher; stopping this host for the run" };
            Object.assign(entry, { outcome: "rate_limited", detail: st.blocked.detail });
          } else if (r.status >= 400) {
            Object.assign(entry, { outcome: "http_error", detail: `HTTP ${r.status}` });
          } else {
            entry.sha256 = createHash("sha256").update(r.buf).digest("hex");
            const isPdf = /pdf/i.test(r.type) || r.buf.subarray(0, 5).toString() === "%PDF-";
            if (isPdf) {
              Object.assign(entry, { outcome: "retrieved_pdf_unparsed", detail: "PDF retrieved; text not extracted by this tool — check the claims by hand" });
              for (const id of d.claims) needsHuman.push({ claimId: id, documentId: d.documentId, reason: "PDF not parsed", retrievedAt: attemptedAt });
            } else {
              const text = r.buf.toString("utf8");
              const paras = /html/i.test(r.type) ? htmlToParagraphs(text) : plainTextToParagraphs(text);
              Object.assign(entry, { outcome: "retrieved", detail: `${paras.length} paragraphs` });
              for (const id of d.claims) {
                const c = claims[id];
                const m = c ? findEvidence(paras, c.display) : null;
                if (m) candidates.push({ claimId: id, documentId: d.documentId, retrievedAt: attemptedAt, ...m, recordedValue: c.display });
                else needsHuman.push({ claimId: id, documentId: d.documentId, reason: "Recorded value not found verbatim in the retrieved text", retrievedAt: attemptedAt });
              }
            }
          }
        }
      }
    } catch (e) {
      Object.assign(entry, { outcome: e.name === "AbortError" ? "timeout" : "network_error", detail: e.cause?.code ?? e.message });
    }
    entry.finishedAt = new Date().toISOString();
    attempts.push(entry);
    onAttempt(entry);
  }
  return { attempts, candidates, needsHuman };
}

/** A candidate becomes a claim-verification import item; the owner reviews it before publishing. */
export function importItem(c) {
  return { kind: "claim_verification", documentId: c.documentId, payload: { claimId: c.claimId, status: "source_checked", checkedValue: c.checkedValue, locator: c.locator, excerpt: c.excerpt, retrievedAt: c.retrievedAt.replace(/\.\d+Z$/, "Z"), note: null }, evidence: { documents: [] } };
}

/** Adds new claim/document pairs only; earlier items keep their original retrieval time. */
export function mergeImportItems(existing, candidates) {
  const key = (it) => `${it.payload.claimId}|${it.documentId ?? ""}`;
  const out = [...existing];
  const have = new Set(out.map(key));
  for (const c of candidates) {
    const it = importItem(c);
    if (!have.has(key(it))) {
      out.push(it);
      have.add(key(it));
    }
  }
  return out;
}

export function mergeNeedsHuman(existing, items) {
  const out = [...existing];
  const have = new Set(out.map((x) => `${x.claimId}|${x.documentId}`));
  for (const x of items) {
    const k = `${x.claimId}|${x.documentId}`;
    if (!have.has(k)) {
      out.push(x);
      have.add(k);
    }
  }
  return out;
}

/** Splits import items into files the import endpoint accepts (at most IMPORT_LIMIT items each). */
export function chunkImportItems(items, limit = IMPORT_LIMIT) {
  const chunks = [];
  for (let i = 0; i < items.length; i += limit) chunks.push(items.slice(i, i + limit));
  if (!chunks.length) chunks.push([]);
  return chunks.map((chunk, i) => ({ name: chunks.length === 1 ? "claim-verifications.import.json" : `claim-verifications.import-${String(i + 1).padStart(2, "0")}.json`, items: chunk }));
}
