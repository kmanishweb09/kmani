// Builds the release bundle and host harness once before worker tests run.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

export default function setup(): void {
  if (process.env.FINANCE_SKIP_BUILD === "1" && existsSync(".local/harness/worker.mjs")) return;
  if (!existsSync("scripts/build.mjs")) return;
  execFileSync(process.execPath, ["scripts/build.mjs", "--quiet"], { stdio: "inherit" });
}
