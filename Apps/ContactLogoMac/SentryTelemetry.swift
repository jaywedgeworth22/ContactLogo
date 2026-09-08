import Foundation
import Sentry

/// Native Sentry crash reporting and telemetry for ContactLogo macOS.
///
/// DSN is read only from Info.plist (`SENTRY_DSN`).  There is no hardcoded
/// fallback — missing or empty skips init so a leaked default cannot be
/// pointed at the wrong project.
///
/// Ship/CI should inject Infisical `SENTRY_DSN_MACOS` into the `SENTRY_DSN`
/// build setting (Sentry project `contactlogo-macos`).  Do not put a live
/// DSN in git.  Session Replay / screenshots are iOS-only in sentry-cocoa.
enum SentryTelemetry {
    static func start() {
        let dsn = (Bundle.main.object(forInfoDictionaryKey: "SENTRY_DSN") as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        guard !dsn.isEmpty else { return }

        SentrySDK.start { options in
            options.dsn = dsn
            options.environment = "production"
            options.tracesSampleRate = 0.2
            options.profilesSampleRate = 0.1
            options.enableAppHangTracking = true
            options.appHangTimeoutInterval = 2.0
            options.enableCaptureFailedRequests = true
            options.failedRequestStatusCodes = [HttpStatusCodeRange(min: 500, max: 599)]
            options.sendDefaultPii = false
            options.beforeSend = { event in
                if let request = event.request, let url = request.url {
                    var sanitized = url
                    for param in ["token", "key", "secret", "auth", "password"] {
                        sanitized = sanitized.replacingOccurrences(
                            of: "([?&]\(param)=)[^&#\\s]+",
                            with: "$1[REDACTED]",
                            options: .regularExpression
                        )
                    }
                    request.url = sanitized
                }
                return event
            }
        }
    }
}
