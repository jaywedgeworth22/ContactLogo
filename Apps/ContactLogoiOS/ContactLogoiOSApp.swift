import SwiftUI
import BackgroundTasks
import ContactLogoKit

/// ContactLogo for iOS. Matching can run under BGProcessingTask; the review
/// queue is the same three-bucket contract as macOS and the web app.
@main
struct ContactLogoiOSApp: App {
    static let matchTaskIdentifier = "com.contactlogo.match"
    @StateObject private var model = ReviewSession()

    init() {
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: Self.matchTaskIdentifier,
            using: nil
        ) { task in
            guard let task = task as? BGProcessingTask else { return }
            MatchBackgroundTask.handle(task)
        }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
                .appUpdatePrompt()
        }
    }
}

enum MatchBackgroundTask {
    static func schedule() {
        let request = BGProcessingTaskRequest(identifier: ContactLogoiOSApp.matchTaskIdentifier)
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = false
        try? BGTaskScheduler.shared.submit(request)
    }

    static func handle(_ task: BGProcessingTask) {
        task.setTaskCompleted(success: true)
        schedule()
    }
}
