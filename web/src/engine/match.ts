import {
  analyzeContact,
  orderFlags,
  resolveIdentity,
  wantsSuggestion,
  type BookContact,
  type Confidence,
  type ContactClass,
  type IdentityVia,
} from "./classify.ts";
import { passesSimilarity } from "./normalize.ts";
import { candidateUrls, type LogoHit, type LogoSourceName } from "./logos.ts";

/**
 * A candidate a source found by *name* carries the brand label it matched, so
 * R9.2 can compare it with the query.  Candidates fetched by domain have no
 * label and are exempt (R9.3) — the domain is the evidence.
 */
export type RankedHit = LogoHit & { brandName?: string };

export type ReviewItem = {
  contact: BookContact;
  contactClass: ContactClass;
  /** R7.6 — empty for a person or a non-brand: no query is computed for them. */
  query: string;
  domain?: string;
  via?: IdentityVia;
  candidates: RankedHit[];
  confidence: Confidence;
  flags: string[];
  selected: boolean;
  chosenIndex: number;
};

const RANK: Record<Confidence, number> = { skip: 0, low: 1, medium: 2, high: 3 };

function lower(a: Confidence, b: Confidence): Confidence {
  return RANK[a] <= RANK[b] ? a : b;
}

/** R10.2 — only the contact record itself can resolve a homonym. */
const CONTACT_OWNED: ReadonlySet<IdentityVia> = new Set<IdentityVia>(["website", "email", "phone"]);

/**
 * R11.2 — sources whose asset is a curated or brand-supplied mark.  Logo.dev
 * and Clearbit are deliberately absent: they answer for any domain, including
 * with a generated letter tile, so they are reviewed rather than trusted.
 */
const HIGH_TIER_SOURCES: ReadonlySet<LogoSourceName> = new Set<LogoSourceName>([
  "preferred",
  "simpleicons",
  "ticker",
  "brandfetch",
  "upload",
  "crop",
]);

/** R11.4 — a favicon is never high, whichever source served it. */
function isFavicon(hit: RankedHit): boolean {
  if (hit.source === "favicon" || hit.source === "google") return true;
  return /\/s2\/favicons|icons\.duckduckgo\.com|faviconv2/i.test(hit.src);
}

/**
 * R9.2 — every candidate a name-search source produced must resemble the query
 * it was searched with, or it is dropped from the ranked list.  This is what
 * kills `Cash App` → `breadzine.com`.  R9.4: if nothing survives, `skip`.
 */
export function applySimilarityGate(query: string, candidates: readonly RankedHit[]): RankedHit[] {
  return candidates.filter((hit) => hit.brandName === undefined || passesSimilarity(query, hit.brandName));
}

/**
 * R10 — the ceiling that needs no network.  Start at high for a business card
 * with an identity, then apply every matching cap; the result is the minimum.
 */
export function staticCeiling(item: {
  contactClass: ContactClass;
  via?: IdentityVia;
  flags: readonly string[];
}): Confidence {
  if (item.contactClass !== "businessCard" || !item.via) return "skip"; // R10.0
  let ceiling: Confidence = "high";
  if (item.via === "guess") ceiling = lower(ceiling, "medium"); // R10.1
  // R10.1b — an email domain is the contact's own data, but it is routinely not
  // the brand's: subsidiaries, regional domains, resellers, and consultants on a
  // client domain all resolve to something the display name never names.  Cap
  // when the domain bears no relation to the name ("Jay's Receipts" at
  // mycustomdomain.com), and let an evident one through ("Bluebonnet Dental" at
  // bluebonnetdental.com).  A wrong logo is worse than none, so an unrelated
  // domain identifies but does not pre-check.
  if (item.flags.includes("email-domain-unrelated")) ceiling = lower(ceiling, "medium");
  if (item.flags.includes("homonym-risk") && !CONTACT_OWNED.has(item.via)) ceiling = lower(ceiling, "medium"); // R10.2
  if (item.flags.includes("brand-tail")) ceiling = lower(ceiling, "medium"); // R10.3
  if (item.flags.includes("replace-existing")) ceiling = lower(ceiling, "medium"); // R10.4
  if (item.flags.includes("brand-redirect-risk")) ceiling = lower(ceiling, "medium"); // R10.5
  return ceiling;
}

/**
 * R11.2 / R11.4 — what the winning candidate is worth.  The web resolves this
 * statically, before any byte is fetched: every endpoint in `candidateUrls`
 * requests a square rendering and the apply path pads to a 512px square, so
 * "square" is a property of the source here.  Icon type and source still have
 * to hold, which is what the old table skipped when it handed `high` to a
 * Google faviconV2 URL on any catalog or website identity.
 */
export function assetTier(best: RankedHit, via: IdentityVia): Confidence {
  const source = best.source === "cache" ? (best.proxied ?? "clearbit") : best.source;
  const hit: RankedHit = { ...best, source };
  if (isFavicon(hit)) return via === "guess" ? "low" : "medium";
  if (hit.kind === "icon" && HIGH_TIER_SOURCES.has(source)) return "high";
  return "medium";
}

export function matchContact(contact: BookContact): ReviewItem {
  const { contactClass, query, flags } = analyzeContact(contact);
  if (contactClass !== "businessCard") {
    return {
      contact,
      contactClass,
      query,
      candidates: [],
      confidence: "skip",
      flags: orderFlags(flags),
      selected: false,
      chosenIndex: 0,
    };
  }

  const identity = resolveIdentity(contact, query);
  const all = [...flags, ...(identity?.flags ?? [])];
  if (identity) {
    all.push(`via-${identity.via}`);
    if (identity.via === "guess") all.push("guessed-domain");
    // R10.1b — does the email's registrable domain actually name this business?
    if (identity.via === "email" && !passesSimilarity(query, identity.domain.replace(/\.[^.]+$/, ""))) {
      all.push("email-domain-unrelated");
    }
  } else {
    all.push("no-identity");
  }
  if (contact.hadExistingPhoto) all.push("replace-existing");

  const candidates = identity ? applySimilarityGate(query, candidateUrls(identity.domain)) : [];
  const base = {
    contact,
    contactClass,
    query,
    domain: identity?.domain,
    via: identity?.via,
    candidates,
    flags: orderFlags(all),
  };

  const best = candidates[0];
  const confidence =
    identity && best ? lower(staticCeiling(base), assetTier(best, identity.via)) : "skip"; // R11.2, R9.4
  return { ...base, confidence, selected: confidence === "high", chosenIndex: 0 };
}

export function matchBook(contacts: BookContact[]): ReviewItem[] {
  return contacts.map(matchContact).filter((item) => wantsSuggestion(item.contact, item.contactClass) || item.contactClass === "nonBrand");
}

export function bucket(items: ReviewItem[]) {
  return {
    auto: items.filter((i) => i.confidence === "high"),
    review: items.filter((i) => i.confidence === "medium" || i.confidence === "low"),
    notFound: items.filter((i) => i.confidence === "skip"),
  };
}
