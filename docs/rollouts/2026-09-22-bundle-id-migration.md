# 2026-09-22 — Bundle Identifier Migration

Issue raised on the macOS signing-cert change window, where the owner approved a fleet-wide bundle rename so every app uses a domain Jay owns as its base.  This document covers **ContactLogo only**; the rest of the fleet (BotFleet, Autorotate, HogHunter, Socratic.Trade, Congress.Trade, Usage-Monitor, the MiniMax-ios companion) is on separate lanes owned by other seats.  The fleet-wide context lives in `/Users/jay/.minimax/sessions/mvs_0bdfe8c73c1046a986df888aa99dcb2e/workspace/fleet-bundle-id-plan.md`.

ContactLogo is the third-smallest lane in the fleet (only HogHunter is smaller).  Two renames (iOS app + Kit-iOS), two `macos` IDs already correct, one new App Group across both shells, and one new Associated Domain on iOS.  No web refs to update — the live web app on Vercel is owned by the `contactlogo.com` domain, and the Android lane is intentionally out of scope (mirrors the Autorotate Android handling).

## Previous → New

| Surface | Previous | New |
|---|---|---|
| iOS app (`ContactLogoiOS`) | `com.contactlogo` | `com.contactlogo.ios` |
| macOS app (`ContactLogoMac`) | `com.contactlogo.macos` | `com.contactlogo.macos` (keep) |
| ContactLogoKit iOS framework | `com.contactlogo.kit` | `com.contactlogo.kit.ios` |
| ContactLogoKit macOS framework | `com.contactlogo.kit.macos` | `com.contactlogo.kit.macos` (keep) |
| iOS BGTaskScheduler identifier | `com.contactlogo.match` | `com.contactlogo.ios.match` |
| iOS match-ready local notification identifier | `com.contactlogo.match-ready` | `com.contactlogo.ios.match-ready` |
| App Group (new) | — | `group.com.contactlogo` |
| Associated Domain (new, iOS only) | — | `contactlogo.com` |
| Associated Domain values (new, iOS only) | — | `applinks:contactlogo.com`, `webcredentials:contactlogo.com` |
| `bundleIdPrefix` | `com.contactlogo` | `com.contactlogo` (keep — base for both platforms' derived strings) |
| Keychain service `com.contactlogo.credentials` | `com.contactlogo.credentials` | `com.contactlogo.credentials` (keep — internal Keychain service name, not a bundle ID) |
| Android Java package + `applicationId` | `com.contactlogo` | `com.contactlogo` (intentionally **out of scope**; separate future lane, owner decision required) |

The macOS app already carried `com.contactlogo.macos` and the Kit-macOS already carried `com.contactlogo.kit.macos`; the iOS app + Kit-iOS needed the `.ios` suffix to match the rest of the fleet's `platform` suffix convention.

## What changed in the repo

- `project.yml`:
  - `ContactLogoKit` iOS target `PRODUCT_BUNDLE_IDENTIFIER`: `com.contactlogo.kit` → `com.contactlogo.kit.ios`.
  - `ContactLogoiOS` app target `PRODUCT_BUNDLE_IDENTIFIER`: `com.contactlogo` → `com.contactlogo.ios`.
  - `ContactLogoKitMac` + `ContactLogoMac` `PRODUCT_BUNDLE_IDENTIFIER` values unchanged (`com.contactlogo.kit.macos` / `com.contactlogo.macos`).
  - New `CODE_SIGN_ENTITLEMENTS: Apps/ContactLogoiOS/ContactLogoiOS.entitlements` on the `ContactLogoiOS` target.
  - Top-of-file dated callout pointing to this rollout doc; `INFOPLIST_FILE` block already documented the array-keys limitation and now carries a sibling note explaining the entitlements wiring.
- `ContactLogo.xcodeproj/project.pbxproj`:
  - Regenerated with `xcodegen generate` from the updated `project.yml`.  All eight `PRODUCT_BUNDLE_IDENTIFIER = …` build configurations flow through:
    - iOS app Debug + Release: `com.contactlogo.ios`.
    - iOS Kit Debug + Release: `com.contactlogo.kit.ios`.
    - macOS app + Kit Debug + Release: unchanged (`com.contactlogo.macos` / `com.contactlogo.kit.macos`).
  - New `ContactLogoiOS.entitlements` PBXFileReference + PBXBuildFile entries.
  - Side benefit (incidental, deterministic from `project.yml`): `Sources/ContactLogoKit/Sources/ContactLogoCacheSource.swift` was already tracked in git but was missing from the iOS-Kit + macOS-Kit target's source build phases in the prior `project.pbxproj`.  `xcodegen generate` re-walked the source directories and added it back; the file's PBXFileReference and the two PBXBuildFile entries are deterministic output of the project spec and are not a hand edit.
- `Apps/ContactLogoiOS/Info.plist`:
  - `BGTaskSchedulerPermittedIdentifiers` array: `com.contactlogo.match` → `com.contactlogo.ios.match` (must match `MatchBackgroundTask.identifier` in `Apps/ContactLogoiOS/ContactLogoiOSApp.swift`).
  - File header comment updated with the rename rationale.
- `Apps/ContactLogoiOS/ContactLogoiOSApp.swift`:
  - `MatchBackgroundTask.identifier`: `com.contactlogo.match` → `com.contactlogo.ios.match` (must match the Info.plist entry and the BGTaskScheduler queue label).
  - Issue #59 comment + register-handler doc-comment updated to reference the new queue label.
- `Apps/ContactLogoiOS/NotificationScheduler.swift`:
  - `UNNotificationRequest.identifier` for the match-ready notification: `com.contactlogo.match-ready` → `com.contactlogo.ios.match-ready`.
- `Apps/ContactLogoiOS/ContactLogoiOS.entitlements` (**new file**):
  - `com.apple.security.application-groups`: `[group.com.contactlogo]` (App Group).
  - `com.apple.developer.associated-domains`: `[applinks:contactlogo.com, webcredentials:contactlogo.com]` (Universal Links + shared Safari webcredentials).
  - Header comment explains the App Group + Associated Domain rationale and the owner-action prerequisites.
- `Apps/ContactLogoMac/ContactLogoMac.entitlements`:
  - **Added** `com.apple.security.application-groups` with `group.com.contactlogo`.
  - Existing sandbox / address-book / network / user-selected-file entries preserved unchanged.
  - Header comment notes that Associated Domains are intentionally absent on macOS (the App Group is the only shared capability we need today).
- `AGENTS.md`:
  - Top-of-file dated callout pointing to this rollout doc.
  - New canonical `## Bundle identifiers` table listing every surface + the new App Group + Associated Domain + a pointer to this rollout doc.
  - Explicit notes that `com.contactlogo.credentials` (Keychain service) and the Android Java package are intentionally out of scope.
- `docs/EFFORT-LOG.md`:
  - New `2026-09-22 - MM - IN PROGRESS` stanza at the very top describing this rollout, with branch + worktree + board + owner actions.
  - The 2026-08-22 entry that originally named `com.contactlogo` and `com.contactlogo.macos` gains a dated archaeology note: those IDs reflect the 2026-08-22 rebrand state; the iOS app is now `com.contactlogo.ios` and the macOS app is unchanged.
  - New `2026-09-22 — MM — claimed bundle-identifier migration lane` row in `## Changelog of this log`.
- `docs/HANDOFF-LOCAL.md`:
  - Top-of-file archaeology note — the reference to `com.contactlogo.match` on the BGTaskSchedulerPermittedIdentifiers line reflects the pre-rename state; the identifier is now `com.contactlogo.ios.match`.
- `docs/audit/2026-09-12-full-app-audit.md`:
  - The iOS Native "Strengths" bullet that named `com.contactlogo.match` is rewritten to record both the pre-rename value and the post-rename value (with the 2026-09-22 date).
- `docs/rollouts/2026-09-03-ios-bgtask-mainactor-crash.md` (pre-rename rollout):
  - Top-of-file archaeology note — the BG identifier references and the Swift 6 MainActor-trap analysis reflect the pre-rename state; the crash analysis itself is unchanged (the Swift 6 MainActor trap on the launch handler still applies, only the queue label is renamed).

### Out-of-scope files (not edited, intentionally)

- `Sources/ContactLogoKit/Store/SettingsStore.swift` — `Credential.service = "com.contactlogo.credentials"` is an internal Keychain service string, not a bundle ID.  Renaming it would invalidate existing Brandfetch credentials on user devices.  Out of scope for this lane.
- `Apps/ContactLogoAndroid/` — entire Android tree intentionally out of scope.  The Java package namespace (`com.contactlogo.engine`, `com.contactlogo.ui`, `com.contactlogo` for `MainActivity`) + Gradle `applicationId` would need to move to a parallel target suffix — that requires a directory move + import refactor across the Android module.  Separate future lane.  Owner should decide whether to align Android with the fleet's `.<platform>` suffix convention (e.g. `com.contactlogo.android`) or leave it as `com.contactlogo` and document the exception.
- `Sources/ContactLogoKit/` source files other than `SettingsStore.swift` — grep confirmed no other internal-namespacing strings reference the renamed bundle IDs.
- `Tests/ContactLogoKitTests/` — no test fixtures reference any of the renamed bundle IDs or BG identifier; the kit tests are pure-Swift with no `Bundle.main` / `Info.plist` introspection.
- `web/` — no bundle-ID references in the web app; the live web app on Vercel is owned by `contactlogo.com` regardless.
- `backups/`, `vendor/`, `node_modules/`, `.build/` — vendor checkouts + archaeology, do not edit.
- No `dealdex.net`, `services.jays.*`, `com.botfleet.*`, `codes.autorotate.*`, `com.jayservices.HogHunter`, `trade.socratic.*`, `trade.congress.*`, `net.dealdex`, or `app.botfleet.*` references exist in this repo.

## Cross-repo files touched (not in this PR's diff)

- `~/Library/LaunchAgents/` — none (no server-side / harness components on this app).
- `~/apps/contactlogo-*-start.sh` / `~/apps/contactlogo-*.py` — none of these exist; ContactLogo has no agent harness.
- `/Users/jay/Code/ContactLogo/` — the human integration tree.  No edits; the worktree stays on `minimax/bundle-rename` and the owner merges through the PR.

## Owner action items

1. **Apple Developer Portal** — register the new explicit App IDs: `com.contactlogo.ios`, `com.contactlogo.kit.ios`, `com.contactlogo.macos` (the macOS one already exists, verify it), `com.contactlogo.kit.macos`, and the new App Group capability `group.com.contactlogo` on **all three** App IDs (it must be registered per-App-ID for `UserDefaults` sharing + shared-container participation).  Add the Associated Domain capability `contactlogo.com` (`applinks` + `webcredentials`) on `com.contactlogo.ios`.  This PR does not have the credentials to do so.
2. **`contactlogo.com` DNS + AASA** — host the Apple App Site Association at `https://contactlogo.com/.well-known/apple-app-site-association` on the verified `contactlogo.com` zone (Universal Links for `com.contactlogo.ios` and webcredentials for the shared Safari password flow).  The associated-domains entitlement values `applinks:contactlogo.com` and `webcredentials:contactlogo.com` are already wired in `Apps/ContactLogoiOS/ContactLogoiOS.entitlements`; they will validate once the AASA is reachable.
3. **Code-signing** — the certificate refresh is vendor-driven and out of scope.  After the cert swap, the build picks up the new bundle ID without any further source change (it reads `PRODUCT_BUNDLE_IDENTIFIER = "com.contactlogo.ios"` from `project.yml`).
4. **TestFlight re-upload** — vendor (hosted `testflight.yml` or equivalent).  No source change required beyond this PR's `project.yml`; `xcodegen generate` regenerates `ContactLogo.xcodeproj` with the new `PRODUCT_BUNDLE_IDENTIFIER`.
5. **macOS keychain access group** — if the owner wants existing macOS Keychain items to remain shared with the renamed iOS app beyond the existing service-name namespace, no action is needed for the lane itself (the Keychain service `com.contactlogo.credentials` is unchanged).  If a clean cut is desired on the App Group side, the owner signs the new App Group separately — out of scope for this PR.
6. **Android bundle** — separate lane (see the `out-of-scope` section above).  Owner decides whether to align Android with the fleet's `.<platform>` suffix convention or leave as `com.contactlogo` and re-scope later.

## Verification

- `git grep -nE 'com\.contactlogo([^.]|$)'` (excluding `Apps/ContactLogoAndroid/`, `backups/`, `vendor/`, `.build/`, `web/`) returns only archaeology hits:
  - `docs/HANDOFF-LOCAL.md` line 57 — carries a top-of-file archaeology note explaining the rename.
  - `docs/audit/2026-09-12-full-app-audit.md` — the iOS Native strengths bullet was rewritten to record both pre-rename and post-rename values.
  - `docs/rollouts/2026-09-03-ios-bgtask-mainactor-crash.md` — carries a top-of-file archaeology note explaining the rename.
  - `docs/EFFORT-LOG.md` — the new IN_PROGRESS stanza + the historical 2026-08-22 row (preserved as archaeology with a dated note) + the new Changelog row.
- `git grep -nE 'com\.contactlogo(\.|$)'` (the broader acceptance-criteria regex, with `\.|$`) returns the same set, plus:
  - `Apps/ContactLogoAndroid/app/src/main/java/com/contactlogo/`, `Apps/ContactLogoAndroid/app/src/main/java/com/contactlogo/ui/`, `Apps/ContactLogoAndroid/app/src/main/java/com/contactlogo/engine/`, `Apps/ContactLogoAndroid/app/src/test/java/com/contactlogo/engine/` — the entire Android tree, which is **intentionally out of scope** (Java namespace + `applicationId`).
  - `Sources/ContactLogoKit/Store/SettingsStore.swift` line 22 — the internal Keychain service name, which is unchanged.
- `git grep -nE 'com\.contactlogo\.match'` (BG task identifier) returns only archaeology hits (HANDOFF-LOCAL.md, audit, 2026-09-03 rollout); the active identifier `com.contactlogo.ios.match` lives in `Apps/ContactLogoiOS/Info.plist` + `Apps/ContactLogoiOS/ContactLogoiOSApp.swift`.
- `git grep -nE 'com\.contactlogo\.match-ready'` returns nothing — the active identifier is `com.contactlogo.ios.match-ready` in `Apps/ContactLogoiOS/NotificationScheduler.swift`.
- `plutil -lint Apps/ContactLogoiOS/Info.plist`, `plutil -lint Apps/ContactLogoMac/Info.plist`, `plutil -lint Apps/ContactLogoiOS/ContactLogoiOS.entitlements`, `plutil -lint Apps/ContactLogoMac/ContactLogoMac.entitlements` — all clean.
- `xcodegen generate` regenerates `ContactLogo.xcodeproj` from `project.yml`; the new `PRODUCT_BUNDLE_IDENTIFIER` values flow into the target build settings without any hand edit.
- `xcodebuild -list -project ContactLogo.xcodeproj` (post-`xcodegen generate`) lists all four targets (`ContactLogoKit`, `ContactLogoKitMac`, `ContactLogoiOS`, `ContactLogoMac`) cleanly with both Debug + Release build configurations.
- `Apps/ContactLogoiOS/Info.plist` `BGTaskSchedulerPermittedIdentifiers` entry (`com.contactlogo.ios.match`) matches `MatchBackgroundTask.identifier` in `Apps/ContactLogoiOS/ContactLogoiOSApp.swift` and the BGTaskScheduler queue label.
- `Apps/ContactLogoiOS/NotificationScheduler.swift` notification identifier (`com.contactlogo.ios.match-ready`) carries the new prefix.
- `Apps/ContactLogoiOS/ContactLogoiOS.entitlements` carries `com.apple.security.application-groups: [group.com.contactlogo]` and `com.apple.developer.associated-domains: [applinks:contactlogo.com, webcredentials:contactlogo.com]`.
- `Apps/ContactLogoMac/ContactLogoMac.entitlements` carries `com.apple.security.application-groups: [group.com.contactlogo]` (no Associated Domains on macOS, by design).
- `AGENTS.md` Bundle Identifiers section is the new canonical table for future seats; top-of-file callout points to this rollout doc.
- `docs/EFFORT-LOG.md` carries the new `2026-09-22 - MM - IN PROGRESS` stanza at the very top of the file, the archaeology-noted 2026-08-22 entry, and the new Changelog row.
- `Sources/ContactLogoKit/Store/SettingsStore.swift` references to `com.contactlogo.credentials` were searched but **not** edited — it is an internal Keychain service name, not a bundle ID.

## Out of scope

- Apple Developer Portal App ID + App Group + Associated Domain registration (owner).
- `contactlogo.com` AASA hosting + DNS (owner).
- Code-signing cert refresh (vendor).
- TestFlight re-upload (vendor).
- Android `com.contactlogo.*` Java package + `applicationId` rename (separate future lane; owner should decide target suffix convention).
- Keychain service-name string `com.contactlogo.credentials` in `Sources/ContactLogoKit/Store/SettingsStore.swift` (internal API; renaming would invalidate existing Brandfetch credentials on user devices).
- Renaming the macOS app + Kit-macOS from `com.contactlogo.macos` / `com.contactlogo.kit.macos` — already correct, no change needed.
- Renaming the `web/` app's domain alignment (already `contactlogo.com`).
- Other fleet apps' bundle renames (separate per-app PRs, separate seats).
