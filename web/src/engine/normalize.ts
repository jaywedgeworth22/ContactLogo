/** MATCHING-ENGINE §2 / ENGINE-CONTRACT R5, R6 and R9: name cleanup, the brand
 *  slug, segment selection and the similarity gate. */

/**
 * R5.2 step 2.  The leading `[\s,]+` is load-bearing: the regex that shipped
 * before began `\s*,?\s*`, every part of which matches the empty string, so the
 * `co` alternative ate the last two letters of a word — `Costco` → `cost`,
 * `Cisco` → `cis`, `Medico` → `medi`, `TRICO` → `tri`.  Two catalog brands were
 * unreachable and `Medico` escaped the generic blocklist.
 */
const LEGAL_STRIP =
  /[\s,]+(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|gmbh|ag|plc|holdings|group|p\.c|llp)\.?\s*$/i;

/** R6.6 — trade words that make a tail a business rather than a role or a place. */
const ORG_SIGNAL =
  /\b(insurance|agency|realty|realtors|roofing|plumbing|electric|electrical|hvac|tire|tires|auto|motors|bank|credit|union|dental|dentistry|orthodontics|medical|clinic|pharmacy|law|legal|attorney|accounting|cpa|construction|contracting|landscaping|sprinkler|irrigation|cleaning|janitorial|salon|barber|bakery|cafe|restaurant|grill|pizza|mortgage|lending|title|escrow|storage|moving|towing|glass|paint|painting|flooring|pest|exterminating|veterinary|vet|daycare|academy|church|studio|fitness|gym|supply|wholesale|distributors|logistics|transport|energy|propane|security|alarm|telecom|wireless|media|marketing|consulting|partners|associates|enterprises|industries|systems|technologies|labs|works)\b/i;

/** R6.6 — job titles and contact-method junk. */
const ROLE_WORDS =
  /\b(front desk|customer service|after hours|on call|manager|mgr|gm|asst|assistant|treasurer|president|vp|director|owner|coordinator|secretary|chairman|chair|board|representative|rep|agent|sales|support|services|service|office|cell|mobile|home|work|fax|main|desk|billing|hr|admin|dispatch|scheduler|emergency|voicemail|reception|ext)\b/i;

/** R6.6 — the catalog's location alternation plus places. */
const GEO_WORDS =
  /#\d*|\b(rd|road|st|street|blvd|ave|avenue|dr|drive|ln|lane|hwy|fwy|pkwy|suite|ste|unit|store|shop|plaza|center|centre|mall|near|at|in|\d{2,5}|cypress|houston|dallas|austin|katy|spring|tomball|tx|texas|usa|us|australia|canada|mexico|uk|north|south|east|west|downtown|midtown|uptown)\b/i;

/** R5.1 — `Walgreens (Mason Rd / Cypress)` → `Walgreens`. */
export function cleanName(raw: string): string {
  return raw
    .replace(/\s*[([{][^)\]}]*[)\]}]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[ \-–—,]+|[ \-–—,]+$/g, "")
    .trim();
}

/**
 * R5.2 — the key every catalog and blocklist lookup is done on.  Hyphens
 * survive (`7-eleven`, `h-e-b`) and whitespace around `&` collapses, so the
 * three spellings of `H & R Block` land on one key.
 */
export function companyKey(name: string): string {
  return cleanName(name)
    .replace(LEGAL_STRIP, "")
    .replace(/[.,'"’]/g, "")
    .replace(/\s*&\s*/g, "&")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

/**
 * R5.3 — the slug behind a guessed `{slug}.com`.  It runs on `companyKey`, not
 * the raw name: skipping that is CL-14, where the surviving "LLC" pushed
 * "Bayou City Sprinkler Repair LLC" to 27 characters, tripped the 3–24 cap and
 * dropped the contact entirely while the same business without "LLC" resolved.
 */
export function guessSlug(raw: string): string | undefined {
  const slug = companyKey(raw)
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
  return slug.length >= 3 && slug.length <= 24 ? slug : undefined;
}

export type NameSegments = { head: string; tail: string; separator: "dash" | "at" };

/**
 * R6.1 — split a name on the first ` - ` or ` At ` into the part before the
 * separator and the part after it.  Returns undefined when there is no usable
 * split, which sends the caller to R6.5 (the whole name is the query).
 */
export function splitSegments(raw: string): NameSegments | undefined {
  const dash = raw.match(/\s+[-–—]\s+/);
  const at = raw.match(/\s+[Aa]t\s+/);
  const dashAt = dash?.index;
  const atAt = at?.index;
  const useDash = dashAt !== undefined && (atAt === undefined || dashAt < atAt);
  const hit = useDash ? dash : at;
  if (!hit || hit.index === undefined) return undefined;

  const head = raw.slice(0, hit.index).trim();
  const tail = raw.slice(hit.index + hit[0].length).trim();
  // Two dashes: no way to tell which side is the brand.
  if (useDash && tail.includes(" - ")) return undefined;

  const headWords = head.split(/\s+/).filter(Boolean).length;
  const tailWords = tail.split(/\s+/).filter(Boolean).length;
  if (headWords < 1 || headWords > 4 || tailWords > 5) return undefined;
  return { head, tail, separator: useDash ? "dash" : "at" };
}

/** The tail of an R6.1 split — `Chris At NTB` → `NTB`. */
export function brandTail(raw: string): string | undefined {
  return splitSegments(raw)?.tail;
}

/** R6.2 signal 2 — the segment names a trade. */
export function hasOrgSignal(segment: string): boolean {
  return ORG_SIGNAL.test(segment);
}

/** R6.3 / R6.4 — the segment is a job title or a place, so it is decoration. */
export function isRoleOrPlace(segment: string): boolean {
  return ROLE_WORDS.test(segment) || GEO_WORDS.test(segment);
}

/** R6.2 signal 3 — a single all-caps token as written in the raw name: `NTB`, `HEB`, `IBC`. */
export function isAcronym(segment: string): boolean {
  return /^[A-Z&]{2,5}$/.test(segment.trim());
}

/**
 * R9.1 — the gate that kills `Cash App` → `breadzine.com`.  A candidate a
 * source found by *name* must share a token, or contain/be contained by, the
 * query it was searched with.
 */
export function passesSimilarity(query: string, brandName: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const q = norm(query);
  const b = norm(brandName);
  if (q && b && (q.includes(b) || b.includes(q))) return true;
  const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const qw = words(query);
  const bw = words(brandName);
  for (const w of qw) if (bw.has(w)) return true;
  return false;
}
