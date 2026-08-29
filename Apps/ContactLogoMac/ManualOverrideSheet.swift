import SwiftUI
import ContactLogoKit
import UniformTypeIdentifiers
#if canImport(AppKit)
import AppKit
#endif

/// Search / Upload / Paste for a single unsure-queue row — the per-contact
/// override VISION.md promises. Search is explicitly out of scope for this
/// pass (NATIVE-CONTRACT.md §6); Upload (NSOpenPanel) and Paste-URL are
/// implemented here, calling straight into the kit's
/// `ReviewSession.setManualCandidate(for:...)`.
struct ManualOverrideSheet: View {
    @EnvironmentObject var model: ReviewSession
    @Environment(\.dismiss) private var dismiss
    let contactID: String

    @State private var pastedURL: String = ""
    @State private var manualError: String?
    @State private var isWorking = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Choose an image")
                .font(.title3.bold())

            Button("Choose file…") { chooseFile() }
                .disabled(isWorking)

            Divider()

            VStack(alignment: .leading, spacing: 8) {
                Text("Or paste a URL").font(.subheadline.bold())
                TextField("https://example.com/logo.png", text: $pastedURL)
                    .textFieldStyle(.roundedBorder)
                Button("Use URL") { Task { await useURL() } }
                    .disabled(pastedURL.trimmingCharacters(in: .whitespaces).isEmpty || isWorking)
            }

            if isWorking {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Preparing image…")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            if let manualError {
                Text(manualError)
                    .font(.caption)
                    .foregroundStyle(.red)
            }

            Spacer()

            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
            }
        }
        .padding(20)
        .frame(width: 380, height: 280)
        .disabled(isWorking)
    }

    private func chooseFile() {
        #if canImport(AppKit)
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.allowedContentTypes = [.image]
        guard panel.runModal() == .OK, let url = panel.url else { return }
        Task { await useFile(url) }
        #endif
    }

    private func useFile(_ url: URL) async {
        isWorking = true
        defer { isWorking = false }
        do {
            let data = try Data(contentsOf: url)
            try model.setManualCandidate(for: contactID, imageData: data)
            dismiss()
        } catch {
            manualError = "Couldn't use that file: \(error.localizedDescription)"
        }
    }

    private func useURL() async {
        let trimmed = pastedURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed), url.scheme != nil else {
            manualError = "That doesn't look like a valid URL."
            return
        }
        isWorking = true
        defer { isWorking = false }
        do {
            try await model.setManualCandidate(for: contactID, imageURL: url)
            dismiss()
        } catch {
            manualError = "Couldn't fetch that image: \(error.localizedDescription)"
        }
    }
}
