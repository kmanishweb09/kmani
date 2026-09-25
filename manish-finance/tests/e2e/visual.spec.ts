import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

/**
 * Visual QA captures (SPEC §19): key screens at desktop, tablet and mobile widths in dark and light
 * themes, written to release/reports/screenshots/. Screenshots are evidence for inspection, not tests of
 * behaviour; each capture still asserts the page rendered its main heading without a client error.
 */

const OUT = "release/reports/screenshots";
mkdirSync(OUT, { recursive: true });

type Shot = { name: string; path: string; owner?: boolean; action?: (page: Page) => Promise<void> };

const DESKTOP: Shot[] = [
  { name: "desk", path: "/finance", owner: true },
  { name: "deals", path: "/finance/deals" },
  { name: "deal-detail", path: "/finance/deals/hdfc-hdfc-bank-merger" },
  {
    name: "deal-evidence-drawer",
    path: "/finance/deals/axis-citi-india-consumer",
    action: async (page) => {
      await page.getByRole("button", { name: /Show evidence for headline value/ }).first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
    },
  },
  { name: "sector-fig", path: "/finance/sectors/fig" },
  { name: "lab-dcf", path: "/finance/lab?tab=dcf" },
  { name: "lab-fig", path: "/finance/lab?tab=fig" },
  { name: "notebook-review", path: "/finance/notebook?tab=review", owner: true },
  { name: "notebook-learn", path: "/finance/notebook?tab=learn" },
  { name: "briefs", path: "/finance/briefs" },
  { name: "sources", path: "/finance/sources" },
];
const MOBILE: Shot[] = [
  { name: "desk", path: "/finance", owner: true },
  { name: "deals", path: "/finance/deals" },
  { name: "deal-detail", path: "/finance/deals/hdfc-hdfc-bank-merger" },
  { name: "lab-dcf", path: "/finance/lab?tab=dcf" },
];

async function capture(page: Page, s: Shot, width: number, height: number, theme: "dark" | "light") {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.setViewportSize({ width, height });
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("manish.finance.v1.theme", t);
    } catch {
      /* ignore */
    }
  }, theme);
  if (s.owner) {
    // The owner's theme is an account preference (server-side), which rightly overrides the device value.
    await page.goto(`/signin-with-chatgpt?as=owner&return_to=/finance`);
    const cur = await (await page.request.get("/api/finance/preferences")).json();
    const origin = new URL(page.url()).origin;
    await page.request.patch("/api/finance/preferences", { data: { theme, revision: cur.revision }, headers: { Origin: origin, "X-Finance-Request": "1" } });
    await page.goto(s.path);
  } else {
    await page.goto(`/signout-with-chatgpt?return_to=${encodeURIComponent(s.path)}`);
  }
  await page.waitForLoadState("networkidle");
  await expect(page.locator("h1").first()).toBeVisible();
  if (s.action) await s.action(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${s.name}-${width}-${theme}.png`, fullPage: false });
  expect(errors).toEqual([]);
}

for (const theme of ["dark", "light"] as const) {
  for (const s of DESKTOP) test(`desktop 1440 ${theme}: ${s.name}`, async ({ page }) => capture(page, s, 1440, 900, theme));
  for (const s of MOBILE) test(`mobile 390 ${theme}: ${s.name}`, async ({ page }) => capture(page, s, 390, 844, theme));
}
for (const s of [DESKTOP[1], DESKTOP[2]] as Shot[]) test(`tablet 768 dark: ${s.name}`, async ({ page }) => capture(page, s, 768, 1024, "dark"));
for (const s of [DESKTOP[0], DESKTOP[1]] as Shot[]) test(`wide 1920 dark: ${s.name}`, async ({ page }) => capture(page, s, 1920, 1080, "dark"));
