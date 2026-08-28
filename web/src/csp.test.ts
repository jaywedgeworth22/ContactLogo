import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
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
      // `https:` covers it too; see the paste-URL test below.
      connect.includes(origin) || connect.includes("https:"),
      `connect-src is missing ${origin} — embedSrc() fetches it, so export would fail`,
    );
  }
});

test("connect-src permits the arbitrary hosts the Paste URL action needs", () => {
  const connect = directives().get("connect-src") ?? [];
  // `composeFromUrl` fetches whatever HTTPS URL the user pastes into a card.
  // No host allowlist can express "any host the user names", so this needs the
  // `https:` scheme source.  Removing it silently breaks that action in
  // production only — it works locally, where no CSP is applied.
  assert.ok(
    connect.includes("https:"),
    "connect-src must allow https: or the per-card Paste URL action fails in production",
  );
});

test("the directives that keep the CSP worth having are still strict", () => {
  const csp = directives();
  // connect-src is deliberately wide (above), so these carry the weight.
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
