/**
 * Domain-keyed first-party logo cache.
 *
 * Product rule: do NOT store address books.  DO store a cache of
 * license-tagged marks keyed only by registrable domain.
 *
 * Durable store on Vercel is Cache-Control s-maxage + CDN, plus an
 * instance-local Map.  No KV, no PGlite, no auth.
 */
import { deriveHost } from "./domain.ts";
import {
  cdnCandidateUrls,
  isFallbackTile,
  licenseForSource,
  type LogoHit,
  type LogoSourceName,
} from "./logos.ts";

export const HIT_CACHE_CONTROL =
  "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";
export const MISS_CACHE_CONTROL =
  "public, max-age=60, s-maxage=300, stale-while-revalidate=3600";
export const ERROR_CACHE_CONTROL = "public, max-age=15, s-maxage=30";

const FETCH_TIMEOUT_MS = 2500;
const MAX_BODY = 1_500_000;
const JSON_INLINE_MAX = 80_000;
const MEMORY_MAX = 256;
const MISS_TTL_MS = 5 * 60 * 1000;

export type LogoCacheJson = {
  png512: string;
  source: LogoSourceName;
  license: string;
  retrievedAt: string;
  etag: string;
};

export type LogoCacheHit = {
  domain: string;
  source: LogoSourceName;
  license: string;
  retrievedAt: string;
  etag: string;
  contentType: string;
  body: Uint8Array;
  sourceUrl: string;
};

type MemoryHit = { kind: "hit"; record: LogoCacheHit };
type MemoryMiss = { kind: "miss"; expiresAt: number };
type MemoryEntry = MemoryHit | MemoryMiss;

const memory = new Map<string, MemoryEntry>();

export function resetLogoMemoryCache(): void {
  memory.clear();
}

/**
 * Accept only a registrable domain.  Contact names, emails, and phones are
 * rejected so this cache can never become an address book.
 */
export function parseLogoCacheKey(raw: string): string | undefined {
  let s = raw.trim().toLowerCase();
  if (!s) return undefined;
  try {
    s = decodeURIComponent(s);
  } catch {
    return undefined;
  }
  s = s.trim().toLowerCase();
  if (!s || s.length > 253) return undefined;
  if (s.includes("@")) return undefined;
  if (/[\s,]/.test(s)) return undefined;
  if (/^\+?\d[\d().\-\s]{6,}$/.test(s)) return undefined;
  const looksUrl = /^https?:\/\//i.test(s);
  if (!looksUrl && /[/?#\\]/.test(s)) return undefined;
  const derived = deriveHost(s);
  if (!derived) return undefined;
  if (!/^[a-z0-9][a-z0-9.-]{0,251}\.[a-z]{2,}$/.test(derived.domain)) return undefined;
  return derived.domain;
}

function memoryGet(domain: string): MemoryEntry | undefined {
  const hit = memory.get(domain);
  if (!hit) return undefined;
  if (hit.kind === "miss" && Date.now() > hit.expiresAt) {
    memory.delete(domain);
    return undefined;
  }
  memory.delete(domain);
  memory.set(domain, hit);
  return hit;
}

function memorySet(domain: string, entry: MemoryEntry): void {
  if (memory.has(domain)) memory.delete(domain);
  memory.set(domain, entry);
  while (memory.size > MEMORY_MAX) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
}

function copyBytes(body: Uint8Array): ArrayBuffer {
  return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
}

function etagFor(source: string, domain: string, body: Uint8Array): string {
  let hash = 2166136261;
  for (let i = 0; i < body.length; i += 1) {
    hash ^= body[i] ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  hash ^= body.length;
  return `"${source}:${domain}:${(hash >>> 0).toString(16)}"`;
}

function bytesToBase64(body: Uint8Array): string {
  const nodeBuffer = (globalThis as { Buffer?: { from(u: Uint8Array): { toString(enc: string): string } } }).Buffer;
  if (nodeBuffer) return nodeBuffer.from(body).toString("base64");
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < body.length; i += chunk) {
    binary += String.fromCharCode(...body.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fromBase64(payload: string): Uint8Array {
  const nodeBuffer = (globalThis as { Buffer?: { from(s: string, enc: string): Uint8Array } }).Buffer;
  if (nodeBuffer) return Uint8Array.from(nodeBuffer.from(payload, "base64"));
  const bin = atob(payload);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function sniffContentType(body: Uint8Array, hinted: string): string | undefined {
  if (body.length >= 8 && body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47) {
    return "image/png";
  }
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) {
    return "image/jpeg";
  }
  if (body.length >= 6 && body[0] === 0x47 && body[1] === 0x49 && body[2] === 0x46) {
    return "image/gif";
  }
  if (body.length >= 4 && body[0] === 0x00 && body[1] === 0x00 && body[2] === 0x01 && body[3] === 0x00) {
    return "image/x-icon";
  }
  if (body.length >= 12 && body[0] === 0x52 && body[1] === 0x49 && body[2] === 0x46 && body[3] === 0x46) {
    return "image/webp";
  }
  const head = new TextDecoder("utf-8", { fatal: false }).decode(body.slice(0, 256)).trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) {
    return "image/svg+xml";
  }
  if (hinted.startsWith("image/") && !hinted.includes("svg")) return hinted;
  if (hinted.includes("svg")) return "image/svg+xml";
  return undefined;
}

function decodeDataUrl(src: string): { body: Uint8Array; contentType: string } | undefined {
  const m = /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,([\s\S]*)$/i.exec(src);
  if (!m) return undefined;
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

type FetchResult =
  | { status: "hit"; record: LogoCacheHit }
  | { status: "miss" }
  | { status: "upstream-error" };

async function fetchOne(
  domain: string,
  hit: LogoHit,
  fetchImpl: typeof fetch,
): Promise<{ body: Uint8Array; contentType: string } | "error" | undefined> {
  if (hit.src.startsWith("data:")) {
    const decoded = decodeDataUrl(hit.src);
    if (!decoded) return undefined;
    const contentType = sniffContentType(decoded.body, decoded.contentType);
    if (!contentType) return undefined;
    const tile = await isFallbackTile(new Blob([copyBytes(decoded.body)], { type: contentType }));
    if (tile.isTile) return undefined;
    return { body: decoded.body, contentType };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(hit.src, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { Accept: "image/avif,image/webp,image/*,*/*;q=0.8" },
    });
    if (res.status >= 500) return "error";
    if (!res.ok) return undefined;
    const hinted = (res.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    if (hinted.includes("text/html") || hinted.includes("application/json") || hinted.includes("text/plain")) {
      return undefined;
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_BODY) return undefined;
    const contentType = sniffContentType(buf, hinted);
    if (!contentType) return undefined;
    const tile = await isFallbackTile(new Blob([copyBytes(buf)], { type: contentType }));
    if (tile.isTile) return undefined;
    return { body: buf, contentType };
  } catch {
    return "error";
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveLogo(
  domain: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchResult> {
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
    const retrievedAt = new Date().toISOString();
    const record: LogoCacheHit = {
      domain,
      source: hit.source,
      license: licenseForSource(hit.source),
      retrievedAt,
      etag: etagFor(hit.source, domain, got.body),
      contentType: got.contentType,
      body: got.body,
      sourceUrl: hit.src.startsWith("data:") ? firstPartyUrl(domain) : hit.src,
    };
    memorySet(domain, { kind: "hit", record });
    return { status: "hit", record };
  }

  if (sawError && ranked.length > 0) return { status: "upstream-error" };
  memorySet(domain, { kind: "miss", expiresAt: Date.now() + MISS_TTL_MS });
  return { status: "miss" };
}

function firstPartyUrl(domain: string): string {
  return `/api/logo/${encodeURIComponent(domain)}`;
}

function domainFromPath(pathname: string): string | undefined {
  const m = /^\/api\/logo\/([^/]+)\/?$/.exec(pathname);
  return m?.[1];
}

function wantsJson(request: Request, url: URL): boolean {
  if (url.searchParams.get("format") === "json") return true;
  const accept = request.headers.get("accept") ?? "";
  return /\bapplication\/json\b/i.test(accept) && !/\bimage\//i.test(accept);
}

function jsonPng512(request: Request, record: LogoCacheHit): string {
  if (record.body.length <= JSON_INLINE_MAX) {
    return `data:${record.contentType};base64,${bytesToBase64(record.body)}`;
  }
  return new URL(request.url).pathname;
}

function applyHitHeaders(headers: Headers, record: LogoCacheHit): void {
  headers.set("Content-Type", record.contentType);
  headers.set("Cache-Control", HIT_CACHE_CONTROL);
  headers.set("ETag", record.etag);
  headers.set("X-Logo-Source", record.source);
  headers.set("X-Logo-License", record.license);
  headers.set("X-Logo-Retrieved-At", record.retrievedAt);
  headers.set("X-Logo-Domain", record.domain);
  headers.set("Vary", "Accept");
}

export async function handleLogoGet(request: Request): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return new Response("method not allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" },
    });
  }

  const url = new URL(request.url);
  const key = parseLogoCacheKey(domainFromPath(url.pathname) ?? "");
  if (!key) {
    return new Response(JSON.stringify({ error: "invalid domain" }), {
      status: 400,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const result = await resolveLogo(key);
  if (result.status === "upstream-error") {
    return new Response(null, {
      status: 503,
      headers: { "Cache-Control": ERROR_CACHE_CONTROL },
    });
  }
  if (result.status === "miss") {
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": MISS_CACHE_CONTROL },
    });
  }

  const { record } = result;
  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch && ifNoneMatch.split(/,\s*/).includes(record.etag)) {
    const headers = new Headers();
    applyHitHeaders(headers, record);
    return new Response(null, { status: 304, headers });
  }

  if (wantsJson(request, url)) {
    const payload: LogoCacheJson = {
      png512: jsonPng512(request, record),
      source: record.source,
      license: record.license,
      retrievedAt: record.retrievedAt,
      etag: record.etag,
    };
    const headers = new Headers({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": HIT_CACHE_CONTROL,
      ETag: record.etag,
      "X-Logo-Source": record.source,
      "X-Logo-License": record.license,
      "X-Logo-Retrieved-At": record.retrievedAt,
      "X-Logo-Domain": record.domain,
      Vary: "Accept",
    });
    const body = method === "HEAD" ? null : JSON.stringify(payload);
    return new Response(body, { status: 200, headers });
  }

  const headers = new Headers();
  applyHitHeaders(headers, record);
  if (method === "HEAD") return new Response(null, { status: 200, headers });
  return new Response(copyBytes(record.body), { status: 200, headers });
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

function queryValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/** Vercel Node `(req, res)` adapter.  Bundled from `web/api/logo/[domain].ts`. */
export async function handleVercelLogo(
  req: {
    method?: string;
    url?: string;
    headers: Record<string, string | string[] | undefined>;
    query?: Record<string, string | string[] | undefined>;
  },
  res: {
    statusCode: number;
    setHeader: (k: string, v: string) => void;
    end: (b?: string | Uint8Array) => void;
  },
): Promise<void> {
  const host = headerValue(req.headers, "host") || "localhost";
  const proto = headerValue(req.headers, "x-forwarded-proto") || "https";
  const url = new URL(req.url || "/", `${proto}://${host}`);
  const domain = queryValue(req.query?.domain);
  if (domain && !url.pathname.includes("/api/logo/")) {
    url.pathname = `/api/logo/${domain}`;
  }
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(", "));
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
}
