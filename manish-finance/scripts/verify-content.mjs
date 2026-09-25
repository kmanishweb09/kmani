#!/usr/bin/env node
/**
 * npm run verify:content — validates the research archive and reports, separately: content counts
 * (SPEC.md §12 targets), integrity (schema, citations, references, claim-ID stability), evidence quality
 * (how claims were actually verified) and numeric coverage. Writes release/reports/content-verification.json,
 * keeps research/claim-registry.json up to date, and exits non-zero on any error-level check.
 * Usage: node scripts/verify-content.mjs [--today YYYY-MM-DD] [--accept-relabel]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const todayArg = args.includes("--today") ? args[args.indexOf("--today") + 1] : null;
const today = todayArg && /^\d{4}-\d{2}-\d{2}$/.test(todayArg) ? todayArg : new Date().toISOString().slice(0, 10);
const REGISTRY = join(ROOT, "research/claim-registry.json");
const RETRIEVAL_LOG = join(ROOT, "research/primary-evidence/retrieval-log.json");
const readJson = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null);

const outfile = join(ROOT, ".local/build/verify-content.mjs");
mkdirSync(dirname(outfile), { recursive: true });
await esbuild.build({ entryPoints: [join(ROOT, "scripts/lib/verify-entry.ts")], bundle: true, platform: "node", format: "esm", target: "node22", outfile, logLevel: "silent" });
const { verifyContent, SECTION_TITLE } = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
const result = verifyContent(today, { registry: readJson(REGISTRY), acceptRelabel: args.includes("--accept-relabel"), retrievalLog: readJson(RETRIEVAL_LOG) });

const pad = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));
const mark = (c) => (c.severity === "info" ? "INFO" : c.ok ? "PASS" : c.severity === "error" ? "FAIL" : "WARN");
console.log(`Content verification (build date ${today}, ${result.counts.archiveVersion ?? "archive did not compile"})`);
const summary = {};
for (const section of Object.keys(SECTION_TITLE)) {
  const list = result.checks.filter((c) => c.section === section);
  if (!list.length) continue;
  console.log(`\n${SECTION_TITLE[section]}`);
  for (const c of list) {
    console.log(`${mark(c)}  ${pad(c.label, 96)} target ${pad(c.target, 22)} actual ${c.actual}`);
    if (!c.ok && c.detail?.length) for (const d of c.detail.slice(0, 8)) console.log(`        · ${d}`);
    if (!c.ok && c.detail?.length > 8) console.log(`        · … ${c.detail.length - 8} more in the JSON report`);
  }
  summary[section] = { pass: list.filter((c) => c.severity !== "info" && c.ok).length, warn: list.filter((c) => !c.ok && c.severity === "warning").length, fail: list.filter((c) => !c.ok && c.severity === "error").length, info: list.filter((c) => c.severity === "info").length };
}

const reg = result.registry;
if (reg?.next) writeFileSync(REGISTRY, `${JSON.stringify(reg.next, null, 1)}\n`);
const failed = result.checks.filter((c) => !c.ok && c.severity === "error");
const warned = result.checks.filter((c) => !c.ok && c.severity === "warning");
mkdirSync(join(ROOT, "release/reports"), { recursive: true });
const { registry: _r, ...report } = result;
const sections = Object.fromEntries(Object.keys(SECTION_TITLE).map((s) => [s, { title: SECTION_TITLE[s], ...summary[s], checks: result.checks.filter((c) => c.section === s) }]));
writeFileSync(
  join(ROOT, "release/reports/content-verification.json"),
  `${JSON.stringify({ checkedAt: new Date().toISOString(), buildDate: today, summary, sections, ...report, claimRegistry: reg ? { registered: reg.registered, added: reg.added.length, missing: reg.missing.length, relabelled: reg.relabelled.length, valueChanged: reg.valueChanged.length, retired: reg.retired, written: Boolean(reg.next) } : null }, null, 2)}\n`,
);
const ev = result.evidence ?? {};
console.log(`\n${Object.entries(summary).map(([s, v]) => `${s}: ${v.pass} pass, ${v.warn} warn, ${v.fail} fail`).join(" · ")}`);
if (ev.claimStatus) console.log(`Verification: ${ev.claimsChecked} of ${result.counts.claims} claims source-checked or human-reviewed; ${ev.documentsRetrieved} of ${ev.documents} documents retrieved. Passing content counts does not mean the content is source-verified.`);
if (reg && !reg.next) console.log("Claim registry NOT updated: fix the identifier problems above first.");
console.log(`${warned.length} warnings, ${failed.length} failed → release/reports/content-verification.json`);
process.exit(failed.length ? 1 : 0);
