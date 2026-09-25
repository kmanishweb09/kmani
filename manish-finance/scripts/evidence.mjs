#!/usr/bin/env node
// Primary-evidence workflow for the research archive (no AI, no paid APIs).
//
//   npm run evidence:worklist            prioritised list of claims and documents to check (autopsies first)
//   npm run evidence:retrieve -- [--tier 1] [--limit 40] [--dry]
//        fetches documents in worklist order (robots.txt honoured, one request at a time, polite delays,
//        identifying User-Agent from FINANCE_EVIDENCE_USER_AGENT), records every attempt with its real
//        timestamps, and matches each claim's value in the retrieved text. Matches become claim-verification
//        drafts in an import file for the owner to review in Research maintenance — nothing is published here.
//
// Never bypasses access restrictions: paywalls, sign-in pages, 401/402/403, CAPTCHAs and robots.txt
// disallows are recorded as access-restricted and not retried by other routes. Only a hash of each
// retrieved document and short (≤300-character) excerpts are kept.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findEvidence, htmlToParagraphs, plainTextToParagraphs, robotsAllows } from "./lib/evidence-match.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "research/primary-evidence");
const ARCHIVE = join(ROOT, ".local/build/archive.json");
const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? true) : dflt;
};

if (!existsSync(ARCHIVE)) {
  console.error("Run `npm run build` first (needs .local/build/archive.json).");
  process.exit(1);
}
const archive = JSON.parse(readFileSync(ARCHIVE, "utf8"));
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- prioritisation

const HEADLINE = ["enterprise_value", "equity_value", "stake_consideration", "value_unclear_basis"];
/** Lower rank = more consequential. */
function fieldRank(deal, claim) {
  const f = claim.field;
  if (f.startsWith("terms.")) {
    const t = deal.terms[Number(f.split(".")[1])];
    if (t && (t.headline || HEADLINE.includes(t.metric))) return 0;
    return 1;
  }
  if (f === "status" || f === "effective") return 1;
  if (f.startsWith("events.")) {
    const e = deal.events[Number(f.split(".")[1])];
    return e && ["completion", "termination", "withdrawal", "regulatory_decision", "regulatory_approval", "revision", "open_offer"].includes(e.type) ? 1 : 5;
  }
  if (f === "stake" || f === "payment" || f.startsWith("asAnnounced.")) return 2;
  if (f === "announced") return 3;
  if (f === "acquirer" || f === "target" || f.startsWith("autopsy.facts")) return 4;
  if (f.startsWith("otherParties") || f === "financing") return 5;
  return 6;
}
const RANK_LABEL = ["Headline value", "Other material term / status / key event", "Stake, consideration", "Announcement date", "Parties, autopsy outcome facts", "Counterparties, financing, other events", "Rationale, advisers, context"];
const CHECKED = new Set(["source_checked", "human_reviewed"]);

function buildWorklist() {
  const claims = Object.values(archive.claims);
  const docs = archive.documents;
  const dealById = new Map(archive.deals.map((d) => [d.id, d]));
  const byDoc = new Map();
  const items = [];
  for (const c of claims) {
    if (c.subject.type !== "deal" || CHECKED.has(c.status)) continue;
    const deal = dealById.get(c.subject.id);
    if (!deal) continue;
    const tier = deal.autopsy ? 1 : 2;
    const rank = fieldRank(deal, c);
    const doc = docs[c.documentId];
    const item = { claimId: c.id, dealId: deal.id, dealTitle: deal.title, tier, rank, rankLabel: RANK_LABEL[rank], field: c.field, label: c.label, display: c.display, status: c.status, documentId: c.documentId, primary: Boolean(doc?.isPrimary) };
    items.push(item);
    const list = byDoc.get(c.documentId) ?? [];
    list.push(item);
    byDoc.set(c.documentId, list);
  }
  // A consequential claim whose only sources are secondary needs a primary document found first.
  const claimDocs = new Map();
  for (const c of claims) claimDocs.set(`${c.subject.id}|${c.field}`, [...(claimDocs.get(`${c.subject.id}|${c.field}`) ?? []), docs[c.documentId]]);
  for (const it of items) it.onlySecondarySources = !(claimDocs.get(`${it.dealId}|${it.field}`) ?? []).some((d) => d?.isPrimary);
  const documents = [...byDoc.entries()]
    .map(([id, list]) => {
      const d = docs[id];
      const tier = Math.min(...list.map((x) => x.tier));
      const rank = Math.min(...list.map((x) => x.rank));
      return { documentId: id, url: d.url, publisher: d.publisher, title: d.title, documentType: d.documentType, isPrimary: d.isPrimary, publishedDate: d.publishedDate?.date ?? null, retrievalStatus: d.retrievalStatus, tier, bestRank: rank, claims: list.sort((a, b) => a.rank - b.rank).map((x) => x.claimId) };
    })
    .sort((a, b) => a.tier - b.tier || a.bestRank - b.bestRank || Number(b.isPrimary) - Number(a.isPrimary) || a.documentId.localeCompare(b.documentId));
  const byStatus = {};
  for (const c of claims) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
  const consequential = items.filter((x) => x.rank <= 2);
  return {
    generatedAt: new Date().toISOString(),
    archiveVersion: archive.version,
    counts: {
      claimsTotal: claims.length,
      claimsByStatus: byStatus,
      dealClaimsNeedingPrimaryCheck: items.length,
      consequentialDealClaims: consequential.length,
      consequentialOnlySecondary: consequential.filter((x) => x.onlySecondarySources).length,
      tier1Claims: items.filter((x) => x.tier === 1).length,
      documentsToRetrieve: documents.length,
      primaryDocumentsToRetrieve: documents.filter((d) => d.isPrimary).length,
    },
    documents,
    claims: items.sort((a, b) => a.tier - b.tier || a.dealId.localeCompare(b.dealId) || a.rank - b.rank),
  };
}

function worklistMarkdown(w, log) {
  const lastAttempt = new Map();
  for (const e of log?.attempts ?? []) lastAttempt.set(e.documentId, e);
  const lines = [
    "# Primary-evidence worklist",
    "",
    `Generated ${w.generatedAt} from ${w.archiveVersion}. Autopsy deals (tier 1) first, then the remaining deals; within a deal the most consequential fields first. Regenerate with \`npm run evidence:worklist\`.`,
    "",
    "## Counts",
    "",
    "| Measure | Count |",
    "|---|---|",
    ...Object.entries(w.claimsByStatusOverride ?? w.counts.claimsByStatus).map(([k, v]) => `| Claims ${k.replace(/_/g, " ")} (all subjects) | ${v} |`),
    `| Deal claims awaiting a primary-document check | ${w.counts.dealClaimsNeedingPrimaryCheck} |`,
    `| …of which consequential (value, material terms, status, stake, consideration) | ${w.counts.consequentialDealClaims} |`,
    `| …consequential claims supported only by secondary sources | ${w.counts.consequentialOnlySecondary} |`,
    `| Documents to retrieve (primary) | ${w.counts.documentsToRetrieve} (${w.counts.primaryDocumentsToRetrieve}) |`,
    "",
    "## Tier 1: deep autopsies — consequential claims",
    "",
    "| Deal | Field | Recorded value | Status | Source | Last retrieval attempt |",
    "|---|---|---|---|---|---|",
  ];
  const docs = archive.documents;
  for (const c of w.claims.filter((x) => x.tier === 1 && x.rank <= 2)) {
    const d = docs[c.documentId];
    const a = lastAttempt.get(c.documentId);
    lines.push(`| ${c.dealId} | ${c.label} | ${String(c.display).replace(/\|/g, "/").slice(0, 80)} | ${c.status.replace(/_/g, " ")} | ${d.isPrimary ? "primary" : "secondary"}: [${d.publisher}](${d.url}) | ${a ? `${a.outcome} (${a.attemptedAt})` : "not attempted"} |`);
  }
  lines.push("", "## Documents in retrieval order (first 60)", "", "| # | Tier | Document | Primary | Claims | Last attempt |", "|---|---|---|---|---|---|");
  w.documents.slice(0, 60).forEach((d, i) => {
    const a = lastAttempt.get(d.documentId);
    lines.push(`| ${i + 1} | ${d.tier} | [${d.title.replace(/\|/g, "/").slice(0, 70)}](${d.url}) | ${d.isPrimary ? "yes" : "no"} | ${d.claims.length} | ${a ? `${a.outcome} ${a.attemptedAt}` : "—"} |`);
  });
  lines.push("", "Statuses change only when the owner publishes a claim verification (Research maintenance). A search result alone never upgrades a claim.", "");
  return lines.join("\n");
}

// ---------------------------------------------------------------- retrieval

const EGRESS_MARKERS = /host not in allowlist|x-deny-reason/i;
const RESTRICTED_MARKERS = /(subscribe to (continue|read)|sign in to (continue|read)|log ?in to (continue|read)|captcha|are you a robot|access denied|enable javascript and cookies to continue)/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url, ua, timeoutMs = 20_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { "User-Agent": ua, Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,application/pdf;q=0.5" }, redirect: "follow", signal: ctrl.signal });
    const type = res.headers.get("content-type") ?? "";
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, type, buf, finalUrl: res.url, denyReason: res.headers.get("x-deny-reason") };
  } finally {
    clearTimeout(t);
  }
}

async function retrieve() {
  const ua = process.env.FINANCE_EVIDENCE_USER_AGENT;
  const dry = Boolean(opt("dry", false));
  if (!ua && !dry) {
    console.error("Set FINANCE_EVIDENCE_USER_AGENT to an identifying User-Agent with a contact address (required by SEC fair-access rules), e.g. \"FinanceDesk research contact@example.com\".");
    process.exit(2);
  }
  const tier = Number(opt("tier", 0)) || null;
  const limit = Number(opt("limit", 40));
  const w = buildWorklist();
  const docs = w.documents.filter((d) => !tier || d.tier === tier).slice(0, limit);
  const logPath = join(OUT, "retrieval-log.json");
  const log = existsSync(logPath) ? JSON.parse(readFileSync(logPath, "utf8")) : { format: "finance-evidence-retrieval-log-v1", attempts: [] };
  const hostState = new Map();
  const candidates = [];
  const needsHuman = [];
  console.log(`${dry ? "Dry run: would retrieve" : "Retrieving"} ${docs.length} documents (${tier ? `tier ${tier}` : "all tiers"})`);
  for (const d of docs) {
    const u = new URL(d.url);
    if (dry) {
      console.log(`  ${d.url}  (${d.claims.length} claims)`);
      continue;
    }
    const host = u.host;
    const st = hostState.get(host) ?? { blocked: null, robots: undefined, last: 0 };
    hostState.set(host, st);
    const attemptedAt = new Date().toISOString();
    const entry = { documentId: d.documentId, url: d.url, attemptedAt, finishedAt: null, outcome: null, httpStatus: null, contentType: null, bytes: null, sha256: null, detail: null, userAgent: ua };
    try {
      if (st.blocked) {
        Object.assign(entry, { outcome: st.blocked.outcome, detail: `Not requested: ${st.blocked.detail} (same host, earlier in this run)` });
      } else {
        const wait = st.last + 2_000 - Date.now();
        if (wait > 0) await sleep(wait);
        if (st.robots === undefined) {
          try {
            const r = await fetchText(`${u.protocol}//${host}/robots.txt`, ua, 10_000);
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
          await sleep(Math.max(0, st.last + 2_000 - Date.now()));
          const r = await fetchText(d.url, ua);
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
                const c = archive.claims[id];
                const m = findEvidence(paras, c.display);
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
    log.attempts.push(entry);
    console.log(`  ${entry.outcome.padEnd(22)} ${d.url}`);
  }
  if (dry) return;
  writeFileSync(logPath, `${JSON.stringify(log, null, 1)}\n`);
  const importFile = {
    format: "finance-research-import-v1",
    note: "Generated by npm run evidence:retrieve. Each item proposes a source check for a claim whose recorded value was found in the retrieved document. Import into Research maintenance, compare each excerpt with the document, then publish the drafts you confirm.",
    items: candidates.map((c) => ({ kind: "claim_verification", payload: { claimId: c.claimId, status: "source_checked", checkedValue: c.checkedValue, locator: c.locator, excerpt: c.excerpt, retrievedAt: c.retrievedAt.replace(/\.\d+Z$/, "Z"), note: null }, evidence: { documents: [] } })),
  };
  writeFileSync(join(OUT, "claim-verifications.import.json"), `${JSON.stringify(importFile, null, 1)}\n`);
  writeFileSync(join(OUT, "needs-human-check.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), items: needsHuman }, null, 1)}\n`);
  const outcomes = {};
  for (const a of log.attempts.slice(-docs.length)) outcomes[a.outcome] = (outcomes[a.outcome] ?? 0) + 1;
  console.log(`Outcomes this run: ${JSON.stringify(outcomes)}. Candidate source checks: ${candidates.length}. Needs human check: ${needsHuman.length}.`);
  writeFileSync(join(OUT, "WORKLIST.md"), worklistMarkdown(w, log));
}

if (cmd === "worklist") {
  const w = buildWorklist();
  const logPath = join(OUT, "retrieval-log.json");
  const log = existsSync(logPath) ? JSON.parse(readFileSync(logPath, "utf8")) : null;
  writeFileSync(join(OUT, "worklist.json"), `${JSON.stringify(w, null, 1)}\n`);
  writeFileSync(join(OUT, "WORKLIST.md"), worklistMarkdown(w, log));
  console.log(`worklist: ${w.counts.dealClaimsNeedingPrimaryCheck} deal claims (${w.counts.consequentialDealClaims} consequential, ${w.counts.tier1Claims} in autopsies) across ${w.documents.length} documents → research/primary-evidence/`);
} else if (cmd === "retrieve") {
  await retrieve();
} else {
  console.error("Usage: node scripts/evidence.mjs worklist | retrieve [--tier 1] [--limit 40] [--dry]");
  process.exit(1);
}
