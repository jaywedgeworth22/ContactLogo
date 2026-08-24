# Frozen backups of BadgeBook and Crest

ContactLogo (this repository, GitHub `jaywedgeworth22/ContactLogo`; formerly
`jaywedgeworth22/BadgeBook`) is the surviving product.  These directories are
complete source snapshots of the two apps that were combined into it.  They
are here so either original app can be restored without depending on a live
remote.  Folder names under `backups/` stay `badgebook` and `crest` on purpose.

Snapshot date: 2026-08-21.

| Path | What it is |
| --- | --- |
| `backups/badgebook/` | BadgeBook as of `18fcf2591dc479d37c3efee3c6f04baed23085ff` (Phase 1 MVP, last tree before the Crest combine). |
| `backups/crest/` | Crest as of `8b4ca7282684c0ff4a35700d10ee4999a0fdddba` (initial public Apache-2.0 release). |
| `vendor/crest/` | Live `git subtree` of the same Crest history (path kept so subtree ancestry is not rewritten).  Not a second product.  Do not run it. |

Provenance files: `backups/badgebook/ORIGIN.txt` and `backups/crest/ORIGIN.txt`.

Do not treat GitHub `jaywedgeworth22/crest` `main` as the restore source.  As
of this snapshot that branch is an archive pointer (`082d0a11`), not the app.

## How to recover

From a clone of this repo:

```bash
# Restore BadgeBook sources (Swift kit + native shells + docs)
cp -R backups/badgebook /tmp/badgebook-restore

# Restore Crest (TypeScript PWA)
cp -R backups/crest /tmp/crest-restore
cd /tmp/crest-restore && npm install && npm run dev
```

The snapshots are source trees (not zip-only).  Git history for Crest also
remains in this repo via the `vendor/crest` subtree (`git log -- vendor/crest`).
BadgeBook history is this repository's own commits through `18fcf25`.

## Feature decisions (winner per area)

ContactLogo keeps one review-first engine and three shells (macOS, iOS, web).
Overlaps were not copied blindly.

| Area | Winner | Why | Left in backup only |
| --- | --- | --- | --- |
| People vs companies | ContactLogo product table + Crest | Classified people never get a logo.  Lone firm-in-given-name is a business card. | Old MATCHING-ENGINE "person + org + no photo" path |
| Matching rules | ContactLogo (BadgeBook kit + Crest catalog/phones) | Battle-tested review-first tiers; Crest catalog, phone directory, lone-firm names, iconic-source order. | Crest Clearbit/Wikidata live resolve (`identity.server.ts`). |
| Native address book | BadgeBook / ContactLogoKit | `Contacts.framework`, undo log, CLI apply/undo.  Crest had no native apps. | — |
| Web UX stack | ContactLogo vanilla TS (not Crest React/PWA stack) | Zero-install, no account, contacts stay in memory.  Crest's TanStack/Better Auth/PGLite/IndexedDB stores a local book and login. | Crest React app, Zustand store, Better Auth, PGLite, multiplayer. |
| Import: vCard / Google CSV | Both (already in ContactLogo web) | Same job. | Crest streaming large-file progress UI. |
| Import: Google People API | Crest, ported into ContactLogo web | Best of Crest; optional client id, contacts still not stored. | Crest `/api/google/config` server route. |
| Import: Contact Picker API | Crest, ported into ContactLogo web | Chrome Android / supported browsers. | Crest IndexedDB merge/dedup. |
| Review UI | ContactLogo three buckets + Crest try-another / upload / paste URL | Buckets and pre-check policy from ContactLogo; try-another, upload, and paste-URL from Crest. | Crest one-at-a-time scan carousel, add-contact, home contact list. |
| Existing photos | ContactLogo review-first, tightened | People with photos: never touch.  People without org: skip.  Business cards that already have a photo: needs review, never pre-checked. | Crest `crestApplied` / local library persistence. |
| Logo sources | Combined | Preferred marks, Simple Icons, CompaniesLogo (native), Wikimedia (native), Brandfetch (native, keyed), favicon last.  Web stays CORS-safe (preferred / Simple Icons / favicon / upload / URL). | Crest server `/api/logo` HTML scrape and logo-cache DB. |
| PWA shell | Crest idea, ContactLogo branding | Installable web app; still no contact storage. | Grok PWA scaffolding, `__grok` install chrome. |
| Auth | ContactLogo (none) | Local-first; no account for the free web path. | Better Auth, email/password, isolation middleware. |
| Export | Both | Web: backup + approved vCard.  Native: undo log before write. | Crest share-sheet vCard helper. |
| Tests | ContactLogo | Swift `ContactLogoKitTests` + web `engine.test.ts`. | Crest `scripts/**/*.test.mjs`. |
| Hosting | ContactLogo site URL | `contactlogo.com`.  Production is Coolify + Cloudflare, not Render.  Grok `.me` hosts are legacy Publish only. | Crest-only Grok publish notes. |

## What was merged into the live app (this snapshot's work)

- Frozen backups of both originals (this directory).
- Shared native source list: preferred → Simple Icons → CompaniesLogo (bundled slugs + page parse) → Wikimedia → favicon, plus Brandfetch when a client id is set.
- Review session tracks the chosen candidate (try another) and does not auto-apply replacements of existing photos.
- People without an organization are not logo targets.
- Web: Google Contacts import, device Contact Picker, paste-image URL, PWA manifest, Google client-id setting (localStorage for the key only).
- iOS review queue brought in line with the macOS three-bucket UI.
