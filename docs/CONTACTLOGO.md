# ContactLogo

ContactLogo is the one product: brand icons for the address book, review-first,
on macOS, iOS, Android, and the web. Official site: [ContactLogo.com](https://contactlogo.com).

This repository previously used two names for the same job (BadgeBook and
Crest). Those names are retired. GitHub is
[`jaywedgeworth22/ContactLogo`](https://github.com/jaywedgeworth22/ContactLogo)
(renamed from `jaywedgeworth22/BadgeBook`; old URLs redirect).  Local checkout:
`~/Code/ContactLogo`.

The Grok web app that also shipped at contactlogo.grok.me and bizlogo.grok.me
is the same product — not a second app.  Official URL is
[contactlogo.com](https://contactlogo.com).  Crest (`jaywedgeworth22/crest`) is a
legacy archive.

The combine work stays: catalog, phones, and iconic marks from the
imported tree at `vendor/crest` sit inside ContactLogo's review-first engine.
Complete frozen copies of both originals are in `backups/` (see
[backups/README.md](../backups/README.md)).

## Official Site

[ContactLogo.com](https://contactlogo.com) is the official product URL. Local folder on this Mac is `~/Code/ContactLogo`.

## What this product does

| Job | How ContactLogo does it |
| --- | --- |
| Find companies in an address book | Person / business / non-brand classes plus catalog |
| Suggest a square iconic mark | Preferred marks, CompaniesLogo picker, Simple Icons, favicons |
| Match by website, work email, name, phone | `IdentityResolver` + `CompanyCatalog` + `PhoneDirectory` |
| Import vCard / Google CSV | ContactLogo Web |
| Import Google Contacts / device picker | ContactLogo Web (Crest capability, no contact storage) |
| Review before write | Ready / Review / Not-found.  High-confidence pre-checked. |
| Backup before write | Undo log (native) + backup download (web) |
| People stay people | Employees are not the company.  Lone firm-in-given-name is the exception. |

## What is not product surface

Grok PWA scaffolding, Better Auth / PGLite login, Crest's logo-cache
**database**, Clearbit/Wikidata live resolve, and multiplayer helpers stay in
`vendor/crest` and `backups/crest` only.  Do not revive PGlite or auth.

The web app processes contacts in the browser and stores nothing except an
optional Google OAuth client id in `localStorage`.  `GET /api/logo/:domain` is
a first-party, domain-keyed cache of license-tagged marks (CDN `s-maxage` plus
instance memory).  It is not an address book.

## Review-first

- Nothing writes without an explicit approve (checkbox / Apply).
- `{name}.com` guesses and favicon-only hits never land in Ready to apply.
- Generic names (`Hospital`, `Verification Code`, printers) stay in Not a brand.
- Homonyms without a contact-owned domain cap at medium.
- Existing person photos are photo-protected.  Classified people never receive a logo.
- Business cards that already have a photo go to Needs review (`replace-existing`).

## File map (imported tree → ContactLogo)

| `vendor/crest` | ContactLogo |
| --- | --- |
| `src/lib/contacts.ts` catalog | `Sources/ContactLogoKit/Normalize/CompanyCatalog.swift`, `web/src/engine/catalog.ts` |
| `src/lib/phones.ts` | `PhoneDirectory.swift`, `web/src/engine/phones.ts` |
| `src/lib/identity.ts` | `IdentityResolver.swift`, `classify.ts` |
| `src/lib/companieslogo.ts` picker | `CompaniesLogoSource.swift` |
| `src/routes/api/logo.ts` Simple Icons / preferred | `SimpleIconsSource.swift`, `PreferredMarksSource.swift`, `web/src/engine/logos.ts` |
| `src/lib/image-flags.ts` | `ImageFlags.swift` |
| `src/lib/vcard.ts`, `vcard-import.ts`, `google-csv.ts` | `web/src/engine/vcard.ts`, `csv.ts` |
| Review actions | macOS / iOS / web three-bucket review, try-another, upload, paste URL |
| Google People API + Contact Picker | `web/src/engine/google-contacts.ts`, `picker.ts` |

Frozen snapshots: `backups/badgebook/` (SHA `18fcf25`) and `backups/crest/`
(SHA `8b4ca72`).  Do not restore Crest from current GitHub `main` (archive pointer).

## Why `vendor/crest` still exists

Renaming that directory would break the `git subtree` history. The path is
the imported tree name, not a second product. Do not run it as an app.
