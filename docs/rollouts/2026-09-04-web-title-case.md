# 2026-09-04 — ContactLogo.com Title Case chrome

Owner ruling 2026-09-03: headings, buttons, tabs, and section names use Title Case.
Body prose stays sentence case with two ASCII spaces between sentences.

Board `62acf520`, issue #63, branch `grok/web-title-case`.  Web only.  Did not extra-ship TestFlight (Stop on 1.0.3; the phone still has the crashing 1.0.2 binary).

## Why

ContactLogo.com landing and review chrome was still sentence case (`How it works`, `Try another`, `Import from this phone`, and the rest of the punch list).  Fleet copy (`FLEET-UI-COPY.md`) already names the replacements (`How It Works`, `Import From This Phone`, `Try Another`).

## Files

- `web/src/app.ts` — landing headings, drop-zone heading, import/review/card buttons, filter chips, section titles, stats labels.
- `web/index.html` — document / Open Graph / Twitter titles.
- `web/src/app.dom.test.ts`, `web/src/app.test.ts`, `web/e2e/audit-repro.mjs`, `web/e2e/csp-paste-url.mjs` — matchers.
- `docs/UI-CONTRACT.md` — chip and section copy (the contract already said Title Case).

Left alone: body paragraphs, status values (`No logo found`, `High confidence`), native iOS/Mac/Android chrome, `vendor/crest`, `backups/`.

## Verification

```bash
cd web
npm test
npm run typecheck
npm run build
```

Browser: landing headings and import buttons, then import a small vCard and check review toolbar + card actions.

## Follow-ups (not this PR)

- Native `Try another` / `Choose your own…` / `Ready to apply` still sentence case.  Do not ship TestFlight for that until Jay lifts the Stop on 1.0.3.
- Privacy and Terms page headings (`On-device processing`, `The product`) are still sentence case.
