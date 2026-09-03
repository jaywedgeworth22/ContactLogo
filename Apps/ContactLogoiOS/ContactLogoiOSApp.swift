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
        SentryTelemetry.start()
        let settings = SettingsStore()
        let session = ReviewSession(settings: settings)
        _settingsStore = StateObject(wrappedValue: settings)
        _model = StateObject(wrappedValue: session)

        // Bind first, then register. The launch handler is nonisolated and
        // hops to MainActor; capturing `session` inside the register
        // closure itself is MainActor-isolated and crashed TestFlight 1.0.2
        // (`EXC_BREAKPOINT` / `_dispatch_assert_queue_fail` on queue
        // `com.apple.BGTaskScheduler (com.contactlogo.match)`). Issue #59.
        MatchBackgroundTask.bind(session)
        MatchBackgroundTask.register()

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
                .appUpdatePrompt()
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

    /// Weak so the `@StateObject` remains the owner. Read only after hopping
    /// onto the main actor from the nonisolated launch handler.
    @MainActor
    private static weak var session: ReviewSession?

    @MainActor
    static func bind(_ session: ReviewSession) {
        self.session = session
    }

    /// Must stay `nonisolated`. `BGTaskScheduler` invokes the launch handler
    /// on `com.apple.BGTaskScheduler (com.contactlogo.match)`, not the main
    /// actor. A MainActor-isolated closure traps under Swift 6.
    nonisolated static func register() {
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: identifier,
            using: nil
        ) { task in
            let boxed = UncheckedSendableBox(task)
            Task { @MainActor in
                handleLaunch(boxed.value)
            }
        }
    }

    @MainActor
    private static func handleLaunch(_ task: BGTask) {
        guard let processing = task as? BGProcessingTask else {
            task.setTaskCompleted(success: false)
            return
        }
        guard let session else {
            processing.setTaskCompleted(success: false)
            schedule()
            return
        }
        handle(processing, session: session)
    }

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
        let completion = TaskCompletion(task)

        let work = Task { @MainActor in
            // `run()` writes the review queue to Application Support before
            // returning true, so setTaskCompleted and the notification cannot
            // outrun the data (issue #32).
            let completed = await runner.run()
            if completed {
                NotificationScheduler.postMatchReady(
                    ready: session.autoAccepted.count,
                    needsReview: session.needsReview.count
                )
            }
            completion.finish(success: completed)
        }

        // The system can invoke expirationHandler off the main thread, so
        // hop explicitly rather than relying on closure-isolation inference
        // for a plain (unannotated, Objective-C-bridged) block property.
        task.expirationHandler = {
            Task { @MainActor in
                runner.cancel()
                completion.finish(success: false)
            }
            work.cancel()
        }
    }
}

/// `BGTask` is not Sendable. The launch handler must hop to MainActor
/// without making the handler itself MainActor-isolated.
private struct UncheckedSendableBox<Value>: @unchecked Sendable {
    let value: Value
    init(_ value: Value) { self.value = value }
}

/// `setTaskCompleted` may be called only once. Expiration and the work
/// task race on the system deadline, so this serializes them.
private final class TaskCompletion: @unchecked Sendable {
    private let lock = NSLock()
    private var finished = false
    private let task: BGProcessingTask

    init(_ task: BGProcessingTask) {
        self.task = task
    }

    func finish(success: Bool) {
        lock.lock()
        let already = finished
        if !already { finished = true }
        lock.unlock()
        guard !already else { return }
        task.setTaskCompleted(success: success)
        MatchBackgroundTask.schedule()
    }
}
