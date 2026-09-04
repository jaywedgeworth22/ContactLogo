# 2026-09-04 — Sentry Max Features (ContactLogo)

Board `af1ab6e9`.  Branch `grok/sentry-max-features`.  Worktree
`~/apps/contactlogo-grok-sentry-max`.

## Changes

- iOS `profilesSampleRate = 0.1` plus masked Session Replay (10% session /
  100% error).
- Web Replay/Feedback already on.
- **Android native Sentry ENABLE** (Designer override of prior hold):
  `ContactLogoApp` masked Session Replay 10% / 100% error plus
  `profilesSampleRate = 0.1`.  Contacts PII stays off screenshots / view
  hierarchy.

## Verification

- Source review of `Apps/ContactLogoiOS/SentryTelemetry.swift`.
