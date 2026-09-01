# 2026-09-01 — Web Sentry SDK and `logo.match` (Grok, `grok/sentry-fleet-adoption`)

## Summary
Replaces the hand-rolled envelope poster in `web/src/observability/sentry.ts` with the DealDex/BotFleet Vite helper, using `@sentry/browser` because ContactLogo web is vanilla TypeScript (not React).

- Gated on `VITE_SENTRY_DSN`.  Inert in dev/CI when unset.
- Session Replay: **100% on error, 10% session**, `maskAllText` / `blockAllMedia`.
- User Feedback widget on (`autoInject: true`) — consumer web UI at contactlogo.com.
- `sendDefaultPii: false`.  `logo.match` is a count only; no contact names, emails, or domains.
- `countLogoMatch` fires from `adoptContacts` after `matchBook`.
- Production CSP already allows `https://*.ingest.sentry.io` / `https://*.ingest.us.sentry.io`.

## Android
**iOS only until Android ships.**  Cocoa is already wired (`Apps/ContactLogoiOS/SentryTelemetry.swift` + Info.plist).  Do not add the Android Sentry SDK until the Android track is a real shipped listing.

## Env
| Key | Where | Notes |
|-----|-------|-------|
| `VITE_SENTRY_DSN` | Vercel build (project `contactlogo`, root `web/`) | Public client DSN.  Unset = dark. |
| `VITE_SENTRY_REPLAY_SESSION_SAMPLE_RATE` | Vercel build | Default `0.1`. |

Vercel production and preview `VITE_SENTRY_DSN` were written 2026-09-01 (length 95, value not recorded here).  A rebuild of `main` is required for the client bundle to pick it up.  Infisical is still the preferred source of truth when a ContactLogo Infisical project exists.

## Verification
- `npm test` in `web/` — existing suite plus inert `startSentry` / `countLogoMatch`.
- `npm run typecheck`.
