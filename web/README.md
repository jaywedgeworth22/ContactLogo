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

Production build: `npm run build`.  Coolify host: `npm start` (serves `dist/`
with `dd-trace`).  Production Datadog env vars are documented in
[docs/DATADOG.md](../docs/DATADOG.md).  Values stay in Coolify / Infisical.
