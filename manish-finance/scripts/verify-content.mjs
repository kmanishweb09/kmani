#!/usr/bin/env node
/**
 * npm run verify:content — validates the research archive against SPEC.md §12 targets and evidence
 * rules. Writes release/reports/content-verification.json and exits non-zero on any error-level check.
 * Usage: node scripts/verify-content.mjs [--today YYYY-MM-DD]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const todayArg = args.includes("--today") ? args[args.indexOf("--today") + 1] : null;
const today = todayArg && /^\d{4}-\d{2}-\d{2}$/.test(todayArg) ? todayArg : new Date().toISOString().slice(0, 10);

const outfile = join(ROOT, ".local/build/verify-content.mjs");
mkdirSync(dirname(outfile), { recursive: true });
await esbuild.build({ entryPoints: [join(ROOT, "scripts/lib/verify-entry.ts")], bundle: true, platform: "node", format: "esm", target: "node22", outfile, logLevel: "silent" });
const { verifyContent } = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
const result = verifyContent(today);

const pad = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));
console.log(`Content verification (build date ${today})\n`);
for (const c of result.checks) {
  const mark = c.ok ? "PASS" : c.severity === "error" ? "FAIL" : "WARN";
  console.log(`${mark}  ${pad(c.label, 92)} target ${pad(c.target, 18)} actual ${c.actual}`);
  if (!c.ok && c.detail?.length) for (const d of c.detail.slice(0, 10)) console.log(`        · ${d}`);
}
const failed = result.checks.filter((c) => !c.ok && c.severity === "error");
const warned = result.checks.filter((c) => !c.ok && c.severity === "warning");
mkdirSync(join(ROOT, "release/reports"), { recursive: true });
writeFileSync(join(ROOT, "release/reports/content-verification.json"), `${JSON.stringify({ checkedAt: new Date().toISOString(), buildDate: today, ...result }, null, 2)}\n`);
console.log(`\n${result.checks.length - failed.length - warned.length} passed, ${warned.length} warnings, ${failed.length} failed → release/reports/content-verification.json`);
process.exit(failed.length ? 1 : 0);
