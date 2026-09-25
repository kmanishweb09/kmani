import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

/**
 * Required end-to-end journeys (SPEC §19) against the built release in the simulated host
 * (workerd + in-memory D1). Sign-in uses the harness's local development identity; production uses the
 * host's getUser. Upstream sources are served by local fixtures (see scripts/serve.mjs).
 */

const signIn = async (page: Page, as: "owner" | "visitor", to = "/finance") => {
  await page.goto(`/signin-with-chatgpt?as=${as}&return_to=${encodeURIComponent(to)}`);
  await page.waitForLoadState("networkidle");
};
const signOut = async (page: Page) => {
  await page.goto("/signout-with-chatgpt?return_to=/finance");
  await page.waitForLoadState("networkidle");
};

/** Runs axe (WCAG 2.0/2.1 A and AA) and records serious/critical findings per page in release/reports/axe/. */
async function checkA11y(page: Page, name: string) {
  // @axe-core/playwright is typed against its own playwright-core copy; the runtime Page is the same object.
  const r = await new AxeBuilder({ page: page as never }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  const serious = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  mkdirSync("release/reports/axe", { recursive: true });
  writeFileSync(`release/reports/axe/${name}.json`, `${JSON.stringify({ page: page.url().replace(/^https?:\/\/[^/]+/, ""), checkedAt: new Date().toISOString(), rulesRun: r.passes.length + r.violations.length + r.incomplete.length, seriousOrCritical: serious.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help })), minorOrModerate: r.violations.filter((v) => !serious.includes(v)).map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })) }, null, 2)}\n`);
  expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`), `axe ${name}`).toEqual([]);
}

test("signed-out visitor: filter deals, open a deal and inspect the source behind a value", async ({ page }) => {
  await signOut(page);
  await page.goto("/finance/deals");
  await expect(page.getByRole("heading", { name: /Deal Terminal|Deals/ }).first()).toBeVisible();
  await page.getByRole("radio", { name: "India" }).click();
  await page.getByRole("button", { name: "Sector", exact: true }).click();
  await page.getByRole("group", { name: "Sector filter" }).getByRole("checkbox", { name: "FIG", exact: true }).check();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/sector=fig/);
  await page.getByRole("link", { name: /open deal: HDFC Ltd merges into HDFC Bank/ }).click();
  await expect(page.getByRole("heading", { name: /HDFC Ltd merges into HDFC Bank/ })).toBeVisible();
  await checkA11y(page, "deal-detail");
  await page.getByRole("button", { name: /Show evidence for status/ }).first().click();
  const drawer = page.getByRole("dialog", { name: /Evidence: status/ });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("link").first()).toHaveAttribute("href", /^https:\/\//);
  await checkA11y(page, "evidence-drawer");
  await page.keyboard.press("Escape");
  // Signed out: private actions ask for sign-in instead of pretending to save.
  await expect(page.getByRole("region", { name: "AI assist" })).toHaveCount(0);
});

test("As announced mode shows only what was known at the cutoff, including the drafted note (Disney–Fox regression)", async ({ page }) => {
  await signIn(page, "owner", "/finance/deals/disney-21st-century-fox");
  // Control: the current view carries the revised $71.3bn cash-and-stock terms.
  await expect(page.getByRole("heading", { level: 1 })).toContainText("bidding contest");
  await expect(page.locator("main")).toContainText("71.3");
  await page.goto("/finance/deals/disney-21st-century-fox?mode=announced");
  const h1 = page.getByRole("heading", { level: 1 });
  await expect(h1).toContainText("$52.4bn in stock");
  await expect(h1).not.toContainText(/bidding contest|Comcast/);
  await expect(page.getByTestId("historical-banner")).toContainText("information cutoff");
  const main = page.locator("main");
  await expect(main).toContainText("52.4");
  await expect(main).toContainText("all stock");
  for (const tab of ["Snapshot", "Price & structure", "Timeline", "Sector context", "Why this deal"]) {
    await page.getByRole("tab", { name: tab }).click();
    await expect(main).not.toContainText("71.3");
    await expect(main).not.toContainText("Comcast");
    await expect(main).not.toContainText("Amended");
  }
  await page.getByRole("tab", { name: "Snapshot" }).click();
  await checkA11y(page, "deal-as-announced");
  await page.getByRole("button", { name: "Draft Deal Note" }).click();
  await expect(page).toHaveURL(/\/finance\/notebook\/n_/);
  const body = await page.locator("textarea").first().inputValue();
  expect(body).toContain("Historical view: information cutoff 2017-12-14");
  expect(body).toContain("52.4");
  expect(body).not.toMatch(/71\.3|Comcast|Amended|bidding contest/);
});

test("owner: draft a deal note, reload and recover it; export Markdown with citations", async ({ page }) => {
  await signIn(page, "owner", "/finance/deals/hdfc-hdfc-bank-merger");
  await page.getByRole("button", { name: "Draft Deal Note" }).click();
  await expect(page).toHaveURL(/\/finance\/notebook\/n_/);
  const url = page.url();
  const editor = page.locator("textarea").first();
  await editor.fill(`${await editor.inputValue()}\n\n## My view\n\nE2E note body marker.`);
  const id = url.split("/").pop() as string;
  // Autosave is debounced: wait until the server copy has the edit (not just the local draft).
  await expect.poll(async () => ((await (await page.request.get(`/api/finance/notes/${id}`)).json()).note.body as string).includes("E2E note body marker"), { timeout: 15_000 }).toBe(true);
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.locator("textarea").first()).toHaveValue(/E2E note body marker/);
  const md = await page.request.get(`/api/finance/notes/${id}/export.md`);
  expect(md.status()).toBe(200);
  const text = await md.text();
  expect(text).toContain("E2E note body marker");
  expect(text).toMatch(/https:\/\//);
  await checkA11y(page, "note-editor");
});

test("compare two deals: incompatible metrics are excluded with reasons", async ({ page }) => {
  await page.goto("/finance/deals/compare?ids=hdfc-hdfc-bank-merger,axis-citi-india-consumer");
  await expect(page.getByRole("heading", { name: "Compare deals" })).toBeVisible();
  await expect(page.getByText(/excluded/i).first()).toBeVisible();
  await expect(page.getByText(/No eligible observations|eligible observation/).first()).toBeVisible();
  await checkA11y(page, "compare");
});

test("owner: follow a company, open its sector and save a research question", async ({ page }) => {
  await signIn(page, "owner", "/finance/companies/hdfc-bank");
  const follow = page.getByRole("button", { name: /Follow/ }).first();
  await follow.click();
  await expect(page.getByRole("button", { name: /Following/ }).first()).toBeVisible();
  await page.getByRole("link", { name: /Financial Institutions \(FIG\)|FIG/ }).first().click();
  await expect(page).toHaveURL(/\/finance\/sectors\/fig/);
  await checkA11y(page, "sector-fig");
  await page.getByRole("tab", { name: "My view" }).click();
  await page.getByLabel("Research question").fill("Does the RBI's expected-credit-loss transition change which bank acquisitions are value-accretive?");
  await page.getByRole("button", { name: "Save research question" }).click();
  await expect(page).toHaveURL(/\/finance\/notebook\/n_/);
  await expect(page.locator("textarea").first()).not.toHaveValue("");
});

test("Lab rejects impossible inputs on the rendered path: 150% stake, negative consideration, zero-book residual income", async ({ page }) => {
  await page.goto("/finance/lab?tab=comparables");
  const stake = page.getByRole("textbox", { name: /^Stake acquired/ });
  await stake.fill("150");
  await stake.blur();
  await expect(page.getByRole("alert").filter({ hasText: "Stake acquired must be above 0% and at most 100%." })).toBeVisible();
  await expect(page.getByText("Implied 100% equity value")).toHaveCount(0);
  await stake.fill("25");
  const consideration = page.getByRole("textbox", { name: /^Consideration for the stake/ });
  await consideration.fill("-500");
  await consideration.blur();
  await expect(page.getByRole("alert").filter({ hasText: "Consideration must be a positive amount." })).toBeVisible();
  await page.goto("/finance/lab?tab=fig");
  await page.getByRole("radio", { name: "Direct NI" }).click();
  await page.getByRole("textbox", { name: /^Opening common book equity/ }).fill("100");
  await page.getByRole("textbox", { name: /^Cost of equity/ }).first().fill("10");
  await page.getByRole("textbox", { name: /^Net income Y1/ }).fill("-100");
  await page.getByRole("button", { name: "Add year" }).click();
  await page.getByRole("textbox", { name: /^Net income Y2/ }).fill("5");
  await page.getByRole("textbox", { name: /^Distributions Y2/ }).fill("0");
  await page.getByRole("textbox", { name: /^Distributions Y2/ }).blur();
  await expect(page.getByRole("alert").filter({ hasText: /Opening book equity for year 2 is zero/ })).toBeVisible();
  await expect(page.locator("main")).not.toContainText("Infinity");
});

test("Lab: load the training DCF, change WACC, see the sensitivity grid, save and reopen", async ({ page }) => {
  await signIn(page, "owner", "/finance/lab?tab=dcf");
  await expect(page.getByText(/fictional|training/i).first()).toBeVisible();
  await page.getByRole("radio", { name: "Enter WACC" }).click();
  const wacc = page.getByRole("textbox", { name: /^WACC/ });
  await wacc.fill("11");
  await wacc.blur();
  const grid = page.getByRole("table", { name: /Value per share for WACC/ });
  await expect(grid).toBeVisible();
  await checkA11y(page, "lab-dcf");
  await page.getByRole("button", { name: /Save model/ }).click();
  await expect(page).toHaveURL(/model=m_|model=/);
  const saved = page.url();
  await page.goto("/finance/lab?tab=dcf");
  await page.goto(saved);
  await page.waitForLoadState("networkidle");
  await page.getByRole("radio", { name: "Enter WACC" }).isVisible();
  await expect(page.getByRole("textbox", { name: /^WACC/ })).toHaveValue(/11/);
});

test("Deal Memory: add cards, review one and see the next due date persist", async ({ page }) => {
  await signIn(page, "owner", "/finance/deals/axis-citi-india-consumer");
  await page.getByRole("button", { name: "Add to Deal Memory" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/One risk/).fill("Customer attrition after migration to Axis systems.");
  await dialog.getByRole("button", { name: /Save|Create|Add/ }).last().click();
  await expect(dialog).toBeHidden();
  await page.goto("/finance/notebook?tab=review");
  await page.getByRole("button", { name: "Reveal answer" }).click();
  await page.getByRole("button", { name: /^Good/ }).click();
  await page.goto("/finance/notebook?tab=memory");
  await page.reload();
  await expect(page.getByText(/Stage 1 of 6 · due \d{4}-\d{2}-\d{2}/).first()).toBeVisible();
  await checkA11y(page, "deal-memory");
});

test("export private data, preview an import with duplicates, and nothing is deleted", async ({ page }) => {
  await signIn(page, "owner", "/finance/settings");
  const exp = await page.request.get("/api/finance/export");
  expect(exp.status()).toBe(200);
  expect(exp.headers()["cache-control"]).toContain("no-store");
  const bundle = await exp.json();
  const notesBefore = bundle.notes.length;
  expect(notesBefore).toBeGreaterThan(0);
  await page.getByLabel(/Import a Finance Desk export/).setInputFiles({ name: "export.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(bundle)) });
  await expect(page.getByText(/duplicate/i).first()).toBeVisible();
  const after = await (await page.request.get("/api/finance/export")).json();
  expect(after.notes.length).toBe(notesBefore);
});

test("AI off: research, models, notes, review and compiled briefs still work", async ({ page }) => {
  await signIn(page, "owner", "/finance/deals/hdfc-hdfc-bank-merger");
  const panel = page.getByRole("region", { name: "AI assist" });
  await expect(panel.getByText(/AI is off/)).toBeVisible();
  await page.goto("/finance/briefs");
  await page.getByRole("button", { name: "Publish general brief" }).click();
  await expect(page).toHaveURL(/\/finance\/briefs\/b_/);
  await expect(page.getByText(/Compiled brief \(no AI\)/).first()).toBeVisible();
  await page.getByText("Why this appears").first().click();
  await expect(page.getByText(/Appears because/).first()).toBeVisible();
  await checkA11y(page, "brief");
});

test("source failure: accurate freshness and last-good data are shown", async ({ page }) => {
  await signIn(page, "owner", "/finance/sources");
  await page.getByRole("tab", { name: "Administration" }).click();
  const row = page.getByRole("row", { name: /RBI press releases/ });
  await row.getByRole("button", { name: "Test connection" }).click();
  await expect(row).toContainText(/Working|current/i, { timeout: 15_000 });
  await row.getByRole("button", { name: "Test connection" }).click();
  await expect(row).toContainText(/503|server error|retried/i, { timeout: 15_000 });
  await page.getByRole("tab", { name: "Source health" }).click();
  await expect(page.getByText(/Cached/).first()).toBeVisible();
  const feed = await (await page.request.get("/api/finance/feed?days=7")).json();
  expect(feed.total).toBeGreaterThan(0);
  await checkA11y(page, "sources");
});

test("signed-out, non-owner and owner states", async ({ page }) => {
  await signOut(page);
  await page.goto("/finance/notebook?tab=notes");
  await expect(page.getByText(/Sign in/).first()).toBeVisible();
  await signIn(page, "visitor", "/finance/notebook?tab=notes");
  await expect(page.getByText(/not the configured owner|site owner|Sign in as the site owner|limited to the site owner/i).first()).toBeVisible();
  const r = await page.request.get("/api/finance/notes");
  expect(r.status()).toBe(403);
  await signIn(page, "owner", "/finance/notebook?tab=notes");
  await expect(page.getByLabel("New note template")).toBeVisible();
  await page.goto("/finance");
  await checkA11y(page, "desk-owner");
});

