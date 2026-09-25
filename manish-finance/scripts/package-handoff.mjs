#!/usr/bin/env node
/**
 * npm run package:handoff
 *
 * 1. Runs a clean production build (never packages a dev build).
 * 2. Writes release/manifest.json: version, source commit (or a deterministic source-tree hash when the
 *    tree has uncommitted changes or no Git), build time, runtime assumptions, exact asset/module/migration
 *    paths with sizes and SHA-256, and configuration names. No secrets, account IDs or signed URLs.
 * 3. Writes release/SHA256SUMS for the deployable files and the manifest (never for itself).
 * 4. Creates manish-finance-handoff.zip with the source project and release/ (no node_modules, .git, .local,
 *    .env files, test output or the ZIP itself).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RELEASE = join(ROOT, "release");
const ZIP = join(ROOT, "manish-finance-handoff.zip");
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const posix = (p) => p.split(sep).join("/");

console.log("1/4 clean production build");
execFileSync(process.execPath, [join(ROOT, "scripts/build.mjs")], { stdio: "inherit", cwd: ROOT });

// ---------------------------------------------------------------- source identity
const EXCLUDE_DIRS = new Set(["node_modules", ".git", ".local", "test-results", "playwright-report", "release"]);
function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const rel = posix(relative(ROOT, full));
    const st = statSync(full);
    if (st.isDirectory()) {
      if (EXCLUDE_DIRS.has(name) && dirname(full) === ROOT) continue;
      if (name === "node_modules" || name === ".git") continue;
      walk(full, out);
    } else if (!/^\.env($|\.)/.test(name) || name === ".env.example") {
      if (rel.endsWith(".zip")) continue;
      out.push(rel);
    }
  }
  return out;
}
const sourceFiles = walk(ROOT);
const treeHash = sha256(sourceFiles.map((f) => `${f}\0${sha256(readFileSync(join(ROOT, f)))}\n`).join(""));
let commit = null;
let dirty = null;
try {
  commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  dirty = execFileSync("git", ["status", "--porcelain", "--", "."], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((l) => l.trim() && !/\srelease\//.test(l) && !l.endsWith(".zip")).length > 0;
} catch {
  commit = null;
}

// ---------------------------------------------------------------- manifest
console.log("2/4 manifest");
const fileEntry = (rel) => {
  const buf = readFileSync(join(ROOT, rel));
  return { path: rel, bytes: buf.length, sha256: sha256(buf) };
};
const list = (sub) => (existsSync(join(RELEASE, sub)) ? readdirSync(join(RELEASE, sub)).sort().map((f) => `release/${sub}/${f}`) : []);
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const sizes = JSON.parse(readFileSync(join(RELEASE, "reports/bundle-sizes.json"), "utf8"));
const html = readFileSync(join(RELEASE, "assets/finance.html"), "utf8");
const manifest = {
  name: "manish-finance",
  product: "Finance Desk",
  version: pkg.version,
  builtAt: new Date().toISOString(),
  source: {
    gitCommit: commit,
    workingTreeClean: commit ? !dirty : null,
    treeSha256: treeHash,
    treeHashMethod: "sha256 over sorted 'path\\0sha256(content)\\n' lines of the packaged source files (release/, node_modules/, .local/, .git and .env files excluded)",
  },
  build: { node: process.version, command: "npm ci && npm run package:handoff", archiveVersion: (/archive-[0-9a-z-]+/.exec(readFileSync(join(RELEASE, "server/finance.mjs"), "utf8")) ?? [null])[0] },
  runtime: {
    module: "release/server/finance.mjs",
    format: "ES module for Cloudflare Workers (Workers APIs only; no Node built-ins, no process.env)",
    exports: ["createFinance", "classifyFinanceRequest", "financePageResponse"],
    requires: { d1Binding: "DB", hostIdentity: "getUser(request) from the existing host" },
    routes: { pages: "/finance and /finance/*", api: "/api/finance and /api/finance/*", assets: "/finance.html, /finance.css, /finance-*.js" },
    assetEntry: (/src="\/(finance-app-[A-Za-z0-9]+\.js)"/.exec(html) ?? [null, null])[1],
  },
  assets: list("assets").map(fileEntry),
  server: [fileEntry("release/server/finance.mjs")],
  migrations: list("migrations").map(fileEntry),
  integration: list("integration").map(fileEntry),
  debugSourceMaps: { path: "release/debug-sourcemaps/", note: "For debugging only; do not publish as site assets." },
  sizes: { initialJsGzipBytes: sizes.browser.initialJsGzipBytes, allBrowserAssetsGzipBytes: sizes.browser.totalGzipBytes, serverModuleGzipBytes: sizes.server.gzipBytes, simulatedCombinedHostWorkerGzipBytes: sizes.combinedHarnessWorker.gzipBytes },
  configuration: {
    required: ["DB (host D1 binding)", "FINANCE_OWNER_USER_ID", "FINANCE_PUBLIC_ORIGIN"],
    recommended: ["FINANCE_JOB_SECRET", "FINANCE_SEC_USER_AGENT"],
    optional: ["FINANCE_SCHEDULE_EXPECTED_MINUTES", "FINANCE_AI_PROVIDER", "FINANCE_AI_MODEL", "FINANCE_AI_API_KEY", "FINANCE_AI_DAILY_BUDGET", "FINANCE_AI_PRICE_INPUT_PER_MTOK", "FINANCE_AI_PRICE_OUTPUT_PER_MTOK", "FINANCE_AI_PRICE_DATE", "FINANCE_AI_MAX_OUTPUT_TOKENS", "FINANCE_AI_DAILY_REQUESTS"],
    secrets: ["FINANCE_JOB_SECRET", "FINANCE_AI_API_KEY"],
  },
  verification: "See release/reports/ACCEPTANCE_REPORT.md. Integration verified in a simulated host only; not deployed.",
};
writeFileSync(join(RELEASE, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

// ---------------------------------------------------------------- checksums
console.log("3/4 SHA256SUMS");
const deployables = [...manifest.assets, ...manifest.server, ...manifest.migrations, ...manifest.integration].map((f) => f.path);
const sums = [...deployables, "release/manifest.json"].map((rel) => `${sha256(readFileSync(join(ROOT, rel)))}  ${rel.replace(/^release\//, "")}`).join("\n");
writeFileSync(join(RELEASE, "SHA256SUMS"), `${sums}\n`);

// ---------------------------------------------------------------- zip
console.log("4/4 zip");
const releaseFiles = [];
(function walkRelease(dir) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkRelease(full);
    else releaseFiles.push(posix(relative(ROOT, full)));
  }
})(RELEASE);
const entries = {};
for (const rel of [...sourceFiles, ...releaseFiles]) {
  const buf = readFileSync(join(ROOT, rel));
  entries[`manish-finance/${rel}`] = [new Uint8Array(buf), { level: /\.(png|zip|gz)$/.test(rel) ? 0 : 6, mtime: new Date("2026-09-25T00:00:00Z") }];
}
const zipped = zipSync(entries);
writeFileSync(ZIP, zipped);
console.log(`\n${Object.keys(entries).length} files → ${posix(relative(process.cwd(), ZIP))} (${(zipped.length / 1024 / 1024).toFixed(1)} MB)`);
console.log(`source ${commit ? `${commit.slice(0, 12)}${dirty ? " (uncommitted changes present)" : ""}` : "(no git)"} · tree ${treeHash.slice(0, 16)}`);
