/**
 * Proves the trade in #34 against the real production CSP: the per-card
 * "Paste URL" action works with `img-src https:` and NO `https:` on
 * `connect-src`, because `composeFromUrl` loads through `<img>` and a canvas
 * instead of `fetch`.
 *
 * `web/vercel.json` is applied only by Vercel, so nothing in `npm test` or
 * `npm run build` exercises it — a policy that breaks this action looks
 * perfectly healthy in CI.  `src/csp.test.ts` asserts the *shape* of the
 * policy; this asserts that the app actually works under it.  The policy is
 * read from `vercel.json` rather than restated here, so the two cannot drift.
 *
 * Five checks:
 *
 *   policy                    vercel.json really does have `img-src https:` and
 *                             no `https:` on connect-src
 *   paste-url-mechanism       under that policy, <img crossOrigin="anonymous">
 *                             loads, the canvas reads back and toDataURL()
 *                             encodes — what `composeFromUrl` does
 *   paste-url-button          the shipped button, end to end, after importing a
 *                             book.  Skipped when the runner cannot reach the
 *                             logo hosts, since then no card has a candidate to
 *                             paste onto
 *   connect-src-still-narrow  an allowlisted host is still fetchable, so
 *                             embedSrc keeps working
 *   connect-src-blocks-       fetch to an arbitrary host is refused: the
 *   arbitrary                 loosening #34 removed is really gone
 *
 * NOT part of `npm test` and NOT in CI, deliberately, for the same reasons as
 * `audit-repro.mjs`: it needs a built bundle, a running server and a browser.
 *
 *   npm i --no-save playwright && npx playwright install chromium
 *   npm run build && npm start &
 *   node e2e/csp-paste-url.mjs
 *
 * CHROME_PATH uses a browser already on the machine.  BASE_URL overrides :3000,
 * LOGO_URL the image that gets pasted.
 *
 * In a sandbox whose browser has no route to the internet, every request is
 * re-issued from Node by `page.route`, which is the side that has one.  Header
 * preservation is therefore explicit: dropping Access-Control-Allow-Origin
 * would read as a CORS failure the real browser never sees.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL ?? "http://localhost:3000/";
const VCF = join(here, "audit-repro.vcf");
// Deliberately NOT the first card's own candidate: pasting a URL the card
// already shows proves nothing, and reads as a pass.
const LOGO_URL = process.env.LOGO_URL ?? "https://cdn.simpleicons.org/ups";

const vercel = JSON.parse(readFileSync(join(here, "..", "vercel.json"), "utf8"));
const CSP = vercel.headers
  .flatMap((h) => h.headers)
  .find((h) => h.key === "Content-Security-Policy").value;

const results = [];
const rec = (id, pass, detail) => {
  results.push({ id, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${id}  ${detail}`);
};
const skip = (id, detail) => {
  results.push({ id, skipped: true });
  console.log(`SKIP  ${id}  ${detail}`);
};

const directive = (name) =>
  CSP.split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith(name + " "))
    ?.split(/\s+/)
    .slice(1) ?? [];

rec(
  "policy",
  directive("img-src").includes("https:") && !directive("connect-src").includes("https:"),
  `img-src has https:=${directive("img-src").includes("https:")}, connect-src has https:=${directive("connect-src").includes("https:")}`,
);

const launch = { args: [] };
if (process.env.CHROME_PATH) launch.executablePath = process.env.CHROME_PATH;
const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const violations = [];
page.on("console", (m) => {
  const t = m.text();
  if (/Content Security Policy/i.test(t)) violations.push(t.slice(0, 200));
});

/**
 * Some logo hosts are unreachable from a locked-down runner.  Three things have
 * to be true or the results lie:
 *
 * - an unhandled rejection here wedges the handler, after which every later
 *   request looks like a CSP block;
 * - a request left pending on an unreachable host holds a connection slot, and
 *   enough of them stop Chromium from ever issuing the one under test — which
 *   looks exactly like the CSP refusing it, silently and with no violation;
 * - so a host that has failed once must fail instantly from then on.
 *
 * Each of those cost a round of false results before it was pinned down.
 */
const unreachable = new Set();
await page.route("**/*", async (route) => {
  const req = route.request();
  const host = new URL(req.url()).host;
  if (unreachable.has(host)) return route.abort();
  if (req.url() === LOGO_URL) console.log(`  [route] pasted URL requested: ${req.resourceType()}`);
  let res;
  try {
    res = await route.fetch({ timeout: 8000 });
  } catch {
    unreachable.add(host);
    return route.abort();
  }
  const headers = { ...res.headers() };
  if (req.resourceType() === "document") headers["content-security-policy"] = CSP;
  if (req.url() === LOGO_URL) {
    console.log(`  [route] pasted URL fulfilled: ${res.status()} acao=${headers["access-control-allow-origin"] ?? "(none)"}`);
  }
  await route.fulfill({ response: res, headers });
});
await page.goto(BASE, { waitUntil: "domcontentloaded" });

// The mechanism `composeFromUrl` uses, on a clean page under the real policy.
// This is the check that matters and the one that always runs: load through
// <img crossOrigin="anonymous">, draw, read the pixels back, encode.
const mechanism = await page.evaluate(
  (url) =>
    new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const c = document.createElement("canvas");
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          const ctx = c.getContext("2d");
          ctx.drawImage(img, 0, 0, c.width, c.height);
          ctx.getImageData(0, 0, 8, 8); // throws on a tainted canvas
          resolve({ src: c.toDataURL("image/png").slice(0, 30), w: c.width, h: c.height });
        } catch (e) {
          resolve({ error: String(e).slice(0, 140) });
        }
      };
      img.onerror = () => resolve({ error: "image failed to load" });
      setTimeout(() => resolve({ error: "timed out" }), 20000);
      img.src = url;
    }),
  LOGO_URL,
);
rec(
  "paste-url-mechanism",
  typeof mechanism.src === "string" && mechanism.src.startsWith("data:image/png"),
  mechanism.src ? `${mechanism.w}x${mechanism.h} -> ${mechanism.src}…` : mechanism.error,
);

// Everything above ran under the real policy.  Count violations now, before the
// two probes below deliberately provoke one.
const violationsDuringPaste = violations.length;

// The end-to-end drive: import a book and click the card's own button.  Skipped
// when the runner could not reach the logo hosts, because then every candidate
// image fails, the app churns through `candidateFailed`, and the click's own
// request never gets issued — a property of the runner, not of the app or the
// policy, and reporting it as a failure of either would be wrong.
await page.locator('input[type=file][accept*="vcf"]').setInputFiles(VCF);
await page.waitForTimeout(10000); // long enough for the slow hosts to give up

// Measure the precondition directly rather than trusting `unreachable`, whose
// entries only appear once each host's fetch has timed out.
const liveThumbs = await page.evaluate(
  () => [...document.querySelectorAll("article.card img")].filter((i) => i.naturalWidth > 0).length,
);
if (liveThumbs === 0) {
  skip(
    "paste-url-button",
    `no card thumbnail loaded — this runner cannot reach the logo hosts${
      unreachable.size ? ` (${[...unreachable].join(", ")})` : ""
    }, so there is no working card to paste onto`,
  );
} else {
  await page.evaluate((url) => {
    window.__prompted = 0;
    window.prompt = () => {
      window.__prompted += 1;
      return url;
    };
  }, LOGO_URL);

  const approved = async () => {
    const label = await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .map((b) => b.textContent.trim())
        // app.ts drops the "s" at one, so match both.
        .find((t) => /Approved Update(s)?$/.test(t)),
    );
    return Number(label?.match(/\d+/)?.[0] ?? -1);
  };

  const approvedBefore = await approved();
  const card = page.locator("article.card").first();
  await card.getByRole("button", { name: "Choose Your Own", exact: true }).click();
  await card.getByRole("menuitem", { name: "Paste URL", exact: true }).click();
  await page
    .waitForFunction(
      (prev) => {
        const label = [...document.querySelectorAll("button")]
          .map((b) => b.textContent.trim())
          .find((t) => /Approved Update(s)?$/.test(t));
        return Number(label?.match(/\d+/)?.[0] ?? -1) > prev;
      },
      approvedBefore,
      { timeout: 30000 },
    )
    .catch(() => {});

  const approvedAfter = await approved();
  const prompted = await page.evaluate(() => window.__prompted);
  const notice = await page.evaluate(() => document.querySelector(".notice")?.textContent?.trim() ?? "");
  rec(
    "paste-url-button",
    prompted === 1 && approvedAfter > approvedBefore,
    `prompted=${prompted}; approved ${approvedBefore} -> ${approvedAfter}${notice ? `; notice=${JSON.stringify(notice)}` : ""}`,
  );
}

// The other half of the trade: fetch to that same host must now be refused.
const fetched = await page.evaluate(async (url) => {
  try {
    const r = await fetch(url, { mode: "cors" });
    return "ok " + r.status;
  } catch (e) {
    return "THREW: " + String(e).slice(0, 60);
  }
}, LOGO_URL);
rec(
  "connect-src-still-narrow",
  fetched.startsWith("ok"),
  `fetch(${new URL(LOGO_URL).host}) -> ${fetched} (this host IS on the connect-src allowlist; embedSrc needs it)`,
);

const offlist = await page.evaluate(async () => {
  try {
    const r = await fetch("https://example.com/logo.png", { mode: "cors" });
    return "ok " + r.status;
  } catch (e) {
    return "THREW: " + String(e).slice(0, 60);
  }
});
rec(
  "connect-src-blocks-arbitrary",
  offlist.startsWith("THREW"),
  `fetch(example.com) -> ${offlist} (this is the loosening #34 removed)`,
);

rec(
  "no-csp-violations",
  violationsDuringPaste === 0,
  violationsDuringPaste === 0
    ? "none while importing and pasting"
    : violations.slice(0, violationsDuringPaste).join(" | "),
);

if (unreachable.size) console.log(`\nnote: unreachable from this runner: ${[...unreachable].join(", ")}`);
await browser.close();
const failed = results.filter((r) => !r.skipped && !r.pass);
const skipped = results.filter((r) => r.skipped);
console.log(
  `\n${results.length - failed.length - skipped.length}/${results.length - skipped.length} checks passed` +
    (skipped.length ? `, ${skipped.length} skipped` : ""),
);
process.exit(failed.length ? 1 : 0);
