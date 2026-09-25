#!/usr/bin/env node
/**
 * Local preview: builds (dev mode), starts the simulated host in workerd with a persistent local D1
 * (.local/dev-d1) and rebuilds on changes. Open http://localhost:8787/finance.
 *
 * Identity: the harness sign-in page offers a local owner (dev-owner) or non-owner (dev-visitor)
 * identity. This adapter exists only in harness/ and is never part of release/server/finance.mjs.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, watch } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startHost } from "./lib/miniflare-host.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT ?? 8787);
const build = () => execFileSync(process.execPath, [join(ROOT, "scripts/build.mjs"), "--dev"], { stdio: "inherit" });

build();
mkdirSync(join(ROOT, ".local/dev-d1"), { recursive: true });
const host = await startHost({
  root: ROOT,
  port: PORT,
  persistDir: join(ROOT, ".local/dev-d1"),
  bindings: { FINANCE_PUBLIC_ORIGIN: `http://localhost:${PORT}` },
});
console.log(`\nFinance Desk (simulated host) → http://localhost:${PORT}/finance`);
console.log(`Local sign-in: http://localhost:${PORT}/signin-with-chatgpt?return_to=/finance`);
console.log("Maintenance secret for local runs is random per start; see scripts/dev.mjs.\n");

let timer = null;
let building = false;
const onChange = () => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    if (building) return;
    building = true;
    try {
      build();
      await host.mf.setOptions(host.options);
      console.log("Rebuilt and reloaded.");
    } catch (e) {
      console.error("Rebuild failed:", e.message);
    } finally {
      building = false;
    }
  }, 250);
};
if (process.env.FINANCE_DEV_WATCH !== "0") {
  for (const d of ["src", "server", "shared", "data", "harness"]) {
    try {
      watch(join(ROOT, d), { recursive: true }, onChange);
    } catch {
      /* recursive watch unsupported */
    }
  }
}
process.on("SIGINT", async () => {
  await host.mf.dispose();
  process.exit(0);
});
