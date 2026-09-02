# ContactLogo Android — official Sentry SDK

- **SDK:** `io.sentry:sentry-android:8.54.0` (no Gradle mapping plugin; AGP 8.5).
- **Init:** `ContactLogoApp.onCreate` before UI.  `io.sentry.auto-init=false` in the manifest.
- **DSN:** `BuildConfig.SENTRY_DSN` from env `SENTRY_DSN` at compile time.  Unset/empty → SDK not initialized.
- **Privacy:** `sendDefaultPii=false`, no screenshots, no view hierarchy (contacts PII).
- **Sampling:** `tracesSampleRate=0.2`.  Crash + ANR enabled.
- **Gate:** `Apps/ContactLogoAndroid` `./gradlew test`.
