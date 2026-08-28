import SwiftUI
import BackgroundTasks
import UserNotifications
import ContactLogoKit

/// ContactLogo for iOS. Matching can run under BGProcessingTask; the review
/// queue is the same three-bucket contract as macOS and the web app.
@main
struct ContactLogoiOSApp: App {
    @StateObject private var settingsStore: SettingsStore
    @StateObject private var model: ReviewSession
    @Environment(\.scenePhase) private var scenePhase

    init() {
        let settings = SettingsStore()
        let session = ReviewSession(settings: settings)
        _settingsStore = StateObject(wrappedValue: settings)
        _model = StateObject(wrappedValue: session)

        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: MatchBackgroundTask.identifier,
            using: nil
        ) { task in
            guard let task = task as? BGProcessingTask else { return }
            Task { @MainActor in
                MatchBackgroundTask.handle(task, session: session)
            }
        }

        // Local notifications are how the overnight-matching promise
        // (VISION.md / ARCHITECTURE.md) surfaces to the user — ask up front
        // so MatchBackgroundTask.handle can post silently later (CL-05).
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }

        // Submit the first request at launch instead of only ever inside
        // handle() — otherwise the very first background run never fires
        // (CL-05a).
        MatchBackgroundTask.schedule()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
                .environmentObject(settingsStore)
        }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .background {
                MatchBackgroundTask.schedule()
            }
        }
    }
}

enum MatchBackgroundTask {
    /// Lives here, not on the App: a SwiftUI `App` is @MainActor under Swift 6,
    /// so a static on it cannot be read from this nonisolated enum.
    static let identifier = "com.contactlogo.match"

    static func schedule() {
        let request = BGProcessingTaskRequest(identifier: Self.identifier)
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = false
        try? BGTaskScheduler.shared.submit(request)
    }

    /// Runs the real overnight-matching pipeline (CL-05): scans + matches via
    /// the kit's `BackgroundMatchRunner`, honours the task's expiration
    /// window with cooperative cancellation, always calls
    /// `setTaskCompleted`, reschedules the next run, and — on a completed
    /// pass — posts the local notification VISION.md/ARCHITECTURE.md
    /// promise ("your queue is ready").
    @MainActor
    static func handle(_ task: BGProcessingTask, session: ReviewSession) {
        let runner = BackgroundMatchRunner(session: session)

        let work = Task { @MainActor in
            let completed = await runner.run()
            task.setTaskCompleted(success: completed)
            if completed {
                NotificationScheduler.postMatchReady(
                    ready: session.autoAccepted.count,
                    needsReview: session.needsReview.count
                )
            }
            // Keep the overnight cadence going regardless of outcome.
            schedule()
        }

        // The system can invoke expirationHandler off the main thread, so
        // hop explicitly rather than relying on closure-isolation inference
        // for a plain (unannotated, Objective-C-bridged) block property.
        task.expirationHandler = {
            Task { @MainActor in
                runner.cancel()
            }
            work.cancel()
        }
    }
}
