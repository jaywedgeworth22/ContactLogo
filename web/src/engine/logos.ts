import { lookupCompanyDomain, lookupCompanyTicker } from "./catalog.ts";

export type LogoSourceName =
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
};

function assertNever(value: never): never {
  throw new Error(`unhandled logo value: ${String(value)}`);
}

const SIMPLE_SLUGS: Record<string, string> = {
  "apple.com": "apple",
  "google.com": "google",
  "microsoft.com": "microsoft",
  "amazon.com": "amazon",
  "meta.com": "meta",
  "facebook.com": "facebook",
  "instagram.com": "instagram",
  "tesla.com": "tesla",
  "nvidia.com": "nvidia",
  "netflix.com": "netflix",
  "spotify.com": "spotify",
  "adobe.com": "adobe",
  "salesforce.com": "salesforce",
  "oracle.com": "oracle",
  "ibm.com": "ibm",
  "intel.com": "intel",
  "cisco.com": "cisco",
  "stripe.com": "stripe",
  "paypal.com": "paypal",
  "visa.com": "visa",
  "mastercard.com": "mastercard",
  "americanexpress.com": "americanexpress",
  "chase.com": "jpmorgan",
  "jpmorganchase.com": "jpmorgan",
  "bankofamerica.com": "bankofamerica",
  "wellsfargo.com": "wellsfargo",
  "citi.com": "citigroup",
  "geico.com": "geico",
  "statefarm.com": "statefarm",
  "verizon.com": "verizon",
  "att.com": "atandt",
  "t-mobile.com": "tmobile",
  "united.com": "unitedairlines",
  "aa.com": "americanairlines",
  "southwest.com": "southwestairlines",
  "fedex.com": "fedex",
  "ups.com": "ups",
  "usps.com": "usps",
  "homedepot.com": "homedepot",
  "lowes.com": "lowe's",
  "costco.com": "costco",
  "walmart.com": "walmart",
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
  "usaa.com": "usaa",
  "centerpointenergy.com": "centerpointenergy",
  "x.ai": "x",
  "x.com": "x",
  "twitter.com": "x",
  "github.com": "github",
  "linkedin.com": "linkedin",
  "youtube.com": "youtube",
  "discord.com": "discord",
  "slack.com": "slack",
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
  "hulu.com": "hulu",
  "disneyplus.com": "disneyplus",
  "spacex.com": "spacex",
  "starlink.com": "spacex",
  "squareup.com": "square",
  "walgreens.com": "walgreens",
  "cvs.com": "cvs",
};

const SKIP_SIMPLE = new Set(["delta.com"]);

const PREFERRED: Record<string, string> = {
  "delta.com":
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 443.13 354"><polygon fill="#E31937" points="16.25,316.21 221.56,0 221.56,217.38"/><polygon fill="#E31937" points="0,354 221.56,354 221.56,260.39"/><polygon fill="#98002E" points="221.56,217.38 221.56,0 426.87,316.21"/><polygon fill="#98002E" points="221.56,260.39 221.56,354 443.13,354"/></svg>',
};

export function simpleIconsSlug(domain: string): string | undefined {
  return SIMPLE_SLUGS[domain];
}

export function candidateUrls(domain: string): LogoHit[] {
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
  out.push({
    src: `https://cdn.brandfetch.io/${encodeURIComponent(domain)}/w/512/h/512`,
    source: "brandfetch",
    kind: "icon",
  });
  out.push({
    src: `https://img.logo.dev/${encodeURIComponent(domain)}?size=512`,
    source: "logodev",
    kind: "icon",
  });
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

export function candidatesForName(name: string): LogoHit[] {
  const domain = lookupCompanyDomain(name);
  return domain ? candidateUrls(domain) : [];
}

export function sourceLabel(source: LogoSourceName): string {
  switch (source) {
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

export async function composeFromFile(file: File): Promise<string> {
  if (!file.type.startsWith("image/") && file.type !== "image/svg+xml") {
    throw new Error("Choose an image file");
  }
  if (file.size > 3_000_000) throw new Error("Keep uploads under 3 MB");
  return readAsDataUrl(file);
}

export async function composeFromUrl(raw: string): Promise<string> {
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) throw new Error("Paste an http(s) image URL");
  const res = await fetch(trimmed, { mode: "cors" });
  if (!res.ok) throw new Error("Could not fetch that image");
  const blob = await res.blob();
  if (!blob.type.startsWith("image/") && blob.type !== "image/svg+xml") {
    throw new Error("That URL is not an image");
  }
  if (blob.size > 3_000_000) throw new Error("Keep images under 3 MB");
  return readAsDataUrl(blob);
}

/** Embed a remote logo as a data URL so the downloaded vCard is self-contained. */
export async function embedSrc(src: string): Promise<string> {
  if (src.startsWith("data:image/")) return src;
  try {
    const res = await fetch(src, { mode: "cors" });
    if (!res.ok) return src;
    const blob = await res.blob();
    if (blob.size < 40 || blob.size > 1_500_000) return src;
    return await readAsDataUrl(blob);
  } catch {
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
};

export function isVectorSource(src: string): boolean {
  if (!src) return false;
  return (
    src.startsWith("data:image/svg") ||
    src.includes(".svg") ||
    src.includes("cdn.simpleicons.org")
  );
}

export const LOW_RES_MIN_PX = 48;

const USER_PINNED_SOURCES: ReadonlySet<LogoSourceName> = new Set(["upload", "crop", "url"]);

export function isUserPinnedLogoSource(source: LogoSourceName): boolean {
  return USER_PINNED_SOURCES.has(source);
}

export function isLowResRaster(width: number, height: number, isVector: boolean): boolean {
  return !isVector && width > 0 && height > 0 && (width < LOW_RES_MIN_PX || height < LOW_RES_MIN_PX);
}

/**
 * Auto-skip a failed/tiny catalog fetch. Never wrap — wrapping plus render()
 * livelocks the review page when every candidate is a 16px favicon. Never
 * discard a user upload/crop/URL.
 */
export function nextIndexAfterUnusableLogo(opts: {
  chosenIndex: number;
  candidateCount: number;
  source: LogoSourceName;
  isVector: boolean;
  width: number;
  height: number;
}): number | null {
  if (opts.candidateCount < 2) return null;
  if (isUserPinnedLogoSource(opts.source)) return null;
  if (!isLowResRaster(opts.width, opts.height, opts.isVector)) return null;
  if (opts.chosenIndex >= opts.candidateCount - 1) return null;
  return opts.chosenIndex + 1;
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
      } catch {
        resolve(src);
      }
    };
    img.onerror = () => resolve(src);
    img.src = src;
  });
}

