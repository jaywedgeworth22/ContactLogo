# Handoff — what has to be finished on the local Mac

## Local Mac status (2026-08-27, Grok)

Picked up this note on `~/apps/contactlogo-grok-eval` @ `claude/full-app-evaluation-wwwwk1` (PR #24).  Monet's later commits already merged `origin/main` and dropped the duplicate root `vercel.json`.  This Mac then compiled every toolchain the cloud session lacked:

- `swift test` — 72/72, including `fixtures/golden-corpus.json`
- `xcodegen generate` + iOS Simulator and macOS `xcodebuild` — both **BUILD SUCCEEDED**
- `./gradlew assembleDebug testDebugUnitTest` — **BUILD SUCCESSFUL**, including the Android golden-corpus test
- Web typecheck / 138 tests / production build

Verified on the built iOS app: `UIBackgroundModes = processing` and `BGTaskSchedulerPermittedIdentifiers = com.contactlogo.match` are actually in Info.plist.  `INFOPLIST_KEY_UIBackgroundModes` did not merge on Xcode 26, so those array keys now live in `Apps/ContactLogoiOS/Info.plist`.

Still owner-blocked (unchanged): pick one host; logo-licensing gate; Brandfetch / Logo.dev credentials; Datadog live RUM PII check; signing on the machine with the certificates; apply→undo on a real address book.

---


Branch: `claude/full-app-evaluation-wwwwk1` · PR #24 · audit of record: `docs/EVALUATION-2026-08.md`

A remote Claude Code session audited every surface (29 findings) and then ran an agent team to fix
them.  This note lists what that session **could not** finish, and why, so a local session can pick it
up without re-deriving any of it.

## Why this handoff exists

The remote sandbox has Node 22, npm, Chromium and Playwright — so the web app was fully built, tested
and driven in a real browser.  It has **no Swift toolchain and no Android SDK**.  Every Swift and
Kotlin change in this branch was therefore written without ever being compiled.  It also has no
access to the Vercel dashboard, App Store Connect, Datadog, or a real address book.

Everything below falls into one of three buckets: blocked on a toolchain, blocked on access, or an
owner decision.  Nothing below is "unfinished because we ran out of time" — it is work that
structurally could not happen there.

## 1 — Blocked on a toolchain

### Swift: nothing in this branch has ever been compiled

```
swift build && swift test                    # the kit + CLI
xcodegen generate                            # regenerate ContactLogo.xcodeproj from project.yml
xcodebuild -scheme ContactLogoiOS  -destination 'generic/platform=iOS Simulator' build
xcodebuild -scheme ContactLogoMac  -destination 'platform=macOS' build
```

Expect compile errors and fix them — that is the expected first step, not a sign something went
wrong.  Pay particular attention to:

- **`SWIFT_VERSION` reconciliation (CL-12).**  `project.yml` pinned 5.9 while `ContentView.swift`
  uses `@retroactive`, which needs 5.10+, and `Package.swift` declares tools version 6.0.  The
  build-ci lane changed this; confirm the same sources now compile under **both** SwiftPM and Xcode,
  which is the whole point of the finding.
- **Image rasterizing (CL-06).**  The kit now rasterizes SVG and pads to a square PNG before writing
  to `CNContact.imageData`.  This is the change most likely to have platform-specific compile
  problems — it touches AppKit/UIKit image APIs from a cross-platform target.
- **`BGProcessingTask` (CL-05).**  Verify `UIBackgroundModes` actually contains `processing` in the
  generated Info.plist.  Without it `BGTaskScheduler.submit()` throws `notPermitted` and the whole
  feature silently does nothing — which is exactly how it shipped before.

### Android: nothing in this branch has ever been compiled

```
cd Apps/ContactLogoAndroid && ./gradlew assembleDebug testDebugUnitTest
```

The `targetSdk` bump (CL-24) may surface behaviour changes that need handling, and the Kotlin /
Compose-compiler versions are a matched pair — if either moved, they both have to.

### Device and simulator verification

The audit's most severe findings are about what gets *written to a real address book*.  None of that
can be verified without Contacts access:

- **Apply → undo round trip on macOS and iOS.**  Confirm a batch applies, the undo log restores the
  prior images, and undo survives quitting the app (CL-11, CL-20).
- **The written image is actually usable.**  Apply a Simple Icons and a preferred-mark (Delta)
  candidate and confirm Contacts renders them — before the fix these were SVG bytes Contacts cannot
  decode, and they could never reach HIGH confidence at all (CL-06).
- **Background matching actually fires** overnight and posts its notification (CL-05).
- **App icons** appear in Xcode's target editor with no missing-slot warnings, and pass
  `xcrun altool`/Transporter validation (CL-24).

## 2 — Blocked on access

- **Vercel.**  `vercel.json` was added at the repo root with security headers and immutable caching
  for `/assets/*`.  The project's **Root Directory is set to `web` in the dashboard**, so confirm the
  route patterns resolve against that setting after the first preview deploy — a wrong prefix fails
  silently by simply not matching.  Then re-probe the live deployment:
  ```
  curl -sI https://<preview>.vercel.app/ | grep -iE 'content-security-policy|x-content-type-options'
  curl -sI https://<preview>.vercel.app/assets/<hashed>.js | grep -i cache-control   # want immutable
  ```
- **Datadog (CL-23).**  The remote session could read the config but not a live RUM session.  Confirm
  in the Datadog UI that no RUM action name and no forwarded log message contains a contact display
  name or a Google `people/c…` resource id.  The landing page promises "Nothing is uploaded to a
  server"; this is the check that the promise holds.
- **`DEVELOPMENT_TEAM` (CL-26).**  The hardcoded `CC8UTF7ATG` was made overridable.  Confirm signing
  still resolves on the machine that actually holds the certificates.

## 3 — Owner decisions, not engineering

- **Pick one host (CL-29).**  The app is live on Vercel; `web/Dockerfile`, `web/server.mjs` and
  `npm start` are a Coolify path that nothing runs, while `AGENTS.md` said Coolify + Cloudflare and
  `EFFORT-LOG.md` said nothing was deployed.  The docs were corrected to describe reality, but the
  repo still carries both.  Decide, then delete the loser.  Note the consequence either way: the
  `dd-trace` server-side APM documented in `docs/DATADOG.md` lives in `server.mjs`, so on Vercel it
  never runs and only browser RUM and Logs are live.
- **Logo licensing (CL-28) — a shipping gate for both stores.**  Bulk-applying third-party trademarks
  fetched from Brandfetch, Logo.dev and Clearbit is governed by each provider's terms, and Wikimedia
  licenses vary per file.  `docs/ROADMAP.md` now carries this as an explicit gate.  It needs a real
  answer before either app is submitted; no agent should invent what those terms say.
- **Brandfetch / Logo.dev credentials.**  Several CDN URLs need a client id or token the app does not
  have.  Either provision them or accept those sources are dead.

## 4 — Already verified remotely (don't redo)

To save you the time — these were confirmed by execution in the sandbox, not by reading:

- Web typecheck, unit tests and production build, before and after the changes.
- The four browser-verified findings, each reproduced live in headless Chromium at 1280×900 and
  390×844: the LinkedIn-logo-at-high-confidence bug (CL-03), search focus loss (CL-07), the stale
  approved-count (CL-08), and the `…LLC` guessed-domain drop (CL-14).
- The vCard round-trip data loss (CL-01) and the `X-ABShowAs:COMPANY`-on-people bug (CL-02), both
  proven with a failing test over a rich card.
- Live HTTP probes of `server.mjs` and of the Vercel deployment (CL-21, CL-22, CL-29).

The reproductions all live in `docs/EVALUATION-2026-08.md` under their finding ids, so any of them
can be re-run to confirm a fix still holds.

## 5 — Source of truth

Read these before changing engine behaviour — three engines are now supposed to agree, and these are
what they agree *on*:

| File | What it is |
| --- | --- |
| `docs/EVALUATION-2026-08.md` | The audit.  Every finding id, with its reproduction. |
| `docs/ENGINE-CONTRACT.md` | Normative spec the Swift, TypeScript and Kotlin engines all implement. |
| `fixtures/golden-corpus.json` | Language-neutral cases all three engines test against. |
| `docs/UI-CONTRACT.md` | DOM / ARIA / CSS-token contract between `app.ts` and `styles.css`. |
| `docs/NATIVE-CONTRACT.md` | Swift API surface shared by `ContactLogoKit` and the two shells. |
| `docs/MATCHING-ENGINE.md` | The original rulebook.  Still the reason any of this exists. |

The single highest-value follow-up is wiring `fixtures/golden-corpus.json` into all three test suites
in CI.  Engine drift is the root cause behind CL-13 through CL-17, and a shared corpus is the only
thing that stops it recurring — `docs/ARCHITECTURE.md` has been claiming CI already does this.
