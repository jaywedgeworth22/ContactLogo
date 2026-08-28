/**
 * ENGINE-CONTRACT R1–R3: hosts, registrable domains, and the hosts that may
 * never become a logo domain.  Ported from `DomainDeriver` in the Swift kit so
 * the two engines answer alike — the web had no counterpart, which is how a
 * LinkedIn company page ended up rendering the LinkedIn glyph (CL-03) and how
 * `shop.walgreens.com` missed the Walgreens catalog entry (CL-13).
 */

/** R2 — consumer mail hosts and their common typo-squats. */
export const FREEMAIL: ReadonlySet<string> = new Set([
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "live.com",
  "msn.com",
  "qq.com",
  "163.com",
  "126.com",
  "foxmail.com",
  "protonmail.com",
  "proton.me",
  "pm.me",
  "gmx.com",
  "mail.com",
  "comcast.net",
  "verizon.net",
  "att.net",
  "sbcglobal.net",
  "ymail.com",
  "googlemail.com",
  "hey.com",
  "fastmail.com",
  "zoho.com",
  "yandex.com",
  "mail.ru",
  "gnail.com",
  "hoymail.com",
]);

/** R3.1 — profile / directory / press hosts.  A linkedin.com URL must never yield a LinkedIn logo. */
export const SOCIAL: ReadonlySet<string> = new Set([
  "linkedin.com",
  "facebook.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "youtube.com",
  "crunchbase.com",
  "wikipedia.org",
  "yelp.com",
  "tripadvisor.com",
  "glassdoor.com",
  "tiktok.com",
  "pinterest.com",
  "reddit.com",
  "bloomberg.com",
  "vimeo.com",
  "medium.com",
  "github.com",
  "foursquare.com",
  "weibo.com",
  "fb.com",
  "apple.news",
]);

/** R3.3 — site builders, tenant hosts, link-in-bio and shorteners: every tenant shares one favicon. */
export const PLATFORM: ReadonlySet<string> = new Set([
  "wixsite.com",
  "wix.com",
  "weebly.com",
  "squarespace.com",
  "godaddysites.com",
  "business.site",
  "square.site",
  "sites.google.com",
  "wordpress.com",
  "blogspot.com",
  "myshopify.com",
  "linktr.ee",
  "about.me",
  "carrd.co",
  "notion.site",
  "webflow.io",
  "netlify.app",
  "vercel.app",
  "github.io",
  "pages.dev",
  "herokuapp.com",
  "wa.me",
  "goo.gl",
  "bit.ly",
  "tinyurl.com",
]);

/**
 * R3.4 — domains that still belong to the company but now serve a successor's
 * mark.  Capped at medium (`brand-redirect-risk`), never dropped.
 */
export const MERGED_DOMAINS: ReadonlySet<string> = new Set(["ntb.com"]);

/** R1.10 — the entire multi-part ccTLD policy.  No engine ships a public-suffix list. */
const MULTIPART_SUFFIX = /^(com|co|org|net|gov|edu|ac)\.[a-z]{2}$/;

export type DerivedHost = {
  /** The full host after R1.1–R1.8: scheme, path, userinfo, port and one `www.` removed. */
  host: string;
  /** The registrable domain — public suffix + 1 label (R1.9–R1.11). */
  domain: string;
  /** R1.4 dropped userinfo (`doug@texasdescon.com`). */
  userinfoStripped: boolean;
  /** R1.9–R1.11 discarded at least one label that was not `www`. */
  subdomainReduced: boolean;
};

/**
 * R1 — reduce one raw contact field value (a URL field, or the part of an
 * email after the last `@`) to its registrable domain.  Returns undefined for
 * anything that is not a usable web host.
 */
export function deriveHost(value: string): DerivedHost | undefined {
  let s = value.toLowerCase().trim();

  // R1.2: ms-outlook:, tel:, mailto:, fb: … are not websites.  The check has to
  // cover the plain colon form and not just `scheme://`: a URL field holding
  // `mailto:sales@costco.com` otherwise falls straight through to userinfo
  // stripping and resolves as `costco.com` — the business's own site, at high
  // confidence and pre-checked, from a field that names no website at all.
  //
  // The scheme pattern excludes `.` on purpose, so `costco.com:8080` is not
  // read as a scheme named `costco.com`.
  const scheme = /^([a-z][a-z0-9+-]*):/.exec(s);
  if (scheme) {
    if (!/^https?$/.test(scheme[1] ?? "")) return undefined;
    s = s.slice(scheme[0].length).replace(/^\/\//, "");
  }
  s = s.split(/[/?#]/)[0] ?? "";

  const at = s.lastIndexOf("@");
  const userinfoStripped = at >= 0;
  if (at >= 0) s = s.slice(at + 1);

  s = s
    .replace(/:\d+$/, "")
    .replace(/%[0-9a-f]{2}/g, "")
    .replace(/^\.+|\.+$/g, "");
  if (s.startsWith("www.")) s = s.slice(4);

  const labels = s.split(".").filter(Boolean);
  if (labels.length < 2) return undefined;
  const keep = labels.length >= 3 && MULTIPART_SUFFIX.test(labels.slice(-2).join(".")) ? 3 : 2;

  return {
    host: labels.join("."),
    domain: labels.slice(-keep).join("."),
    userinfoStripped,
    subdomainReduced: labels.length > keep,
  };
}

/** R1 — the registrable domain alone, for callers that do not need the flags. */
export function registrableDomain(value: string): string | undefined {
  return deriveHost(value)?.domain;
}

/** The authority of an email address: everything after the last `@`. */
export function emailHost(address: string): string {
  const at = address.lastIndexOf("@");
  return (at >= 0 ? address.slice(at + 1) : address).trim();
}

export function isFreemailDomain(domain: string): boolean {
  return FREEMAIL.has(domain);
}

/**
 * R3.1 / R3.3 — both sets are tested against the full host *and* the
 * registrable domain: `sites.google.com` reduces to `google.com` and would
 * otherwise hand a little-league team the Google logo.
 */
export function isSocialHost(h: DerivedHost): boolean {
  return SOCIAL.has(h.host) || SOCIAL.has(h.domain);
}

export function isPlatformHost(h: DerivedHost): boolean {
  return PLATFORM.has(h.host) || PLATFORM.has(h.domain);
}

export function isMergedDomain(domain: string): boolean {
  return MERGED_DOMAINS.has(domain);
}
