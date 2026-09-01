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
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Optional.  High-resolution Brandfetch and Logo.dev marks need a key.  Without one, ContactLogo uses Simple Icons, stock tickers, and favicons.")
                        if settings.credentialStorageFailed {
                            Text("The keychain would not save that credential.  High-resolution sources will stay off until it can.")
                                .foregroundStyle(.red)
                        }
                    }
                }
                Section {
                    Toggle("Skip contacts that already have a photo", isOn: $settings.skipContactsWithExistingPhoto)
                        .onChange(of: settings.skipContactsWithExistingPhoto) { settings.save() }
                } footer: {
                    Text("Off by default. A business card that already has a photo stays in Needs review, flagged \"replace existing\", and is never applied automatically. Turn this on to leave those cards out of the scan entirely.")
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
