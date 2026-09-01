import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { candidateUrls } from "./engine/logos.ts";

/**
 * The production CSP lives in `web/vercel.json` and is applied only by Vercel,
 * so nothing in `npm test` or `npm run build` exercises it — a policy that
 * breaks the app at runtime looks completely healthy in CI.  That is not
 * hypothetical: the first draft of this CSP listed the logo CDNs in `img-src`
 * only, which would have broken every export (`embedSrc` fetches them), and the
 * second blocked the per-card "Paste URL" action for every host outside the
 * provider list.  Both were caught by review rather than by a test.  This is
 * the test.
 */

const here = dirname(fileURLToPath(import.meta.url));
const vercel = JSON.parse(readFileSync(join(here, "..", "vercel.json"), "utf8")) as {
  headers: { headers: { key: string; value: string }[] }[];
};

function directives(): Map<string, string[]> {
  const header = vercel.headers
    .flatMap((h) => h.headers)
    .find((h) => h.key === "Content-Security-Policy");
  assert.ok(header, "vercel.json must set a Content-Security-Policy");
  const out = new Map<string, string[]>();
  for (const part of header.value.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) out.set(name, sources);
  }
  return out;
}

/** Every origin the engine can build a candidate URL for. */
function engineOrigins(): Set<string> {
  const origins = new Set<string>();
  // Two domains: one with a Simple Icons slug and one without, so the union
  // covers every source `candidateUrls` can emit.
  for (const domain of ["fedex.com", "some-unknown-business.example"]) {
    for (const hit of candidateUrls(domain)) {
      if (hit.src.startsWith("http")) origins.add(new URL(hit.src).origin);
    }
  }
  return origins;
}

test("every logo source the engine can reach is allowed by img-src and connect-src", () => {
  const csp = directives();
  const img = csp.get("img-src") ?? [];
  const connect = csp.get("connect-src") ?? [];

  for (const origin of engineOrigins()) {
    assert.ok(
      img.includes(origin),
      `img-src is missing ${origin} — the review list would show a broken thumbnail`,
    );
    assert.ok(
      connect.includes(origin),
      `connect-src is missing ${origin} — embedSrc() fetches it, so export would fail`,
    );
  }
});

/**
 * "Paste URL" takes whatever HTTPS host the user names, and no allowlist can
 * express that.  The first fix was `connect-src ... https:`, which works and is
 * a real loosening: connect-src stops being an exfiltration barrier for an app
 * holding the whole address book in memory.  `composeFromUrl` now loads through
 * `<img>` and a canvas instead, which needs only `img-src https:` — an image
 * can leak a URL but cannot read a response.
 *
 * Verified in a browser under exactly this shape of policy (`img-src 'self'
 * data: blob: https:`, `connect-src 'self'` and nothing else): the image loads,
 * the canvas reads back and encodes, and `fetch` to the same URL is refused.
 * These two assertions are what keep that trade in place — put `https:` back on
 * connect-src and the app still works, so nothing else would notice.
 */
test("the Paste URL action is carried by img-src, not connect-src", () => {
  const csp = directives();
  assert.ok(
    (csp.get("img-src") ?? []).includes("https:"),
    "img-src must allow https: or the per-card Paste URL action fails in production",
  );
  assert.ok(
    !(csp.get("connect-src") ?? []).includes("https:"),
    "connect-src must not carry https: — composeFromUrl no longer fetches, so nothing needs it",
  );
});

test("connect-src allows Sentry ingest so a configured VITE_SENTRY_DSN can post", () => {
  const connect = directives().get("connect-src") ?? [];
  assert.ok(
    connect.includes("https://*.ingest.sentry.io") || connect.includes("https://*.ingest.us.sentry.io"),
    "connect-src must allow Sentry ingest hosts; a DSN without this CSP entry fails silently",
  );
});

test("the directives that keep the CSP worth having are still strict", () => {
  const csp = directives();
  // img-src is deliberately wide (above), so these carry the weight.
  assert.deepEqual(csp.get("default-src"), ["'none'"]);
  assert.deepEqual(csp.get("object-src"), ["'none'"]);
  assert.deepEqual(csp.get("base-uri"), ["'none'"]);
  assert.deepEqual(csp.get("frame-ancestors"), ["'none'"]);
  assert.deepEqual(csp.get("form-action"), ["'self'"]);
  const script = csp.get("script-src") ?? [];
  assert.ok(!script.includes("'unsafe-inline'") && !script.includes("'unsafe-eval'"),
    "script-src must not allow inline or eval — it is what makes the rest meaningful");
  assert.ok(!script.includes("https:"), "script-src must stay an allowlist");
});

/**
 * The CSP covers every file Vercel serves, not just the app bundle — and the
 * static pages in `web/public` are hand-written HTML that nothing typechecks or
 * bundles. `style-src 'self'` silently reduced `privacy.html` and
 * `privacy-policy.html` to unstyled Times New Roman in production: the app was
 * clean, so no other check noticed.
 *
 * This asserts the policy still permits whatever those pages actually do, and
 * fails if a future page introduces something the policy forbids.
 */
function publicHtml(): { name: string; body: string }[] {
  const dir = join(here, "..", "public");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".html"))
    .map((name) => ({ name, body: readFileSync(join(dir, name), "utf8") }));
}

test("the CSP permits what the static pages in web/public actually do", () => {
  const csp = directives();
  const style = csp.get("style-src") ?? [];
  const script = csp.get("script-src") ?? [];

  for (const { name, body } of publicHtml()) {
    if (/<style[\s>]/i.test(body) || /\sstyle="/i.test(body)) {
      assert.ok(
        style.includes("'unsafe-inline'"),
        `${name} uses inline CSS, which style-src would block — the page would render unstyled in production`,
      );
    }
    // Inline script is a different matter: script-src stays an allowlist, so a
    // page that needs one has to be fixed rather than the policy loosened.
    assert.ok(
      !/<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(body),
      `${name} has an inline <script>; script-src deliberately forbids that — give the page an external script instead of weakening the policy`,
    );
    assert.ok(!script.includes("'unsafe-inline'"), "script-src must never allow inline");
  }
});
