# Crest (historical import)

> This directory is a `git subtree` of the retired Crest project. The live
> product is **[ContactLogo](../../README.md)**. Do not run this tree as an
> app. See [docs/CONTACTLOGO.md](../../docs/CONTACTLOGO.md).

Company logos for the contacts that need them.

Crest finds company cards in an address book, suggests a simple square or round mark, and only writes a photo after you approve it. Existing pictures are never replaced unless you tap **Replace**.

**Live site (ContactLogo):** [contactlogo.com](https://contactlogo.com)

## License

[Apache License 2.0](LICENSE) — Copyright 2026 Jay Wedgeworth.

## What it does

- Import from **Google Contacts**, a phone contact picker, or a **vCard / Google CSV** (including large iPhone exports)
- Match companies by website, work email, **company name**, or **phone**
- Prefer transparent iconic marks (CompaniesLogo, Simple Icons, then favicons)
- Review: approve, try another, upload your own, or skip
- Keep a backup before any write back to Contacts
- Works as a website, an iOS home-screen app, or an Android app (PWA)

People who *work at* a company stay people. A lone first or last name that is actually a firm (and has no personal email) is treated as the company. Store locations like `Walgreens (Mason Rd in Cypress)` match **Walgreens**.

## Run it

```bash
npm install
npm run dev
```

Then open the printed local URL. Production build:

```bash
npm run build
npm run typecheck
```

Optional: set `GOOGLE_CLIENT_ID` (or `VITE_GOOGLE_CONTACTS_CLIENT_ID`) so **Import Google Contacts** can read the People API. Without it, export a vCard or Google CSV from [contacts.google.com](https://contacts.google.com/) and import that file.

## Hosting

| Place | What updates it |
| --- | --- |
| This GitHub repo | Commits on `main` |
| [contactlogo.com](https://contactlogo.com) | Coolify + Cloudflare (not Render).  Zone was not in the jay Cloudflare account as of 2026-08-22. |
| Grok `*.grok.me` | Legacy Publish only (`contact-logo.grok.me` / `contactlogo.grok.me` / `bizlogo.grok.me`) |

GitHub Actions do not deploy this product.  Point `contactlogo.com` at Coolify when DNS is in Cloudflare.

## Source layout

- `src/routes` — pages and `/api/logo`, `/api/resolve`, Google config
- `src/lib` — contacts, vCard, logos, identity, Google import
- `src/store/crest.ts` — local address book (IndexedDB)
- `migrations` — logo cache schema (Postgres / PGLite)
- `public` — icons and share card
