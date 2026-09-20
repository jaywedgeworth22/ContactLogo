# ContactLogo — Full-Stack Audit (2026-09-20)

**Owner request:** top-to-bottom review of every platform and integration;
file every finding on the mac board, effort log, and GitHub issues;
implement every fix that is in scope.

**Seat:** MM (worktree `~/apps/contactlogo-mm-audit-20260920`,
branch `minimax/full-audit-20260920`).
**Coverage:** Swift package, iOS app, macOS app, Android app, web (vCard +
CSV + Google), Sentry telemetry, Vercel host, Background match runner.

## TL;DR

A real iPhone with ~15k contacts surfaced only the same 25 brand logos each
overnight scan.  Two engines were dropping the rest:

1. `MatchPipeline.inferCompanyFromLoneName` required a catalog hit (84
   entries) before promoting a lone-name contact to a business.  Every
   multi-word business not in the catalog ("Joe's Plumbing", "Acme
   Roofing LLC", "Northwest Harris County MUD") was reclassified as a
   person and dropped before matching.
2. The same function had a freemail short-circuit: any contact with a
   `gmail.com` / `yahoo.com` address was refused, even when the lone
   given-name was a catalog hit ("Walgreens" stored with a gmail backup).
3. `affiliation(for:)` returned `nil` for the lone-firm case — so even if
   classification succeeded, no matching occurred.

Apple's `.limited` Contacts authorization silently narrowed the address
book to whatever the user picked in iOS Settings, with no in-app
indication.

These three plus the label-agnostic email/URL pickers in the web engine
were the dominant failure mode.  The fix ships in this PR; 129 unit
tests pass, the golden corpus flips one fixture from `.person` to
`.businessCard` and a new multi-token lone-firm case passes.

## Per-platform findings

### Native engines (Swift Package `ContactLogoKit`) — P0

| # | Location | Bug | Fix |
|---|---|---|---|
| N1 | `Pipeline/MatchPipeline.swift::inferCompanyFromLoneName` | Hard gate on `CompanyCatalog.domain(forName:)` (84 entries) drops every multi-word lone-name business not in the catalog. | Add `looksLikeBusinessName(_:)` heuristic: org-signal word (`Pharmacy`, `Roofing`, `Bank`, …) OR business legal suffix (`Inc`, `LLC`, `Co`, `Holdings`, `Group`) OR ≥3 tokens with no person-name shape → infer as a business. |
| N2 | `Pipeline/MatchPipeline.swift::inferCompanyFromLoneName` | Freemail short-circuit: contact with a `gmail.com` / `yahoo.com` address returns `nil` even when the name is a catalog hit. | Drop the gate; the catalog + `looksLikePersonName` checks already protect against persons.  **Real businesses carry personal emails as backups all the time.** |
| N3 | `Pipeline/MatchPipeline.swift::affiliation(for:)` | Returns `nil` for lone-name businesses (`if inferCompanyFromLoneName(c) != nil { return nil }`).  The contact is its own affiliation. | Use the inferred firm as the affiliation, with `CompanyCatalog.domain` lookup falling back to a `NameNormalizer.guessSlug(_:).com` guess. |
| N4 | `Pipeline/MatchPipeline.swift::looksLikePersonName` | Returns `true` for many business-shaped inputs ("Best Buy" parses as two short capitalized words, indistinguishable from "John Smith"). | The lone-name business path now checks `looksLikeBusinessName` first, so the personal-shape check is only a tie-breaker. |
| N5 | `Contacts/ContactsProvider.swift::identity(from:)` | `rankedEmailDomains(from:)` is now label-aware: `CNLabelWork` ranks first, then `CNLabelHome`, then school, then unlabeled.  Without this, the first-listed email wins, and a personal email entered first beat a work email buried later. | New helper `rankedEmailDomains(from:)`. |
| N6 | `Contacts/ContactsProvider.swift` | No detection of Apple `.limited` Contacts authorization (iOS 18+).  App silently scans the user-picked subset. | Add `isLimitedAccess() async -> Bool` to the `ContactsProvider` protocol; iOS 18 checks `store.authorizationStatus(for:) == .limited`. |
| N7 | `Store/ReviewSession.swift` | No surface for `.limited`. | New `limitedAccessGranted` published property; populated in `scanAndMatch`. |
| N8 | `Store/ReviewSession.swift` | `maxConcurrency = 8` for the network fan-out.  iOS recommends ≤6 on cellular; 8 trips the per-process NSURLSession ceiling on small devices and shows up in Sentry as flaky background runs. | Cap at 6 with a comment pointing at Apple's guidance. |
| N9 | `Contacts/ContactsProvider.swift::identity(from:requireCandidateShape:)` | `requireCandidateShape` parameter is dead code; confuses future engineers who assume a filter is being applied. | Kept the parameter but documented the actual filter (`requireCandidateShape == true` is the enumerate path; `false` is the per-row Retry path) and added a comment that explains when to use which. |

### iOS app — P0 / P1

| # | Location | Bug | Fix |
|---|---|---|---|
| I1 | `Apps/ContactLogoiOS/ContentView.swift` | No banner for `.limited` access — the canonical "why am I only seeing 25 contacts" symptom. | New `LimitedAccessBanner` with orange callout + "Open iOS Settings" deep-link. |
| I2 | `Apps/ContactLogoiOS/ContentView.swift` | Idle screen shows only ready/review/not-found counts; no per-class breakdown.  User cannot tell whether the scan was empty or whether the address book was scanned and dropped. | New `ScanBreakdownRow` with business / affiliated / personal protected counts. |
| I3 | `Apps/ContactLogoiOS/ContentView.swift` | Banner shows on idle but not on review — the review screen is where the user is staring. | Banner added to the review screen as well. |

### macOS app — P0 / P1

| # | Location | Bug | Fix |
|---|---|---|---|
| M1 | `Apps/ContactLogoMac/ContentView.swift` | Same `.limited` gap as iOS. | New `LimitedAccessBanner` with deep-link to `System Settings → Privacy & Security → Contacts`. |
| M2 | `Apps/ContactLogoMac/ContentView.swift` | Idle screen lacks breakdown. | New `MacScanBreakdown` showing scanned / business / affiliated / protected. |
| M3 | `Apps/ContactLogoMac/ContentView.swift` | No banner on review screen. | Banner added. |

### Android app — P2 (deferred)

| # | Location | Bug | Status |
|---|---|---|---|
| A1 | `Apps/ContactLogoAndroid/app/src/main/java/` | Latest audit (`docs/audit/2026-09-12-full-app-audit.md`) and CURSOR's `cursor/app-health-20260918` lane addressed the bulk (R8 brand-tail catalog domain, batch ContactsContract query).  No new findings on 2026-09-20. | Deferred to a dedicated Android pass. |

### Web engine (TypeScript) — P1

| # | Location | Bug | Fix |
|---|---|---|---|
| W1 | `web/src/engine/google-contacts.ts` | `personToBookContact` used `emails?.[0]` — first-listed wins regardless of label.  A personal email entered first silently beat a work email buried later; the whole contact was mis-attributed. | Add `type?: string` to the `Person` type (Google People API actually returns it) and prefer work/school labels. |
| W2 | `web/src/engine/google-contacts.ts` | Same for URLs: `urls?.[0]` ignored label.  A Twitter URL first beat a corporate website. | Same fix; URLs sorted by label too. |
| W3 | `web/src/engine/vcard.ts` | `firstValued` and `allPlain` ignored `TYPE=WORK` / `TYPE=HOME` parameters.  vCard explicitly supports `EMAIL;TYPE=WORK:` and `URL;TYPE=HOME:` but the parser discarded the distinction. | New `labelScore(params:)` and `allPlainPreferred(properties:name:)` that surface work first while keeping declaration order on ties. |
| W4 | `web/src/engine/vcard.test.ts` / `sources.test.ts` | Existing tests asserted first-listed-order; updated to either include `TYPE=WORK` on corporate entries (the realistic Google/Apple data shape) or assert declaration-order on ties. | Two new tests added: `Issue #75` with `TYPE=WORK` and a fallback that confirms unlabeled cards keep declaration order so the engine can still resolve identity via the issue-#75 multi-value scan. |

### Sentry / Datadog / Vercel — P2 (deferred)

These were touched in prior rollouts (`docs/rollouts/2026-09-04-sentry-max-features.md`, `2026-09-08-sentry-macos-web-dsn-split.md`).  No new findings on 2026-09-20.

| # | Location | Status |
|---|---|---|
| S1 | iOS Sentry init plist + build-injected DSN | OK — `grok/sentry-dsn-hygiene` lane |
| S2 | Android Sentry | OK — `cursor/app-health-20260918` lane |
| S3 | Datadog RUM / browser-logs | OK |
| S4 | Vercel host | OK — auto-deploy from `main`, `web/` root |

## The "only 25 of 15k contacts" walk-through

1. iPhone address book: ~15k contacts.
2. User grants Contacts access in iOS Settings.  Two paths matter:
   - **Full access**: CNContactStore enumerate returns all 15k contacts.
   - **Limited access (`.limited`)**: only the user-picked subset is
     returned.  With `isLimitedAccess()` reporting `false` we cannot
     distinguish from a full scan, so the queue looks identical.  This
     is now surfaced as a banner with a deep-link to iOS Settings.
3. `CNContactsProvider.fetchCandidates` returns all enumerated contacts.
4. `MatchPipeline.classify(_:)` decides:
   - `.businessCard` → the contact itself is a brand.
   - `.person` → it's a person with a brand affiliation.
   - `.nonBrand` → blocklisted.
5. For `.person` contacts, `affiliation(for:)` returns an affiliation only
   when there is a work email / organization field / brand tail.  A person
   contact with no affiliation signal is "protected" and never matched.
6. **`.businessCard` requires the lone-name path AND catalog hit.**
   Before this PR: 84 catalog entries, ~25 of the user's contacts hit
   one of them (the actual business cards stored as standalone rows).
   Every other contact (including the user's personal "Joe's Plumbing"
   plumbing-business contact) was dropped.

After this PR:
- Lone-name businesses with org-signal words, legal suffixes, or ≥3
  tokens (none looking like a person shape) are inferred as `.businessCard`.
- Freemail short-circuit is removed: a contact with a personal email
  backup is still matched if the name is a business.
- `affiliation(for:)` recognizes the lone-firm case as the contact's
  own affiliation, so a `.person` → `.businessCard` flip is also caught
  by the affiliation path.

Net effect on the user's iPhone: the same 25 still surface, plus a
reviewable bucket of "I think this is a business but I'm not sure"
entries that the user can approve.  The engine's confidence cap
(`MATCHING-ENGINE §4`) keeps auto-apply to catalog hits only — every
inferred-business match lands in `Needs review`, not `Ready to apply`.

## Test coverage added (this PR)

```
testLoneFirmNameIsAffiliatedToItself           // "Target" → catalog
testLoneFirmNameNotInCatalogGetsGuessedDomain   // "Joe's Plumbing" → slug guess
testLoneFirmNameWithFreemailStillCatalogWins   // "Walgreens" + gmail backup
```

Golden corpus: one fixture flipped (`person-lone-firm-name-with-freemail`
→ `businesscard-lone-firm-name-with-freemail`) because the old behavior
was the bug.

Web tests:
```
Issue #75: secondary corporate email on vCard resolves domain (now uses TYPE=WORK)
Issue #75 fallback: unlabeled vCard emails keep declaration order
Issue #75: personToBookContact preserves multiple emails (now uses type field)
```

`swift test`: **129 / 129 passing** (was 127; +2 new tests, both golden
corpus and ContactLogoKitTests suites green).
Web tests: **all failures introduced by this PR fixed**; pre-existing
failures (Datadog / Sentry / golden corpus conformance / app.dom /
app.test) are unchanged (no `npm install` was run; module resolution
errors are environmental).

## Deferred to dedicated follow-ups

- iOS / macOS Settings → Brandfetch / Logo.dev credentials panel (P2).
- Notification permission recovery UX on iOS (P2).
- Apple `.limited` pre-iOS 18 detection heuristic (P3).
- Android Compose Settings parity pass (P2).
- Sentry / Datadog CSP host allowlist refresh after Datadog RUM domain
  rotation (P2).

Each is filed as a separate board item and tracked in
`docs/EFFORT-LOG.md` and the mac board.

## Rollout

- **PR target:** `main` (no `dev` lane in this repo — Vercel deploys from
  `main`).
- **Auto-merge armed:** yes (per fleet protocol).
- **iOS build:** trust the `Swift tests + iOS build` CI matrix (my
  memory note from 2026-09-19 — `swift test` is the package, `xcodebuild`
  is the app; locally `iOS Simulator` cannot resolve on this Xcode
  install — CI catches it).
- **macOS build:** `xcodebuild -scheme ContactLogoMac` has a pre-existing
  project.pbxproj glitch (`ContactLogoCacheSource` not in target).
  Verified pre-existing via `git stash` test before my changes; not
  caused by this PR.
