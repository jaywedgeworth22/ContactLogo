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
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000/";

/** *.vcf is gitignored (AddressBook PII).  The fixture is generated here. */
function writeFixture() {
  const cards = [
    ["Walgreens", "Walgreens", "https://walgreens.com", "hello@walgreens.com"],
    ["FedEx", "FedEx", "https://fedex.com", "hello@fedex.com"],
    [
      "Bayou City Sprinkler And Fire Protection Services Of Greater Houston LLC Doing Business As The Very Long Name That Used To Wrap",
      "Bayou City Sprinkler And Fire Protection Services Of Greater Houston LLC",
      "https://bayoucity.example",
      "office@bayoucity.example",
    ],
  ];
  for (let i = 0; i < 36; i += 1) {
    const name = `Acme ${i} ${"Roofing Plumbing Electrical And Landscape ".repeat(2)}Co`;
    cards.push([name, name, `https://acme${i}.example`, `info@acme${i}.example`]);
  }
  const body = cards
    .map(
      ([fn, org, url, email]) =>
        `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${fn}\r\nORG:${org}\r\nURL:${url}\r\nEMAIL:${email}\r\nEND:VCARD`,
    )
    .join("\r\n");
  const dir = mkdtempSync(join(tmpdir(), "contactlogo-e2e-"));
  const path = join(dir, "audit-repro.vcf");
  writeFileSync(path, body);
  return path;
}

const VCF = writeFixture();

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

// Issue #35 — heterogeneous rows (long names, Choose your own menu) must not
// break the uniform-height virtualizer: no overlap, last card reachable.
const cardBoxes = await page.locator("article.card").evaluateAll((nodes) =>
  nodes.map((n) => {
    const r = n.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, height: r.height, left: r.left, right: r.right };
  }),
);
const heights = cardBoxes.map((b) => b.height);
const heightSpread = heights.length ? Math.max(...heights) - Math.min(...heights) : 99;
let overlap = false;
for (let i = 0; i < cardBoxes.length; i += 1) {
  for (let j = i + 1; j < cardBoxes.length; j += 1) {
    const a = cardBoxes[i];
    const b = cardBoxes[j];
    const x = a.left < b.right && a.right > b.left;
    const y = a.top < b.bottom - 1 && a.bottom > b.top + 1;
    if (x && y) overlap = true;
  }
}
const firstCard = page.locator("article.card").first();
const heightBeforeMenu = (await firstCard.boundingBox())?.height ?? 0;
await firstCard.getByRole("button", { name: "Choose your own", exact: true }).click();
await firstCard.getByRole("menuitem", { name: "Paste URL", exact: true }).waitFor({ state: "visible" });
const heightAfterMenu = (await firstCard.boundingBox())?.height ?? 0;
await page.keyboard.press("Escape");

const listIndex = await page.locator(".virtual-list").evaluateAll((lists) => {
  let best = 0;
  let bestH = -1;
  lists.forEach((el, i) => {
    const h = el.querySelector(".virtual-list-spacer")?.getBoundingClientRect().height ?? 0;
    if (h > bestH) {
      bestH = h;
      best = i;
    }
  });
  return best;
});
const list = page.locator(".virtual-list").nth(listIndex);
await list.evaluate((el) => {
  el.scrollTop = el.scrollHeight;
});
await page.waitForTimeout(400);
const reach = await list.evaluate((el) => {
  const spacer = el.querySelector(".virtual-list-spacer");
  const cards = [...el.querySelectorAll("article.card")];
  if (!spacer || cards.length === 0) return { ok: false, reason: "no spacer or cards" };
  const last = cards[cards.length - 1].getBoundingClientRect();
  const view = el.getBoundingClientRect();
  const spacerH = spacer.getBoundingClientRect().height;
  const mounted = cards.length;
  return {
    ok: last.bottom <= view.bottom + 8 && spacerH >= el.clientHeight && spacerH > 800 && mounted < 40,
    lastBottom: Math.round(last.bottom),
    viewBottom: Math.round(view.bottom),
    spacerH: Math.round(spacerH),
    scrollH: el.scrollHeight,
    mounted,
  };
});
rec(
  "CL-35",
  heightSpread <= 2 && !overlap && Math.abs(heightAfterMenu - heightBeforeMenu) <= 2 && reach.ok,
  `heightSpread=${heightSpread}px overlap=${overlap} menuDelta=${Math.round(heightAfterMenu - heightBeforeMenu)}px reach=${JSON.stringify(reach)} (long names + Choose your own must keep uniform rows)`,
);

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log("\n" + (failed.length === 0
  ? "ALL REPRODUCTIONS CLEAR"
  : `STILL REPRODUCING: ${failed.map((f) => f.id).join(", ")}`));
process.exit(failed.length === 0 ? 0 : 1);
