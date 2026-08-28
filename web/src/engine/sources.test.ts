import assert from "node:assert/strict";
import { test } from "node:test";
import {
  candidateUrls,
  composeFromUrl,
  embedSrc,
  getBrandfetchClientId,
  getLogoDevToken,
  isFallbackTile,
  padAndSquareImage,
} from "./logos.ts";
import { fetchConnections, personToBookContact, updateGoogleContactPhoto, type Person } from "./google-contacts.ts";

/** Swap `globalThis.fetch` for the duration of `fn`, always restoring it after. */
async function withMockFetch<T>(mock: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

// ---------------------------------------------------------------------------
// CL-10 — Google import must not silently stop at 12,000 contacts.
// ---------------------------------------------------------------------------

test("CL-10: fetchConnections pages past the old 12-page / 12,000-contact cap", async () => {
  let calls = 0;
  const progress: number[] = [];
  const people = await withMockFetch(
    (async (input: RequestInfo | URL) => {
      calls += 1;
      const u = new URL(String(input));
      const pageToken = u.searchParams.get("pageToken");
      const page = pageToken ? Number(pageToken) : 0;
      // 15 pages of 1000 mirrors the project's own 14,379-contact benchmark
      // from docs/EVALUATION-2026-08.md CL-10, which the old `page < 12` cap
      // truncated by ~2,400 contacts.
      const isLast = page === 14;
      const count = isLast ? 379 : 1000;
      const connections = Array.from({ length: count }, (_, i) => ({
        resourceName: `people/p${page}-${i}`,
      }));
      const body = { connections, ...(isLast ? {} : { nextPageToken: String(page + 1) }) };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch,
    () => fetchConnections("token", (n) => progress.push(n)),
  );

  assert.equal(people.length, 14379, "must not drop contacts past 12,000");
  assert.equal(calls, 15, "must keep paging until nextPageToken is exhausted");
  assert.equal(progress[progress.length - 1], 14379, "progress must be surfaced to the caller");
  assert.ok(progress.length >= 15, "progress must be reported on every page, not just the last");
});

test("CL-10: fetchConnections reports a hit safety bound instead of swallowing it", async () => {
  // A pathological API that never stops returning nextPageToken must not
  // silently truncate the import the way the removed `page < 12` cap did —
  // it must fail loudly so the caller can tell the book is incomplete.
  await withMockFetch(
    (async () =>
      new Response(JSON.stringify({ connections: [{ resourceName: "people/x" }], nextPageToken: "more" }), {
        status: 200,
      })) as typeof fetch,
    () => assert.rejects(() => fetchConnections("token"), /stopped after/i),
  );
});

test("CL-10: fetchConnections retries a 429 with backoff before succeeding", async () => {
  let calls = 0;
  const people = await withMockFetch(
    (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("", { status: 429, headers: { "Retry-After": "0" } });
      }
      return new Response(JSON.stringify({ connections: [{ resourceName: "people/1" }] }), { status: 200 });
    }) as typeof fetch,
    () => fetchConnections("token"),
  );
  assert.equal(calls, 2, "must retry a 429 rather than failing the whole import on the first hit");
  assert.equal(people.length, 1);
});

test("CL-10: fetchConnections surfaces a 429 that outlasts every retry (not silent)", async () => {
  let calls = 0;
  await withMockFetch(
    (async () => {
      calls += 1;
      return new Response("", { status: 429 });
    }) as typeof fetch,
    () => assert.rejects(() => fetchConnections("token"), /rate-limit/i),
  );
  assert.ok(calls >= 2, "must have actually retried before giving up");
});

test("CL-10: Google photo sync retries a 429 before reporting failure", async () => {
  let calls = 0;
  await withMockFetch(
    (async () => {
      calls += 1;
      if (calls === 1) return new Response("", { status: 429, headers: { "Retry-After": "0" } });
      return new Response("", { status: 200 });
    }) as typeof fetch,
    () => updateGoogleContactPhoto("people/1", "data:image/png;base64,AAAA", "token"),
  );
  assert.equal(calls, 2, "a transient 429 must not fail the contact's photo sync outright");
});

test("CL-10: Google photo sync still fails loudly on a real error (no swallow)", async () => {
  await withMockFetch(
    (async () => new Response("nope", { status: 403 })) as typeof fetch,
    () => assert.rejects(() => updateGoogleContactPhoto("people/1", "data:image/png;base64,AAAA", "token"), /403/),
  );
});

test("personToBookContact keeps import source and existing-photo bookkeeping", () => {
  const person: Person = {
    resourceName: "people/42",
    names: [{ displayName: "Dana Reyes", givenName: "Dana", familyName: "Reyes" }],
    photos: [{ url: "https://example.com/p.jpg", default: false }],
  };
  const contact = personToBookContact(person);
  assert.equal(contact?.displayName, "Dana Reyes");
  assert.equal(contact?.importSource, "google");
  assert.equal(contact?.hadExistingPhoto, true);
  assert.equal(contact?.googleResourceName, "people/42");
});

// ---------------------------------------------------------------------------
// CL-18 — fallback-tile detection (docs/ENGINE-CONTRACT.md R11.5).
// ---------------------------------------------------------------------------

test("CL-18: isFallbackTile drops anything under the 512-byte floor", async () => {
  const tiny = new Blob([new Uint8Array(100)], { type: "image/png" });
  const verdict = await isFallbackTile(tiny);
  assert.equal(verdict.isTile, true);
  assert.equal(verdict.reason, "byte-floor");
});

test("CL-18: isFallbackTile does not flag a normal-sized asset on byte size alone", async () => {
  // A real 2-10 KB letter tile is exactly what the old `data.count < 80`
  // floor missed (CL-18); the byte floor alone must not fire above 512
  // bytes — that judgment is left to the pixel test (needs a canvas, so it
  // is inconclusive — not a false positive — outside a browser).
  const normal = new Blob([new Uint8Array(4096)], { type: "image/png" });
  const verdict = await isFallbackTile(normal);
  assert.equal(verdict.isTile, false);
});

test("CL-18: candidateUrls candidates are still ranked/labeled by source when a tile would be dropped", () => {
  // Regression guard for the shared source list: dropping tiles must not
  // remove brandfetch/logodev entries wholesale (see credentialMissing
  // tests below) — only actual tile bytes returned at fetch time are
  // dropped, and that happens in embedSrc/composeFromUrl below.
  const hits = candidateUrls("zzqx-nonexistent-brand-xyz.com");
  assert.ok(hits.some((h) => h.source === "brandfetch"));
});

// ---------------------------------------------------------------------------
// CL-11 — failures on the export path must be detectable, not silently
// swallowed into a reported "success".
// ---------------------------------------------------------------------------

test("CL-11: embedSrc reports why it fell back on a network failure", async () => {
  const reasons: Array<[string, string | undefined]> = [];
  const result = await withMockFetch(
    (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch,
    () => embedSrc("https://logos.example/acme.png", (reason, detail) => reasons.push([reason, detail])),
  );
  assert.equal(result, "https://logos.example/acme.png", "falls back to the input src, as before");
  assert.equal(reasons.length, 1);
  assert.equal(reasons[0][0], "fetch-failed");
});

test("CL-11: embedSrc reports an HTTP failure instead of silently returning the input", async () => {
  const reasons: string[] = [];
  await withMockFetch(
    (async () => new Response("not found", { status: 404 })) as typeof fetch,
    () => embedSrc("https://logos.example/acme.png", (reason) => reasons.push(reason)),
  );
  assert.deepEqual(reasons, ["http-error"]);
});

test("CL-11: embedSrc reports a detected fallback tile instead of embedding it as a match (CL-18 x CL-11)", async () => {
  const reasons: string[] = [];
  const tileBytes = new Uint8Array(200); // above the 40-byte too-small floor, below the 512-byte tile floor
  await withMockFetch(
    (async () => new Response(tileBytes, { status: 200 })) as typeof fetch,
    () => embedSrc("https://cdn.brandfetch.io/zzqx-nonexistent-brand-xyz.com", (reason) => reasons.push(reason)),
  );
  assert.deepEqual(reasons, ["fallback-tile"]);
});

test("CL-11: embedSrc reports oversized/undersized blobs distinctly", async () => {
  const tinyReasons: string[] = [];
  await withMockFetch(
    (async () => new Response(new Uint8Array(5), { status: 200 })) as typeof fetch,
    () => embedSrc("https://logos.example/a.png", (r) => tinyReasons.push(r)),
  );
  assert.deepEqual(tinyReasons, ["too-small"]);

  const hugeReasons: string[] = [];
  await withMockFetch(
    (async () => new Response(new Uint8Array(2_000_000), { status: 200 })) as typeof fetch,
    () => embedSrc("https://logos.example/a.png", (r) => hugeReasons.push(r)),
  );
  assert.deepEqual(hugeReasons, ["too-large"]);
});

test("CL-11: embedSrc without a callback still degrades exactly like before (no breaking change)", async () => {
  const result = await withMockFetch(
    (async () => new Response("nope", { status: 500 })) as typeof fetch,
    () => embedSrc("https://logos.example/a.png"),
  );
  assert.equal(result, "https://logos.example/a.png");
});

test("CL-11: padAndSquareImage falls back unchanged outside a DOM (documented Node behavior)", async () => {
  const reasons: string[] = [];
  const result = await padAndSquareImage("https://logos.example/a.png", {
    onFallback: (r) => reasons.push(r),
  });
  assert.equal(result, "https://logos.example/a.png");
  // No document/canvas in this environment, so this is the documented
  // Node-test fallback path, not a reported failure — onFallback only fires
  // for a real decode/taint failure, which requires a DOM to observe.
  assert.deepEqual(reasons, []);
});

test("CL-11: composeFromUrl throws with a specific reason instead of silently degrading", async () => {
  await withMockFetch(
    (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch,
    () => assert.rejects(() => composeFromUrl("https://logos.example/a.png"), /Could not reach that URL/),
  );

  await withMockFetch(
    (async () => new Response("nope", { status: 500 })) as typeof fetch,
    () => assert.rejects(() => composeFromUrl("https://logos.example/a.png"), /HTTP 500/),
  );

  await withMockFetch(
    (async () => new Response(new Uint8Array(200), { status: 200, headers: { "content-type": "image/png" } })) as typeof fetch,
    () => assert.rejects(() => composeFromUrl("https://logos.example/a.png"), /placeholder tile/),
  );
});

// ---------------------------------------------------------------------------
// CL-18 (CDN credentials) — Brandfetch/Logo.dev URLs must not silently 403.
// ---------------------------------------------------------------------------

test("CDN credentials: brandfetch/logodev candidates are flagged when no credential is configured", () => {
  assert.equal(getBrandfetchClientId(), "", "no client id configured in this test environment");
  assert.equal(getLogoDevToken(), "", "no token configured in this test environment");

  const hits = candidateUrls("apple.com");
  const brandfetch = hits.find((h) => h.source === "brandfetch");
  const logodev = hits.find((h) => h.source === "logodev");
  assert.ok(brandfetch);
  assert.ok(logodev);
  assert.equal(brandfetch?.credentialMissing, "VITE_BRANDFETCH_CLIENT_ID");
  assert.equal(logodev?.credentialMissing, "VITE_LOGODEV_TOKEN");
  // The URL must still be emitted (other engines/tests depend on the source
  // list being stable) — just explicitly marked as doomed to 403, rather
  // than silently advancing to the next candidate as if it were merely
  // broken (docs/EVALUATION-2026-08.md CL-18).
  assert.ok(brandfetch?.src.startsWith("https://cdn.brandfetch.io/"));
  assert.ok(logodev?.src.startsWith("https://img.logo.dev/"));
});
