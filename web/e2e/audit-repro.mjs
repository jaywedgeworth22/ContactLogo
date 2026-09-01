/**
 * Re-runs the three browser-verified findings from docs/EVALUATION-2026-08.md
 * (CL-07, CL-08, CL-09) against the built app.  The audit reproduced these in a
 * headless Chromium session at 1280x900; this is that session, committed, so the
 * fixes can be re-checked instead of taken on trust.
 *
 * NOT part of `npm test` and NOT in CI, deliberately: it needs a built bundle, a
 * running server and a browser binary.  Making every push carry a Playwright
 * install and a browser download was more than these three findings warranted,
 * so `web` has no Playwright dependency and this asks for one explicitly.  Run
 * it by hand after touching the review UI:
 *
 *   npm i --no-save playwright && npx playwright install chromium
 *   npm run build
 *   npm start &
 *   node e2e/audit-repro.mjs
 *
 * To use a browser that is already on the machine instead of downloading one:
 *
 *   CHROME_PATH=/path/to/chrome node e2e/audit-repro.mjs
 *
 * BASE_URL overrides the target if the server is not on :3000.
 */
import { chromium } from "playwright";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE_URL ?? "http://localhost:3000/";
const VCF = join(dirname(fileURLToPath(import.meta.url)), "audit-repro.vcf");

/**
 * The "Circle mask preview" toggle and the crop dialog's backing toggle are
 * checkboxes that approve nothing.  Counting them is how a first pass at this
 * script produced an off-by-one and a false CL-08 failure.
 */
const CARD_BOX =
  "input[type=checkbox]:not(.mask-toggle input):not(.crop-check-row input)";

const results = [];
const rec = (id, pass, detail) => {
  results.push({ id, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${id}  ${detail}`);
};

const launch = {};
if (process.env.CHROME_PATH) launch.executablePath = process.env.CHROME_PATH;
const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(BASE, { waitUntil: "networkidle" });
await page.locator('input[type=file][accept*="vcf"]').setInputFiles(VCF);
await page.waitForTimeout(2500);

const approved = async () => {
  const text = await page.evaluate(() =>
    [...document.querySelectorAll("button")]
      .map((b) => b.textContent.trim())
      // app.ts:1490 drops the "s" at one; matching only the plural made a
      // count of 1 look like a missing button.
      .find((t) => /Approved Update(s)?$/.test(t)),
  );
  const m = text?.match(/\d+/);
  if (!m) throw new Error(`no "N Approved Update(s)" button on the page (saw ${JSON.stringify(text)})`);
  return Number(m[0]);
};
const checkedCards = () => page.locator(`${CARD_BOX}:checked`).count();

// CL-07 — the search box lost focus and every character but the first.
const search = page.locator('input[type=search], .search-input').first();
await search.click();
await page.keyboard.type("wal", { delay: 120 });
await page.waitForTimeout(400);
const typed = await search.inputValue();
const active = await page.evaluate(() => document.activeElement?.tagName ?? "NONE");
rec("CL-07", typed === "wal" && active === "INPUT",
    `value=${JSON.stringify(typed)} activeElement=${active} (audit saw "w" / BODY)`);
await search.fill("");
await page.waitForTimeout(400);

// CL-09 — every card in the DOM, rebuilt on each keystroke; 9,804px on mobile.
const m = await page.evaluate(() => ({
  h: document.documentElement.scrollHeight,
  nodes: document.querySelectorAll("*").length,
}));
rec("CL-09", m.h < 9804, `scrollHeight=${m.h}px domNodes=${m.nodes} (audit: 9,804px)`);

// CL-08 — the approve count froze until something else forced a re-render.
// Both directions, because the original bug was a missing render() on change.
let ok = true;
for (const [tag, delta, act] of [
  ["check one card", +1, async () => page.locator(`${CARD_BOX}:not(:checked)`).first().check()],
  ["uncheck one card", -1, async () => page.locator(`${CARD_BOX}:checked`).first().uncheck()],
]) {
  const before = await approved();
  await act();
  await page.waitForTimeout(350);
  const after = await approved();
  if (after - before !== delta) {
    ok = false;
    console.log(`      ${tag}: ${before} -> ${after}, expected ${delta > 0 ? "+" : ""}${delta}`);
  }
}
// And the bulk controls, which is where the stale count was first seen.  These
// act on the high-confidence rows only, so a medium row approved by hand above
// survives "Clear" — the label must agree with the boxes, not reach zero.
await page.getByRole("button", { name: "Clear high-confidence", exact: true }).click();
await page.waitForTimeout(400);
const cleared = await approved();
if (cleared !== (await checkedCards())) ok = false;
await page.getByRole("button", { name: "Select all high-confidence", exact: true }).click();
await page.waitForTimeout(400);
const reselected = await approved();
if (reselected !== (await checkedCards())) ok = false;
rec("CL-08", ok, `check/uncheck track; after clear label=${cleared}, after select-all label=${reselected}, both equal to the checked boxes`);

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log("\n" + (failed.length === 0
  ? "ALL REPRODUCTIONS CLEAR"
  : `STILL REPRODUCING: ${failed.map((f) => f.id).join(", ")}`));
process.exit(failed.length === 0 ? 0 : 1);
