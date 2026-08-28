import SwiftUI
import ContactLogoKit

/// Brandfetch/Google CSE credentials + matching preferences, reachable via
/// ContactLogo > Settings… (⌘,) (CL-19). ARCHITECTURE.md promises this
/// screen; previously the only way to enable Brandfetch was a
/// `CONTACTLOGO_BRANDFETCH_*` process environment variable, which GUI apps
/// launched from Finder never have set.
struct SettingsView: View {
    @EnvironmentObject var settings: SettingsStore

    var body: some View {
        Form {
            Section("Brandfetch") {
                SecureField("Client ID", text: $settings.brandfetchClientID)
                    .onChange(of: settings.brandfetchClientID) { settings.save() }
                SecureField("API Key", text: $settings.brandfetchAPIKey)
                    .onChange(of: settings.brandfetchAPIKey) { settings.save() }
                Text("Optional. ContactLogo works without a key using free logo sources; adding your own Brandfetch credentials unlocks higher-quality matches.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Section("Matching") {
                Toggle("Skip contacts that already have a photo", isOn: $settings.skipContactsWithExistingPhoto)
                    .onChange(of: settings.skipContactsWithExistingPhoto) { settings.save() }
                Text("On by default, per MATCHING-ENGINE's photo-protection policy.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(20)
        .frame(width: 420)
    }
}
