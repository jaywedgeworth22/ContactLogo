# ContactLogo — agent notes

Brand icons for the address book.  Review-first matching on macOS, iOS, Android,
and the web.

**Official site:** [https://contactlogo.com](https://contactlogo.com)
**GitHub:** `jaywedgeworth22/ContactLogo`
**Local:** `/Users/jay/Code/ContactLogo`
**Slack `repo:`:** `ContactLogo`
**Acronym:** `CL`

Production hosting is Vercel (auto-deployed from main, no Docker container in use).
The `web/` directory is the Vercel root directory per dashboard configuration.
Security headers, cache policy for `/assets/*`, and build configuration are in
`vercel.json`.  Do not invent Apple or DNS credentials.  Do not treat Grok
Publish (`contact-logo.grok.me`, `contactlogo.grok.me`, `bizlogo.grok.me`) as
the product URL.

Sibling names (other apps, not this repo): Autorotate public host is
`autorotate.codes` (GitHub may still say TopSpin).  DealDex public host is
`dealdex.net`, not `dealdex.online`.

BadgeBook and Crest are retired working names.  Frozen copies live in
`backups/`.  `vendor/crest` is a git subtree path, not a second product.

## Before you start

`~/Code/ContactLogo` is the human integration tree.  Prefer a seat worktree
under `~/apps/` once fleet onboard lands.  Read `docs/CONTACTLOGO.md`,
`docs/EFFORT-LOG.md`, and `/Users/jay/apps/CONTACTLOGO-EFFORT-LOG.md`.

Do not commit scan dumps, AddressBook exports, or `.contactlogo/` / `.badgebook/`
artifacts.
