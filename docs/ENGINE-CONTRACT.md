# The Engine Contract — normative algorithm spec

Status: **normative**. `docs/MATCHING-ENGINE.md` is the rulebook (what and why);
this document is the contract (exactly how). Where they disagree, this document
is a bug and MATCHING-ENGINE wins.

Three engines implement it and must agree byte-for-byte on every observable
listed in §14:

| Engine | Path |
| --- | --- |
| Swift | `Sources/ContactLogoKit/{Normalize,Identity,Pipeline,Rank}` |
| TypeScript | `web/src/engine/{normalize,classify,match,catalog,phones,logos}.ts` |
| Kotlin | `Apps/ContactLogoAndroid/app/src/main/java/com/contactlogo/engine/` |

The conformance suite is `fixtures/golden-corpus.json` (§14). Every case in it is
decidable from this document with **no network access**.

Keywords MUST / MUST NOT / SHOULD are used in the RFC 2119 sense.

---

## R0. Vocabulary

- **host** — the authority part of a URL or the right-hand side of an email.
- **registrable domain** — the host reduced to its public-suffix + 1 label (R1).
- **query** — the brand string handed to name-based sources (R6, R7.6).
- **identity** — `{ domain, via }` where `via ∈ {website, email, catalog, phone, guess}` (R8).
- **contact-owned evidence** — `via ∈ {website, email, phone}`. The contact
  record itself carries the domain.
- **name-derived evidence** — `via ∈ {catalog, guess}`. The domain came from the
  name, so it cannot corroborate the name.
- **static** — computable with no image fetch and no network.
- **asset-time** — requires bytes of a candidate image.

---

## R1. `registrableDomain(input) -> string | null`

Input is one raw contact field value (a URL field, or the part of an email after
`@`). Steps run in order; any step returning `null` ends the function.

1. Lowercase and trim ASCII whitespace.
2. **Scheme.** If the value contains `://`, the scheme MUST be `http` or
   `https`; anything else (`ms-outlook:`, `tel:`, `mailto:`, `fb:`) → `null`.
   Take the substring after `://`. If there is no `://`, treat the whole value
   as an authority.
3. **Path.** Truncate at the first `/`, `?` or `#`.
4. **Userinfo.** If `@` is present, drop everything up to and including the
   **last** `@`. (`doug@texasdescon.com` → `texasdescon.com`.)
5. **Port.** Drop a trailing `:` + digits.
6. **Escapes.** Delete every `%[0-9a-f]{2}` sequence.
7. Trim leading and trailing `.`.
8. If the result starts with `www.`, remove exactly that prefix (once).
9. Split on `.`, discard empty labels. Fewer than 2 labels → `null`.
10. If there are ≥ 3 labels and the last two match
    `^(com|co|org|net|gov|edu|ac)\.[a-z]{2}$`, return the last **three**.
11. Otherwise return the last **two**.

Notes:
- R1.10 is the entire multi-part ccTLD policy. It is deliberately a rule, not a
  public-suffix-list dependency: no engine may ship a 10 000-line PSL.
  `shop.example.co.uk` → `example.co.uk`; `mail.utexas.edu` → `utexas.edu`
  (`edu` is a single-label suffix, so R1.10 does not fire).
- `shop.walgreens.com` → `walgreens.com`. Failing to reduce (CL-13) misses the
  catalog entry, misses the Simple Icons glyph, and rates an unknown host high.
- R1.8 removing `www.` is **not** a reduction: `subdomain-reduced` (R12.1) is
  emitted only when R1.9–R1.11 discarded at least one label that was not `www`.

---

## R2. `FREEMAIL` — canonical set (32)

Consumer mail hosts and their common typo-squats. A domain in this set MUST NOT
become a logo domain by any route, and MUST NOT be treated as a work email.

```
gmail.com  yahoo.com  hotmail.com  outlook.com  icloud.com  me.com  mac.com
aol.com  live.com  msn.com  qq.com  163.com  126.com  foxmail.com
protonmail.com  proton.me  pm.me  gmx.com  mail.com  comcast.net  verizon.net
att.net  sbcglobal.net  ymail.com  googlemail.com  hey.com  fastmail.com
zoho.com  yandex.com  mail.ru  gnail.com  hoymail.com
```

(Reference: `DomainDeriver.freemail`. `comcast.net`/`verizon.net`/`att.net` are
freemail **as mail hosts** even though `xfinity.com`/`verizon.com`/`att.com` are
catalog brands — the two are different domains and must not be conflated.)

---

## R3. Hosts that are never a logo domain

### R3.1 `SOCIAL` — canonical set (22)

Profile / directory / press hosts. A `linkedin.com` URL MUST NEVER yield the
LinkedIn logo (CL-03).

```
linkedin.com  facebook.com  twitter.com  x.com  instagram.com  youtube.com
crunchbase.com  wikipedia.org  yelp.com  tripadvisor.com  glassdoor.com
tiktok.com  pinterest.com  reddit.com  bloomberg.com  vimeo.com  medium.com
github.com  foursquare.com  weibo.com  fb.com  apple.news
```

(Reference: `DomainDeriver.social`. The TypeScript engine has no social set at
all; Kotlin has a 5-host subset. Both MUST adopt this set verbatim.)

### R3.2 SOCIAL applies to email as well as websites

Swift currently filters social on the website path only. The contract extends it
to the email path: `sales@facebook.com` is exactly as wrong a logo source as
`facebook.com/acme`. A social host is never contact-owned evidence for anyone
except the platform itself, and that case arrives through the **catalog**
(`facebook` → `facebook.com`), which R3 does not filter.

### R3.3 `PLATFORM` — canonical set (25)

Site builders, tenant hosts, link-in-bio and shortener services. Every tenant
shares one favicon, so the derived mark is the platform's, not the business's —
the same failure class as R3.1.

```
wixsite.com  wix.com  weebly.com  squarespace.com  godaddysites.com
business.site  square.site  sites.google.com  wordpress.com  blogspot.com
myshopify.com  linktr.ee  about.me  carrd.co  notion.site  webflow.io
netlify.app  vercel.app  github.io  pages.dev  herokuapp.com  wa.me
goo.gl  bit.ly  tinyurl.com
```

`PLATFORM` MUST be tested against **both** the full host (after R1.1–R1.8) and
the registrable domain, because `sites.google.com` reduces to `google.com` and
would otherwise hand a little-league team the Google logo.

### R3.4 `MERGED_DOMAINS` — domains that redirect to a successor brand

| Domain | Now serves | Effect |
| --- | --- | --- |
| `ntb.com` | Mavis Tire | flag `brand-redirect-risk`, ceiling medium (R10.5) |

Unlike R3.1/R3.3 these domains are still used — they are the right domain for
the *company* but may render the *successor's* mark, so they are capped, not
dropped. Extend this table only with a verified redirect.

---

## R4. Blocklists

### R4.1 Order

`GENERIC` (exact) is tested before `HOMONYM`. `jerry` and `candy` are in both;
they are non-brands and MUST be skipped, not matched at medium.

### R4.2 Matching key

All three sets are keyed on `companyKey(name)` (R5.2), **not** on the raw or
merely cleaned name. Without this, `Apple Inc` escapes the homonym cap that
`Apple` receives.

### R4.3 `GENERIC` — canonical exact set (24)

```
hospital  gift card  manager  market manager  medico  jerry
verification  verification code  verification codes  candy
link  cash  info  office  reception  front desk
support  customer service  voicemail  suspected spam
emergency  spam risk  nice  meme
```

### R4.4 `NON_BRAND` — canonical patterns (4)

Case-insensitive, applied to the cleaned name (R5.1).

```
\bprinter\b
\bWF-\d{4}\b
\bverification\b
\bpassword\b|\bpasscode\b
```

### R4.5 `HOMONYM` — canonical set (13)

Real brands whose name collides across categories.

```
ibc  mercury  delta  apple  amazon  carnival  empower
link  jerry  candy  pioneer  united  premier
```

A homonym is not skipped. It is flagged (`homonym-risk`) and capped at medium
unless contact-owned evidence resolves it (R10.2).

---

## R5. Name normalization

### R5.1 `clean(raw) -> string`

1. Delete every bracketed group: `\s*[([{][^)\]}]*[)\]}]` → `" "`.
2. Collapse runs of whitespace to one space.
3. Trim the characters `space - – — ,` from both ends.

`Walgreens (Mason Rd / Cypress)` → `Walgreens`.

### R5.2 `companyKey(raw) -> string`

1. `clean(raw)`.
2. Strip one trailing legal suffix, which MUST be a separate token:

   ```
   [\s,]+(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|gmbh|ag|plc|holdings|group|p\.c|llp)\.?\s*$
   ```

   (case-insensitive).
3. Delete the characters `. , ' ’ "`.
4. Collapse whitespace **around `&`**: `\s*&\s*` → `&`.
5. Collapse remaining whitespace runs to one space; lowercase; trim.

Hyphens survive: `7-eleven`, `t-mobile`, `h-e-b`, `buc-ees` are catalog keys.
`H & R Block` → `h&r block` → catalog hit. (Step 4 is new; without it the three
spellings of H&R Block resolve three different ways.)

**The leading `[\s,]+` is load-bearing.** The regex shipping in Swift and
TypeScript today begins `\s*,?\s*`, every part of which can match the empty
string, so the alternative `co` matches the last two letters of a word:

```
companyKey("Costco") == "cost"   companyKey("Cisco")  == "cis"
companyKey("Medico") == "medi"   companyKey("TRICO")  == "tri"
```

Verified against `web/src/engine/normalize.ts`: `lookupCompanyDomain("Costco")`
and `lookupCompanyDomain("Cisco")` both return `undefined` today, so two catalog
brands are unreachable, `Medico` escapes the GENERIC blocklist, and `TRICO`
guesses `tri.com`. Requiring a real separator before the suffix fixes all four
without affecting `Apple Inc`, `Zeta Metalworks, Inc.`, `Acme Roofing Co` or
`Bayou City Sprinkler Repair LLC`.

### R5.3 `guessSlug(raw) -> string | null`

1. `companyKey(raw)`.
2. `&` → `and`.
3. Delete every character outside `[a-z0-9]`.
4. Length outside `3...24` → `null`.

`Bayou City Sprinkler Repair LLC` → `bayoucitysprinklerrepair` (24 — at the
cap). Skipping `companyKey` here is CL-14: the raw name yields 27 characters,
trips the cap, and the contact disappears while the same business without "LLC"
resolves.

---

## R6. Segment selection — which part of the name is the brand

Applied to `clean(displayName-or-organization)` (R7.2) after the R7.1 non-brand
tests.

### R6.1 Split

Split on the **first** occurrence of either separator:

- dash form: `\s+[-–—]\s+`
- at form: `\s+[Aa]t\s+`

If the dash form matches and the *tail* still contains ` - `, there is no usable
split → R6.5. If neither matches → R6.5. `head` and `tail` are the trimmed
sides. If `head` has 0 or >4 words, or `tail` has >5 words → R6.5.

### R6.2 Tail is the brand (MATCHING-ENGINE §5 rule 8) — flag `brand-tail`

`isKnownBrandTail(tail)` is true when **all** of:

- `tail` is non-empty and is not GENERIC / NON_BRAND (R4), and
- at least one of:
  1. `catalogDomain(tail) != null`, or
  2. `tail` matches `ORG_SIGNAL` (R6.6) on a whole-word, case-insensitive basis, or
  3. `tail` is a single token matching `^[A-Z&]{2,5}$` **as written in the raw
     display name** (an acronym: `NTB`, `HEB`, `IBC`).

Then `query = clean(tail)`.

This is the rule the audit found dead in all three engines (CL-15).
`Byron Goode Jr - Root Insurance` fires on signal 2; `Chris At NTB` on signal 3.
A `brand-tail` query is always capped at medium (R10.3) — it is a heuristic
override of the person rule, so it is reviewed, never pre-checked.

### R6.3 Tail is decoration — flag `decoration-stripped`

Else, if `isRoleOrPlace(tail)` — i.e. `tail` matches `ROLE_WORDS` or `GEO_WORDS`
(R6.6) on a whole word, **or** `catalogDomain(head) != null` — then
`query = clean(head)`.

`Apple - Australia` → `Apple` (head is a catalog brand, so the tail is
decoration; the §4 instruction is "fall back to the parent brand").
`TRICO - General Mgr` → `TRICO`. `Hsa PTO - Asst Treasurer` → `Hsa PTO`.

### R6.4 Head is decoration — flag `decoration-stripped`

Else, if `isRoleOrPlace(head)` or `head` is GENERIC, then `query = clean(tail)`.
`Front Desk - Hospital` → `Hospital`, which R7.5 then rejects as non-brand.

### R6.5 No split — `query = clean(name)`

Order matters: R6.2 → R6.3 → R6.4 → R6.5, first match wins.

### R6.6 Word lists

`ORG_SIGNAL` (whole word, case-insensitive):

```
insurance agency realty realtors roofing plumbing electric electrical hvac
tire tires auto motors bank credit union dental dentistry orthodontics
medical clinic pharmacy law legal attorney accounting cpa construction
contracting landscaping sprinkler irrigation cleaning janitorial salon barber
bakery cafe restaurant grill pizza mortgage lending title escrow storage
moving towing glass paint painting flooring roofing pest exterminating
veterinary vet daycare academy church studio fitness gym supply wholesale
distributors logistics transport energy propane security alarm telecom
wireless media marketing consulting partners associates enterprises
industries systems technologies labs works
```

`ROLE_WORDS` (whole word, case-insensitive):

```
manager mgr gm asst assistant treasurer president vp director owner
coordinator secretary chair chairman board rep representative agent sales
support service services office cell mobile home work fax main desk billing
hr admin dispatch scheduler emergency voicemail reception ext
front desk on call after hours customer service
```

`GEO_WORDS` (whole word, case-insensitive) — the catalog's `LOCATIONISH`
alternation plus places:

```
rd road st street blvd ave avenue dr drive ln lane hwy fwy pkwy suite ste
unit store shop plaza center centre mall near at in #\d* \d{2,5}
cypress houston dallas austin katy spring tomball tx texas usa us
australia canada mexico uk north south east west downtown midtown uptown
```

`ORG_SIGNAL` is checked before `ROLE_WORDS`, so `... - Sales Agency` is a brand
tail and `... - Sales` is decoration.

---

## R7. Classification

Produces `person | businessCard | nonBrand`. Evaluate in order.

**R7.1** `name = clean(organization ?: displayName)`. If `NON_BRAND` (R4.4)
matches `name`, or `GENERIC` (R4.3) contains `companyKey(name)` → **nonBrand**,
flag `non-brand`. This runs **before** any R6 split, so
`Printer at Farm (WF-2950)` never becomes a query for "Farm".

**R7.2** The brand source is `organization` when it is non-empty after trimming,
otherwise `displayName`. (MATCHING-ENGINE §1: display name is not a person
signal; on org-only contacts it equals the organization.) R6 is applied to
`clean(brandSource)` on the business-card path (R7.3.c, R7.6) and to
`clean(displayName)` on the person path (R7.3.a) — §5 rule 8 is stated in terms
of the display name, and role junk in `organization` must not reclassify a
person.

**R7.3** Let `hasPersonName = givenName or familyName is non-empty after trim`.
If `hasPersonName`:

- a. If R6.2 produced a `brand-tail` from `displayName` → **businessCard**
     (rule 8), **except**:
- b. **Employee guard.** If any of the contact's email addresses has a
     registrable domain (R1) equal to the identity that the tail resolves to
     (R8 applied to the tail alone), the contact works there → **person**, flags
     `person` + `employee`. (`Maya Chen - Apple` + `maya@apple.com`.)
     MATCHING-ENGINE §5 rule 7 beats §5 rule 8.
- c. Else if `inferLoneFirmName` (R7.4) returns a name → **businessCard**, flag
     `lone-firm-name`.
- d. Else → **person**.

**R7.4** `inferLoneFirmName(contact)`: only when exactly one of givenName /
familyName is set, or neither is (an unstructured card). Returns `null` if any
email is FREEMAIL (R2). Let `candidate = clean(the lone name, else displayName)`.
Returns `null` if `candidate` is empty or `looksLikePersonName(candidate)`:

```
looksLikePersonName(n) = clean(n) with ',' → ' ' splits into 2...4 tokens,
                         every token matching ^[A-Za-z][A-Za-z'.-]{1,30}$
```

Otherwise returns `candidate` when `catalogDomain(candidate) != null`.
(A lone given/family name that is a catalog firm is the company, per §2b.)

**R7.5** For a business card, compute `query` per R6, then re-test R7.1 against
`query`. If it is generic now → **nonBrand**. This catches `Front Desk -
Hospital` without blocklisting `Riverbend Clinic - Voicemail`.

**R7.6** `query` is defined **only** for `businessCard`. For `person` and
`nonBrand` the engine MUST NOT compute a query, resolve an identity, or contact
any source; the corpus asserts `query: null, domain: null, via: null`.

**R7.7** Flags for the non-businessCard classes: `nonBrand` → `["non-brand"]`;
`person` → `["photo-protected"]` if the contact already has an image, else
`["person"]`, plus `employee` when R7.3.b fired.

---

## R8. Identity resolution

`resolveIdentity(contact, query) -> {domain, via} | null`. Strict order; the
first step that yields a domain wins, and the `via` label is that step's name.
Rejections inside a step fall through to the **next candidate in that step**,
then to the next step.

**R8.1 Website.** For each website field in contact order: `d =
registrableDomain(value)`. Reject (and flag) when
`d == null`; `d ∈ FREEMAIL`; full host or `d ∈ SOCIAL` (flag
`social-url-ignored`); full host or `d ∈ PLATFORM` (flag
`platform-host-ignored`). Otherwise → `{d, website}`.

**R8.2 Work email.** For each email in contact order: `d =
registrableDomain(part after the last '@')`. Reject when `d == null`,
`d ∈ FREEMAIL`, or `d ∈ SOCIAL` (flag `social-url-ignored`) — see R3.2.
Otherwise → `{d, email}`.

**R8.3 Catalog.** `catalogDomain(query) ?? catalogDomain(organization) ??
catalogDomain(displayName)` → `{d, catalog}`.

`catalogDomain(raw)`:
1. `k = companyKey(raw)`; empty → `null`.
2. `DOMAINS[k]`, else `DOMAINS[k without spaces]`.
3. Else split `k` into words; for `i` from `words.count - 1` down to `1`:
   `head = words[0..<i]`, `tail = words[i...]`. If `DOMAINS[head]` (or the
   space-less head) exists **and** `tail` matches `CATALOG_TAIL_OK` → that
   domain.
4. Else `null`.

`CATALOG_TAIL_OK` = `GEO_WORDS` (R6.6) ∪ `SUBBRAND_TAIL`:

```
pharmacy deli bakery fuel gas market marketplace optical photo curbside
drive thru corporate hq distribution warehouse
```

`H-E-B Pharmacy (Bridgeland)` → `heb.com`. `Kroger Marketplace Cypress` →
`kroger.com`. `Delta Dental` MUST NOT reduce to `delta.com`: `dental` is an
`ORG_SIGNAL` trade word and is deliberately absent from `CATALOG_TAIL_OK`.

The canonical table is `Sources/ContactLogoKit/Normalize/CompanyCatalog.swift`
(≈150 keys). The TypeScript table is a subset and the Kotlin table a smaller
subset; both MUST be brought to parity. Entries the corpus depends on:
`apple, apple inc, amazon, at&t, att, chase, costco, delta, exxon, exxonmobil,
fedex, gcx, h&r block, h-e-b, heb, kroger, publix, raise, southwest,
southwest airlines, texas by texas, txt, united, walgreens, 7-eleven`.

**R8.4 Phone.** For each phone in contact order, `phoneDomain(p)`:
digits only; 11 digits starting `1` → drop the `1`; >10 digits → last 10; look
up the 10-digit key. → `{d, phone}`.

**R8.5 Guess.** `s = guessSlug(query)` (R5.3). If `s != null` → `{s + ".com",
guess}`, flags `via-guess` + `guessed-domain`. Else → `null` (flag
`no-identity`, ceiling `skip`).

The guess MUST use `companyKey`, not the raw name (CL-14). A guessed domain is
never contact-owned evidence and never reaches high (R10.1); in practice the
only asset it produces is a favicon or a fallback tile, both of which are capped
or rejected anyway.

Ordering is load-bearing and currently wrong on Android (catalog before email,
brand tail as a resolution step). `Delta` + `1-800-221-1212` resolves
`via: catalog`, not `via: phone`, because catalog is step 3.

---

## R9. Similarity gate (MATCHING-ENGINE §5 rule 5) — MANDATORY

**R9.1** `passesSimilarity(query, brandName)`:

```
norm(s)  = lowercase, delete [^a-z0-9]
words(s) = lowercase, split on [^a-z0-9]+, drop empties
pass = (norm(q) != "" and norm(b) != "" and (norm(q) contains norm(b)
                                          or norm(b) contains norm(q)))
    or (words(q) ∩ words(b) != ∅)
```

**R9.2** Every candidate produced by a **name-search** source (a source queried
with the brand name rather than a domain: Brandfetch search, Wikimedia, Google
CSE, Google Images) MUST be passed through R9.1 against the query, using the
source-supplied brand label. A candidate that fails is **dropped from the
ranked list**, not merely flagged. This is what kills `Cash App` →
`breadzine.com`.

**R9.3** Candidates fetched **by domain** are exempt. The domain is the
evidence; requiring the business name to resemble its own domain would reject
`Acme Roofing Co` → `acmeroof.net`, which is correct. When the query and the
domain's first label share no token, emit the asset-time flag `name-mismatch`
for the review UI. It does not cap on its own; the `MERGED_DOMAINS` cap (R10.5)
handles the case where a mismatch is actually dangerous.

**R9.4** If, after R9.2, no candidate remains, confidence is `skip`. The web
engine exports `passesSimilarity` and calls it from nowhere (CL-16); that is a
contract violation, not a style issue.

---

## R10. Static ceiling — `staticCeiling(contact)`

The corpus asserts this value as `expect.maxConfidence`. It is computable with
no network. The final tier is:

```
confidence = min(staticCeiling(contact), assetTier(bestCandidate))   [R11.2]
```

Start from `high` for a `businessCard` with an identity, then apply **every**
matching cap (the result is the minimum):

| # | Condition | Ceiling | Flag |
| --- | --- | --- | --- |
| R10.0 | class is `person` or `nonBrand`, or no identity resolved | `skip` | `person` / `photo-protected` / `non-brand` / `no-identity` |
| R10.1 | `via == guess` | `medium` | `guessed-domain` |
| R10.2 | `homonym-risk` and `via ∉ {website, email, phone}` | `medium` | `homonym-risk` |
| R10.3 | `brand-tail` (R6.2) | `medium` | `brand-tail` |
| R10.4 | contact already has an image | `medium` | `replace-existing` |
| R10.5 | `domain ∈ MERGED_DOMAINS` | `medium` | `brand-redirect-risk` |
| — | otherwise | `high` | — |

Two readings of "domain agrees" are deliberately kept apart:

- **R10.2 uses contact-owned evidence only.** A catalog hit for `Delta` is
  name-derived — it is the same guess the homonym warns about, so it cannot
  resolve it. MATCHING-ENGINE §4 says to use *contact context* (email domain,
  notes, address country).
- **R11.3's promotion uses resolved evidence** (`via != guess`), matching §6's
  "Catalog **or** contact-owned domain + square asset may also promote to HIGH".

`via == email` may reach high. (The TypeScript engine currently caps email at
medium; §2b ranks a work email second only to a website, so the cap is removed.)

---

## R11. Asset-time tiering and ranking

**R11.1 Ranking** is unchanged from `CandidateRanker`: score = 100 (square,
aspect ∈ 0.8...1.25) + 40 (`assetType == "icon"`) + source bonus (preferred 48,
manual 50, simpleIcons 36, companiesLogo 32, brandfetch 20, wikimedia 18,
googleCSE 10, favicon 8, googleScrape 6) + 12 (alpha) + 5 (width ≥ 256) − 12
(aggregator host: `logodix. seeklogo. logos-world. 1000logos. stickpng.`).
Stable sort: score descending, original order on ties. Keep the top 5.

**R11.2 `assetTier(best)`**

| Condition | Tier |
| --- | --- |
| no candidate survives R9 | `skip` |
| square **and** icon-typed **and** source ∈ {preferred, simpleIcons, companiesLogo, brandfetch, wikimedia, manual} | `high` |
| square | `medium` |
| otherwise | `low` |

**R11.3** If `via != guess` and the winner is square and the tier came out
`medium`, promote to `high` and flag `domain-match` (§6).

**R11.4 Caps that need the asset:**

- winner's source is `favicon` (or any `*/s2/favicons`, `icons.duckduckgo.com`,
  `faviconV2` URL) → `medium`, flag `favicon-fallback`. **Never high** (§6).
  Android currently places `google.com/s2/favicons` at index 0 and auto-approves
  it at HIGH — that is the single most damaging conformance break (CL-04).
- `isFallbackTile(bytes)` (R11.5) → the candidate is **dropped**, exactly as if
  the fetch 404'd. If nothing remains, `skip`.
- SVG assets MUST be rasterized to a padded square PNG before write **and**
  before dimension measurement; otherwise the curated marks can never satisfy
  the square rule and are structurally locked out of `high` (CL-06).

**R11.5 `isFallbackTile(image) -> bool`** (CL-18)

The shipping check is `data.count < 80`, which no real letter tile trips. The
canonical heuristic, in cost order — the first that answers, answers:

1. **Provider flag.** Brandfetch JSON `fallback == true`, or an asset whose
   `type` is `fallback`/`letter`, or a Logo Link CDN response carrying
   `x-brandfetch-fallback` → tile.
2. **Byte floor.** A PNG/JPEG/GIF payload under **512 bytes** → tile.
   (Raised from 80: a 1-letter tile is a normal 2–10 KB PNG, but nothing under
   512 bytes is a usable logo either.)
3. **Pixel test.** Decode, downscale to at most 64×64 nearest-neighbour, then:
   - `bg` = mean colour of the four 8×8 corner blocks. If any corner block's
     mean differs from `bg` by more than 8 per channel → **not** a tile
     (real logos rarely have four identical flat corners).
   - `ink` = pixels differing from `bg` by more than 32 in any channel.
     `inkFraction = |ink| / (w*h)`. Require `0.02 ≤ inkFraction ≤ 0.22`.
   - Bounding box of `ink`: its centre must lie within 12 % of the image centre
     on both axes, and it must span ≤ 55 % of width and ≤ 55 % of height.
   - Quantise `ink` colours to 5 bits per channel: ≤ 2 distinct values.
   All four hold → tile.

A letter tile is one centred glyph in one colour on a flat field; a real mark
either reaches the edges, uses more colours, or is off-centre. Engines MUST
share these constants so a tile rejected on macOS is also rejected on Android.

**R11.6 Source failure policy** (CL-17)

A source that fails is not the same as a source that found nothing, and neither
may be silent.

- **429 / rate limit.** Retry with exponential backoff and full jitter: base
  500 ms, doubling, 4 attempts, cap 8 s; honour `Retry-After` when present and
  larger. Brandfetch's free tier rate-limits within ~250 calls and Wikimedia
  throttles rapid bursts, so identical contacts otherwise return different
  answers on different runs — which the corpus cannot catch and users will.
- **Exhausted or erroring source.** Record it on the run (`sourceErrors`) and
  surface it in the review UI. `try?` / `catch {}` around a whole source, which
  makes it disappear for the rest of the batch, is a contract violation:
  `MatchPipeline` calls `BrandfetchSource` that way today, so a single 429 turns
  the best source off silently and every later contact is scored as if the
  source had simply found nothing.
- **Determinism.** A run in which a source errored MUST NOT report `skip` as
  though the search were complete; those contacts belong in a retryable state,
  not in "not found".

---

## R12. Flags

**R12.1 Static flags** — asserted by the corpus, emitted in this order:

| Flag | Meaning |
| --- | --- |
| `person` | classified person, no existing photo |
| `photo-protected` | classified person, already has a photo |
| `employee` | person kept as a person by R7.3.b |
| `non-brand` | R7.1 or R7.5 |
| `lone-firm-name` | R7.4 promoted a lone given/family name |
| `brand-tail` | R6.2 fired |
| `decoration-stripped` | R6.3 or R6.4 fired |
| `homonym-risk` | `companyKey(query) ∈ HOMONYM` |
| `brand-redirect-risk` | resolved domain ∈ `MERGED_DOMAINS` |
| `social-url-ignored` | a SOCIAL host was skipped during R8.1/R8.2 |
| `platform-host-ignored` | a PLATFORM host was skipped during R8.1 |
| `userinfo-stripped` | R1.4 removed userinfo from the winning host |
| `subdomain-reduced` | R1.9–R1.11 dropped a non-`www` label |
| `via-website` `via-email` `via-catalog` `via-phone` `via-guess` | the winning step |
| `guessed-domain` | always accompanies `via-guess` |
| `no-identity` | R8 returned null |
| `replace-existing` | the contact already has an image |

**R12.2 Asset-time flags** — never asserted by the corpus:
`favicon-fallback`, `fallback-tile`, `domain-match`, `name-mismatch`,
`non-square`, `aggregator-source`.

**R12.3 UI note.** `via-*` is the machine carrier of the `via` field. A surface
that already renders a humanized "from the contact's website" label MUST NOT
also print `via-website`, and MUST NOT print `guessed-domain` next to a
"guessed from name" label — the audit found the same fact printed three times.

---

## R13. Simple Icons

**R13.1** The canonical slug map (domain → slug) is the union of the Swift and
TypeScript tables:

```
apple.com apple            google.com google          microsoft.com microsoft
amazon.com amazon          meta.com meta              facebook.com facebook
instagram.com instagram    tesla.com tesla            nvidia.com nvidia
netflix.com netflix        spotify.com spotify        adobe.com adobe
salesforce.com salesforce  oracle.com oracle          ibm.com ibm
intel.com intel            cisco.com cisco            stripe.com stripe
paypal.com paypal          visa.com visa              mastercard.com mastercard
americanexpress.com americanexpress                   chase.com jpmorgan
jpmorganchase.com jpmorgan bankofamerica.com bankofamerica
wellsfargo.com wellsfargo  citi.com citigroup         geico.com geico
statefarm.com statefarm    verizon.com verizon        att.com atandt
t-mobile.com tmobile       united.com unitedairlines  aa.com americanairlines
southwest.com southwestairlines                       fedex.com fedex
ups.com ups                usps.com usps              homedepot.com homedepot
lowes.com lowe's           costco.com costco          walmart.com walmart
target.com target          starbucks.com starbucks    mcdonalds.com mcdonalds
uber.com uber              lyft.com lyft              doordash.com doordash
airbnb.com airbnb          nike.com nike              samsung.com samsung
sony.com sony              ford.com ford              bmw.com bmw
usaa.com usaa              centerpointenergy.com centerpointenergy
x.ai x                     x.com x                    twitter.com x
squareup.com square        walgreens.com walgreens    cvs.com cvs
github.com github          linkedin.com linkedin      youtube.com youtube
discord.com discord        slack.com slack            zoom.us zoom
notion.so notion           figma.com figma            dropbox.com dropbox
pinterest.com pinterest    reddit.com reddit          tiktok.com tiktok
whatsapp.com whatsapp      telegram.org telegram      signal.org signal
ebay.com ebay              shopify.com shopify        hulu.com hulu
disneyplus.com disneyplus  spacex.com spacex          starlink.com spacex
```

**R13.2 Slugs MUST NOT be derived.** A domain absent from R13.1 produces **no**
Simple Icons candidate. Android derives the slug by stripping the TLD, so
`delta.com` → `delta` → the *Delta software* mark: a confident, square,
transparent, wrong logo — the highest-damage failure the engine can produce.
Simple Icons slugs are brand names, not domain labels (`chase.com` → `jpmorgan`,
`att.com` → `atandt`); derivation is right only by accident.

**R13.3 `SKIP` set.** `delta.com`. Even if a `delta` slug is later added to
R13.1, delta.com MUST NOT use it; the airline is served by the curated mark
(MATCHING-ENGINE §3 source 1, `PreferredMarksSource`). Extend `SKIP` whenever a
slug is known to belong to a different company on the same domain key.

---

## R14. Conformance

**R14.1** `fixtures/golden-corpus.json` is the shared suite. Each case gives a
contact and the expected `class`, `query`, `domain`, `via`, `maxConfidence`
(= `staticCeiling`, R10) and the complete set of static flags (R12.1). Some
cases also assert `simpleIconsSlug` (R13). Compare flags as a **set**.

**R14.2** Each engine ships one test that loads the JSON, runs its own static
path, and asserts all six fields per case. No network, no image fetch, no clock.
Swift reads it in `Tests/ContactLogoKitTests`; TypeScript in
`web/src/engine/engine.test.ts`; Kotlin in the app's unit-test source set.

**R14.3** A case that an engine cannot yet satisfy is a **failing test**, never
a skipped one and never a deleted case. Adding a case requires a rule reference
in this document; if no rule decides it, add the rule first.

**R14.4** `ARCHITECTURE.md` claimed this corpus already existed and that CI
asserted it. It now exists; wiring it into the three test targets and into
`.github/workflows/ci.yml` is the remaining work (owned outside this file).

---

## R15. Known divergences at the time of writing

Each line is a contract violation in shipping code, with the audit id.

| Engine | Violation | Rule |
| --- | --- | --- |
| TypeScript | no SOCIAL set; a LinkedIn URL becomes the logo domain | R3.1 (CL-03) |
| TypeScript, Kotlin | no registrable-domain reduction | R1 (CL-13) |
| TypeScript | guess path skips `companyKey` | R5.3, R8.5 (CL-14) |
| TypeScript | `passesSimilarity` exported, never called | R9 (CL-16) |
| TypeScript | `via == email` capped at medium | R10 |
| Kotlin | no GENERIC / NON_BRAND / HOMONYM sets at all | R4 (CL-04) |
| Kotlin | favicon at candidate index 0, auto-approved at HIGH | R11.4 (CL-04) |
| Kotlin | Simple Icons slug derived by stripping the TLD | R13.2 (CL-04) |
| Kotlin | identity order is website → catalog → phone → email | R8 |
| Kotlin | `passesSimilarity` has no token-overlap branch | R9.1 |
| all three | §5 rule 8 never reclassifies; `brandTail` is dead code | R6.2, R7.3 (CL-15) |
| all three | fallback-tile detection is `data.count < 80` | R11.5 (CL-18) |
| Swift | `BrandfetchSource` 429 is swallowed by `try?`; no backoff anywhere | R11.6 (CL-17) |
| Swift | raw source bytes written to Contacts; no rasterize/pad | R11.4 (CL-06) |
| Swift, TypeScript | legal-suffix regex has no leading separator, so `Costco` → `cost`, `Cisco` → `cis`, `Medico` → `medi`, `TRICO` → `tri` | R5.2 (new — found while writing the corpus) |
| Kotlin | legal-suffix regex is unanchored, so it strips `Co`/`Group`/`Services` mid-string, not only as a trailing token | R5.2 |

`fixtures/golden-corpus.json` was validated against a scratch reference
implementation of every rule above: all 86 cases agree. The R5.2 defect was
found that way, not by reading the code — which is the argument for the corpus.
