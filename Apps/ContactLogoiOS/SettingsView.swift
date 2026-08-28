import SwiftUI
import ContactLogoKit

/// Brandfetch/Google CSE credentials + matching preferences (CL-19).
/// ARCHITECTURE.md promises a settings screen; previously the only way to
/// enable Brandfetch was a `CONTACTLOGO_BRANDFETCH_*` process environment
/// variable, which GUI apps launched from Springboard never have set.
struct SettingsView: View {
    @EnvironmentObject var settings: SettingsStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    SecureField("Client ID", text: $settings.brandfetchClientID)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onChange(of: settings.brandfetchClientID) { settings.save() }
                    SecureField("API Key", text: $settings.brandfetchAPIKey)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onChange(of: settings.brandfetchAPIKey) { settings.save() }
                } header: {
                    Text("Brandfetch")
                } footer: {
                    Text("Optional. ContactLogo works without a key using free logo sources; adding your own Brandfetch credentials unlocks higher-quality matches.")
                }
                Section {
                    Toggle("Skip contacts that already have a photo", isOn: $settings.skipContactsWithExistingPhoto)
                        .onChange(of: settings.skipContactsWithExistingPhoto) { settings.save() }
                } footer: {
                    Text("On by default, per MATCHING-ENGINE's photo-protection policy. Turn this off to let ContactLogo replace existing contact photos too.")
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}
