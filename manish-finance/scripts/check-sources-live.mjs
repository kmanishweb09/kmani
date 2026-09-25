#!/usr/bin/env node
/**
 * npm run check:sources:live — fetches each registered connector endpoint once from this machine with
 * the Worker's fetch guard and parsers, and writes release/reports/live-source-check.json.
 * FINANCE_SEC_USER_AGENT must be set (real contact) for the SEC check. This is a live network test:
 * results depend on where it runs. The deployed Worker records its own live_verified_at per source.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = join(ROOT, ".local/build/live-check.mjs");
mkdirSync(dirname(outfile), { recursive: true });
await esbuild.build({ entryPoints: [join(ROOT, "scripts/lib/live-check-entry.ts")], bundle: true, platform: "node", format: "esm", target: "node22", outfile, logLevel: "silent" });
const { runLiveCheck } = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
const results = await runLiveCheck({ secUserAgent: process.env.FINANCE_SEC_USER_AGENT?.trim() || null });
for (const r of results) console.log(`${r.outcome.padEnd(15)} ${String(r.httpStatus ?? "—").padEnd(4)} ${r.sourceId.padEnd(24)} ${r.items ?? ""} ${r.sample ?? r.note ?? ""}`);
mkdirSync(join(ROOT, "release/reports"), { recursive: true });
writeFileSync(join(ROOT, "release/reports/live-source-check.json"), `${JSON.stringify({ ranAt: new Date().toISOString(), environment: process.env.FINANCE_LIVE_CHECK_LABEL ?? "unlabelled machine", results }, null, 2)}\n`);
const ok = results.filter((r) => r.outcome === "ok").length;
console.log(`\n${ok} of ${results.length} connectors returned parseable data from this machine → release/reports/live-source-check.json`);
