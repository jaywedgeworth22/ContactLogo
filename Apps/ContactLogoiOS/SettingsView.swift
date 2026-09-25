import SwiftUI
import ContactLogoKit

/// Brandfetch/Google CSE credentials + matching preferences (CL-19).
/// ARCHITECTURE.md promises a settings screen; previously the only way to
/// enable Brandfetch was a `CONTACTLOGO_BRANDFETCH_*` process environment
/// variable, which GUI apps launched from Springboard never have set.
struct SettingsView: View {
    @EnvironmentObject var settings: SettingsStore
    @EnvironmentObject var model: ReviewSession
    @Environment(\.dismiss) private var dismiss
    @State private var showDiagnostic = false

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
                        .onChange(of: settings.brandfetchClientID) { settings.save() }
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
                // 2026-09-21 follow-up audit — direct route to the "Why am I only
                // seeing X contacts?" diagnostic so a user can verify whether
                // Limited Contacts access is the cause without guessing.
                Section {
                    Button {
                        showDiagnostic = true
                    } label: {
                        Label("Diagnostic: Why am I only seeing X?", systemImage: "stethoscope")
                    }
                } header: {
                    Text("Scan coverage")
                } footer: {
                    Text("Shows the authorization state, the scan breakdown, and a sample of dropped contacts so you can verify whether Limited contacts access is hiding part of your address book.")
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .sheet(isPresented: $showDiagnostic) {
                DiagnosticView()
            }
        }
    }
}
