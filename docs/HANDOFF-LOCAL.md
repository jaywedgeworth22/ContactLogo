# Handoff — what has to be finished on a local machine

**Updated 2026-08-28 21:20 UTC.**  Branch `claude/full-app-evaluation-wwwwk1` · PR #24 · head `2144ea8`
· audit of record `docs/EVALUATION-2026-08.md`.

PR #24 is **green on all six checks and `mergeable_state: clean`**, with 0 unresolved review threads.
Auto-merge is **off** at the owner's instruction; the merge is theirs.  Nothing below blocks the
merge — it is work that structurally cannot happen in a cloud sandbox.

An earlier version of this note said "nothing in this branch has ever been compiled."  That is no
longer true and has been rewritten, because acting on it would waste your first hour.  Every
toolchain now builds and tests on every push (`ci.yml`: `web`, `kit`, `apple` ×2, `android`), and a
local Mac pass on 2026-08-27 confirmed the same.

---

## Start here — the three checks only you can run

Three separate bugs fixed in this branch were all the same shape: **the review card showed one thing
and a different thing got written.**  All three were found by reading and reasoning, and *none* of
them can be confirmed without a real address book.  That makes device verification the highest-value
local work by a wide margin.

### 1. The written image is the image you were shown

The single most important check.  On macOS and on iOS:

- Apply a **Simple Icons** candidate (FedEx is the canonical case) and open the contact in Contacts.
  The mark must be **FedEx purple**.  If it is a **black silhouette**, the `SVGRasterizer` root-fill
  fix regressed.  Background: `cdn.simpleicons.org/fedex` returns `<svg fill="#4D148C">` with the
  glyph's `<path>` bare, and `fillColor` used to read per-element attributes only.  `fill` and
  `fill-opacity` now inherit from the root (ENGINE-CONTRACT R11.4).
- Apply a **preferred mark** (Delta) and confirm Contacts renders it at all — these were SVG bytes
  Contacts cannot decode before CL-06.
- On **Android**, apply any Simple Icons candidate and look at the circular crop.  The mark must sit
  inside a visible margin, not touch the edge.  `square()` used to scale against the full 512×512
  canvas, which is a no-op for a square source, so the photo reached all four edges and Contacts cut
  its corners off — while the Compose preview, which insets, looked correct.  R11.7 and
  `PhotoGeometry` now fix the inset at 15%; `PhotoGeometryTest` asserts the arithmetic
  (512×512 → 358×358 at (77, 77)), but only a device shows the crop.

### 2. Apply → undo against a real address book

This matters more than it did at the last handoff, because **undo was rewritten in this branch.**
The old code deleted every newer batch's log without unwinding it — batch B stayed applied and B's
backup was destroyed, permanently.  Undo now unwinds newest-to-oldest and deletes a log only after
its own restore succeeds.

Test it properly: apply batch A, apply batch B, undo A, and confirm **B is unwound too and both
backups survive**.  Then quit and relaunch and confirm undo still works (CL-11, CL-20).  Use a
throwaway Contacts account, not your own.

### 3. Background matching actually fires

Confirm `BGProcessingTask` runs overnight and posts its notification (CL-05).  The Info.plist keys
are verified present (`UIBackgroundModes = processing`, `BGTaskSchedulerPermittedIdentifiers =
com.contactlogo.match`) — `INFOPLIST_KEY_UIBackgroundModes` did not merge on Xcode 26, so those array
keys live in `Apps/ContactLogoiOS/Info.plist`.  What is unverified is the behaviour.

Related, now implemented on `grok/persist-review-queue` (issue #32): the overnight
notification's queue is written to Application Support before `setTaskCompleted` and
before the notification posts.  A contact-store change token stamps the payload; a
mismatch discards it rather than showing a queue built against contacts that have
since changed.  Candidate URLs only — no photo bytes.

---

## What changed since the last handoff

So you do not re-derive any of it.  Every provider claim below was probed against the live service,
not reasoned about.

**Rule 8 reversed — a named contact never gets a company logo.**  "Dana At Costco" used to be
promoted to Costco's mark.  MATCHING-ENGINE §1 wins: a contact with a person's name is a person, and
an employee is not the company.  The tail is still read, but only to derive the `employee` flag.
Only a card with *no* name fields at all can take its logo from a `Head at Brand` shape, and then
only when the head does not itself read as a name.  All three engines agree; the corpus asserts it.

**Three write-path fixes** (the ones you are verifying above): Swift SVG root-fill inheritance,
Android's missing 15% inset, and `padAndSquareImage` silently returning its *unpadded* input on
failure at three web call sites — vCard export, Google sync, and `applyCrop`.  That last one was the
worst: `crop` is a high-tier source, so a failed render was installed at candidate index 0,
pre-checked, labelled as a crop the user had made.

**Credentialless providers are no longer offered.**  Probed: `cdn.brandfetch.io/<domain>/w/512/h/512`
302s to a 413 KB documentation page (so nothing 404s and the card stays pre-checked at high while
pointing at HTML); `img.logo.dev/<domain>?size=512` answers 401.  Neither enters `candidateUrls`
without its key now.  **Consequence worth knowing before you test:** with no credentials configured,
a domain with no Simple Icons or ticker hit tops out at **medium**, so far fewer contacts arrive
pre-checked than the screenshots in the audit show.  That is intended.

**The fallback-tile byte floor no longer rejects vectors.**  `cdn.simpleicons.org/chase` is 377 bytes
and `…/verizon` is 183 bytes; both are the genuine article.  The 512-byte floor now applies only to
raster payloads.

**The backup export stopped rewriting `URL:`.**  A card that came in saying `URL:acme.example` came
back out as `URL:https://acme.example`.  Scheme normalization is for cards the app synthesizes.

**Paste URL goes through a canvas, not `fetch`** (#34, closed).  So `https:` moved from `connect-src`
to `img-src` — an image can leak a URL but cannot read a response.  Verified in a real browser under
the exact production policy.

**The golden corpus now runs in all three engines** (94 cases).  It previously ran only in the
Android suite, which is how R10.1b shipped to two engines out of three.  Turning it on elsewhere
immediately found R8.3 meaning three different things — including `Delta Dental Center → delta.com`
on `main`, a dental practice pre-checked with Delta Air Lines' logo.  The old version of this note
called wiring the corpus into all three suites "the single highest-value follow-up"; that is done.

**ENGINE-CONTRACT gained R11.7** (apply-time image preparation): the 512×512 canvas, the 15% inset,
and the rule that preparation must not fail quietly.  There was no rule at all before, which is why
the three engines could diverge silently.

---

## Blocked on access, not on you having a Mac

- **Clearbit is unmeasured.**  `logo.clearbit.com:443` is denied by the cloud sandbox's network
  policy (gateway answers 502 to CONNECT).  Combined with issue #37, this means the fallback for
  seven domains is unverified — see below.  Any normal network can settle it in a minute:
  ```sh
  curl -sI 'https://logo.clearbit.com/geico.com?size=512'
  ```
- **Vercel.**  The project's Root Directory is `web` in the dashboard, so confirm `vercel.json`'s
  route patterns resolve against that after a preview deploy — a wrong prefix fails silently by
  simply not matching.  Then:
  ```sh
  curl -sI https://<preview>.vercel.app/ | grep -iE 'content-security-policy|x-content-type-options'
  curl -sI https://<preview>.vercel.app/assets/<hashed>.js | grep -i cache-control   # want immutable
  ```
  Note the CSP changed in this branch: `img-src` now carries `https:` and `connect-src` does **not**.
  `web/src/csp.test.ts` asserts both halves, but only Vercel applies the header.
- **Datadog (CL-23).**  Confirm in the UI that no RUM action name and no forwarded log message
  contains a contact display name or a Google `people/c…` resource id.  The landing page promises
  "Nothing is uploaded to a server"; this is the check that the promise holds.
- **`DEVELOPMENT_TEAM` (CL-26).**  `project.yml` leaves it unset on purpose —
  `CONTACTLOGO_DEVELOPMENT_TEAM=YOURTEAMID xcodegen generate`.  Confirm signing resolves on the
  machine that holds the certificates.

## App Store Connect / TestFlight — nothing exists yet

Worth stating plainly because it has been asked: **no app has ever been archived, signed, or
uploaded, and this repo has no pipeline that could do it.**  The `apple` CI job runs
`xcodebuild build … CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO` — compile only.  There is no
`archive`, `exportArchive`, `altool`, `notarytool`, or fastlane anywhere in the tree; `ci.yml` is the
only workflow; `docs/ROADMAP.md` still has `- [ ] TestFlight via existing App Store Connect account`
unchecked.

To get there you need, in order: App IDs registered and app records created in ASC; an ASC API key
(`.p8` + key ID + issuer ID); `CONTACTLOGO_DEVELOPMENT_TEAM` set; a release job doing
`archive` → `exportArchive` → upload with an `ExportOptions.plist`; and notarization for the macOS
app if it is ever distributed outside TestFlight.  App-icon slots also still need
`xcrun altool`/Transporter validation (CL-24).

**Do not start a store submission before the logo-licensing decision below.**

## Owner decisions, not engineering

- **Logo licensing — a shipping gate for both stores.**  Bulk-applying third-party trademarks fetched
  from Brandfetch, Logo.dev and Clearbit is governed by each provider's terms, and Wikimedia licenses
  vary per file.  Issue **#37** sharpens this considerably: Simple Icons has *removed* 23 of the 79
  slugs this app uses, and the ones it removed are exactly the large corporate marks — Microsoft,
  Amazon, Walmart, Costco, Chase, CVS — which is what that project does when trademark holders
  object.  No agent should invent what those terms say.
- **Pick one host (CL-29).**  Vercel is what runs; `web/Dockerfile`, `web/server.mjs` and `npm start`
  are a Coolify path nothing uses.  Decide, then delete the loser.  Consequence either way: the
  `dd-trace` server-side APM in `docs/DATADOG.md` lives in `server.mjs`, so on Vercel it never runs
  and only browser RUM and Logs are live.
- **Brandfetch / Logo.dev credentials**, or accept those sources as dead.  Now a sharper choice than
  before, since neither is offered at all without a key.

## Open issues

| # | What |
| --- | --- |
| #32 | Persist the iOS background match queue before advertising it — implemented on `grok/persist-review-queue`; still wants a device pass that the overnight notification actually opens the restored queue |
| #33 | Surface retryable rows in the native shells instead of showing them as "Not found" |
| #35 | The web virtualizer assumes every row is the height of the first one |
| #36 | R8 identity order for org-only brand-tail cards |
| #37 | **23 of 79 Simple Icons slugs now 404.**  15 still land a good mark via the ticker fallback; 7 (`geico`, `statefarm`, `usaa`, `centerpointenergy`, `linkedin`, `slack`, `hulu`) have no high-tier source at all |

Also open, and recorded in R11.7 as a **product call rather than a bug**: Swift and Kotlin upscale a
small mark to fill the content box; web caps at 1.0 and leaves it small.  An upscaled 64px favicon is
blurry, a centred one is tiny.  Neither is obviously right.

## Already verified — don't redo

Confirmed by execution, not by reading:

- Web: typecheck, **156 tests**, production build.
- Swift: `swift test` green in CI (77 test functions incl. `GoldenCorpusTests`); iOS Simulator and
  macOS `xcodebuild` **BUILD SUCCEEDED**.
- Android: `assembleDebug` + `testDebugUnitTest` green in CI, corpus green, `PhotoGeometryTest` green.
- `PhotoGeometry` additionally compiled and run standalone, and checked against the *old* geometry to
  confirm its tests fail there (`expected:<358> but was:<512>`) — the tests are real, not tautological.
- The audit's three browser-verified findings, re-run against the built app
  (`node web/e2e/audit-repro.mjs`): CL-07, CL-08, CL-09 all clear.
- The CSP probed in a real browser (`node web/e2e/csp-paste-url.mjs`) before and after the paste-URL
  change: under `img-src … https:` with `connect-src 'self'` and nothing else, the image loads, the
  canvas reads back and `toDataURL` encodes, while `fetch` to the same URL is refused.
- Every provider claim above, by live probe.

## Recipes

### Android engine without the Android SDK

The engine package is pure JVM Kotlin apart from `ContactsRepository.kt`, so a standalone compiler
covers it — a 10-second round trip instead of 4 minutes of CI.  **`PhotoGeometry.kt` is new; keep it
in the list.**

```sh
curl -sSLo kotlinc.zip \
  https://github.com/JetBrains/kotlin/releases/download/v1.9.24/kotlin-compiler-1.9.24.zip
unzip -q kotlinc.zip                       # match Apps/ContactLogoAndroid/build.gradle.kts (1.9.24)
curl -sSLo junit.jar     https://repo1.maven.org/maven2/junit/junit/4.13.2/junit-4.13.2.jar
curl -sSLo hamcrest.jar  https://repo1.maven.org/maven2/org/hamcrest/hamcrest-core/1.3/hamcrest-core-1.3.jar

E=Apps/ContactLogoAndroid/app/src/main/java/com/contactlogo/engine
T=Apps/ContactLogoAndroid/app/src/test/java/com/contactlogo/engine
kotlinc/bin/kotlinc -jvm-target 17 -classpath junit.jar:hamcrest.jar -d out \
  $E/Blocklists.kt $E/CompanyCatalog.kt $E/MatchPipeline.kt $E/Models.kt \
  $E/Normalize.kt $E/PhoneDirectory.kt $E/PhotoGeometry.kt $E/SimpleIcons.kt $T/*.kt
java -cp out:junit.jar:hamcrest.jar:kotlinc/lib/kotlin-stdlib.jar org.junit.runner.JUnitCore \
  com.contactlogo.engine.EngineContractConformanceTest \
  com.contactlogo.engine.MatchPipelineTest \
  com.contactlogo.engine.PhotoGeometryTest
```

Excludes `ContactsRepository.kt` — that one file needs the Android SDK.  UI, Compose and
instrumentation still need a real Gradle build.

### Browser checks

Neither is in `npm test` or CI, deliberately: both need a built bundle, a running server and a
browser.  Run them by hand after touching the review UI or the CSP.

```sh
cd web
npm i --no-save playwright && npx playwright install chromium
npm run build && npm start &
node e2e/audit-repro.mjs        # CL-07 / CL-08 / CL-09
node e2e/csp-paste-url.mjs      # the CSP trade in #34
# CHROME_PATH=/path/to/chrome uses a browser already on the machine
```

`csp-paste-url.mjs` reads the policy out of `vercel.json` rather than restating it, so the script and
the shipped header cannot drift.  It skips its end-to-end button drive, with the reason printed, when
the runner cannot reach the logo hosts.

### Swift

```sh
swift build && swift test
xcodegen generate                            # regenerate ContactLogo.xcodeproj from project.yml
xcodebuild -scheme ContactLogoiOS -destination 'generic/platform=iOS Simulator' build
xcodebuild -scheme ContactLogoMac -destination 'platform=macOS' build
```

## Source of truth

Read these before changing engine behaviour — three engines are supposed to agree, and these are what
they agree *on*:

| File | What it is |
| --- | --- |
| `docs/EVALUATION-2026-08.md` | The audit.  Every finding id, with its reproduction. |
| `docs/ENGINE-CONTRACT.md` | Normative spec the Swift, TypeScript and Kotlin engines all implement.  R15 lists the known divergences. |
| `fixtures/golden-corpus.json` | 94 language-neutral cases all three engines now test against. |
| `docs/UI-CONTRACT.md` | DOM / ARIA / CSS-token contract between `app.ts` and `styles.css`. |
| `docs/NATIVE-CONTRACT.md` | Swift API surface shared by `ContactLogoKit` and the two shells. |
| `docs/MATCHING-ENGINE.md` | The original rulebook.  Still the reason any of this exists. |

One principle behind most of the above, from `VISION.md`: **a wrong logo is worse than none.**  When
a check here is ambiguous, that is the tiebreaker.
