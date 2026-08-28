import SwiftUI
import ContactLogoKit
#if canImport(UIKit)
import UIKit
#endif

/// Three-bucket review queue (same contract as macOS and the web app).
struct ContentView: View {
    @EnvironmentObject var model: ReviewSession
    @State private var showSettings = false

    var body: some View {
        NavigationStack {
            Group {
                switch model.stage {
                case .idle:
                    idle
                case .scanning:
                    ProgressView("Reading contacts…")
                case .matching(let done, let total):
                    ProgressView("Matching brands… \(done)/\(total)")
                case .review:
                    ReviewQueueView()
                case .applying:
                    ProgressView("Applying approved logos…")
                }
            }
            .navigationTitle("ContactLogo")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                // Every element here must be ToolbarContent; a bare Button makes
                // toolbar(content:) ambiguous against its View overload.
                if model.stage == .idle || model.stage == .review {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Scan") { Task { await model.scanAndMatch() } }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showSettings = true
                    } label: {
                        Image(systemName: "gearshape")
                    }
                    .accessibilityLabel("Settings")
                }
            }
        }
        .sheet(isPresented: $showSettings) {
            SettingsView()
        }
    }

    private var idle: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Brand icons for your address book.  Review every logo before it is written.")
                .foregroundStyle(.secondary)
            Label("Ready to apply (\(model.autoAccepted.count))", systemImage: "checkmark.circle.fill")
            Label("Needs review (\(model.needsReview.count))", systemImage: "questionmark.circle")
            Label("Not found (\(model.notFound.count))", systemImage: "minus.circle")
            Button("Scan contacts") { Task { await model.scanAndMatch() } }
                .buttonStyle(.borderedProminent)
            Spacer()
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct ReviewQueueView: View {
    @EnvironmentObject var model: ReviewSession
    @State private var bucket: ReviewSession.Bucket = .auto
    @State private var searchText = ""
    @State private var previewResult: MatchResult?
    @State private var manualOverrideResult: MatchResult?
    @State private var showError = false

    var rows: [MatchResult] {
        let base: [MatchResult]
        switch bucket {
        case .auto: base = model.autoAccepted
        case .review: base = model.needsReview
        case .notFound: base = model.notFound
        }
        guard !searchText.trimmingCharacters(in: .whitespaces).isEmpty else { return base }
        let query = searchText.lowercased()
        return base.filter { result in
            let name = model.displayName(for: result.contactID).lowercased()
            let flags = result.flags.joined(separator: " ").lowercased()
            return name.contains(query) || flags.contains(query)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Picker("Bucket", selection: $bucket) {
                Text("Ready (\(model.autoAccepted.count))").tag(ReviewSession.Bucket.auto)
                Text("Review (\(model.needsReview.count))").tag(ReviewSession.Bucket.review)
                Text("Not found (\(model.notFound.count))").tag(ReviewSession.Bucket.notFound)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            HStack {
                Button("Select high") { model.selectHigh(true) }
                Button("Clear") { model.selectHigh(false) }
                Spacer()
                Button("Apply") { Task { await model.applySelected() } }
                    .buttonStyle(.borderedProminent)
            }
            .padding(.horizontal)
            undoHistoryRow
            List(rows, id: \.contactID) { result in
                ReviewRow(result: result, onPreview: {
                    previewResult = result
                }, onManualOverride: {
                    manualOverrideResult = result
                })
                .swipeActions(edge: .leading) {
                    Button {
                        model.setSelected(result.contactID, true)
                    } label: {
                        Label("Approve", systemImage: "checkmark")
                    }
                    .tint(.green)
                }
                .swipeActions(edge: .trailing) {
                    if result.candidates.count > 1 {
                        Button {
                            model.cycleCandidate(result.contactID)
                        } label: {
                            Label("Next logo", systemImage: "arrow.triangle.2.circlepath")
                        }
                        .tint(.orange)
                    }
                    Button(role: .destructive) {
                        model.setSelected(result.contactID, false)
                    } label: {
                        Label("Skip", systemImage: "xmark")
                    }
                }
            }
            .searchable(text: $searchText, prompt: "Search brands or flags…")
        }
        .sheet(item: $previewResult) { result in
            ContactSimulatorSheet(result: result)
        }
        .sheet(item: $manualOverrideResult) { result in
            ManualOverrideSheet(contactID: result.contactID)
        }
        .onChange(of: model.lastError) { _, newValue in
            showError = newValue != nil
        }
        .alert("ContactLogo", isPresented: $showError, presenting: model.lastError) { _ in
            Button("OK") {}
        } message: { error in
            Text(errorMessage(error))
        }
    }

    @ViewBuilder
    private var undoHistoryRow: some View {
        if let mostRecent = model.undoHistory.first {
            HStack {
                Button("Undo last batch") {
                    Task { await model.undo(batchID: mostRecent.id) }
                }
                if model.undoHistory.count > 1 {
                    Menu("History (\(model.undoHistory.count))") {
                        ForEach(model.undoHistory) { batch in
                            Button {
                                Task { await model.undo(batchID: batch.id) }
                            } label: {
                                Text("\(batch.contactCount) contact\(batch.contactCount == 1 ? "" : "s") — \(batch.createdAt.formatted(.relative(presentation: .named)))")
                            }
                        }
                    }
                }
                Spacer()
            }
            .font(.footnote)
            .padding(.horizontal)
        }
    }

    private func errorMessage(_ error: ReviewSessionError) -> String {
        switch error {
        case .applyFailed(let succeeded, let failed, let underlying):
            return "\(failed) of \(succeeded + failed) logos failed to apply (\(underlying))."
        case .nothingToApply:
            return "Nothing selected to apply."
        case .undoFailed(let batchID, let underlying):
            return "Couldn't undo batch \(batchID.prefix(8)) (\(underlying)). You can try again."
        case .noBatchToUndo:
            return "There's no batch to undo."
        }
    }
}

extension MatchResult: @retroactive Identifiable {
    public var id: String { contactID }
}

struct ReviewRow: View {
    @EnvironmentObject var model: ReviewSession
    let result: MatchResult
    var onPreview: (() -> Void)? = nil
    var onManualOverride: (() -> Void)? = nil

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Toggle("", isOn: Binding(
                get: { model.selected.contains(result.contactID) },
                set: { model.setSelected(result.contactID, $0) }
            ))
            .labelsHidden()
            .disabled(result.candidates.isEmpty)
            Button {
                onPreview?()
            } label: {
                LogoThumb(url: model.chosenCandidate(for: result)?.imageURL)
            }
            .buttonStyle(.plain)
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(model.displayName(for: result.contactID)).font(.headline)
                    Spacer()
                    Button {
                        onPreview?()
                    } label: {
                        Image(systemName: "iphone")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                }
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                HStack(spacing: 8) {
                    if result.candidates.count > 1 {
                        Button("Try another") { model.cycleCandidate(result.contactID) }
                            .font(.caption)
                        Text("(\((model.chosenIndex[result.contactID] ?? 0) + 1)/\(result.candidates.count))")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                    Button("Choose your own…") { onManualOverride?() }
                        .font(.caption)
                }
            }
        }
    }

    private var detail: String {
        let source = model.chosenCandidate(for: result)?.source.rawValue ?? "none"
        let flags = result.flags.isEmpty ? "" : " · " + result.flags.joined(separator: ", ")
        return "\(label(result.confidence)) · \(source)\(flags)"
    }

    private func label(_ c: Confidence) -> String {
        switch c {
        case .high: "high"
        case .medium: "medium"
        case .low: "low"
        case .skip: "skip"
        }
    }
}

struct ContactSimulatorSheet: View {
    @EnvironmentObject var model: ReviewSession
    @Environment(\.dismiss) var dismiss
    let result: MatchResult

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    Text("Live iOS Simulation")
                        .font(.caption.bold())
                        .foregroundStyle(.secondary)
                        .padding(.top)

                    // Incoming Call Banner Simulation
                    VStack(spacing: 12) {
                        Text("INCOMING CALL").font(.caption2.bold()).foregroundStyle(.secondary)
                        LogoThumb(url: model.chosenCandidate(for: result)?.imageURL)
                            .frame(width: 88, height: 88)
                            .clipShape(Circle())
                            .shadow(radius: 4)
                        Text(model.displayName(for: result.contactID))
                            .font(.title3.bold())
                        Text("mobile")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        HStack(spacing: 40) {
                            Circle().fill(Color.red).frame(width: 54, height: 54)
                                .overlay(Image(systemName: "phone.down.fill").foregroundStyle(.white))
                            Circle().fill(Color.green).frame(width: 54, height: 54)
                                .overlay(Image(systemName: "phone.fill").foregroundStyle(.white))
                        }
                        .padding(.top, 4)
                    }
                    .padding()
                    .frame(maxWidth: .infinity)
                    .background(Color.gray.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 20))

                    // iMessage Header Simulation
                    VStack(alignment: .leading, spacing: 8) {
                        Text("iMESSAGE HEADER").font(.caption2.bold()).foregroundStyle(.secondary)
                        HStack(spacing: 12) {
                            LogoThumb(url: model.chosenCandidate(for: result)?.imageURL)
                                .frame(width: 42, height: 42)
                                .clipShape(Circle())
                            VStack(alignment: .leading, spacing: 2) {
                                Text(model.displayName(for: result.contactID))
                                    .font(.subheadline.bold())
                                Text("Verified Business")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Image(systemName: "video.fill").foregroundStyle(.blue)
                        }
                        .padding()
                        .background(Color.gray.opacity(0.12))
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                    }
                    .frame(maxWidth: .infinity)
                }
                .padding()
            }
            .navigationTitle(model.displayName(for: result.contactID))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

struct LogoThumb: View {
    let url: URL?
    @State private var decodedDataImage: UIImage?

    var body: some View {
        Group {
            if let url {
                if url.scheme == "data" {
                    if let decodedDataImage {
                        Image(uiImage: decodedDataImage).resizable().scaledToFit()
                    } else {
                        placeholder
                    }
                } else {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let image):
                            image.resizable().scaledToFit()
                        case .failure:
                            placeholder
                        case .empty:
                            ProgressView()
                        @unknown default:
                            placeholder
                        }
                    }
                }
            } else {
                placeholder
            }
        }
        .frame(width: 52, height: 52)
        .background(Color.gray.opacity(0.08))
        .clipShape(Circle())
        .task(id: url) {
            await loadDataImageIfNeeded()
        }
    }

    // Decodes data: URLs once per distinct `url` (cached in state) instead
    // of synchronously re-decoding base64 on every body evaluation.
    private func loadDataImageIfNeeded() async {
        guard let url, url.scheme == "data" else {
            if decodedDataImage != nil { decodedDataImage = nil }
            return
        }
        // Only `Data` crosses the actor boundary — UIImage is not Sendable, so
        // constructing it inside the detached task and returning it is a Swift 6
        // concurrency error.  The base64 decode is the expensive part and still
        // happens off the main actor.
        let raw = await Task.detached(priority: .utility) { () -> Data? in
            try? Data(contentsOf: url)
        }.value
        decodedDataImage = raw.flatMap(UIImage.init(data:))
    }

    private var placeholder: some View {
        Image(systemName: "photo")
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
