import { isTailOkWord, lookupCompanyDomain } from "./catalog.ts";
import { lookupPhoneDomain } from "./phones.ts";
import {
  cleanName,
  companyKey,
  guessSlug,
  hasOrgSignal,
  isAcronym,
  isOrgSignalWord,
  isRoleOrPlace,
  splitSegments,
} from "./normalize.ts";
import {
  FREEMAIL,
  SOCIAL,
  deriveHost,
  emailHost,
  isMergedDomain,
  isPlatformHost,
  isSocialHost,
  registrableDomain,
} from "./domain.ts";

export type ContactClass = "person" | "businessCard" | "nonBrand";
export type Confidence = "skip" | "low" | "medium" | "high";
export type IdentityVia = "website" | "email" | "catalog" | "phone" | "guess";

export type BookContact = {
  id: string;
  displayName: string;
  givenName?: string;
  familyName?: string;
  organization?: string;
  /** Single-field shells (vCard, CSV, the device picker) fill these … */
  email?: string;
  phone?: string;
  website?: string;
  /** … while multi-valued records (and the golden corpus) fill these, in contact order. */
  emails?: string[];
  phones?: string[];
  websites?: string[];
  photoDataUrl?: string;
  hadExistingPhoto?: boolean;
  importSource?: "file" | "google" | "device";
  googleResourceName?: string;
};

/** R4.3 — exact non-brands.  Tested on `companyKey`, before HOMONYM (R4.1). */
const GENERIC = new Set([
  "hospital",
  "gift card",
  "manager",
  "market manager",
  "medico",
  "jerry",
  "verification",
  "verification code",
  "verification codes",
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
  "nice",
  "meme",
]);

/** R4.5 — real brands whose name collides across categories: flagged and capped, never skipped. */
const HOMONYM = new Set([
  "ibc",
  "mercury",
  "delta",
  "apple",
  "amazon",
  "carnival",
  "empower",
  "link",
  "jerry",
  "candy",
  "pioneer",
  "united",
  "premier",
]);

/** R4.4 — patterns applied to the cleaned name. */
const NON_BRAND = [/\bprinter\b/i, /\bWF-\d{4}\b/i, /\bverification\b/i, /\bpassword\b|\bpasscode\b/i];

/** R12.1 — static flags are emitted in this order, so two engines print one list. */
const FLAG_ORDER = [
  "person",
  "photo-protected",
  "employee",
  "non-brand",
  "lone-firm-name",
  "brand-tail",
  "decoration-stripped",
  "homonym-risk",
  "brand-redirect-risk",
  "social-url-ignored",
  "platform-host-ignored",
  "userinfo-stripped",
  "subdomain-reduced",
  "via-website",
  "via-email",
  "via-catalog",
  "via-phone",
  "via-guess",
  "guessed-domain",
  "no-identity",
  "replace-existing",
];

/** Dedupe and sort into R12.1 order; anything unknown (asset-time flags) keeps its place at the end. */
export function orderFlags(flags: readonly string[]): string[] {
  const seen = [...new Set(flags)];
  const rank = (f: string) => {
    const i = FLAG_ORDER.indexOf(f);
    return i === -1 ? FLAG_ORDER.length + seen.indexOf(f) : i;
  };
  return seen.sort((a, b) => rank(a) - rank(b));
}

function fieldValues(single: string | undefined, many: string[] | undefined): string[] {
  return [single, ...(many ?? [])]
    .map((v) => v?.trim() ?? "")
    .filter((v) => v.length > 0);
}

export function websiteFields(c: BookContact): string[] {
  return fieldValues(c.website, c.websites);
}

export function emailFields(c: BookContact): string[] {
  return fieldValues(c.email, c.emails);
}

export function phoneFields(c: BookContact): string[] {
  return fieldValues(c.phone, c.phones);
}

/** R1 applied to the authority of an email address. */
export function emailDomain(email?: string): string | undefined {
  if (!email || !email.includes("@")) return undefined;
  return registrableDomain(emailHost(email));
}

export function isFreemail(email?: string): boolean {
  const d = emailDomain(email);
  return Boolean(d && FREEMAIL.has(d));
}

/** R1 applied to a raw website field: `shop.walgreens.com/store/1` → `walgreens.com`. */
export function websiteHost(website?: string): string | undefined {
  if (!website) return undefined;
  return registrableDomain(website);
}

/** R7.1 / R4 — a generic noun or a non-brand pattern, keyed on `companyKey` (R4.2). */
export function isGeneric(name: string): boolean {
  const cleaned = cleanName(name);
  if (NON_BRAND.some((re) => re.test(cleaned))) return true;
  return GENERIC.has(companyKey(cleaned));
}

export function isHomonymRisk(name: string): boolean {
  return HOMONYM.has(companyKey(name));
}

function looksLikePersonName(name: string): boolean {
  const parts = cleanName(name).replace(/,/g, " ").split(/\s+/).filter(Boolean);
  if (parts.length < 2 || parts.length > 4) return false;
  return parts.every((p) => /^[A-Za-z][A-Za-z'.-]{1,30}$/.test(p));
}

/**
 * §1, applied to a card with no name fields: does the head of a "head - tail"
 * split read as a person's name?
 *
 * Name-field classification only works when the import supplies structured
 * names, and plenty do not — a vCard carrying only `FN:Dana At Costco` parses
 * with no givenName at all, so without this the card is a business and wears
 * Costco's mark.  That is the outcome the owner ruled out.
 *
 * Defined by exclusion, because there is no name dictionary here and the safe
 * default for this shape is "person": a head is personal unless a word in it is
 * one we already know means business, department, role, place or brand.
 * `looksLikePersonName` is not reusable for this — it demands two to four
 * parts, and "Dana" and "Chris" are one.
 *
 *   Dana / Chris / Byron Goode Jr   -> personal
 *   Pharmacy / Optical              -> ORG_SIGNAL and SUBBRAND_TAIL departments
 *   Front Office                    -> ROLE_WORDS
 *   Katy Auto                       -> "katy" is a GEO_WORD
 */
function headLooksPersonal(head: string): boolean {
  const cleaned = cleanName(head);
  if (!cleaned) return false;
  const parts = cleaned.replace(/,/g, " ").split(/\s+/).filter(Boolean);
  if (parts.length === 0 || parts.length > 4) return false;
  if (!parts.every((p) => /^[A-Za-z][A-Za-z'.-]{0,30}$/.test(p))) return false;
  if (isGeneric(cleaned) || isRoleOrPlace(cleaned)) return false;
  if (lookupCompanyDomain(cleaned)) return false;
  return parts.every((p) => !isOrgSignalWord(p) && !isTailOkWord(p));
}

/** Every non-freemail, non-social email domain on the contact (R8.2's accept set). */
function workEmailDomains(c: BookContact): string[] {
  const out: string[] = [];
  for (const address of emailFields(c)) {
    const d = registrableDomain(emailHost(address));
    if (d && !FREEMAIL.has(d) && !SOCIAL.has(d)) out.push(d);
  }
  return out;
}

/** The domain a *name* alone implies — catalog first, then the guess (R8.3, R8.5). */
function nameDerivedDomain(name: string): string | undefined {
  const catalog = lookupCompanyDomain(name);
  if (catalog) return catalog;
  const slug = guessSlug(name);
  return slug ? `${slug}.com` : undefined;
}

/**
 * R7.3.b — the employee guard.  A work email on the brand's own domain means
 * the contact works there, so §5 rule 7 (people are never logo targets) beats
 * §5 rule 8 (person-in-name businesses).
 */
function worksAt(c: BookContact, affiliation: string): boolean {
  const target = nameDerivedDomain(affiliation);
  if (!target) return false;
  return workEmailDomains(c).includes(target);
}

/** R7.4 — a lone first/last that is a known firm, with no personal email. */
export function inferCompanyFromLoneName(c: BookContact): string | undefined {
  if (emailFields(c).some(isFreemail)) return undefined;
  const given = cleanName(c.givenName ?? "");
  const family = cleanName(c.familyName ?? "");
  const onlyGiven = Boolean(given && !family);
  const onlyFamily = Boolean(family && !given);
  const unstructured = !given && !family;
  if (!onlyGiven && !onlyFamily && !unstructured) return undefined;
  const candidate = cleanName(onlyGiven ? given : onlyFamily ? family : c.displayName);
  if (!candidate || looksLikePersonName(candidate)) return undefined;
  return lookupCompanyDomain(candidate) ? candidate : undefined;
}

/** R6.2 — is this tail the brand rather than the decoration? */
function isKnownBrandTail(tail: string): boolean {
  const t = cleanName(tail);
  if (!t || isGeneric(t)) return false;
  if (lookupCompanyDomain(t)) return true;
  if (hasOrgSignal(t)) return true;
  return isAcronym(t);
}

type Segment = { query: string; flag?: "brand-tail" | "decoration-stripped" };

/** R6.2 → R6.3 → R6.4 → R6.5, first match wins. */
function selectSegment(name: string): Segment {
  const seg = splitSegments(name);
  if (!seg) return { query: cleanName(name) };
  if (isKnownBrandTail(seg.tail)) return { query: cleanName(seg.tail), flag: "brand-tail" };
  if (isRoleOrPlace(seg.tail) || lookupCompanyDomain(seg.head)) {
    return { query: cleanName(seg.head), flag: "decoration-stripped" };
  }
  if (isRoleOrPlace(seg.head) || isGeneric(seg.head)) {
    return { query: cleanName(seg.tail), flag: "decoration-stripped" };
  }
  return { query: cleanName(name) };
}

export type ContactAnalysis = {
  contactClass: ContactClass;
  /** R7.6 — defined only for `businessCard`; empty for a person or a non-brand. */
  query: string;
  flags: string[];
};

function nonBrand(): ContactAnalysis {
  return { contactClass: "nonBrand", query: "", flags: ["non-brand"] };
}

function person(c: BookContact, affiliation: string): ContactAnalysis {
  const flags = [c.hadExistingPhoto ? "photo-protected" : "person"];
  if (worksAt(c, affiliation)) flags.push("employee");
  return { contactClass: "person", query: "", flags };
}

function businessCard(segment: Segment, extra?: string): ContactAnalysis {
  // R7.5: re-test the chosen segment — `Front Desk - Hospital` is generic only
  // once the role head has been stripped.
  if (!segment.query || isGeneric(segment.query)) return nonBrand();
  const flags: string[] = [];
  if (extra) flags.push(extra);
  if (segment.flag) flags.push(segment.flag);
  if (isHomonymRisk(segment.query)) flags.push("homonym-risk");
  return { contactClass: "businessCard", query: segment.query, flags };
}

/**
 * R7 — classify the contact and, for a business card, pick the brand query.
 * One pass, so the class and the query can never disagree.
 */
export function analyzeContact(c: BookContact): ContactAnalysis {
  const brandSource = c.organization?.trim() || c.displayName;
  const name = cleanName(brandSource);
  if (isGeneric(name)) return nonBrand(); // R7.1, before any R6 split

  const given = (c.givenName ?? "").trim();
  const family = (c.familyName ?? "").trim();
  if (given || family) {
    // R7.2: §5 rule 8 is stated in terms of the display name, and role junk in
    // `organization` must not reclassify a person.
    const display = cleanName(c.displayName);
    const seg = splitSegments(display);
    const tail = seg && isKnownBrandTail(seg.tail) ? cleanName(seg.tail) : undefined;
    // §1 — "Person: has given or family name. Never a logo target. Employees are
    // not the company."  A known brand tail identifies who this person is
    // affiliated with, not a business to badge: "Dana At Costco" is Dana, and
    // putting Costco's mark on her card is exactly the wrong-logo outcome the
    // product exists to avoid.  The tail is still passed to `person` so the
    // `employee` flag can be derived from it.
    //
    // §5 rule 8 survives for the case it was written for — a card with NO name
    // fields whose display name carries a brand tail — which is handled by the
    // business-card path below, and for a company misfiled into a name field,
    // which `inferCompanyFromLoneName` catches (it requires the name not look
    // like a person's).
    if (tail) return person(c, tail);
    const lone = inferCompanyFromLoneName(c); // R7.3.c
    if (lone) return businessCard(selectSegment(cleanName(lone)), "lone-firm-name");
    return person(c, brandSource); // R7.3.d
  }
  // No name fields.  §5 rule 8 applies here — but a card whose display name is
  // "Dana At Costco" is still a person, and many imports carry no structured
  // name at all, so the head has to be read.
  const segment = selectSegment(name);
  if (segment.flag === "brand-tail") {
    const seg = splitSegments(name);
    if (seg && headLooksPersonal(seg.head)) return person(c, segment.query);
  }
  return businessCard(segment);
}

export function classifyContact(c: BookContact): ContactClass {
  return analyzeContact(c).contactClass;
}

export function queryName(c: BookContact): { query: string; flags: string[] } {
  const { query, flags } = analyzeContact(c);
  return { query, flags };
}

export type ResolvedIdentity = { domain: string; via: IdentityVia; flags: string[] };

function identity(domain: string, via: IdentityVia, flags: string[]): ResolvedIdentity {
  // R3.4: still the company's domain, but it may render the successor's mark.
  if (isMergedDomain(domain)) flags.push("brand-redirect-risk");
  return { domain, via, flags };
}

function note(flags: string[], flag: string): void {
  if (!flags.includes(flag)) flags.push(flag);
}

/**
 * R8 — website → work email → catalog → phone → guess.  The first step that
 * yields a domain wins; a rejection inside a step falls through to the next
 * candidate in that step, then to the next step.
 */
export function resolveIdentity(c: BookContact, brandName: string): ResolvedIdentity | undefined {
  const flags: string[] = [];

  for (const raw of websiteFields(c)) {
    const h = deriveHost(raw); // R8.1
    if (!h || FREEMAIL.has(h.domain)) continue;
    if (isSocialHost(h)) {
      note(flags, "social-url-ignored");
      continue;
    }
    if (isPlatformHost(h)) {
      note(flags, "platform-host-ignored");
      continue;
    }
    if (h.userinfoStripped) note(flags, "userinfo-stripped");
    if (h.subdomainReduced) note(flags, "subdomain-reduced");
    return identity(h.domain, "website", flags);
  }

  for (const raw of emailFields(c)) {
    const h = deriveHost(emailHost(raw)); // R8.2 — R3.2 extends SOCIAL to email
    if (!h || FREEMAIL.has(h.domain)) continue;
    if (isSocialHost(h)) {
      note(flags, "social-url-ignored");
      continue;
    }
    if (h.subdomainReduced) note(flags, "subdomain-reduced");
    return identity(h.domain, "email", flags);
  }

  const catalog =
    lookupCompanyDomain(brandName) || // R8.3
    (c.organization ? lookupCompanyDomain(c.organization) : undefined) ||
    lookupCompanyDomain(c.displayName);
  if (catalog) return identity(catalog, "catalog", flags);

  for (const raw of phoneFields(c)) {
    const d = lookupPhoneDomain(raw); // R8.4
    if (d) return identity(d, "phone", flags);
  }

  const slug = guessSlug(brandName); // R8.5 — on `companyKey`, not the raw name
  if (slug) return identity(`${slug}.com`, "guess", flags);
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
