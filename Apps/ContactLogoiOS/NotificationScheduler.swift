import Foundation
import UserNotifications

/// Posts the local notification VISION.md / ARCHITECTURE.md promise for
/// overnight background matching (CL-05): "your queue is ready" once a
/// `BGProcessingTask` finishes a scan+match pass while the app is
/// backgrounded.  Callers must persist the queue (and only invoke this
/// after that write succeeds) so a cold launch can keep the promise.
enum NotificationScheduler {
    static func postMatchReady(ready: Int, needsReview: Int) {
        let content = UNMutableNotificationContent()
        content.title = "Logo matching finished"
        content.body = summary(ready: ready, needsReview: needsReview)
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: "com.contactlogo.match-ready",
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request)
    }

    private static func summary(ready: Int, needsReview: Int) -> String {
        if ready == 0 && needsReview == 0 {
            return "No new brand logos were found overnight."
        }
        var parts: [String] = []
        if ready > 0 { parts.append("\(ready) ready to apply") }
        if needsReview > 0 { parts.append("\(needsReview) need your review") }
        return parts.joined(separator: " · ") + "."
    }
}
