import SwiftUI
import PhotosUI
import ContactLogoKit

/// Search / Upload / Paste for a single unsure-queue row — the per-contact
/// override VISION.md promises. Search is explicitly out of scope for this
/// pass (NATIVE-CONTRACT.md §6); Upload (PhotosPicker) and Paste-URL are
/// implemented here, calling straight into the kit's
/// `ReviewSession.setManualCandidate(for:...)`.
struct ManualOverrideSheet: View {
    @EnvironmentObject var model: ReviewSession
    @Environment(\.dismiss) private var dismiss
    let contactID: String

    @State private var photoItem: PhotosPickerItem?
    @State private var pastedURL: String = ""
    @State private var manualError: String?
    @State private var isWorking = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    PhotosPicker(selection: $photoItem, matching: .images) {
                        Label("Choose photo…", systemImage: "photo.on.rectangle")
                    }
                } header: {
                    Text("Upload")
                }
                Section {
                    TextField("https://example.com/logo.png", text: $pastedURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                    Button("Use URL") {
                        Task { await useURL() }
                    }
                    .disabled(pastedURL.trimmingCharacters(in: .whitespaces).isEmpty || isWorking)
                } header: {
                    Text("Paste a URL")
                }
                if let manualError {
                    Section {
                        Text(manualError).foregroundStyle(.red)
                    }
                }
                if isWorking {
                    Section {
                        HStack {
                            ProgressView()
                            Text("Preparing image…")
                        }
                    }
                }
            }
            .navigationTitle("Choose an image")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .disabled(isWorking)
            .onChange(of: photoItem) { newItem in
                Task { await useSelectedPhoto(newItem) }
            }
        }
    }

    private func useSelectedPhoto(_ item: PhotosPickerItem?) async {
        guard let item else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            guard let data = try await item.loadTransferable(type: Data.self) else {
                manualError = "Couldn't read that photo."
                return
            }
            try model.setManualCandidate(for: contactID, imageData: data)
            dismiss()
        } catch {
            manualError = "Couldn't use that photo: \(error.localizedDescription)"
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
