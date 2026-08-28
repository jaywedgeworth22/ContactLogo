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

test("CL-18: candidateUrls still returns a ranked list when a tile would be dropped", () => {
  // Tile detection happens at fetch time in embedSrc/composeFromUrl, not here.
  // Brandfetch is no longer offered without a credential, so clearbit leads for
  // an unknown brand and is deliberately medium tier.
  const hits = candidateUrls("zzqx-nonexistent-brand-xyz.com");
  assert.ok(hits.length > 0);
  assert.equal(hits[0]?.source, "clearbit");
  assert.equal(hits.some((h) => h.source === "brandfetch"), false);
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

/**
 * `composeFromUrl` loads through `<img>` and a canvas rather than `fetch` (#34),
 * so the CSP needs only `img-src https:` instead of `connect-src https:`.  That
 * means the failures worth pinning are no longer HTTP statuses but image ones:
 * a URL that will not decode, one too small to be a logo, a provider's
 * placeholder tile, and a host whose canvas cannot be read back.
 *
 * Enough of a DOM to drive the real code path, installed and removed per call —
 * this file's `padAndSquareImage` test asserts the *absence* of `document`, and
 * a global stub would quietly turn that into a different test.
 */
type StubPixels = { width: number; height: number; fill?: (x: number, y: number) => [number, number, number] };

async function withStubCanvas<T>(
  image: { width: number; height: number; fails?: boolean } | null,
  pixels: StubPixels | "tainted",
  fn: () => Promise<T>,
): Promise<T> {
  const g = globalThis as Record<string, unknown>;
  const hadDoc = "document" in g;
  const hadImage = "Image" in g;
  const priorDoc = g.document;
  const priorImage = g.Image;

  g.Image = class {
    crossOrigin = "";
    naturalWidth = image?.width ?? 0;
    naturalHeight = image?.height ?? 0;
    width = image?.width ?? 0;
    height = image?.height ?? 0;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) {
      queueMicrotask(() => (image && !image.fails ? this.onload?.() : this.onerror?.()));
    }
  };
  g.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        imageSmoothingEnabled: false,
        imageSmoothingQuality: "low",
        drawImage: () => {},
        getImageData: (_x: number, _y: number, w: number, h: number) => {
          if (pixels === "tainted") throw new Error("SecurityError: tainted canvas");
          const data = new Uint8ClampedArray(w * h * 4);
          for (let y = 0; y < h; y += 1) {
            for (let x = 0; x < w; x += 1) {
              const [r, gr, b] = pixels.fill ? pixels.fill(x, y) : [255, 255, 255];
              const i = (y * w + x) * 4;
              data[i] = r;
              data[i + 1] = gr;
              data[i + 2] = b;
              data[i + 3] = 255;
            }
          }
          return { data };
        },
      }),
      toDataURL: () => {
        if (pixels === "tainted") throw new Error("SecurityError: tainted canvas");
        return "data:image/png;base64,STUB";
      },
    }),
  };

  try {
    return await fn();
  } finally {
    if (hadDoc) g.document = priorDoc;
    else delete g.document;
    if (hadImage) g.Image = priorImage;
    else delete g.Image;
  }
}

/** A provider's letter tile: one small centred glyph on a flat field. */
const LETTER_TILE: StubPixels = {
  width: 64,
  height: 64,
  fill: (x, y) => (x >= 26 && x < 38 && y >= 26 && y < 38 ? [20, 20, 20] : [230, 120, 90]),
};

/** A real mark: ink spread wide enough that the tile test rejects it. */
const REAL_MARK: StubPixels = {
  width: 64,
  height: 64,
  fill: (x, y) => (x >= 6 && x < 58 && y >= 6 && y < 58 ? [10, 40, 200] : [255, 255, 255]),
};

test("CL-11 / #34: composeFromUrl throws with a specific reason instead of silently degrading", async () => {
  await assert.rejects(() => composeFromUrl("ftp://logos.example/a.png"), /http\(s\) image URL/);

  await withStubCanvas({ width: 0, height: 0, fails: true }, REAL_MARK, () =>
    assert.rejects(() => composeFromUrl("https://logos.example/a.png"), /Could not load that URL as an image/),
  );

  await withStubCanvas({ width: 16, height: 16 }, REAL_MARK, () =>
    assert.rejects(() => composeFromUrl("https://logos.example/favicon.ico"), /16x16 — too small to be a logo/),
  );

  await withStubCanvas({ width: 256, height: 256 }, LETTER_TILE, () =>
    assert.rejects(() => composeFromUrl("https://logos.example/a.png"), /placeholder tile/),
  );

  await withStubCanvas({ width: 256, height: 256 }, "tainted", () =>
    assert.rejects(() => composeFromUrl("https://logos.example/a.png"), /does not allow its images to be reused/),
  );
});

test("#34: a real pasted mark comes back as a data URL, never as the remote URL", async () => {
  const out = await withStubCanvas({ width: 256, height: 256 }, REAL_MARK, () =>
    composeFromUrl("  https://logos.example/mark.svg  "),
  );
  assert.ok(out.startsWith("data:image/png;base64,"), `expected a data URL, got ${out.slice(0, 40)}`);
});

test("#34: composeFromUrl never calls fetch, so connect-src does not have to allow the host", async () => {
  let fetched = 0;
  await withMockFetch(
    (async () => {
      fetched += 1;
      throw new Error("composeFromUrl must not reach the network through fetch");
    }) as typeof fetch,
    () =>
      withStubCanvas({ width: 256, height: 256 }, REAL_MARK, async () => {
        await composeFromUrl("https://anything.example/mark.png");
      }),
  );
  assert.equal(fetched, 0, "composeFromUrl used fetch — the CSP loosening it was meant to remove is still needed");
});

// ---------------------------------------------------------------------------
// CL-18 (CDN credentials) — Brandfetch/Logo.dev URLs must not silently 403.
// ---------------------------------------------------------------------------

test("CDN credentials: an unusable provider is not offered at all", () => {
  assert.equal(getBrandfetchClientId(), "", "no client id configured in this test environment");
  assert.equal(getLogoDevToken(), "", "no token configured in this test environment");

  const hits = candidateUrls("apple.com");
  assert.equal(hits.some((h) => h.source === "brandfetch"), false);
  assert.equal(hits.some((h) => h.source === "logodev"), false);

  // These used to be emitted and merely flagged `credentialMissing`, on the
  // reasoning that the source list should stay stable. That put an unusable URL
  // at index 0 for every domain with no Simple Icons or ticker hit, and R11.2
  // rates Brandfetch high tier -- so the card was pre-checked at high.
  //
  // Probed 2026-08-28, both without credentials:
  //   cdn.brandfetch.io/<domain>/w/512/h/512  302 -> docs.brandfetch.com,
  //                                           200 text/html, 413 KB
  //   img.logo.dev/<domain>?size=512          401 application/json
  //
  // Brandfetch is the dangerous one: it resolves, so nothing 404s and the card
  // stays pre-checked while pointing at an HTML page.
  //
  // Consequence worth knowing: with no credentials, a domain with no curated
  // mark now tops out at medium, because clearbit is deliberately not high
  // tier. Fewer contacts are pre-checked, which is the honest outcome.
  assert.equal(candidateUrls("apple.com")[0]?.source, "simpleicons");
  assert.equal(candidateUrls("some-agency-with-no-icon.com")[0]?.source, "clearbit");
});
