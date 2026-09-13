// src/engine/domain.ts
var MULTIPART_SUFFIX = /^(com|co|org|net|gov|edu|ac)\.[a-z]{2}$/;
function deriveHost(value) {
  let s = value.toLowerCase().trim();
  const scheme = /^([a-z][a-z0-9+-]*):/.exec(s);
  if (scheme) {
    if (!/^https?$/.test(scheme[1] ?? "")) return void 0;
    s = s.slice(scheme[0].length).replace(/^\/\//, "");
  }
  s = s.split(/[/?#]/)[0] ?? "";
  const at = s.lastIndexOf("@");
  const userinfoStripped = at >= 0;
  if (at >= 0) s = s.slice(at + 1);
  s = s.replace(/:\d+$/, "").replace(/%[0-9a-f]{2}/g, "").replace(/^\.+|\.+$/g, "");
  if (s.startsWith("www.")) s = s.slice(4);
  const labels = s.split(".").filter(Boolean);
  if (labels.length < 2) return void 0;
  const keep = labels.length >= 3 && MULTIPART_SUFFIX.test(labels.slice(-2).join(".")) ? 3 : 2;
  return {
    host: labels.join("."),
    domain: labels.slice(-keep).join("."),
    userinfoStripped,
    subdomainReduced: labels.length > keep
  };
}

// src/engine/catalog.ts
var DOMAIN_TO_TICKER = {
  "apple.com": "AAPL",
  "microsoft.com": "MSFT",
  "google.com": "GOOGL",
  "abc.xyz": "GOOGL",
  "amazon.com": "AMZN",
  "nvidia.com": "NVDA",
  "meta.com": "META",
  "tesla.com": "TSLA",
  "netflix.com": "NFLX",
  "spotify.com": "SPOT",
  "adobe.com": "ADBE",
  "salesforce.com": "CRM",
  "oracle.com": "ORCL",
  "ibm.com": "IBM",
  "intel.com": "INTC",
  "cisco.com": "CSCO",
  "paypal.com": "PYPL",
  "visa.com": "V",
  "mastercard.com": "MA",
  "americanexpress.com": "AXP",
  "jpmorganchase.com": "JPM",
  "chase.com": "JPM",
  "bankofamerica.com": "BAC",
  "wellsfargo.com": "WFC",
  "citi.com": "C",
  "schwab.com": "SCHW",
  "goldmansachs.com": "GS",
  "morganstanley.com": "MS",
  "verizon.com": "VZ",
  "att.com": "T",
  "t-mobile.com": "TMUS",
  "walmart.com": "WMT",
  "target.com": "TGT",
  "costco.com": "COST",
  "homedepot.com": "HD",
  "lowes.com": "LOW",
  "starbucks.com": "SBUX",
  "mcdonalds.com": "MCD",
  "uber.com": "UBER",
  "lyft.com": "LYFT",
  "airbnb.com": "ABNB",
  "nike.com": "NKE",
  "ford.com": "F",
  "gm.com": "GM",
  "disney.com": "DIS",
  "disneyplus.com": "DIS",
  "fedex.com": "FDX",
  "ups.com": "UPS",
  "united.com": "UAL",
  "aa.com": "AAL",
  "southwest.com": "LUV",
  "delta.com": "DAL",
  "jetblue.com": "JBLU",
  "boeing.com": "BA",
  "caterpillar.com": "CAT",
  "deere.com": "DE",
  "exxonmobil.com": "XOM",
  "chevron.com": "CVX",
  "pfizer.com": "PFE",
  "jnj.com": "JNJ",
  "modernatx.com": "MRNA",
  "lilly.com": "LLY",
  "cvs.com": "CVS",
  "walgreens.com": "WBA",
  "labcorp.com": "LH",
  "spectrum.com": "CHTR",
  "charter.com": "CHTR",
  "comcast.com": "CMCSA",
  "xfinity.com": "CMCSA",
  "block.xyz": "SQ",
  "squareup.com": "SQ",
  "coinbase.com": "COIN",
  "robinhood.com": "HOOD",
  "sofi.com": "SOFI",
  "crowdstrike.com": "CRWD",
  "palantir.com": "PLTR",
  "snowflake.com": "SNOW",
  "cloudflare.com": "NET",
  "datadoghq.com": "DDOG",
  "mongodb.com": "MDB",
  "roblox.com": "RBLX",
  "draftkings.com": "DKNG"
};
function lookupCompanyTicker(domain) {
  return DOMAIN_TO_TICKER[domain.toLowerCase().replace(/^www\./, "")];
}

// src/engine/settings.ts
var BRANDFETCH_KEY = "contactlogo.brandfetchClientId";
var LOGODEV_KEY = "contactlogo.logodevToken";
var sessionFallback = /* @__PURE__ */ new Map();
var storageFailed = false;
function readEnv(name) {
  const proc = globalThis.process;
  const fromProc = proc?.env?.[name] ?? proc?.env?.[`VITE_${name}`];
  if (fromProc) return String(fromProc).trim();
  const viteEnv = import.meta.env;
  const fromVite = viteEnv?.[name] ?? viteEnv?.[`VITE_${name}`];
  return String(fromVite ?? "").trim();
}
function readStored(key) {
  const live = sessionFallback.get(key);
  if (live) return live;
  if (typeof localStorage === "undefined") return "";
  try {
    return localStorage.getItem(key)?.trim() ?? "";
  } catch {
    storageFailed = true;
    return "";
  }
}
function getBrandfetchClientId() {
  return readStored(BRANDFETCH_KEY) || readEnv("BRANDFETCH_CLIENT_ID") || readEnv("VITE_BRANDFETCH_CLIENT_ID");
}
function getLogoDevToken() {
  return readStored(LOGODEV_KEY) || readEnv("LOGODEV_TOKEN") || readEnv("VITE_LOGODEV_TOKEN");
}

// src/engine/logos.ts
function assertNever(value) {
  throw new Error(`unhandled logo value: ${String(value)}`);
}
var SIMPLE_SLUGS = {
  "apple.com": "apple",
  "google.com": "google",
  "meta.com": "meta",
  "facebook.com": "facebook",
  "instagram.com": "instagram",
  "tesla.com": "tesla",
  "nvidia.com": "nvidia",
  "netflix.com": "netflix",
  "spotify.com": "spotify",
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
  "squareup.com": "square"
};
var SKIP_SIMPLE = /* @__PURE__ */ new Set(["delta.com"]);
var PREFERRED = {
  "delta.com": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 443.13 354"><polygon fill="#E31937" points="16.25,316.21 221.56,0 221.56,217.38"/><polygon fill="#E31937" points="0,354 221.56,354 221.56,260.39"/><polygon fill="#98002E" points="221.56,217.38 221.56,0 426.87,316.21"/><polygon fill="#98002E" points="221.56,260.39 221.56,354 443.13,354"/></svg>'
};
function simpleIconsSlug(domain) {
  if (SKIP_SIMPLE.has(domain)) return void 0;
  return SIMPLE_SLUGS[domain];
}
function cdnCandidateUrls(domain) {
  const out = [];
  const svg = PREFERRED[domain];
  if (svg) {
    out.push({
      src: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
      source: "preferred",
      kind: "icon"
    });
  }
  const slug = simpleIconsSlug(domain);
  if (slug && !SKIP_SIMPLE.has(domain)) {
    out.push({
      src: `https://cdn.simpleicons.org/${encodeURIComponent(slug)}`,
      source: "simpleicons",
      kind: "icon"
    });
  }
  const ticker = lookupCompanyTicker(domain);
  if (ticker) {
    out.push({
      src: `https://raw.githubusercontent.com/davidepalazzo/ticker-logos/main/ticker_icons/${encodeURIComponent(ticker)}.png`,
      source: "ticker",
      kind: "icon"
    });
  }
  const brandfetchClientId = getBrandfetchClientId();
  if (brandfetchClientId) {
    out.push({
      src: `https://cdn.brandfetch.io/${encodeURIComponent(domain)}/w/512/h/512?c=${encodeURIComponent(brandfetchClientId)}`,
      source: "brandfetch",
      kind: "icon"
    });
  }
  const logoDevToken = getLogoDevToken();
  if (logoDevToken) {
    out.push({
      src: `https://img.logo.dev/${encodeURIComponent(domain)}?size=512&token=${encodeURIComponent(logoDevToken)}`,
      source: "logodev",
      kind: "icon"
    });
  }
  out.push({
    src: `https://logo.clearbit.com/${encodeURIComponent(domain)}?size=512`,
    source: "clearbit",
    kind: "icon"
  });
  out.push({
    src: `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${encodeURIComponent(domain)}&size=256`,
    source: "google",
    kind: "icon"
  });
  out.push({
    src: `https://icons.duckduckgo.com/ip3/${domain}.ico`,
    source: "favicon",
    kind: "icon"
  });
  return out;
}
function licenseForSource(source) {
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
function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read image"));
    reader.readAsDataURL(blob);
  });
}
var FALLBACK_TILE_MIN_BYTES = 512;
async function looksVector(blob) {
  if (/svg/i.test(blob.type)) return true;
  try {
    const head = (await blob.slice(0, 256).text()).trimStart().toLowerCase();
    return head.startsWith("<svg") || head.startsWith("<?xml");
  } catch {
    return false;
  }
}
async function isFallbackTile(blob) {
  if (blob.size < FALLBACK_TILE_MIN_BYTES && !await looksVector(blob)) {
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
function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode image"));
    img.src = src;
  });
}
async function pixelFallbackTileTest(blob) {
  const dataUrl = await readAsDataUrl(blob);
  return fallbackTileFromImage(await loadImageElement(dataUrl));
}
function fallbackTileFromImage(img) {
  const w = Math.max(1, Math.min(64, img.naturalWidth || img.width || 64));
  const h = Math.max(1, Math.min(64, img.naturalHeight || img.height || 64));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { isTile: false };
  ctx.drawImage(img, 0, 0, w, h);
  let pixels;
  try {
    pixels = ctx.getImageData(0, 0, w, h);
  } catch {
    return { isTile: false };
  }
  const { data } = pixels;
  const at = (x, y) => {
    const i = (y * w + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const cornerMean = (x0, y0) => {
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
    cornerMean(Math.max(0, w - 8), Math.max(0, h - 8))
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
  const quantized = /* @__PURE__ */ new Set();
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

// src/engine/logo-cache.ts
var HIT_CACHE_CONTROL = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";
var MISS_CACHE_CONTROL = "public, max-age=60, s-maxage=300, stale-while-revalidate=3600";
var ERROR_CACHE_CONTROL = "public, max-age=15, s-maxage=30";
var FETCH_TIMEOUT_MS = 2500;
var MAX_BODY = 15e5;
var JSON_INLINE_MAX = 8e4;
var MEMORY_MAX = 256;
var MISS_TTL_MS = 5 * 60 * 1e3;
var memory = /* @__PURE__ */ new Map();
function parseLogoCacheKey(raw) {
  let s = raw.trim().toLowerCase();
  if (!s) return void 0;
  try {
    s = decodeURIComponent(s);
  } catch {
    return void 0;
  }
  s = s.trim().toLowerCase();
  if (!s || s.length > 253) return void 0;
  if (s.includes("@")) return void 0;
  if (/[\s,]/.test(s)) return void 0;
  if (/^\+?\d[\d().\-\s]{6,}$/.test(s)) return void 0;
  const looksUrl = /^https?:\/\//i.test(s);
  if (!looksUrl && /[/?#\\]/.test(s)) return void 0;
  const derived = deriveHost(s);
  if (!derived) return void 0;
  if (!/^[a-z0-9][a-z0-9.-]{0,251}\.[a-z]{2,}$/.test(derived.domain)) return void 0;
  return derived.domain;
}
function memoryGet(domain) {
  const hit = memory.get(domain);
  if (!hit) return void 0;
  if (hit.kind === "miss" && Date.now() > hit.expiresAt) {
    memory.delete(domain);
    return void 0;
  }
  memory.delete(domain);
  memory.set(domain, hit);
  return hit;
}
function memorySet(domain, entry) {
  if (memory.has(domain)) memory.delete(domain);
  memory.set(domain, entry);
  while (memory.size > MEMORY_MAX) {
    const oldest = memory.keys().next().value;
    if (oldest === void 0) break;
    memory.delete(oldest);
  }
}
function copyBytes(body) {
  return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
}
function etagFor(source, domain, body) {
  let hash = 2166136261;
  for (let i = 0; i < body.length; i += 1) {
    hash ^= body[i] ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  hash ^= body.length;
  return `"${source}:${domain}:${(hash >>> 0).toString(16)}"`;
}
function bytesToBase64(body) {
  const nodeBuffer = globalThis.Buffer;
  if (nodeBuffer) return nodeBuffer.from(body).toString("base64");
  let binary = "";
  const chunk = 32768;
  for (let i = 0; i < body.length; i += chunk) {
    binary += String.fromCharCode(...body.subarray(i, i + chunk));
  }
  return btoa(binary);
}
function fromBase64(payload) {
  const nodeBuffer = globalThis.Buffer;
  if (nodeBuffer) return Uint8Array.from(nodeBuffer.from(payload, "base64"));
  const bin = atob(payload);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}
function sniffContentType(body, hinted) {
  if (body.length >= 8 && body[0] === 137 && body[1] === 80 && body[2] === 78 && body[3] === 71) {
    return "image/png";
  }
  if (body.length >= 3 && body[0] === 255 && body[1] === 216 && body[2] === 255) {
    return "image/jpeg";
  }
  if (body.length >= 6 && body[0] === 71 && body[1] === 73 && body[2] === 70) {
    return "image/gif";
  }
  if (body.length >= 4 && body[0] === 0 && body[1] === 0 && body[2] === 1 && body[3] === 0) {
    return "image/x-icon";
  }
  if (body.length >= 12 && body[0] === 82 && body[1] === 73 && body[2] === 70 && body[3] === 70) {
    return "image/webp";
  }
  const head = new TextDecoder("utf-8", { fatal: false }).decode(body.slice(0, 256)).trimStart().toLowerCase();
  if (head.startsWith("<svg") || head.startsWith("<?xml") && head.includes("<svg")) {
    return "image/svg+xml";
  }
  if (hinted.startsWith("image/") && !hinted.includes("svg")) return hinted;
  if (hinted.includes("svg")) return "image/svg+xml";
  return void 0;
}
function decodeDataUrl(src) {
  const m = /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,([\s\S]*)$/i.exec(src);
  if (!m) return void 0;
  const contentType = (m[1] || "application/octet-stream").trim();
  const payload = m[3] ?? "";
  if (m[2]) {
    return { body: fromBase64(payload), contentType };
  }
  try {
    return { body: new TextEncoder().encode(decodeURIComponent(payload)), contentType };
  } catch {
    return { body: new TextEncoder().encode(payload), contentType };
  }
}
async function fetchOne(domain, hit, fetchImpl) {
  if (hit.src.startsWith("data:")) {
    const decoded = decodeDataUrl(hit.src);
    if (!decoded) return void 0;
    const contentType = sniffContentType(decoded.body, decoded.contentType);
    if (!contentType) return void 0;
    const tile = await isFallbackTile(new Blob([copyBytes(decoded.body)], { type: contentType }));
    if (tile.isTile) return void 0;
    return { body: decoded.body, contentType };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(hit.src, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { Accept: "image/avif,image/webp,image/*,*/*;q=0.8" }
    });
    if (res.status >= 500) return "error";
    if (!res.ok) return void 0;
    const hinted = (res.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    if (hinted.includes("text/html") || hinted.includes("application/json") || hinted.includes("text/plain")) {
      return void 0;
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_BODY) return void 0;
    const contentType = sniffContentType(buf, hinted);
    if (!contentType) return void 0;
    const tile = await isFallbackTile(new Blob([copyBytes(buf)], { type: contentType }));
    if (tile.isTile) return void 0;
    return { body: buf, contentType };
  } catch {
    return "error";
  } finally {
    clearTimeout(timer);
  }
}
async function resolveLogo(domain, fetchImpl = fetch) {
  const cached = memoryGet(domain);
  if (cached?.kind === "hit") return { status: "hit", record: cached.record };
  if (cached?.kind === "miss") return { status: "miss" };
  const ranked = cdnCandidateUrls(domain);
  let sawError = false;
  for (const hit of ranked) {
    const got = await fetchOne(domain, hit, fetchImpl);
    if (got === "error") {
      sawError = true;
      continue;
    }
    if (!got) continue;
    const retrievedAt = (/* @__PURE__ */ new Date()).toISOString();
    const record = {
      domain,
      source: hit.source,
      license: licenseForSource(hit.source),
      retrievedAt,
      etag: etagFor(hit.source, domain, got.body),
      contentType: got.contentType,
      body: got.body,
      sourceUrl: hit.src.startsWith("data:") ? firstPartyUrl(domain) : hit.src
    };
    memorySet(domain, { kind: "hit", record });
    return { status: "hit", record };
  }
  if (sawError && ranked.length > 0) return { status: "upstream-error" };
  memorySet(domain, { kind: "miss", expiresAt: Date.now() + MISS_TTL_MS });
  return { status: "miss" };
}
function firstPartyUrl(domain) {
  return `/api/logo/${encodeURIComponent(domain)}`;
}
function domainFromPath(pathname) {
  const m = /^\/api\/logo\/([^/]+)\/?$/.exec(pathname);
  return m?.[1];
}
function wantsJson(request, url) {
  if (url.searchParams.get("format") === "json") return true;
  const accept = request.headers.get("accept") ?? "";
  return /\bapplication\/json\b/i.test(accept) && !/\bimage\//i.test(accept);
}
function jsonPng512(request, record) {
  if (record.body.length <= JSON_INLINE_MAX) {
    return `data:${record.contentType};base64,${bytesToBase64(record.body)}`;
  }
  return new URL(request.url).pathname;
}
function applyHitHeaders(headers, record) {
  headers.set("Content-Type", record.contentType);
  headers.set("Cache-Control", HIT_CACHE_CONTROL);
  headers.set("ETag", record.etag);
  headers.set("X-Logo-Source", record.source);
  headers.set("X-Logo-License", record.license);
  headers.set("X-Logo-Retrieved-At", record.retrievedAt);
  headers.set("X-Logo-Domain", record.domain);
  headers.set("Vary", "Accept");
}
async function handleLogoGet(request) {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return new Response("method not allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" }
    });
  }
  const url = new URL(request.url);
  const key = parseLogoCacheKey(domainFromPath(url.pathname) ?? "");
  if (!key) {
    return new Response(JSON.stringify({ error: "invalid domain" }), {
      status: 400,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  }
  const result = await resolveLogo(key);
  if (result.status === "upstream-error") {
    return new Response(null, {
      status: 503,
      headers: { "Cache-Control": ERROR_CACHE_CONTROL }
    });
  }
  if (result.status === "miss") {
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": MISS_CACHE_CONTROL }
    });
  }
  const { record } = result;
  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch && ifNoneMatch.split(/,\s*/).includes(record.etag)) {
    const headers2 = new Headers();
    applyHitHeaders(headers2, record);
    return new Response(null, { status: 304, headers: headers2 });
  }
  if (wantsJson(request, url)) {
    const payload = {
      png512: jsonPng512(request, record),
      source: record.source,
      license: record.license,
      retrievedAt: record.retrievedAt,
      etag: record.etag
    };
    const headers2 = new Headers({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": HIT_CACHE_CONTROL,
      ETag: record.etag,
      "X-Logo-Source": record.source,
      "X-Logo-License": record.license,
      "X-Logo-Retrieved-At": record.retrievedAt,
      "X-Logo-Domain": record.domain,
      Vary: "Accept"
    });
    const body = method === "HEAD" ? null : JSON.stringify(payload);
    return new Response(body, { status: 200, headers: headers2 });
  }
  const headers = new Headers();
  applyHitHeaders(headers, record);
  if (method === "HEAD") return new Response(null, { status: 200, headers });
  return new Response(copyBytes(record.body), { status: 200, headers });
}
function headerValue(headers, name) {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}
function queryValue(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}
async function handleVercelLogo(req, res) {
  try {
    const host = headerValue(req.headers, "host") || "localhost";
    const proto = headerValue(req.headers, "x-forwarded-proto") || "https";
    const url = new URL(req.url || "/", `${proto}://${host}`);
    const domain = queryValue(req.query?.domain);
    if (domain) {
      url.pathname = `/api/logo/${domain}`;
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (key.startsWith(":")) continue;
      try {
        if (typeof value === "string") headers.set(key, value);
        else if (Array.isArray(value)) headers.set(key, value.join(", "));
      } catch {
      }
    }
    const request = new Request(url, { method: req.method || "GET", headers });
    const response = await handleLogoGet(request);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });
    if (req.method?.toUpperCase() === "HEAD" || response.status === 304 || response.status === 204) {
      res.end();
      return;
    }
    res.end(new Uint8Array(await response.arrayBuffer()));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    const message = err instanceof Error ? err.message : String(err);
    res.end(JSON.stringify({ error: "internal_error", message }));
  }
}

// src/api/logo.ts
var config = {
  maxDuration: 10
};
var logo_default = handleVercelLogo;
export {
  config,
  logo_default as default
};
