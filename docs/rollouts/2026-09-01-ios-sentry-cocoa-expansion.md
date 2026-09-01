# 2026-09-01 — iOS Native Sentry Cocoa Telemetry & Crash Reporting (Antigravity, `ag/ios-sentry-cocoa-expansion`)

## Context & Objective
Integrates native Sentry Cocoa SDK into ContactLogo iOS to capture native crashes, OOMs, and 2.0s main-thread app hangs, closing the mobile observability blind spot.

## Changes Made
- **Sentry Cocoa SPM Dependency**: Added `https://github.com/getsentry/sentry-cocoa.git` (`8.44.0+`) to `project.yml` and linked `Sentry` product to target `ContactLogoiOS`.
- **SentryTelemetry Manager**: Implemented `SentryTelemetry.swift` for crash reporting, 2.0s app-hang detection, HTTP 5xx error capture, and 0.2 distributed tracing.
- **Privacy Protections**: Disabled screenshot capture (`attachScreenshot = false`) and view hierarchy capture (`attachViewHierarchy = false`).
- **App Startup Wiring**: Initialized `SentryTelemetry.start()` in `ContactLogoiOSApp.init()`.

### Touched Files
- `project.yml`
- `ContactLogo.xcodeproj/project.pbxproj`
- `Apps/ContactLogoiOS/ContactLogoiOSApp.swift`
- `Apps/ContactLogoiOS/SentryTelemetry.swift`
- `docs/rollouts/2026-09-01-ios-sentry-cocoa-expansion.md`

## Decisions & Trade-offs
- **Privacy First**: Sensitive auth parameters are sanitized from event URLs and screenshot captures are disabled.

## Verification State
- `xcodegen generate` — passed.
- `xcodebuild -project ContactLogo.xcodeproj -scheme ContactLogoiOS -showdestinations` — resolved Sentry Cocoa SPM package cleanly.

## Next Steps & Blockers
- Android Sentry SDK is **out of scope until Android ships** as a real track.  iOS Cocoa only for native.
- Web Sentry (`@sentry/browser`) is a sibling rollout: `docs/rollouts/2026-09-01-web-sentry-sdk.md`.
