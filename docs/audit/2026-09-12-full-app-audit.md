# ContactLogo Comprehensive Full-Stack Audit & Contact Discovery Review

**Date:** 2026-09-12  
**Reviewer:** Antigravity (AG)  
**Repository:** `jaywedgeworth22/ContactLogo` (`CL`)  
**Scope:** macOS native, iOS native, Android native, Web/PWA, Matching Engine, Data Safety, Observability  

---

## 1. Executive Summary

ContactLogo delivers an exceptionally strong privacy-first premise: brand icons for the address book with strict local execution, deterministic multi-candidate matching, and mandatory human review before writing.  The core matching logic (golden corpus, normalizers, blocklists, confidence ceilings) is battle-tested and consistent across TypeScript, Swift, and Kotlin.

However, a thorough investigation reveals why users report that **the app only finds a small number of their contacts and doesn't see the rest**, alongside critical gaps in safety, mobile database performance, and UI transparency.  This review details the exact mechanics causing contacts to be dropped, evaluates all four platform implementations, and establishes tracking issues (#71 through #76) on GitHub and the effort log.

---

## 2. Root Cause Analysis: Why Contact Scanning Drops Contacts

When users run ContactLogo against their address book, they routinely see only a tiny fraction of their contacts (e.g. 15 out of 500 contacts).  The remaining contacts appear to be completely invisible.  This behavior is caused by a multi-layered filter pipeline combined with UI masking:

### Layer 1: Native Ingestion Gate (`CNContactsProvider.swift` lines 66–68)
In `Sources/ContactLogoKit/Contacts/ContactsProvider.swift`:
```swift
private static func identity(from contact: CNContact, requireCandidateShape: Bool) -> ContactIdentity? {
    let given = contact.givenName.trimmingCharacters(in: .whitespaces)
    let family = contact.familyName.trimmingCharacters(in: .whitespaces)
    let org = contact.organizationName.trimmingCharacters(in: .whitespaces)
    let hasPersonName = !given.isEmpty || !family.isEmpty
    // only people-with-org or business cards are candidates at all
    if requireCandidateShape {
        guard !org.isEmpty || !hasPersonName else { return nil }
    }
```
- When `requireCandidateShape` is `true` (the default in `fetchCandidates()`), any contact where `org.isEmpty` is true requires `!hasPersonName` to be true.
- If a contact has **any** first or last name (e.g., "John Doe", or a business saved in the first name field such as "Joe's Plumbing" or "CVS Pharmacy"), `hasPersonName` is `true`, so `!hasPersonName` is `false`.
- Result: **The contact returns `nil` during enumeration**.  In real-world address books, 80% to 90% of contacts lack an `organizationName` entry in Apple Contacts.  All of these contacts are discarded before matching ever begins.

### Layer 2: Match Classification Gate (`ReviewSession.swift` & `MatchPipeline.swift`)
Even for contacts that *do* have `organizationName` populated (e.g., `given: "Jane"`, `family: "Doe"`, `org: "Google"`):
In `Sources/ContactLogoKit/Store/ReviewSession.swift`:
```swift
let targets = contacts.filter {
    pipeline.classify($0) == .businessCard && !(skipPhotos && $0.hasImage)
}
```
And in `Sources/ContactLogoKit/Pipeline/MatchPipeline.swift`:
```swift
if hasPersonName {
    if let lone = inferCompanyFromLoneName(c) {
        flags.append("lone-firm-name")
        query = NameNormalizer.clean(lone)
    } else {
        let affiliation = segment.isBrandTail ? segment.query : name
        return Self.person(c, employee: isEmployee(c, of: affiliation))
    }
}
```
- `inferCompanyFromLoneName` strictly requires single-component names (`onlyGiven || onlyFamily || unstructured`) that match an offline entry in `CompanyCatalog`.
- Contacts with both given and family names, or given names not in `CompanyCatalog`, are classified as `ContactClass.person`.
- Because `targets` filters strictly on `pipeline.classify($0) == .businessCard`, **all people with companies are excluded from the target list**.
- Furthermore, `ContactClass.nonBrand` (generic nouns like "Hospital", "Front Desk", printer devices) are also excluded from `targets`.

### Layer 3: UI Masking in Native macOS & iOS
In `Apps/ContactLogoMac/ContentView.swift` and `Apps/ContactLogoiOS/ContentView.swift`:
- The review queue only exposes three buckets:
  1. `Ready` (`autoAccepted` - high confidence)
  2. `Review` (`needsReview` - medium/low confidence)
  3. `Not found` (`notFound` - skip confidence)
- These three buckets are populated solely from `results` (which was derived from `targets`).
- There is **no UI bucket, filter, or counter** for:
  - "Personal contacts protected"
  - "Non-brand skipped"
  - "Total address book size"
- The progress indicator reports: `Matching brands… X/X` (where X is only the count of `targets`, e.g. 15).
- The user has no indication that 485 contacts were inspected and protected; they only see 15 items and conclude the app failed to read their address book.

### Layer 4: Businesses Saved in Name Fields
In both mobile and desktop contact managers, users frequently save commercial entities into the Given Name field (e.g. `Given: "Trader Joe's"`, `Given: "Delta Airlines"`, `Given: "Dr. Smith"`):
- If `organization` is empty, Layer 1 drops them at enumeration time.
- If `organization` is populated or filled from import, Layer 2 classifies them as `.person` unless they have a single token matching `CompanyCatalog`.  Multi-word businesses ("Best Buy", "Home Depot", "Trader Joe's") are misclassified as people and discarded.

### Layer 5: Multi-Value Field Truncation in Web Imports
In `web/src/engine/vcard.ts`, `csv.ts`, and `google-contacts.ts`:
- VCard parser uses `firstValued(properties, "EMAIL")` and `firstValued(properties, "URL")`.
- CSV parser only maps "E-mail 1 - Value" and "Phone 1 - Value".
- Google Contacts API mapper only maps `emailAddresses?.[0]` and `urls?.[0]`.
- If a contact lists their personal email (`@gmail.com`) first and corporate email (`@stripe.com`) second, the business identity resolver never inspects the work domain.

### Layer 6: Google Contacts "Other Contacts" Omission
`web/src/engine/google-contacts.ts` calls `people/me/connections`.  In Google Workspace and Gmail, frequently emailed businesses and correspondents are automatically saved under `people/me/otherContacts`.  Unless `otherContacts.list` is queried, those auto-collected contacts are completely omitted.

### Layer 7: Apple Contacts Limited Access (`CNContactStoreAuthorizationStatus.limited`)
In macOS Sonoma (14.0+) and iOS 17+, Apple introduced `.limited` authorization for Contacts.  When the user grants limited access, `enumerateContacts` silently returns only the user-selected subset without raising an error.  The app does not detect `.limited` status or notify the user that full access is required to scan the whole address book.

---

## 3. Platform-by-Platform Review

### 3.1 Web & PWA (`web/`)
- **Strengths:** 
  - 188 automated tests passing across DOM, engine, observability, CSP, and style contracts.
  - Robust PWA configuration with service worker update prompts and clean theme color metadata.
  - Fast uniform-height card virtualization (`REVIEW_CARD_HEIGHT = 248`).
  - Sentry Browser SDK and Datadog RUM slim integration with strict PII scrubbing.
- **Identified Issues:**
  - **Issue #72 (P1):** `updateGoogleContactPhoto` directly overwrites photos in Google People API without capturing a previous photo snapshot or creating an undo log.  Unlike desktop and native mobile apps, web users cannot undo changes made to Google Contacts.
  - **Issue #75 (P2):** Parsers for vCard, CSV, and Google Contacts only read primary email and URL fields, discarding secondary work emails and websites.

### 3.2 macOS Native (`Apps/ContactLogoMac` & `ContactLogoKit`)
- **Strengths:**
  - Full App Sandbox compliance with `personal-information.addressbook` and user-selected file read entitlements.
  - Comprehensive `UndoLog` implementation persisting previous photos to `~/Library/Application Support/ContactLogo/Undo/` with sub-second timestamps and chronological unwind protection.
  - Full keyboard shortcuts (`Cmd+Return` to apply, `Cmd+Z` to undo, `Cmd+Shift+A` to select high).
- **Identified Issues:**
  - **Issue #71 (P0):** `CNContactsProvider.fetchCandidates()` silently discards contacts without `organizationName`.
  - **Issue #74 (P2):** Native macOS engine queries third-party CDNs directly instead of using the Vercel first-party logo cache (`/api/logo/:domain`).
  - **Issue #76 (P2):** No scan breakdown count ("X businesses found in Y contacts") and no mechanism to manually assign a logo to an unlisted contact.

### 3.3 iOS Native (`Apps/ContactLogoiOS`)
- **Strengths:**
  - Modern SwiftUI lifecycle with inline navigation titles and dark/light adaptive palettes.
  - Sentry Cocoa integration supporting Session Replay (100% error, 10% session) and Swift 6 background task safety (`MatchBackgroundTask.register()` nonisolated).
  - Background processing task (`com.contactlogo.match`) persists review queue before notifying.
- **Identified Issues:**
  - **Issue #71 (P0):** Same candidate shape drop as macOS.
  - **Issue #74 (P2):** Misses first-party logo cache.
  - **Missing Authorization Guard:** Does not handle `.limited` contact access.

### 3.4 Android Native (`Apps/ContactLogoAndroid`)
- **Strengths:**
  - Jetpack Compose UI with Material 3 styling, status filtering chips (Ready, Review, Skipped), and custom manual crop/URL override dialogs.
  - Dedicated `UndoLog` storing restore ops in app-private storage.
  - Privacy-safe Sentry Android SDK integration (`io.sentry:sentry-android` 8.54.0) with masked replay and profiling.
- **Identified Issues:**
  - **Issue #73 (P1):** Severe N+1 query bottleneck in `ContactsRepository.loadContacts()`.  The repository performs 5 sub-queries on `ContactsContract.Data` per contact (7,500 queries for 1,500 contacts).
  - **Issue #74 (P2):** Lacks integration with first-party logo cache.

---

## 4. Logo Sourcing & CDN Infrastructure

1. **First-Party Vercel Cache (`/api/logo/:domain`):**
   - Implemented in `web/api/logo/[domain].ts` with in-memory LRU (`MEMORY_MAX = 256`) and edge caching (`s-maxage=86400, stale-while-revalidate=604800`).
   - Rejects personal names, emails, and invalid domains.
   - **Improvement:** Connect native macOS, iOS, and Android clients to this endpoint to accelerate logo loads and reduce third-party rate limits.

2. **Simple Icons CDN:**
   - Slugs validated; weekly liveness CI established (`simpleicons-liveness.yml`).
   - SVG rasterization letterboxed to 15% safe margin per R11.7.

3. **Brandfetch & Logo.dev:**
   - Correctly identifies letter-tile fallbacks (`isFallbackTile`, `ImageFlags.isProviderFallback`).
   - Honors 429 backoff and rate-limiting retry protocols.

4. **Wikimedia Commons:**
   - Sends identified User-Agent `ContactLogo/1.0 (+https://contactlogo.com)` and Referer.

---

## 5. Summary of New GitHub Issues Filed

| Issue # | Component | Title | Priority |
|---------|-----------|-------|----------|
| **#71** | Native (iOS/macOS) | `fix(native): contact scanning drops non-org contacts and silently hides non-business contacts from review UI` | P0 |
| **#72** | Web | `feat(web): add undo log and prior photo snapshot for Google Contacts photo sync` | P1 |
| **#73** | Android | `perf(android): batch query ContactsContract.Data instead of 5 individual queries per contact` | P1 |
| **#74** | Native (All) | `feat(native): integrate first-party Vercel logo cache (/api/logo/:domain) into Swift and Android engines` | P2 |
| **#75** | Web / Engine | `fix(web): preserve multi-valued emails and URLs in vCard, CSV, and Google imports` | P2 |
| **#76** | UI / UX | `feat(ui): display address book scan breakdown and allow manual logo override for any contact` | P2 |

---

## 6. Recommended Action Plan

1. **Resolve Issue #71 (Native Ingestion & UI Transparency):**
   - In `CNContactsProvider.swift`, remove the aggressive enumeration filter `guard !org.isEmpty || !hasPersonName else { return nil }` or expand candidate extraction to check for work email domains and company-catalog matches.
   - In `ReviewSession.swift`, preserve the total address book count and provide UI counters for protected people (`peopleCount`) and non-brand items.
   - Add an "All Contacts" or search tab to allow manual badging for businesses misclassified as individuals.

2. **Resolve Issue #73 (Android Batch Query):**
   - Refactor `ContactsRepository.loadContacts()` to fetch all relevant `ContactsContract.Data` rows in a single batch query, grouping by `contactId` in memory to eliminate the 7,500 round-trips.

3. **Resolve Issue #72 (Google Contacts Web Undo):**
   - Store previous photo URLs/bytes in IndexedDB prior to calling `updateGoogleContactPhoto`, providing an "Undo Google Sync" action.

4. **Resolve Issue #74 (Unify Logo Cache Across Platforms):**
   - Insert `https://contactlogo.com/api/logo/:domain` as a top-ranked CDN source in Swift `DefaultSources.swift` and Kotlin `MatchPipeline.kt`.
