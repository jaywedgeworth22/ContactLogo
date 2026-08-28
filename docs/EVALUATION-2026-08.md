# ContactLogo — full-stack evaluation (2026-08-26)

Scope: `Sources/ContactLogoKit`, `Apps/ContactLogo{iOS,Mac,Android}`, `web/`,
`web/server.mjs`, `docs/`, `.github/workflows/ci.yml`.  Excluded: `backups/` and
`vendor/crest` (frozen snapshots, not shipping code).  Commit `a168fd7`.

Verified by execution: web typecheck, 28 unit tests, production build; a vCard
round-trip test; a headless-Chromium session against the built app at 1280×900
and 390×844; live HTTP probes of `server.mjs` and of the live Vercel deployment.
Swift and Gradle builds were not run — no Swift toolchain or Android SDK in the
evaluation environment — so all native findings are marked *code read* and should
be confirmed on a Mac.

## Re-verification (2026-08-28)

The three findings this document verified in a browser — CL-07, CL-08, CL-09 —
were re-run against the built app on the remediation branch, in the same
headless Chromium at 1280×900, with a twelve-contact vCard:

| | audit (`a168fd7`) | now |
| --- | --- | --- |
| CL-07 | typing `wal` left `value: "w"`, `activeElement: BODY` | `value: "wal"`, `activeElement: INPUT` |
| CL-08 | label froze at 2 until a forced re-render showed 4 | tracks check, uncheck, and both bulk controls |
| CL-09 | 9,804px mobile page, every card in the DOM | 2,203px, 455 DOM nodes |

The session is committed as `web/e2e/audit-repro.mjs` so these can be re-run
rather than taken on trust. It is not in CI and `web` gained no Playwright
dependency: the script says how to install one and run it.

Two notes from re-running, both about the harness rather than the app. Counting
every `input[type=checkbox]` includes the "Circle mask preview" toggle, which
approves nothing — that produced an off-by-one and a false CL-08 failure on the
first pass. And the button pluralizes (`app.ts:1490`), so a matcher for
"Approved Updates" misses a count of exactly one. Both are guarded in the
committed script.

Not re-verified here: the native findings, which remain as the audit left them —
now built by CI on every push, but still not exercised against a real address
book.

## Verdict

The premise is correct and unusually well-argued.  "A wrong logo is worse than
none" is the right insight, confidence tiers are the right mechanism, and
`docs/MATCHING-ENGINE.md` is a genuine asset.

The gap is between that document and the code.  The rulebook is implemented most
faithfully in `ContactLogoKit`, partially in `web/`, and barely on Android.  The
three engines give three different answers for the same contact and nothing tests
them against each other.  Two of the highest-severity problems are not matching
bugs at all — they are data-loss bugs in the web vCard export, including the
"Download backup" button that is meant to be the safety net.

Nothing here is a rewrite.  The work is to make the shells honor the kit, and to
stop the export path destroying address books.

## Surface state

| Surface | State | Headline problem |
| --- | --- | --- |
| ContactLogoKit | Solid | Applies raw source bytes to Contacts — no rasterizing, no padding |
| Web app | Data loss | Export and backup discard most vCard fields; social URLs yield wrong logos |
| iOS | Stubbed | Background matching is a no-op; no per-contact override |
| macOS | Thin | None of the promised power features exist; undo is one level, in memory |
| Android | Unsafe | No generic blocklist; auto-approves favicons as high confidence |
| Hosting | Undeclared | Live on Vercel with no `vercel.json`; the committed Docker/`server.mjs` host is unused |
| Design / UX | Unshippable at scale | Review flow costs five clicks per contact and breaks past a few hundred |

## Critical

### CL-01 — Export and backup silently destroy most of the address book
`web/src/engine/vcard.ts` · **verified by test**

`contactToVcard()` emits only `FN`, `N`, `ORG`, one `EMAIL`, one `TEL`, one `URL`
and `PHOTO`; the parser keeps only the first of each repeated field.  A
round-trip of a realistic card turned 20 lines into 10 and lost all of:

```
UID, TITLE, ADR, BDAY, NOTE, IMPP, CATEGORIES, second EMAIL, second TEL,
second URL, X-SOCIALPROFILE, ORG department, name prefix, name suffix
```

This is not confined to "Export full address book".  **"Download backup"** —
captioned "untouched original address book backup" — uses the same serializer.
Backup → apply → restore permanently loses every address, birthday, note, job
title and second phone number.  Dropping `UID` also means re-import cannot match
existing cards, so Apple Contacts duplicates rather than updates.

The existing test "vcard round-trip keeps org and photo" passes because it
asserts exactly those two fields.

### CL-02 — Every person with an employer comes back as a company
`web/src/engine/vcard.ts` · **verified by test**

`contactToVcard()` writes `X-ABShowAs:COMPANY` unconditionally whenever `ORG` is
present, including for people.  On import, Apple Contacts displays and sorts them
as businesses.  Most people in a working address book have an employer, so one
full export converts a large fraction of the user's colleagues into company cards
— contradicting the first principle that people's cards are left alone.

### CL-03 — A LinkedIn profile URL produces the LinkedIn logo, pre-checked
`web/src/engine/classify.ts` · **verified in browser**

MATCHING-ENGINE §4: "a linkedin.com URL must never yield a LinkedIn logo."  The
Swift kit implements this via `DomainDeriver.social` (24 hosts).  The web
`resolveIdentity()` checks freemail only.  A business card whose sole URL is a
LinkedIn company page resolves to:

```
Acme Roofing Co
  high · Simple Icons · from website · via-website
  src: https://cdn.simpleicons.org/linkedin
  checked: true
```

It lands in "Ready to apply", so select-all-high-confidence → download applies it
unseen.  Same for Facebook, Instagram, X, YouTube, Yelp, Crunchbase.  Android
blocks five social hosts; the web app blocks none.

### CL-04 — Android has no generic blocklist and auto-approves favicons
`Apps/ContactLogoAndroid/.../MatchPipeline.kt` · code read

`grep -rni "hospital|gift card|generic|blocklist|verification" app/src/` returns
nothing.  "Hospital", "Gift Card", "Verification Code", "Manager" and "Printer at
Farm (WF-2950)" are all matched as business cards — the ~5% VISION.md says must
never be auto-matched.  No homonym set either, and the Simple Icons slug is
derived by stripping the TLD, so `delta.com` → `delta` → the Delta *software*
mark, the exact case `SimpleIconsSource.skip` exists to prevent.

Separately, `generateCandidates()` puts `google.com/s2/favicons?sz=128` at index
0, and confidence is computed from catalog membership alone.  A catalog hit gives
`HIGH` + `approved = true` + `selectedIndex = 0`.  §6 says favicon-only hits are
never HIGH; on Android they are the auto-approved default.  The test
`catalogBusinessWithoutPhotoIsReady` pins this behavior in place.

## High

### CL-05 — iOS background matching is a stub that reports success
`Apps/ContactLogoiOS/ContactLogoiOSApp.swift` · code read

```swift
static func handle(_ task: BGProcessingTask) {
    task.setTaskCompleted(success: true)   // never runs the pipeline
    schedule()
}
```

Three independent reasons it could not work even with a real body: `schedule()`
is only called from `handle()`, so nothing is ever submitted; `UIBackgroundModes`
is absent from `project.yml`, so `submit()` would throw `notPermitted`; and there
is no `expirationHandler` and no local notification anywhere in the target.
ARCHITECTURE.md describes this flow as working.

### CL-06 — Native apply writes raw source bytes straight into Contacts
`Sources/ContactLogoKit/Store/ReviewSession.swift` · code read

`applySelected()` assigns whatever `fetchImage()` returned to
`CNContact.imageData` behind a single `data.count > 80` guard — no rasterizing,
no resizing, no padding.  §5.3 ("pad, never crop") exists only in the web canvas
path.

Both top-priority sources return SVG (`PreferredMarksSource` data URL,
`cdn.simpleicons.org`), which Contacts does not accept.  Second-order effect:
`ImageDimensions.read()` parses PNG/JPEG/lossy-WebP only, so an SVG candidate
never gets dimensions, never satisfies `isSquareish`, and **can never reach HIGH
confidence** — the curated marks are structurally locked out of the auto bucket.

### CL-07 — The search box loses focus after every keystroke
`web/src/app.ts` · **verified in browser**

Every state change calls `render()` → `root.replaceChildren()` → a fresh
`<input>`.  Typing `wal` leaves `value: "w"` and `document.activeElement: BODY`.
Search is the only way to navigate a long queue, and it is unusable.

### CL-08 — The primary button misreports how many contacts it will export
`web/src/app.ts` · **verified in browser**

The card checkbox handler sets `item.selected` without calling `render()`.
Ticking two boxes left the label at "Download 2 Approved Updates"; a forced
re-render jumped it to 4.  In a review-first product this is the user's last
confirmation of what they are about to do.

### CL-09 — Full teardown on every interaction, no virtualization
`web/src/app.ts` · **verified in browser**

Every card is in the DOM at once and each keystroke rebuilds all of them,
re-creating every `<img>` and re-requesting every remote logo.  Twelve contacts
already render a 9,804px mobile page.  The stated target is 14,379 contacts with
1,300+ businesses.

### CL-10 — Google import silently stops at 12,000 contacts
`web/src/engine/google-contacts.ts` · code read

`fetchConnections()` loops `page < 12` at 1,000/page and discards any remaining
`nextPageToken`.  Against the project's own benchmark that drops ~2,400 contacts
with no warning.  Photo sync is a bare sequential loop with no rate limiting.

### CL-11 — Failures are swallowed on the paths that matter
kit + web · code read

- `applySelected()` wraps the write loop in `catch { /* stay in review */ }`.
- `undoLast()` uses `try?` then clears `lastBatchID` regardless — a failed undo
  removes the button and reports success.
- In web export, `padAndSquareImage()` catches the tainted-canvas `toDataURL()`
  throw and returns the remote URL; `photoBase64()` then fails to match and the
  `PHOTO` line is dropped — while the notice reads "Downloaded N updated
  contacts."  Any source without permissive CORS produces a photo-less export.

### CL-12 — Neither Android nor the app shells are built in CI
`.github/workflows/ci.yml`, `project.yml` · code read

CI has two jobs: `web` and `kit` (`swift test`).  `swift test` compiles
`Sources/` only — the SwiftUI code in `Apps/` and the Xcode project are never
compiled, and there is no Android job.  ~1,400 lines of shipping app code have no
automated coverage.

That is how this survives: `project.yml` pins `SWIFT_VERSION: "5.9"` while
`ContentView.swift` uses `extension MatchResult: @retroactive Identifiable`,
which requires Swift 5.10+.  The Xcode targets and the SwiftPM package
(`swift-tools-version: 6.0`) do not agree.

## Medium

### CL-13…17 — Three engines, three answers, no conformance suite

- **Subdomains never reduced** (web, Android).  `shop.walgreens.com` stays whole,
  missing the catalog entry and the Simple Icons glyph and hitting CDNs on an
  unknown domain — rated `high`, pre-checked.  Swift has
  `DomainDeriver.registrableDomain`; neither port does.
- **Guessed-domain skips `companyKey`** in web, so the legal suffix survives.
  "Bayou City Sprinkler Repair LLC" produces a 27-char key, trips the 3–24 cap,
  and is dropped entirely; the same business without "LLC" resolves.  Verified.
- **§5 rule 8 is dead in all three engines.**  "Byron Goode Jr - Root Insurance"
  and "Chris At NTB" are the rulebook's own examples.  `brandTail()` exists and is
  unit-tested, but classification returns `person` before `queryName()` is
  reached, so neither contact appears in the queue at all.  Verified.
- **The similarity gate is dead code in web.**  `passesSimilarity()` is exported
  from `normalize.ts` and imported by nothing.  §5.5 is unenforced.
- **No 429 backoff anywhere.**  `BrandfetchSource` throws `rateLimited`, but
  `MatchPipeline` calls it through `try?`, so the source silently disappears for
  the rest of the run.  ARCHITECTURE.md claims all sources honor 429 with
  exponential backoff.

### CL-18…20 — Safeguards described in the docs that were never built

- **Fallback-tile detection.**  Only `ImageFlags.isTooSmall()` (`< 80` bytes)
  exists; a letter tile is a normal 2–10 KB PNG.  Confirmed the web app offers a
  Brandfetch candidate for the invented brand "Zzqx Nonexistent Brand Xyz".
- **Brandfetch is effectively off natively.**  `DefaultSources` adds it only when
  `CONTACTLOGO_BRANDFETCH_CLIENT_ID` is in the process environment.  GUI apps
  have no environment and neither shell has a settings screen.
- **Undo is one level and in memory.**  `lastBatchID` is cleared on use and lost
  on quit, though every batch is still on disk.  `UndoLog.listBatches()` is never
  called and sorts by random UUID, so it cannot order batches chronologically.
  Nothing prunes the log.

### CL-21…22 — Header gaps on both hosting paths
**verified by live probe** — see CL-29 first: production is Vercel, not `server.mjs`.

Probing `server.mjs` locally (the Coolify/Docker path):

```
GET /                     200  content-type only — no CSP, nosniff,
                               Referrer-Policy, HSTS or frame-ancestors
GET /assets/index-*.js    200  no Cache-Control, no ETag, no gzip
GET /%                    500  "URI malformed"
GET /../../../etc/passwd  400  blocked (safeFile is sound)
```

A malformed percent-escape throws `URIError` out of `decodeURIComponent` into the
generic handler, which does `res.end(message)` and returns the raw internal error
string; it should be a 400 with a fixed body.  This is the one item here that is
a genuine bug in `server.mjs` rather than a missing header.

Probing the live Vercel deployment, which is what users actually hit:

```
GET /                     200  HSTS ✓, ETag ✓, cache-control: max-age=0,
                               must-revalidate — no CSP, no nosniff,
                               no X-Frame-Options / frame-ancestors
GET /assets/index-*.js    200  content-encoding: br ✓, ETag ✓,
                               cache-control: public, max-age=0, must-revalidate
```

So two of the three complaints do not apply in production: Vercel adds brotli and
ETags automatically.  Two real problems remain:

- **Security headers are absent on the live site too.**  Vercel supplies only
  HSTS.  For a page that processes address books, no CSP and no `frame-ancestors`
  is the notable gap, and there is no `vercel.json` to add them.
- **Immutable assets are served as if they were volatile.**  Vite emits
  content-hashed filenames precisely so they can carry
  `max-age=31536000, immutable`.  Vercel's default gives them the same
  `max-age=0, must-revalidate` as the HTML shell, so every visit revalidates
  every asset.  A `headers` rule in `vercel.json` fixes it.

### CL-23 — Telemetry can carry contact identifiers off-device
`web/src/observability/datadog.ts` · code read

`datadog.ts` says "Contact payloads are never sent" and the landing page says
"Nothing is uploaded to a server."  Two paths cut against that:

- `updateGoogleContactPhoto()` throws ``Failed to update photo for
  ${resourceName}`` and `reportClientError()` forwards `error.message` to Datadog
  Logs, carrying the Google contact resource id.
- RUM runs with `trackUserInteractions: true`, which derives action names from
  clicked elements; the clickable thumbnail is `<img alt="{display name}">`.
  Worth confirming against a live RUM session — `defaultPrivacyLevel:
  "mask-user-input"` does not cover derived action names.

Both sample rates are 100%.

### CL-24…26 — Neither store would accept these builds today

- **Android cannot be published.**  `targetSdk = 34`; Play has required 35 for
  new and updated apps since Aug 2025.  `allowBackup="true"` ships contact photos
  and app state to Drive backup, contradicting local-first.
  `proguard-rules.pro` is referenced but absent; R8 is off in release.
- **No app icons on Apple.**  There is no `.xcassets` in the repo.
  `ASSETCATALOG_COMPILER_APPICON_NAME: AppIcon` is set on iOS with nothing behind
  it; the macOS target does not set it at all.  Android has a proper adaptive icon.
- **A real Apple Team ID is committed** (`DEVELOPMENT_TEAM: CC8UTF7ATG`, in both
  `project.yml` and the generated pbxproj).  Not a secret, but it hardcodes one
  developer's team and breaks the build for anyone else.

### CL-27…28 — The docs describe a different product than the repo

- `ROADMAP.md` has every Phase 1 (macOS) and Phase 2 (iOS) box unchecked,
  including "Apply + undo log" — all of which exist in code.
- `ARCHITECTURE.md` lists the 189-name golden corpus under "Testing strategy" and
  says "CI asserts expected domains/candidates for each."  It does not exist;
  `ROADMAP.md` still lists it as an unchecked to-do.
- `README.md` says "working web review app and native shells"; `EFFORT-LOG.md`
  says nothing is deployed and the Cloudflare zone for contactlogo.com does not
  exist.  Meanwhile README, `package.json`, the manifest and the app footer all
  present contactlogo.com as live.  (Not reachable from the evaluation sandbox —
  egress is proxied — so this follows the repo's own log.)

### CL-29 — The app is deployed on a platform no document mentions
**verified by live probe**

A Vercel bot comment on the evaluation PR pointed at a preview deployment.  It is
real, it serves the built app, and it is not the hosting path any document
describes:

```
GET /            200  server: Vercel   → /assets/index-BQ44O-Hp.js
                                          (the built bundle, not web/src)
GET /healthz     404  → server.mjs is not running
vercel.json      absent from the repo
```

`AGENTS.md` states "Production hosting is Coolify + Cloudflare, not Render" and
never mentions Vercel.  `EFFORT-LOG.md` records "Deployed: (none on
Coolify/Cloudflare yet)."  Both are literally true and jointly misleading: the app
*is* deployed, on a third platform, from an auto-detected build with no committed
configuration.  Consequences:

- **`web/Dockerfile`, `web/server.mjs` and `npm start` are dead weight** on this
  path — or Vercel is, and one of the two should be deleted.  Right now the repo
  maintains a container host that nothing runs.
- **Server-side APM is dark in production.**  `server.mjs` is where `dd-trace` is
  initialized and where the structured request logs are emitted.  It never runs,
  so the `DD_API_KEY` / APM pipeline documented in `docs/DATADOG.md` and
  `web/README.md` does not exist on the live site.  Only browser RUM and Logs are
  active.
- **The build config lives outside the repo.**  There is no `vercel.json`; the
  deploy bot's payload reports `rootDirectory: "web"`, so the build is wired up in
  the Vercel dashboard instead.  Nothing about how production is built is
  reviewable in a pull request or reproducible from a clone, and there is nowhere
  to put the security and cache headers from CL-21.

Decide which host is real, delete or document the other, and commit a
`vercel.json` if the answer is Vercel.

Still open and gating both stores: `ROADMAP.md` flags **logo licensing** as
unresolved.  Bulk-applying third-party trademarks fetched from Brandfetch,
Logo.dev and Clearbit CDNs is governed by each provider's terms, and Wikimedia
licenses vary per file.

## Design and interaction

Reviewed in a real browser at 1280×900 and 390×844 with a twelve-contact vCard of
the rulebook's own trap cases.

**The landing page is not a landing page.**  VISION.md calls the web app the
marketing surface and top of funnel.  What renders is an `<h1>`, one paragraph,
two buttons and a footnote about retired internal codenames; content stops ~35%
down the fold.  No product mark (for a product about marks), no before/after of a
contact card, no how-it-works, no pricing, no links to the native apps.  The
footer's "ContactLogoKit" and "backups/" is engineering copy on a customer page.

**The review flow does not scale to its own use case.**  Five equal-weight
buttons per card (Try another, Crop, Upload, Paste URL, Skip) with no primary
action.  At the grid's 280px minimum column the content area is ~140px, so the
name wraps to two lines, metadata to three, buttons to three rows.  No keyboard
triage of any kind.  Reviewing 1,300 businesses by mouse at that density is not
realistic, and VISION.md's "one tap to pick" is not what was built.

**Failed logos are invisible and still counted as ready.**  A 404 advances to the
next candidate, but there is no terminal state when all of them fail: the card
stays in "Ready to apply", stays checked, and renders an empty circle.  In the
test run Walgreens, FedEx and Chase were all blank and all checked.

**Internal vocabulary is shown to users.**  The metadata line prints raw engine
flags: `medium · Brandfetch (HD) · guessed from name · homonym-risk, via-guess,
guessed-domain`.  `viaLabel()` humanizes `via`, then the raw `via-guess` and
`guessed-domain` flags print alongside — the same fact three times, twice in
debug spelling.

**Accessibility and theming.**

- `color-scheme: light` with no dark palette, while the manifest sets a dark
  `theme_color` — a dark-mode phone gets a dark status bar above a cream app.
- Card checkboxes have no label and no `aria-label`.
- Candidate buttons are 36×36 (below the 44px minimum) and their only accessible
  name is the source id — "brandfetch", "simpleicons".
- No `:focus-visible` styling anywhere; no `aria-live` on the status banner.
- The crop modal has no `role="dialog"`, no focus trap and no Escape binding;
  transforms and a fade run with no `prefers-reduced-motion` guard.
- Confidence is carried by a border tint plus a lowercase word in 13px muted text.

**Smaller items.**

- `state.filterStatus` is declared, initialized and reset on import, with no UI to
  set it and no code that reads it.
- `cropModal()` registers `window` `mousemove`/`mouseup` listeners on every call
  and removes none; any async image handler firing `render()` while the modal is
  open adds another pair and resets the canvas mid-drag.
- "Not found / not a brand" merges two sets VISION.md deliberately separates,
  hiding the engine's actual miss rate.

## What is genuinely good

- **The rulebook.**  `MATCHING-ENGINE.md` is the best artifact in the repository.
  Most findings above are "the code does not do what this document says", which is
  a far better problem than not knowing what to do.
- **The confidence model.**  Tiering by source, aspect, icon-vs-wordmark and trap
  flags — and refusing to auto-apply guesses — is right.  `CandidateRanker` is
  deterministic, stable-sorted on ties, and cleanly unit-tested.
- **Web build health.**  Typecheck clean, 28 tests in 302ms, production build in
  1.05s, 70.5 KB gzipped, `npm audit` clean.  The Datadog config degrades to dark
  rather than crashing when keys are missing, and that behavior is itself tested.
- **Privacy hygiene after the incident.**  `.gitignore` covers `*.vcf`, `*.abbu`,
  scan dumps and both work directories.  No secrets committed.  Path traversal on
  the host is correctly blocked.
- **The iOS simulator sheet.**  Previewing the chosen logo as an incoming-call
  screen and an iMessage header is the best product idea in the codebase — it
  shows the mark at the size that actually matters.  It should exist on macOS and
  the web too.

## Suggested order of work

Ordered by damage prevented per unit of effort.

1. **Stop the bleeding in the export path.**  Preserve unknown vCard lines
   verbatim through parse and re-emit, keep `UID`, keep repeated fields, and make
   `X-ABShowAs:COMPANY` conditional on the contact actually being a business card.
   Until this lands, "Download backup" is more dangerous than not backing up.
   (CL-01, CL-02)
2. **Port `DomainDeriver` to TypeScript and Kotlin.**  The social blocklist and
   registrable-domain reduction already exist and are tested in Swift; the other
   engines need that code, not a second implementation.  (CL-03, CL-13)
3. **Give Android the blocklist and the confidence rules.**  Non-brand skip,
   homonym cap, favicons never HIGH, Simple Icons slug map with its skip set —
   then fix the test that pins the favicon behavior.  (CL-04)
4. **Write the golden corpus.**  One fixture of the 189 battle-test names with
   expected class, domain and tier, run against all three engines in CI.  It is
   the only thing that stops them drifting again, and ARCHITECTURE.md already
   claims it exists.  (CL-13…17)
5. **Make the web review UI incremental.**  Update in place instead of tearing
   down the tree, virtualize the list, add keyboard triage.  Search focus, the
   stale count and the scale problem are one fix.  (CL-07, CL-08, CL-09)
6. **Rasterize before writing on native.**  Render SVG and pad to a square PNG in
   `applySelected()`, matching the web canvas path — this also unlocks HIGH
   confidence for the curated marks.  (CL-06)
7. **Surface failures.**  Replace the three silent catches with visible state, and
   add a terminal "no logo found" card state.  (CL-11)
8. **Build the shells in CI.**  Add an `xcodebuild` job and a Gradle job, and
   reconcile `SWIFT_VERSION` with the package's tools version.  (CL-12)
9. **Finish iOS background matching or remove the claim.**  Either wire up
   `UIBackgroundModes`, launch-time scheduling, a real handler and a notification,
   or take it out of ARCHITECTURE.md and VISION.md until it is real.  (CL-05)
10. **Settle the hosting story.**  Pick Vercel or Coolify, delete or document the
    loser, commit a `vercel.json` with security headers and
    `immutable` caching for `/assets/*` if it is Vercel, and either restore
    server-side APM or correct `docs/DATADOG.md`.  (CL-21, CL-29)
11. **Decide the logo-licensing question.**  Not an afternoon, and it gates both
    stores.  (CL-28)
