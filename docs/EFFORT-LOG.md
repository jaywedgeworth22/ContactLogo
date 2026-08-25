# ContactLogo Effort Log — cross-agent board
Protocol: /Users/jay/apps/EFFORT-LOG-PROTOCOL.md (canonical). Live board: this file
(mirror: docs/EFFORT-LOG.md in ~/Code/ContactLogo). As of 2026-08-21.

> ⚠️ **AGENT AVAILABILITY NOTICE (2026-08-21):** KIMI is **RETIRED / UNAVAILABLE** long-term (owner directive). All agents MUST NOT assign work or wait on KIMI in-flight work. Reassign any open KIMI effort board lanes or GitHub issues to active seats (AG, GROK, CLAUDE, MONET, etc.).

## Deployed
- (none on Coolify/Cloudflare yet.  Official product URL is https://contactlogo.com.  Grok Publish at https://contact-logo.grok.me is legacy only.)

## Completed
- **2026-08-25 — AG — COMPLETED — Set inline navigation bar title display mode in ContactLogo iOS (branch ag/ios-inline-nav-titles).**  Set .navigationBarTitleDisplayMode(.inline) on root NavigationStack.
- **2026-08-21 — CURSOR — COMPLETED — Local folder `~/Code/ContactLogo` + GitHub `jaywedgeworth22/ContactLogo` + Cursor project name ContactLogo.**  `mv` of `/Users/jay/Code/BadgeBook` (git history, uncommitted merge, `backups/`, `vendor/crest/` intact).  GitHub already renamed (0 forks, old BadgeBook slug redirects).  Origin set to `https://github.com/jaywedgeworth22/ContactLogo.git`.  Cursor project list name/path updated; `~/.cursor/projects/Users-jay-Code-ContactLogo` created.  Frozen snapshots stay `backups/badgebook/` (`18fcf25`) and `backups/crest/` (`8b4ca72`).  Product docs/homepages use `contact-logo.grok.me` (live 200; unhyphenated host 404s).
- **2026-08-21 — CURSOR — COMPLETED — Preserve Crest+BadgeBook merge into the live app.**  Uncommitted kit/web/PWA/Google-import/iOS review work committed with backups.  `vendor/crest/` subtree kept.  Best ideas stay in ContactLogoKit + `web/`.
- **2026-08-21 — KIMI — COMPLETED — [P0] PRIVACY INCIDENT: purged `.badgebook/` from git history.**  Board item 3b9ca6cf.  Removed scan dumps, match results, review HTML, and UUID-keyed candidate PNGs from all commits via `git filter-repo` + force-push.  `.gitignore` now covers `.badgebook/`, `.contactlogo/`, scan artifacts, and AddressBook exports.  Issue #4 closed.  Residual: GitHub may cache old blobs/PR diffs until GC; issue/PR text is path-only; no forks; clones and agent transcripts are out of band.

- **2026-08-21 — AG — COMPLETED — Web, iOS, macOS, Android PWA enhancements & power features.**  Two-way Google Contacts write sync (`updateGoogleContactPhoto` with write scope), in-browser safe-ring canvas studio (`padAndSquareImage`), instant search & smart filter bar with live circle-mask toggle, iOS swipe triage & live simulator sheet (incoming call / iMessage), macOS keyboard shortcuts (Cmd+Return, Cmd+Z, Cmd+Shift+A), expanded offline company catalog.  PR #8 merged.

- **2026-08-22 — AG — COMPLETED — Xcode project (iOS & macOS), ContactLogo.com domain alignment, Android app build.**  Xcode project generation with iOS 17+ min deployment, document format 26 compatibility, bundle IDs `com.contactlogo` and `com.contactlogo.macos`, display name `ContactLogo`, category `utilities`, Dev Team `CC8UTF7ATG`, verified on iOS simulator with screenshot, domain aligned everywhere to `ContactLogo.com` / `https://contactlogo.com` (GitHub metadata, package.json, web, docs), and full native Android application in `Apps/ContactLogoAndroid` built and verified (`app-debug.apk`).  PR merged.

## In Progress
- **2026-08-25 — CURSOR-BUGBOT — IN PROGRESS — Android must skip people at catalog firms.**  `MatchPipeline` treated any organization as a business, so Scan + Apply auto-wrote Apple/Walgreens logos over "Maya Chen at Apple" photos.  Align with ContactLogoKit/web: load given/family, skip people, keep lone firm cards.  No DNS.  No Coolify.
- **2026-08-22 — CURSOR — IN PROGRESS — Domain + CI leftovers (uncommitted).**  Official host `contactlogo.com`.  Added `.github/workflows/ci.yml` (web Node job + macOS `swift test`) and `AGENTS.md`.  Did not run `onboard-new-app.sh` (must be from a fleet worktree, not `~/Code`).  Cloudflare jay account has no `contactlogo.com` zone; no DNS invented.  Personal-Site project list now points at ContactLogo + contactlogo.com.

## Planned / Reserved
- **2026-08-21 — KIMI — PLANNED — [P1] Onboard ContactLogo to the fleet.**  Board item 3b9ca6cf.  Still absent from fleet-apps.json and the digest.  CI workflow now exists locally (see In Progress); dependabot and seat worktrees still missing.  `jaywedgeworth22/crest` is archived (2026-08-21); `vendor/crest` remains a subtree path, not a second product.
- **2026-08-22 — CURSOR — PLANNED — Attach contactlogo.com to Coolify + Cloudflare.**  Domain is owned (Grok tapspin log).  Zone not in Cloudflare yet.  Do not use Render.

## Changelog of this log
- 2026-08-21 — KIMI — file created during owner-requested fleet setup audit.
- 2026-08-21 — P0 history rewrite completed (filter-repo + force-push); no contact names in this log.
- 2026-08-21 — CURSOR — renamed local folder and GitHub product to ContactLogo; moved P0 to Completed; recorded merge+backup preservation; live site URL hyphenated.
