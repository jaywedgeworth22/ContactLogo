import { lookupCompanyDomain } from "./catalog.ts";
import { isBusinessPhone, lookupPhoneDomain } from "./phones.ts";
import { brandTail, cleanName } from "./normalize.ts";

export type ContactClass = "person" | "businessCard" | "nonBrand";
export type Confidence = "skip" | "low" | "medium" | "high";
export type IdentityVia = "website" | "email" | "catalog" | "phone" | "guess";

export type BookContact = {
  id: string;
  displayName: string;
  givenName?: string;
  familyName?: string;
  organization?: string;
  email?: string;
  phone?: string;
  website?: string;
  photoDataUrl?: string;
  hadExistingPhoto?: boolean;
  importSource?: "file" | "google" | "device";
  googleResourceName?: string;
  rawVcard?: string;
};

const FREEMAIL = new Set([
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
  "protonmail.com",
  "proton.me",
  "hey.com",
  "fastmail.com",
  "googlemail.com",
  "ymail.com",
  "gnail.com",
]);

const GENERIC = new Set([
  "hospital",
  "gift card",
  "manager",
  "verification",
  "verification code",
  "candy",
  "link",
  "cash",
  "info",
  "office",
  "reception",
  "front desk",
  "support",
  "customer service",
  "voicemail",
  "suspected spam",
  "emergency",
  "spam risk",
]);

const HOMONYM = new Set([
  "ibc",
  "mercury",
  "delta",
  "apple",
  "amazon",
  "carnival",
  "empower",
  "united",
  "premier",
]);

const NON_BRAND = [/\bprinter\b/i, /\bWF-\d{4}\b/i, /\bverification\b/i, /\bpassword\b|\bpasscode\b/i];

export function emailDomain(email?: string): string | undefined {
  if (!email || !email.includes("@")) return undefined;
  return email.split("@")[1]?.trim().toLowerCase();
}

export function isFreemail(email?: string): boolean {
  const d = emailDomain(email);
  return Boolean(d && FREEMAIL.has(d));
}

export function websiteHost(website?: string): string | undefined {
  if (!website) return undefined;
  try {
    const withProto = website.includes("://") ? website : `https://${website}`;
    if (!withProto.toLowerCase().startsWith("http")) return undefined;
    return new URL(withProto).hostname.replace(/^www\./, "") || undefined;
  } catch {
    return undefined;
  }
}

export function isGeneric(name: string): boolean {
  const n = cleanName(name).toLowerCase();
  if (GENERIC.has(n)) return true;
  return NON_BRAND.some((re) => re.test(n));
}

export function isHomonymRisk(name: string): boolean {
  return HOMONYM.has(cleanName(name).toLowerCase());
}

function looksLikePersonName(name: string): boolean {
  const parts = cleanName(name).replace(/,/g, " ").split(/\s+/).filter(Boolean);
  if (parts.length < 2 || parts.length > 4) return false;
  return parts.every((p) => /^[A-Za-z][A-Za-z'.-]{1,30}$/.test(p));
}

/** Lone first/last that is a known firm, with no personal email. */
export function inferCompanyFromLoneName(c: BookContact): string | undefined {
  if (isFreemail(c.email)) return undefined;
  const given = cleanName(c.givenName ?? "");
  const family = cleanName(c.familyName ?? "");
  const onlyGiven = Boolean(given && !family);
  const onlyFamily = Boolean(family && !given);
  const unstructured = !given && !family;
  if (!onlyGiven && !onlyFamily && !unstructured) return undefined;
  const candidate = cleanName(onlyGiven ? given : onlyFamily ? family : c.displayName);
  if (!candidate || looksLikePersonName(candidate)) return undefined;
  if (lookupCompanyDomain(candidate)) return candidate;
  if (isBusinessPhone(c.phone) && lookupPhoneDomain(c.phone)) return candidate;
  return undefined;
}

export function classifyContact(c: BookContact): ContactClass {
  const raw = c.organization?.trim() || c.displayName;
  if (isGeneric(raw)) return "nonBrand";
  const given = (c.givenName ?? "").trim();
  const family = (c.familyName ?? "").trim();
  if (given || family) {
    if (inferCompanyFromLoneName(c)) return "businessCard";
    return "person";
  }
  return "businessCard";
}

export function queryName(c: BookContact): { query: string; flags: string[] } {
  const raw = inferCompanyFromLoneName(c) || c.organization?.trim() || c.displayName;
  const flags: string[] = [];
  const tail = brandTail(raw);
  const query = cleanName(tail ?? raw);
  if (tail) flags.push("brand-tail");
  if (isHomonymRisk(query)) flags.push("homonym-risk");
  return { query, flags };
}

export function resolveIdentity(c: BookContact, brandName: string): { domain: string; via: IdentityVia } | undefined {
  const site = websiteHost(c.website);
  if (site && !FREEMAIL.has(site)) return { domain: site, via: "website" };
  const email = emailDomain(c.email);
  if (email && !FREEMAIL.has(email)) return { domain: email, via: "email" };
  const catalog =
    lookupCompanyDomain(brandName) ||
    (c.organization ? lookupCompanyDomain(c.organization) : undefined) ||
    lookupCompanyDomain(c.displayName);
  if (catalog) return { domain: catalog, via: "catalog" };
  const phone = lookupPhoneDomain(c.phone);
  if (phone) return { domain: phone, via: "phone" };
  const key = brandName
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
  if (key.length >= 3 && key.length <= 24) return { domain: `${key}.com`, via: "guess" };
  return undefined;
}

export function wantsSuggestion(_contact: BookContact, klass: ContactClass): boolean {
  switch (klass) {
    case "nonBrand":
    case "person":
      return false;
    case "businessCard":
      return true;
    default: {
      const _never: never = klass;
      return _never;
    }
  }
}
