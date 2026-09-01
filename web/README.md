# ContactLogo Web

Zero-install top-of-funnel: upload a `.vcf` or Google CSV → review matches in
three buckets (Ready / Review / Not-found) → download an updated vCard with
logos embedded. Contacts stay in the browser.

Site: [ContactLogo.com](https://contactlogo.com)

The review-first contract: high-confidence only is pre-checked; guessed
`{name}.com` domains and favicon-only hits never auto-apply.  Existing business
photos stay in Needs review.  People are never logo targets.

## Run

```bash
npm install
npm test
npm run dev
```

Optional Google Contacts: set `VITE_GOOGLE_CONTACTS_CLIENT_ID` or paste a
client id in Settings.  Device picker appears on browsers that implement
`navigator.contacts`.

Production build: `npm run build`.  Vercel deployment: auto-deployed from main,
built from the web directory root per `vercel.json`.  Local development server:
`npm start` (serves `dist/` with `dd-trace`; not the production path).
Datadog RUM configuration is documented in [docs/DATADOG.md](../docs/DATADOG.md);
note that server-side APM (`dd-trace` in `server.mjs`) only runs locally, not
in Vercel production (Vercel is a serverless CDN, not a Node container).

## First-party logo cache

`GET /api/logo/:registrableDomain` is a domain-keyed cache of license-tagged
marks.  It does not store address books.  The key is a registrable domain only
— never a contact name, email, or phone.

The web engine tries this URL first and falls through to live CDNs on 404.
Native clients stay on live CDNs until a follow-up wires them.

Default response is the source bytes (`image/png` or `image/svg+xml`) with
`Cache-Control: public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800`
and an `ETag`.  Rasterizing SVG to a padded 512×512 PNG is left to the client
(ENGINE-CONTRACT R11.7) so the serverless function stays light.  Optional JSON:

```bash
curl -sS -D - "https://contactlogo.com/api/logo/apple.com" -o /tmp/apple-logo
curl -sS -H "Accept: application/json" "https://contactlogo.com/api/logo/apple.com"
# { "png512": "data:image/png;base64,…", "source": "simpleicons",
#   "license": "CC0-1.0 OR MIT", "retrievedAt": "…", "etag": "\"…\"" }

curl -sS "https://contactlogo.com/api/logo/not-a-person@example.com"
# 400 — emails are not keys
```

`npm run dev` serves the same function via a Vite middleware.  `npm test`
covers parse/reject, ranked populate, 404 miss, and the JSON contract.
