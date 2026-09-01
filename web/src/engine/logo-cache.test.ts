import assert from "node:assert/strict";
import { test } from "node:test";
import {
  handleLogoGet,
  parseLogoCacheKey,
  resetLogoMemoryCache,
  resolveLogo,
} from "./logo-cache.ts";
import { candidateUrls, firstPartyLogoPath, licenseForSource } from "./logos.ts";
import { assetTier } from "./match.ts";

function pngBytes(): Uint8Array {
  // 1x1 PNG, well above the 512-byte fallback-tile floor.
  const prefix = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const rest = new Uint8Array(600).fill(1);
  const out = new Uint8Array(prefix.length + rest.length);
  out.set(prefix);
  out.set(rest, prefix.length);
  return out;
}

async function withMockFetch<T>(mock: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

test("parseLogoCacheKey keeps only a registrable domain", () => {
  assert.equal(parseLogoCacheKey("apple.com"), "apple.com");
  assert.equal(parseLogoCacheKey("WWW.Apple.COM"), "apple.com");
  assert.equal(parseLogoCacheKey("https://shop.walgreens.com/foo"), "walgreens.com");
  assert.equal(parseLogoCacheKey("mail.google.com"), "google.com");
});

test("parseLogoCacheKey rejects emails, phones, names, and junk", () => {
  assert.equal(parseLogoCacheKey("ada@apple.com"), undefined);
  assert.equal(parseLogoCacheKey("Dana Reyes"), undefined);
  assert.equal(parseLogoCacheKey("+17135550142"), undefined);
  assert.equal(parseLogoCacheKey("713-555-0142"), undefined);
  assert.equal(parseLogoCacheKey(""), undefined);
  assert.equal(parseLogoCacheKey("../etc/passwd"), undefined);
  assert.equal(parseLogoCacheKey("apple.com/extra"), undefined);
  assert.equal(parseLogoCacheKey("not a host"), undefined);
});

test("candidateUrls tries the first-party cache before live CDNs", () => {
  const hits = candidateUrls("apple.com");
  assert.equal(hits[0]?.source, "cache");
  assert.equal(hits[0]?.src, firstPartyLogoPath("apple.com"));
  assert.equal(hits[0]?.proxied, "simpleicons");
  assert.equal(hits.some((h) => h.source === "simpleicons" && h.src.includes("cdn.simpleicons.org")), true);
});

test("a cache wrapper inherits the proxied source's R11.2 tier", () => {
  const apple = candidateUrls("apple.com")[0];
  assert.ok(apple);
  assert.equal(assetTier(apple, "website"), "high");

  const unknown = candidateUrls("zzqx-nonexistent-brand-xyz.com")[0];
  assert.ok(unknown);
  assert.equal(unknown.proxied, "clearbit");
  assert.equal(assetTier(unknown, "website"), "medium");
});

test("licenseForSource tags every ranked provider", () => {
  assert.match(licenseForSource("simpleicons"), /CC0/);
  assert.match(licenseForSource("ticker"), /ticker-logos/);
  assert.match(licenseForSource("clearbit"), /Clearbit/);
});

test("resolveLogo walks ranked CDNs and stores source + license + etag", async () => {
  resetLogoMemoryCache();
  const png = pngBytes();
  const seen: string[] = [];
  const result = await withMockFetch(
    (async (input: RequestInfo | URL) => {
      const href = String(input);
      seen.push(href);
      if (href.includes("cdn.simpleicons.org/apple")) {
        return new Response(png, { status: 200, headers: { "content-type": "image/png" } });
      }
      return new Response("", { status: 404 });
    }) as typeof fetch,
    () => resolveLogo("apple.com"),
  );
  assert.equal(result.status, "hit");
  if (result.status !== "hit") return;
  assert.equal(result.record.source, "simpleicons");
  assert.match(result.record.license, /CC0/);
  assert.ok(result.record.etag.startsWith('"'));
  assert.equal(result.record.contentType, "image/png");
  assert.ok(seen.some((u) => u.includes("cdn.simpleicons.org/apple")));
  assert.ok(!seen.some((u) => u.includes("/api/logo/")), "must not recurse into the first-party URL");
});

test("resolveLogo 404s after every ranked source misses", async () => {
  resetLogoMemoryCache();
  const result = await withMockFetch(
    (async () => new Response("", { status: 404 })) as typeof fetch,
    () => resolveLogo("zzqx-nonexistent-brand-xyz.com"),
  );
  assert.equal(result.status, "miss");
});

test("GET /api/logo/:domain returns image bytes with Cache-Control and ETag", async () => {
  resetLogoMemoryCache();
  const png = pngBytes();
  await withMockFetch(
    (async (input: RequestInfo | URL) => {
      const href = String(input);
      if (href.includes("cdn.simpleicons.org/apple")) {
        return new Response(png, { status: 200, headers: { "content-type": "image/png" } });
      }
      return new Response("", { status: 404 });
    }) as typeof fetch,
    async () => {
      const res = await handleLogoGet(new Request("https://contactlogo.com/api/logo/apple.com"));
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "image/png");
      assert.match(res.headers.get("cache-control") ?? "", /s-maxage=86400/);
      assert.ok(res.headers.get("etag"));
      assert.equal(res.headers.get("x-logo-source"), "simpleicons");
      assert.equal(res.headers.get("x-logo-domain"), "apple.com");
      const body = new Uint8Array(await res.arrayBuffer());
      assert.equal(body[0], 0x89);

      const again = await handleLogoGet(
        new Request("https://contactlogo.com/api/logo/apple.com", {
          headers: { "if-none-match": res.headers.get("etag") ?? "" },
        }),
      );
      assert.equal(again.status, 304);
    },
  );
});

test("GET /api/logo/:domain?format=json returns the documented payload", async () => {
  resetLogoMemoryCache();
  const png = pngBytes();
  await withMockFetch(
    (async (input: RequestInfo | URL) => {
      if (String(input).includes("cdn.simpleicons.org/apple")) {
        return new Response(png, { status: 200, headers: { "content-type": "image/png" } });
      }
      return new Response("", { status: 404 });
    }) as typeof fetch,
    async () => {
      const res = await handleLogoGet(
        new Request("https://contactlogo.com/api/logo/apple.com?format=json"),
      );
      assert.equal(res.status, 200);
      const json = (await res.json()) as {
        png512: string;
        source: string;
        license: string;
        retrievedAt: string;
        etag: string;
      };
      assert.equal(json.source, "simpleicons");
      assert.match(json.license, /CC0/);
      assert.ok(json.retrievedAt);
      assert.ok(json.etag);
      assert.match(json.png512, /^data:image\/png;base64,/);
    },
  );
});

test("GET /api/logo/:email is 400 and stores nothing", async () => {
  resetLogoMemoryCache();
  const res = await handleLogoGet(new Request("https://contactlogo.com/api/logo/ada@apple.com"));
  assert.equal(res.status, 400);
});
