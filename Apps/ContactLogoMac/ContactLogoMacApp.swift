import SwiftUI
import ContactLogoKit

/// ContactLogo for macOS — review-first logo matching for your address book.
@main
struct ContactLogoMacApp: App {
    @StateObject private var model = ReviewSession()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
                .frame(minWidth: 760, minHeight: 520)
                .appUpdatePrompt()
        }
        .windowStyle(.titleBar)
    }
}
