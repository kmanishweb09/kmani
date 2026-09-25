#!/usr/bin/env node
/**
 * Finance Desk build.
 *
 *   node scripts/build.mjs [--dev] [--quiet]
 *
 * 1. Validates and compiles the research archive (data/archive) → .local/build/archive.json, research/ledger.json
 * 2. Bundles the browser app → release/assets (flat, finance-prefixed files only)
 * 3. Writes finance.html with hashed asset URLs and the CSP hash of the inline theme script
 * 4. Bundles the Worker module → release/server/finance.mjs (Workers APIs only)
 * 5. Copies migrations and integration examples into release/
 * 6. Builds the simulated host harness (.local/harness/worker.mjs) that embeds assets like the host build
 * 7. Writes bundle size measurements → release/reports/bundle-sizes.json
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import * as esbuild from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const DEV = args.has("--dev");
const QUIET = args.has("--quiet");
const log = (...m) => {
  if (!QUIET) console.log(...m);
};

const LOCAL = join(ROOT, ".local");
const BUILD = join(LOCAL, "build");
const RELEASE = join(ROOT, "release");
const ASSETS = join(RELEASE, "assets");
const SERVER_OUT = join(RELEASE, "server");
const DEBUG_MAPS = join(RELEASE, "debug-sourcemaps");

function sha256(buf, len = 64) {
  return createHash("sha256").update(buf).digest("hex").slice(0, len);
}

/**
 * Applies a package's `browser` field file map (e.g. @anthropic-ai/sdk swaps its Node-only helpers
 * for shims) when bundling the Worker with platform "neutral", which otherwise ignores that field.
 */
function browserFieldMap(packages) {
  return {
    name: "browser-field-map",
    setup(build) {
      const maps = new Map();
      for (const pkg of packages) {
        const root = join(ROOT, "node_modules", pkg);
        const pj = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
        if (pj.browser && typeof pj.browser === "object") {
          maps.set(root, Object.fromEntries(Object.entries(pj.browser).map(([from, to]) => [join(root, from), join(root, to)])));
        }
      }
      build.onResolve({ filter: /^\.\.?\// }, (args) => {
        for (const [root, map] of maps) {
          if (!args.importer.startsWith(root)) continue;
          const target = join(dirname(args.importer), args.path);
          const mapped = map[target] ?? map[`${target}.mjs`];
          if (mapped) return { path: mapped };
        }
        return undefined;
      });
    },
  };
}

function virtualModules(map) {
  return {
    name: "finance-virtual-modules",
    setup(b) {
      b.onResolve({ filter: /^virtual:/ }, (a) => ({ path: a.path, namespace: "finance-virtual" }));
      b.onLoad({ filter: /.*/, namespace: "finance-virtual" }, (a) => {
        if (!(a.path in map)) return { errors: [{ text: `Unknown virtual module ${a.path}` }] };
        const v = map[a.path];
        return typeof v === "string" ? { contents: v, loader: "js" } : { contents: JSON.stringify(v), loader: "json" };
      });
    },
  };
}

async function compileArchive() {
  mkdirSync(BUILD, { recursive: true });
  const outfile = join(BUILD, "archive-compiler.mjs");
  await esbuild.build({
    entryPoints: [join(ROOT, "scripts/lib/archive-entry.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    outfile,
    logLevel: "silent",
  });
  const mod = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
  const result = mod.buildArchive();
  if (result.issues.length) {
    console.error(`Archive validation failed with ${result.issues.length} issue(s):`);
    for (const i of result.issues.slice(0, 40)) console.error(`  ${i.collection}/${i.id} ${i.path}: ${i.message}`);
    process.exit(1);
  }
  if (result.compileError) {
    console.error(`Archive compile failed: ${result.compileError}`);
    process.exit(1);
  }
  const json = JSON.stringify(result.compiled);
  writeFileSync(join(BUILD, "archive.json"), json);
  // Machine-readable research ledger: one row per claim with its document provenance.
  const c = result.compiled;
  const ledger = Object.values(c.claims).map((cl) => {
    const d = c.documents[cl.documentId];
    return {
      claimId: cl.id,
      subject: `${cl.subject.type}:${cl.subject.id}`,
      field: cl.field,
      claim: cl.label,
      value: cl.display,
      sourceUrl: d.url,
      publisher: d.publisher,
      documentTitle: d.title,
      documentType: d.documentType,
      primarySource: d.isPrimary,
      publicationDate: d.publishedDate?.date ?? null,
      retrievedAt: d.retrievedAt,
      retrievalStatus: d.retrievalStatus,
      locator: cl.locator,
      excerpt: cl.excerpt,
      verificationStatus: cl.status,
      checkMethod: cl.method,
      checkedAt: cl.checkedAt,
      note: cl.note,
    };
  });
  mkdirSync(join(ROOT, "research"), { recursive: true });
  writeFileSync(join(ROOT, "research/ledger.json"), `${JSON.stringify({ archiveVersion: c.version, cutoff: c.cutoff, claims: ledger }, null, 1)}\n`);
  log(`archive: ${c.deals.length} deals, ${c.companies.length} companies, ${c.sectors.length} sectors, ${Object.keys(c.claims).length} claims → ${c.version}`);
  return result.compiled;
}

const THEME_SCRIPT =
  '(function(){var d=document.documentElement,t="dark";try{var s=localStorage.getItem("manish.finance.v1.theme");if(s==="light"||s==="dark")t=s}catch(e){}d.setAttribute("data-mf-theme",t)})();';

async function buildBrowser() {
  rmSync(ASSETS, { recursive: true, force: true });
  rmSync(DEBUG_MAPS, { recursive: true, force: true });
  mkdirSync(ASSETS, { recursive: true });
  const result = await esbuild.build({
    entryPoints: [join(ROOT, "src/main.tsx")],
    bundle: true,
    splitting: true,
    format: "esm",
    outdir: ASSETS,
    entryNames: "finance-app-[hash]",
    chunkNames: "finance-chunk-[hash]",
    assetNames: "finance-asset-[hash]",
    minify: !DEV,
    sourcemap: DEV ? "inline" : "external",
    target: ["es2020", "chrome100", "safari15", "firefox100"],
    jsx: "automatic",
    define: { "process.env.NODE_ENV": DEV ? '"development"' : '"production"' },
    metafile: true,
    legalComments: "none",
    logLevel: "warning",
  });
  const css = await esbuild.build({
    entryPoints: [join(ROOT, "src/styles/finance.css")],
    bundle: true,
    minify: !DEV,
    outfile: join(ASSETS, "finance.css"),
    logLevel: "warning",
    target: ["chrome100", "safari15", "firefox100"],
  });
  void css;
  // Move external source maps out of the public asset directory (debug handoff only).
  mkdirSync(DEBUG_MAPS, { recursive: true });
  for (const f of readdirSync(ASSETS)) {
    if (f.endsWith(".map")) {
      cpSync(join(ASSETS, f), join(DEBUG_MAPS, f));
      rmSync(join(ASSETS, f));
    }
  }
  const outputs = Object.entries(result.metafile.outputs).filter(([p]) => p.endsWith(".js"));
  const entry = outputs.find(([, o]) => o.entryPoint);
  if (!entry) throw new Error("No browser entry output");
  const entryFile = relative(ASSETS, join(ROOT, entry[0])).replace(/\\/g, "/");
  const cssHash = sha256(readFileSync(join(ASSETS, "finance.css")), 12);
  const scriptHash = createHash("sha256").update(THEME_SCRIPT).digest("base64");
  const html = `<!doctype html>
<html lang="en-IN" data-mf-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<meta name="robots" content="noindex">
<title>Finance Desk</title>
<script>${THEME_SCRIPT}</script>
<link rel="stylesheet" href="/finance.css?v=${cssHash}">
<script type="module" src="/${entryFile}"></script>
</head>
<body class="mf-body">
<div id="finance-root" class="finance-root">
<div class="mf-boot" aria-hidden="true"><div class="mf-boot-rail"></div><div class="mf-boot-main"><div class="mf-boot-bar"></div><div class="mf-boot-block"></div><div class="mf-boot-block short"></div></div></div>
<noscript><p class="mf-noscript">Finance Desk needs JavaScript to run. Research data is also available from <a href="/api/finance/deals">/api/finance/deals</a>.</p></noscript>
</div>
</body>
</html>
`;
  writeFileSync(join(ASSETS, "finance.html"), html);
  for (const f of readdirSync(ASSETS)) {
    if (!(f === "finance.html" || f === "finance.css" || /^finance-[A-Za-z0-9_-]+\.js$/.test(f))) {
      throw new Error(`Unexpected asset ${f}: release assets must be flat and finance-prefixed`);
    }
  }
  return { metafile: result.metafile, entryFile, scriptHash };
}

async function buildServer(archive, scriptHash, version) {
  rmSync(SERVER_OUT, { recursive: true, force: true });
  mkdirSync(SERVER_OUT, { recursive: true });
  const outfile = join(SERVER_OUT, "finance.mjs");
  const r = await esbuild.build({
    entryPoints: [join(ROOT, "server/index.ts")],
    bundle: true,
    platform: "neutral",
    mainFields: ["module", "main"],
    conditions: ["worker", "browser", "import"],
    format: "esm",
    target: "es2022",
    outfile,
    minify: false,
    treeShaking: true,
    legalComments: "none",
    metafile: true,
    banner: { js: `// Finance Desk Worker module ${version}. Generated by scripts/build.mjs; do not edit.\n// Exports: createFinance, classifyFinanceRequest, financePageResponse.` },
    plugins: [browserFieldMap(["@anthropic-ai/sdk"]), virtualModules({ "virtual:finance-archive": archive, "virtual:finance-build-info": { version, pageScriptHash: scriptHash, archiveVersion: archive.version } })],
    logLevel: "warning",
  });
  const code = readFileSync(outfile, "utf8");
  // Finance code: no Node imports, no process.env, no __dirname. Dependencies: no Node imports at all;
  // their feature-detected `globalThis.process` reads (e.g. the Anthropic SDK's optional log level) are allowed.
  const strict = [/from\s+["']node:/, /require\(["'](fs|path|child_process|os|net)["']\)/, /\bprocess\.env\b/, /__dirname/];
  const deps = [/from\s+["']node:/, /require\(["'](node:)?(fs|path|child_process|os|net)["']\)/, /(?<![`'"])\bimport\(["']node:/];
  const parts = code.split(/^\/\/ ((?:node_modules|server|shared|data)\/\S+)$/m);
  for (let i = 0; i < parts.length; i++) {
    const isPath = i % 2 === 1;
    if (isPath) continue;
    const owner = i === 0 ? "(banner)" : parts[i - 1];
    const rules = owner.startsWith("node_modules/") ? deps : strict;
    for (const re of rules) {
      if (re.test(parts[i])) throw new Error(`finance.mjs contains a Node-only construct matching ${re} in ${owner}`);
    }
  }
  return r.metafile;
}

function copyRelease() {
  const mig = join(RELEASE, "migrations");
  rmSync(mig, { recursive: true, force: true });
  mkdirSync(mig, { recursive: true });
  for (const f of readdirSync(join(ROOT, "migrations"))) {
    if (f.endsWith(".sql") || f.endsWith(".ts") || f.endsWith(".md")) cpSync(join(ROOT, "migrations", f), join(mig, f));
  }
  const integ = join(RELEASE, "integration");
  rmSync(integ, { recursive: true, force: true });
  if (existsSync(join(ROOT, "integration"))) cpSync(join(ROOT, "integration"), integ, { recursive: true });
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".webp": "image/webp" };

async function buildHarness() {
  // Mirrors the host build: read supported files in the top level of dist/ and embed them in SITE_ASSETS.
  const dist = join(LOCAL, "harness-dist");
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  for (const f of readdirSync(join(ROOT, "harness/dist"))) cpSync(join(ROOT, "harness/dist", f), join(dist, f));
  for (const f of readdirSync(ASSETS)) cpSync(join(ASSETS, f), join(dist, f));
  const assets = {};
  for (const f of readdirSync(dist)) {
    const p = join(dist, f);
    if (!statSync(p).isFile()) continue;
    const ext = f.slice(f.lastIndexOf("."));
    if (!(ext in MIME)) continue;
    assets[f] = ext === ".webp" ? { type: MIME[ext], base64: readFileSync(p).toString("base64") } : { type: MIME[ext], text: readFileSync(p, "utf8") };
  }
  const outDir = join(LOCAL, "harness");
  mkdirSync(outDir, { recursive: true });
  await esbuild.build({
    entryPoints: [join(ROOT, "harness/entry.mjs")],
    bundle: true,
    platform: "neutral",
    mainFields: ["module", "main"],
    format: "esm",
    target: "es2022",
    outfile: join(outDir, "worker.mjs"),
    plugins: [virtualModules({ "virtual:site-assets": assets })],
    logLevel: "warning",
  });
  return join(outDir, "worker.mjs");
}

function sizes(browserMeta, entryFile) {
  const files = readdirSync(ASSETS).map((f) => {
    const buf = readFileSync(join(ASSETS, f));
    return { file: f, bytes: buf.length, gzipBytes: gzipSync(buf, { level: 9 }).length };
  });
  // Initial JS = entry + statically imported chunks (dynamic imports excluded).
  const outputs = browserMeta.outputs;
  const key = Object.keys(outputs).find((k) => k.endsWith(entryFile));
  const initial = new Set();
  const visit = (k) => {
    if (!k || initial.has(k)) return;
    initial.add(k);
    for (const imp of outputs[k]?.imports ?? []) if (imp.kind === "import-statement") visit(imp.path);
  };
  visit(key);
  const initialFiles = [...initial].map((k) => k.split("/").pop());
  const initialGzip = files.filter((f) => initialFiles.includes(f.file)).reduce((s, f) => s + f.gzipBytes, 0);
  const cssGzip = files.find((f) => f.file === "finance.css")?.gzipBytes ?? 0;
  const server = readFileSync(join(SERVER_OUT, "finance.mjs"));
  const harness = existsSync(join(LOCAL, "harness/worker.mjs")) ? readFileSync(join(LOCAL, "harness/worker.mjs")) : Buffer.alloc(0);
  return {
    measuredAt: new Date().toISOString(),
    browser: {
      files,
      initialJsFiles: initialFiles,
      initialJsGzipBytes: initialGzip,
      cssGzipBytes: cssGzip,
      totalGzipBytes: files.reduce((s, f) => s + f.gzipBytes, 0),
      budgetInitialJsGzipBytes: 300 * 1024,
    },
    server: { file: "release/server/finance.mjs", bytes: server.length, gzipBytes: gzipSync(server, { level: 9 }).length },
    combinedHarnessWorker: {
      file: ".local/harness/worker.mjs",
      note: "Simulated host bundle: host sentinels + embedded finance assets + finance module. Compare with the real host's Worker size limit.",
      bytes: harness.length,
      gzipBytes: gzipSync(harness, { level: 9 }).length,
    },
  };
}

const start = Date.now();
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const archive = await compileArchive();
const browser = await buildBrowser();
await buildServer(archive, browser.scriptHash, pkg.version);
copyRelease();
await buildHarness();
const report = sizes(browser.metafile, browser.entryFile);
mkdirSync(join(RELEASE, "reports"), { recursive: true });
writeFileSync(join(RELEASE, "reports/bundle-sizes.json"), `${JSON.stringify(report, null, 2)}\n`);
log(
  `build ${DEV ? "(dev) " : ""}ok in ${Date.now() - start} ms · initial JS ${(report.browser.initialJsGzipBytes / 1024).toFixed(1)} KB gz · CSS ${(report.browser.cssGzipBytes / 1024).toFixed(1)} KB gz · finance.mjs ${(report.server.gzipBytes / 1024).toFixed(1)} KB gz`,
);
