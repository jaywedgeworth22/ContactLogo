# 2026-09-01 — ContactLogo full-stack audit remediations

## Why

Owner asked for a top-to-bottom analysis of contactlogo.com (desktop + mobile), iOS, Android, and the missing logo store, expanding the 2026-09-01 desktop audit and implementing what can ship without legal or store-listing decisions.

## What landed

- Privacy policy rewritten to match the binaries (Android, Google Contacts read/write, every logo host, Datadog, Sentry).  Cream palette.  New `/terms`.
- SEO/PWA: `robots.txt`, `sitemap.xml`, canonical, Open Graph, PNG apple-touch/192/512 icons, cream light `theme-color`, product mark in the header.
- Copy: American "recognize"; "this phone" only when the Contacts Picker exists; address-book promise no longer claims "nothing is uploaded."
- CSP: Sentry ingest allowlisted; `X-Frame-Options: DENY`; CORP `same-origin`; document CORS locked to `https://contactlogo.com` instead of `*`.
- Light theme default via `data-theme="light"` (OS dark no longer boots the product).
- Simple Icons: 22 dead slugs dropped; `chase.com` remapped to live `chase`; weekly liveness workflow.
- Vercel declared as production in `AGENTS.md` / effort log.  `web/server.mjs` is not the live host.
- Native Settings surface keychain write failures.

## Verification

- Live probes: robots/sitemap/terms 404 before this PR; Simple Icons 22/79 404; iTunes lookup `resultCount: 0`; Clearbit 000 from this network.
- `cd web && npm test` — 164 pass.
- `swift test` — 83 pass.

## Follow-ups (not in this PR)

- Owner: logo licensing, `support@contactlogo.com` mailbox, Brandfetch/Logo.dev keys, ASC/Play listings, device apply/undo on a throwaway address book.
- #32 persist iOS review queue.  #33 retryable native rows.  Android undo.  #35 variable-height virtualizer.  First-party `/api/logo/:domain` cache.
- Dual SW registration removed here; SW still caches every same-origin GET (narrow later).
