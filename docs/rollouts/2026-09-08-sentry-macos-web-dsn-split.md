# 2026-09-08 — Sentry macOS / web DSN split

Sentry projects are split by platform.  DSNs stay in Infisical; never commit values.

| Surface | Sentry project | Infisical key | Runtime key |
| --- | --- | --- | --- |
| iOS | `contactlogo` (`apple-ios`) | `SENTRY_DSN` | Info.plist `SENTRY_DSN` (unchanged) |
| macOS | `contactlogo-macos` (`apple-macos`) | `SENTRY_DSN_MACOS` | Info.plist `SENTRY_DSN` via build inject |
| Web | `contactlogo-web` (`javascript`) | `VITE_SENTRY_DSN` / `SENTRY_DSN_WEB` | `VITE_SENTRY_DSN` (unchanged) |

## macOS

- `Apps/ContactLogoMac/SentryTelemetry.swift` — plist-only DSN, empty = no-op.
- `ContactLogoMacApp.init()` calls `SentryTelemetry.start()`.
- `project.yml` links sentry-cocoa SPM on `ContactLogoMac` (same package as iOS).
- `Apps/ContactLogoMac/Info.plist` expands `$(SENTRY_DSN)`.
- **Ship/CI:** inject Infisical `SENTRY_DSN_MACOS` into the Mac `SENTRY_DSN` build setting (`xcodebuild SENTRY_DSN=...` or equivalent).  Do not write the value into git, `project.yml`, or Info.plist.
- Session Replay / screenshots are iOS-only in sentry-cocoa; Mac sends crashes, hangs, traces (0.2), profiles (0.1), `sendDefaultPii = false`.

## Web (already on main)

`web/src/observability/sentry.ts` already gates on `VITE_SENTRY_DSN` and already has the fleet feature bar: `enableLogs: true`, traces default `0.2`, Replay `maskAllText` / `blockAllMedia`, `sendDefaultPii: false`.  Env key name unchanged.  Vercel should keep using Infisical `VITE_SENTRY_DSN` (and `SENTRY_DSN_WEB` as the Infisical twin).

## iOS

Unchanged.  Stays on `contactlogo` via plist `SENTRY_DSN`.
