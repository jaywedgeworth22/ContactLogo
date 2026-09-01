import { lookupCompanyDomain, lookupCompanyTicker } from "./catalog.ts";
import { getBrandfetchClientId, getLogoDevToken } from "./settings.ts";

export type LogoSourceName =
  | "cache"
  | "preferred"
  | "simpleicons"
  | "ticker"
  | "brandfetch"
  | "logodev"
  | "clearbit"
  | "google"
  | "favicon"
  | "upload"
  | "crop"
  | "url";

export type LogoHit = {
  src: string;
  source: LogoSourceName;
  kind: "icon" | "unknown";
  /**
   * When `source` is `cache`, the ranked CDN this first-party URL is wrapping.
   * Used so R11.2 tiers the mark by what the cache would serve, not by the
   * wrapper itself (a cache hit of Clearbit must not inherit Simple Icons'
   * high).
   */
  proxied?: LogoSourceName;
  /**
   * Set when this candidate's CDN requires a credential ContactLogo does not
   * have configured (e.g. Brandfetch's `c=` client id, Logo.dev's `token`).
   * The URL is still emitted — some deployments do configure the key, and the
   * source list itself must stay stable — but callers can use this to warn
   * the user or skip the doomed request instead of silently hitting a 403 and
   * advancing to the next candidate as if this one were merely broken.
   * Holds the name of the missing env var.
   */
};

function assertNever(value: never): never {
  throw new Error(`unhandled logo value: ${String(value)}`);
}

const SIMPLE_SLUGS: Record<string, string> = {
  "apple.com": "apple",
  "google.com": "google",
  "meta.com": "meta",
  "facebook.com": "facebook",
  "instagram.com": "instagram",
  "tesla.com": "tesla",
  "nvidia.com": "nvidia",
  "netflix.com": "netflix",
  "spotify.com": "spotify",
  "salesforce.com": "salesforce",
  "intel.com": "intel",
  "cisco.com": "cisco",
  "stripe.com": "stripe",
  "paypal.com": "paypal",
  "visa.com": "visa",
  "mastercard.com": "mastercard",
  "americanexpress.com": "americanexpress",
  "chase.com": "chase",
  "jpmorganchase.com": "chase",
  "bankofamerica.com": "bankofamerica",
  "wellsfargo.com": "wellsfargo",
  "verizon.com": "verizon",
  "att.com": "atandt",
  "united.com": "unitedairlines",
  "aa.com": "americanairlines",
  "southwest.com": "southwestairlines",
  "fedex.com": "fedex",
  "ups.com": "ups",
  "usps.com": "usps",
  "target.com": "target",
  "starbucks.com": "starbucks",
  "mcdonalds.com": "mcdonalds",
  "uber.com": "uber",
  "lyft.com": "lyft",
  "doordash.com": "doordash",
  "airbnb.com": "airbnb",
  "nike.com": "nike",
  "samsung.com": "samsung",
  "sony.com": "sony",
  "ford.com": "ford",
  "bmw.com": "bmw",
  "x.ai": "x",
  "x.com": "x",
  "twitter.com": "x",
  "github.com": "github",
  "youtube.com": "youtube",
  "discord.com": "discord",
  "zoom.us": "zoom",
  "notion.so": "notion",
  "figma.com": "figma",
  "dropbox.com": "dropbox",
  "pinterest.com": "pinterest",
  "reddit.com": "reddit",
  "tiktok.com": "tiktok",
  "whatsapp.com": "whatsapp",
  "telegram.org": "telegram",
  "signal.org": "signal",
  "ebay.com": "ebay",
  "shopify.com": "shopify",
  "spacex.com": "spacex",
  "starlink.com": "spacex",
  "squareup.com": "square",
};

const SKIP_SIMPLE = new Set(["delta.com"]);

const PREFERRED: Record<string, string> = {
  "delta.com":
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 443.13 354"><polygon fill="#E31937" points="16.25,316.21 221.56,0 221.56,217.38"/><polygon fill="#E31937" points="0,354 221.56,354 221.56,260.39"/><polygon fill="#98002E" points="221.56,217.38 221.56,0 426.87,316.21"/><polygon fill="#98002E" points="221.56,260.39 221.56,354 443.13,354"/></svg>',
};

export function simpleIconsSlug(domain: string): string | undefined {
  if (SKIP_SIMPLE.has(domain)) return undefined;
  return SIMPLE_SLUGS[domain];
}

/** Brandfetch's Logo Link CDN 403s without a client id (`?c=`).  See docs/HANDOFF-LOCAL.md. */
export { getBrandfetchClientId, getLogoDevToken };

/** Same-origin path for the domain-keyed first-party cache.  Never a contact key. */
export function firstPartyLogoPath(domain: string): string {
  return `/api/logo/${encodeURIComponent(domain)}`;
}

export function isFirstPartyLogoSrc(src: string): boolean {
  if (!src) return false;
  try {
    const path = src.startsWith("http://") || src.startsWith("https://") ? new URL(src).pathname : src.split("?")[0] ?? src;
    return /\/api\/logo\//.test(path);
  } catch {
    return /\/api\/logo\//.test(src);
  }
}

/**
 * Ranked live CDNs + preferred inline marks.  The first-party cache walks this
 * list; `candidateUrls` prepends the cache URL so the web engine tries
 * same-origin first and falls through on 404.
 */
export function cdnCandidateUrls(domain: string): LogoHit[] {
  const out: LogoHit[] = [];
  const svg = PREFERRED[domain];
  if (svg) {
    out.push({
      src: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
      source: "preferred",
      kind: "icon",
    });
  }
  const slug = simpleIconsSlug(domain);
  if (slug && !SKIP_SIMPLE.has(domain)) {
    out.push({
      src: `https://cdn.simpleicons.org/${encodeURIComponent(slug)}`,
      source: "simpleicons",
      kind: "icon",
    });
  }
  const ticker = lookupCompanyTicker(domain);
  if (ticker) {
    out.push({
      src: `https://raw.githubusercontent.com/davidepalazzo/ticker-logos/main/ticker_icons/${encodeURIComponent(ticker)}.png`,
      source: "ticker",
      kind: "icon",
    });
  }
  // R11.2 rates Brandfetch a high tier source, so an unusable Brandfetch URL at
  // index 0 becomes the pre-checked winner for every domain without a Simple
  // Icons or ticker hit.  Neither provider serves anything without its
  // credential — probed 2026-08-28:
  //
  //   cdn.brandfetch.io/<domain>/w/512/h/512   302 -> docs.brandfetch.com,
  //                                            200 text/html, 413 KB
  //   img.logo.dev/<domain>?size=512           401 application/json
  //
  // The Brandfetch case is the worse one: it resolves, so nothing 404s and the
  // card stays pre-checked at high while pointing at an HTML page.  A candidate
  // that cannot be a logo does not belong in the ranked list at all.
  const brandfetchClientId = getBrandfetchClientId();
  if (brandfetchClientId) {
    out.push({
      src: `https://cdn.brandfetch.io/${encodeURIComponent(domain)}/w/512/h/512?c=${encodeURIComponent(brandfetchClientId)}`,
      source: "brandfetch",
      kind: "icon",
    });
  }
  const logoDevToken = getLogoDevToken();
  if (logoDevToken) {
    out.push({
      src: `https://img.logo.dev/${encodeURIComponent(domain)}?size=512&token=${encodeURIComponent(logoDevToken)}`,
      source: "logodev",
      kind: "icon",
    });
  }
  out.push({
    src: `https://logo.clearbit.com/${encodeURIComponent(domain)}?size=512`,
    source: "clearbit",
    kind: "icon",
  });
  out.push({
    src: `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${encodeURIComponent(domain)}&size=256`,
    source: "google",
    kind: "icon",
  });
  out.push({
    src: `https://icons.duckduckgo.com/ip3/${domain}.ico`,
    source: "favicon",
    kind: "icon",
  });
  return out;
}

export function candidateUrls(domain: string): LogoHit[] {
  const cdn = cdnCandidateUrls(domain);
  if (cdn.length === 0) return [];
  return [
    {
      src: firstPartyLogoPath(domain),
      source: "cache",
      kind: "icon",
      proxied: cdn[0]?.source,
    },
    ...cdn,
  ];
}

/** SPDX-ish tag stored with a cached mark.  Never a contact identifier. */
export function licenseForSource(source: LogoSourceName): string {
  switch (source) {
    case "preferred":
      return "trademark; curated inline mark";
    case "simpleicons":
      return "CC0-1.0 OR MIT";
    case "ticker":
      return "upstream ticker-logos (davidepalazzo/ticker-logos)";
    case "brandfetch":
      return "Brandfetch Logo Link terms";
    case "logodev":
      return "Logo.dev terms";
    case "clearbit":
      return "Clearbit Logo API terms";
    case "google":
      return "Google Favicon Service terms";
    case "favicon":
      return "origin-site favicon; license unknown";
    case "cache":
      return "see proxied source";
    case "upload":
      return "user upload";
    case "crop":
      return "user crop";
    case "url":
      return "user-pasted URL";
    default:
      return assertNever(source);
  }
}

/**
 * Advance past a broken or tiny raster.  Never wrap: `(i+1)%n` plus `render()`
 * livelocks review when every remaining source is a 16px favicon.
 */
export function nextCandidateIndex(current: number, count: number): number | undefined {
  if (count <= 1) return undefined;
  const next = current + 1;
  return next < count ? next : undefined;
}

export function candidatesForName(name: string): LogoHit[] {
  const domain = lookupCompanyDomain(name);
  return domain ? candidateUrls(domain) : [];
}

export function sourceLabel(source: LogoSourceName): string {
  switch (source) {
    case "cache":
      return "ContactLogo cache";
    case "preferred":
      return "Iconic mark";
    case "simpleicons":
      return "Simple Icons";
    case "ticker":
      return "Stock Ticker Pack (HD)";
    case "brandfetch":
      return "Brandfetch (HD)";
    case "logodev":
      return "Logo.dev (HD)";
    case "clearbit":
      return "Clearbit (512px)";
    case "google":
      return "Google (256px)";
    case "favicon":
      return "Favicon";
    case "upload":
      return "Your file";
    case "crop":
      return "Custom crop";
    case "url":
      return "Pasted URL";
    default:
      return assertNever(source);
  }
}

export function viaLabel(via?: string): string {
  switch (via) {
    case "phone":
      return "found by phone";
    case "catalog":
      return "known company";
    case "website":
      return "from website";
    case "email":
      return "from email";
    case "guess":
      return "guessed from name";
    case undefined:
    case "":
      return "";
    default:
      return via;
  }
}

export function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read image"));
    reader.readAsDataURL(blob);
  });
}

export type FallbackTileVerdict = { isTile: boolean; reason?: string };

const FALLBACK_TILE_MIN_BYTES = 512;

/**
 * docs/ENGINE-CONTRACT.md R11.5 — detect a provider's colored single-letter
 * fallback tile (what Brandfetch, Logo.dev and Clearbit return for a domain
 * they don't recognize) so the caller can treat it as "not found" instead of
 * a real match, exactly as CL-18 requires.
 *
 * Step 1 of R11.5 (the provider's own `fallback`/`letter` JSON flag) needs the
 * API response, not just the CDN image bytes we have here, so only steps 2–3
 * are implemented: a byte floor, then a pixel test for a single centred glyph
 * on a flat field. The pixel test needs a canvas; outside a browser (e.g. the
 * Node test run) only the byte floor applies.
 */
/**
 * R11.5 step 2 defines the byte floor for a "PNG/JPEG/GIF payload".  Applying it
 * to everything drops real vector marks: `cdn.simpleicons.org/chase` is 377
 * bytes and is the genuine article, so the floor rejected it as a tile and both
 * `composeFromUrl` and `embedSrc` lost it.
 *
 * Checked by MIME type and, when the type is missing or unhelpful, by sniffing
 * the first bytes for an XML/SVG prologue.  Anything that is not identifiably
 * vector keeps the floor — a tiny unknown payload is still not a usable logo.
 */
async function looksVector(blob: Blob): Promise<boolean> {
  if (/svg/i.test(blob.type)) return true;
  try {
    const head = (await blob.slice(0, 256).text()).trimStart().toLowerCase();
    return head.startsWith("<svg") || head.startsWith("<?xml");
  } catch {
    return false;
  }
}

export async function isFallbackTile(blob: Blob): Promise<FallbackTileVerdict> {
  if (blob.size < FALLBACK_TILE_MIN_BYTES && !(await looksVector(blob))) {
    return { isTile: true, reason: "byte-floor" };
  }
  if (typeof document === "undefined" || typeof Image === "undefined") {
    return { isTile: false };
  }
  try {
    return await pixelFallbackTileTest(blob);
  } catch {
    return { isTile: false };
  }
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode image"));
    img.src = src;
  });
}

async function pixelFallbackTileTest(blob: Blob): Promise<FallbackTileVerdict> {
  const dataUrl = await readAsDataUrl(blob);
  return fallbackTileFromImage(await loadImageElement(dataUrl));
}

/**
 * R11.5 step 3 on an image that is already decoded.  `composeFromUrl` loads the
 * pasted URL through `<img>` rather than `fetch` (#34) and so never holds a
 * Blob; splitting the test here lets both callers share one implementation
 * instead of the paste path growing a second, drifting copy.
 */
function fallbackTileFromImage(img: HTMLImageElement): FallbackTileVerdict {
  const w = Math.max(1, Math.min(64, img.naturalWidth || img.width || 64));
  const h = Math.max(1, Math.min(64, img.naturalHeight || img.height || 64));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { isTile: false };
  ctx.drawImage(img, 0, 0, w, h);

  let pixels: ImageData;
  try {
    pixels = ctx.getImageData(0, 0, w, h);
  } catch {
    return { isTile: false }; // tainted canvas — can't inspect pixels
  }
  const { data } = pixels;
  const at = (x: number, y: number): readonly [number, number, number] => {
    const i = (y * w + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const cornerMean = (x0: number, y0: number): readonly [number, number, number] => {
    const bw = Math.min(8, w);
    const bh = Math.min(8, h);
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let y = y0; y < y0 + bh && y < h; y += 1) {
      for (let x = x0; x < x0 + bw && x < w; x += 1) {
        const [pr, pg, pb] = at(x, y);
        r += pr;
        g += pg;
        b += pb;
        n += 1;
      }
    }
    return n ? [r / n, g / n, b / n] : [0, 0, 0];
  };
  const corners = [
    cornerMean(0, 0),
    cornerMean(Math.max(0, w - 8), 0),
    cornerMean(0, Math.max(0, h - 8)),
    cornerMean(Math.max(0, w - 8), Math.max(0, h - 8)),
  ];
  const bg = corners[0];
  for (const c of corners) {
    if (Math.abs(c[0] - bg[0]) > 8 || Math.abs(c[1] - bg[1]) > 8 || Math.abs(c[2] - bg[2]) > 8) {
      return { isTile: false, reason: "corners-not-flat" };
    }
  }

  let ink = 0;
  let sumX = 0;
  let sumY = 0;
  let minX = w;
  let maxX = 0;
  let minY = h;
  let maxY = 0;
  const quantized = new Set<string>();
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [r, g, b] = at(x, y);
      if (Math.abs(r - bg[0]) > 32 || Math.abs(g - bg[1]) > 32 || Math.abs(b - bg[2]) > 32) {
        ink += 1;
        sumX += x;
        sumY += y;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        quantized.add(`${r >> 3},${g >> 3},${b >> 3}`);
      }
    }
  }
  const inkFraction = ink / (w * h);
  if (inkFraction < 0.02 || inkFraction > 0.22) {
    return { isTile: false, reason: "ink-fraction" };
  }
  const centerXFrac = Math.abs(sumX / ink - w / 2) / w;
  const centerYFrac = Math.abs(sumY / ink - h / 2) / h;
  if (centerXFrac > 0.12 || centerYFrac > 0.12) {
    return { isTile: false, reason: "off-center" };
  }
  const bboxWFrac = (maxX - minX + 1) / w;
  const bboxHFrac = (maxY - minY + 1) / h;
  if (bboxWFrac > 0.55 || bboxHFrac > 0.55) {
    return { isTile: false, reason: "bbox-too-large" };
  }
  if (quantized.size > 2) {
    return { isTile: false, reason: "too-many-colors" };
  }
  return { isTile: true, reason: "pixel-test" };
}

/**
 * Reasons `embedSrc` / `padAndSquareImage` fell back to their input instead
 * of producing an embedded/composited image — CL-11's "make the failure
 * detectable by the caller".  Passed to an optional callback rather than
 * folded into the return type, so existing callers (which treat the return
 * value as the best-effort src) keep compiling and keep working, while a
 * caller that wants to surface the failure (e.g. warn instead of reporting
 * unconditional success) can opt in.
 */
export type LogoFallbackReason =
  | "fetch-failed"
  | "http-error"
  | "too-small"
  | "too-large"
  | "fallback-tile"
  | "canvas-tainted"
  | "decode-failed";

export type LogoFallbackHandler = (reason: LogoFallbackReason, detail?: string) => void;

export async function composeFromFile(file: File): Promise<string> {
  if (!file.type.startsWith("image/") && file.type !== "image/svg+xml") {
    throw new Error("Choose an image file");
  }
  if (file.size > 3_000_000) throw new Error("Keep uploads under 3 MB");
  return readAsDataUrl(file);
}

/** Largest canvas a pasted image is rasterized into; the old cap was 3 MB of bytes. */
const PASTE_MAX_EDGE = 2048;
/** Below this a mark is a favicon, not a logo — the floor `isTooSmall` already uses. */
const PASTE_MIN_EDGE = 48;

/**
 * Load a pasted logo URL through `<img>` and a canvas rather than `fetch`.
 *
 * The point is the Content-Security-Policy (#34).  `fetch` against a host the
 * user names cannot be expressed as an allowlist, so the policy had to carry
 * `connect-src ... https:` — which stops connect-src being an exfiltration
 * barrier for an app that holds the whole address book in memory.  An image
 * needs only `img-src https:`, and an image can leak a URL but cannot read a
 * response, so it is strictly the weaker capability.  Verified in a browser
 * under `img-src 'self' data: blob: https:` with `connect-src 'self'` and
 * nothing else: the image path loads, reads back and encodes; `fetch` to the
 * same URL is refused by the policy.
 *
 * The same set of hosts works as before.  `crossOrigin = "anonymous"` means a
 * host with no `Access-Control-Allow-Origin` fails at load rather than tainting
 * the canvas, which is the same set `fetch(mode: "cors")` already rejected —
 * only the wording of the failure changes.
 *
 * Two things genuinely change, both stated rather than smoothed over:
 *
 * - **No byte floor.** R11.5 step 2 needs the payload size, and an `<img>` never
 *   exposes it.  Step 3's pixel test still runs and is the stronger check, and
 *   the dimension floor below catches the case the byte floor was really for.
 * - **An SVG comes back as PNG**, because a canvas has no other output.  It is
 *   drawn at its natural size and never upscaled, so this is not a visible
 *   change: `padAndSquareImage` caps `baseScale` at 1.0, so a pasted SVG was
 *   already composited at the size the browser gave it.
 */
export async function composeFromUrl(raw: string): Promise<string> {
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) throw new Error("Paste an http(s) image URL");
  if (typeof document === "undefined" || typeof Image === "undefined") {
    throw new Error("Pasting an image URL needs a browser");
  }

  let img: HTMLImageElement;
  try {
    img = await loadImageElement(trimmed);
  } catch {
    throw new Error(
      "Could not load that URL as an image — it may not be an image, the host may be unreachable, or the host may not allow cross-origin use.",
    );
  }

  const naturalW = img.naturalWidth || img.width;
  const naturalH = img.naturalHeight || img.height;
  if (!naturalW || !naturalH) throw new Error("That URL is not an image");
  if (naturalW < PASTE_MIN_EDGE || naturalH < PASTE_MIN_EDGE) {
    throw new Error(
      `That image is ${naturalW}x${naturalH} — too small to be a logo. Paste one at least ${PASTE_MIN_EDGE}px on each side.`,
    );
  }

  // Never upscale: a blown-up favicon is a worse logo than a small one, and the
  // apply path re-renders from this data URL anyway.
  const scale = Math.min(1, PASTE_MAX_EDGE / Math.max(naturalW, naturalH));
  const width = Math.max(1, Math.round(naturalW * scale));
  const height = Math.max(1, Math.round(naturalH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser could not render that image");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);

  if (fallbackTileFromImage(img).isTile) {
    throw new Error("That URL looks like a placeholder tile, not a real logo — try another source.");
  }

  try {
    return canvas.toDataURL("image/png");
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`That host does not allow its images to be reused: ${detail}`);
  }
}

/**
 * Embed a remote logo as a data URL so the downloaded vCard is self-contained.
 * On any failure to do that — network, HTTP, size, or a detected fallback
 * tile — falls back to returning `src` unchanged (as before, so existing
 * callers keep working) but, when given `onFallback`, reports *why*, so a
 * caller can stop reporting the export as an unqualified success (CL-11).
 */
export async function embedSrc(src: string, onFallback?: LogoFallbackHandler): Promise<string> {
  if (src.startsWith("data:image/")) return src;
  let res: Response;
  try {
    res = await fetch(src, { mode: "cors" });
  } catch (err) {
    onFallback?.("fetch-failed", err instanceof Error ? err.message : String(err));
    return src;
  }
  if (!res.ok) {
    onFallback?.("http-error", String(res.status));
    return src;
  }
  const blob = await res.blob();
  if (blob.size < 40) {
    onFallback?.("too-small", `${blob.size} bytes`);
    return src;
  }
  if (blob.size > 1_500_000) {
    onFallback?.("too-large", `${blob.size} bytes`);
    return src;
  }
  try {
    const tile = await isFallbackTile(blob);
    if (tile.isTile) {
      onFallback?.("fallback-tile", tile.reason);
      return src;
    }
  } catch {
    /* inconclusive — proceed to embed rather than block on a heuristic that errored */
  }
  try {
    return await readAsDataUrl(blob);
  } catch (err) {
    onFallback?.("decode-failed", err instanceof Error ? err.message : String(err));
    return src;
  }
}

export type PadAndSquareOptions = {
  size?: number;
  paddingFraction?: number;
  addBadgeForDarkAlpha?: boolean;
  zoom?: number;
  panX?: number;
  panY?: number;
  backgroundColor?: string;
  circleClip?: boolean;
  /** See `LogoFallbackHandler` on `embedSrc` — called instead of silently
   *  returning `src` unchanged when the canvas can't be read back (tainted
   *  by a non-CORS image) or the source image fails to decode (CL-11). */
  onFallback?: LogoFallbackHandler;
};

export function isVectorSource(src: string): boolean {
  if (!src) return false;
  // First-party cache may return SVG or PNG; skip the favicon pixel floor either way.
  if (isFirstPartyLogoSrc(src)) return true;
  return (
    src.startsWith("data:image/svg") ||
    src.includes(".svg") ||
    src.includes("cdn.simpleicons.org")
  );
}

export async function getImageDimensions(
  src: string,
): Promise<{ width: number; height: number; isVector: boolean; isLowRes: boolean }> {
  const isVector = isVectorSource(src);
  if (typeof Image === "undefined") {
    return { width: isVector ? 512 : 128, height: isVector ? 512 : 128, isVector, isLowRes: false };
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      const isLowRes = !isVector && (w < 48 || h < 48);
      resolve({ width: w, height: h, isVector, isLowRes });
    };
    img.onerror = () => {
      resolve({ width: 0, height: 0, isVector, isLowRes: false });
    };
    img.src = src;
  });
}

/**
 * Render any image / svg onto a square canvas (512x512) centered within
 * a circular safe-ring with customizable zoom, pan, padding and optional badge backing.
 */
export async function padAndSquareImage(
  src: string,
  options: PadAndSquareOptions = {},
): Promise<string> {
  if (typeof document === "undefined") return src; // Node test environment fallback
  const size = options.size ?? 512;
  const padding = options.paddingFraction ?? 0.15; // 15% safe margin for circular contact icons
  const zoom = Math.max(0.2, Math.min(5.0, options.zoom ?? 1.0));
  const panX = options.panX ?? 0;
  const panY = options.panY ?? 0;

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return src;

  // High-quality bicubic resampling
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (options.backgroundColor && options.backgroundColor !== "transparent") {
        ctx.fillStyle = options.backgroundColor;
        ctx.fillRect(0, 0, size, size);
      }

      // Check if we should add a circular white badge backing
      if (options.addBadgeForDarkAlpha) {
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
        ctx.fill();
      }

      if (options.circleClip) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
        ctx.clip();
      }

      const availWidth = size * (1 - padding * 2);
      const availHeight = size * (1 - padding * 2);
      const baseScale = Math.min(availWidth / img.width, availHeight / img.height, 1.0);
      const scale = baseScale * zoom;
      const drawWidth = img.width * scale;
      const drawHeight = img.height * scale;
      const drawX = (size - drawWidth) / 2 + panX;
      const drawY = (size - drawHeight) / 2 + panY;

      ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);

      if (options.circleClip) {
        ctx.restore();
      }

      try {
        resolve(canvas.toDataURL("image/png"));
      } catch (err) {
        options.onFallback?.("canvas-tainted", err instanceof Error ? err.message : String(err));
        resolve(src);
      }
    };
    img.onerror = () => {
      options.onFallback?.("decode-failed");
      resolve(src);
    };
    img.src = src;
  });
}

