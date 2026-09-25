import SwiftUI
import ContactLogoKit
#if canImport(AppKit)
import AppKit
#endif

/// Three-bucket review layout (VISION: Auto / Review / Not-found).
/// Approve / try-another / upload / skip actions live on each row.
struct ContentView: View {
    @EnvironmentObject var model: ReviewSession

    var body: some View {
        NavigationSplitView {
            List(selection: $model.bucket) {
                Label("Ready to apply (\(model.autoAccepted.count))", systemImage: "checkmark.circle.fill")
                    .tag(ReviewSession.Bucket.auto)
                Label("Needs review (\(model.needsReview.count))", systemImage: "questionmark.circle")
                    .tag(ReviewSession.Bucket.review)
                Label("Not found (\(model.notFound.count))", systemImage: "minus.circle")
                    .tag(ReviewSession.Bucket.notFound)
            }
            .navigationTitle("ContactLogo")
        } detail: {
            VStack(alignment: .leading, spacing: 16) {
                switch model.stage {
                case .idle:
                    ContentUnavailableView("Scan your contacts",
                                           systemImage: "person.crop.square.filled.and.at.rectangle",
                                           description: Text("ContactLogo finds brand logos for the businesses in your address book — you approve every change."))
                    if case .definite = model.limitedAccessState {
                        MacLimitedAccessBlocker()
                    } else if case .heuristic(let count) = model.limitedAccessState {
                        MacLimitedAccessHeuristicNotice(visibleCount: count)
                    } else if model.limitedAccessGranted {
                        LimitedAccessBanner()
                    }
                    Button("Scan contacts") { Task { await model.scanAndMatch() } }
                        .buttonStyle(.borderedProminent)
                    if model.totalScannedCount > 0 {
                        MacScanBreakdown(
                            scanned: model.totalScannedCount,
                            business: model.businessTargetsCount,
                            affiliated: model.affiliatedTargetsCount,
                            protected: model.protectedPersonCount
                        )
                    }
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
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}

/// 2026-09-20 audit — surfaces Apple `.limited` Contacts access on macOS.
struct LimitedAccessBanner: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Limited contacts access", systemImage: "person.crop.circle.badge.exclamationmark")
                .font(.subheadline.bold())
                .foregroundStyle(.orange)
            Text("ContactLogo can only see the contacts you chose.  Open System Settings → Privacy & Security → Contacts to grant full access.")
                .font(.caption)
                .foregroundStyle(.secondary)
            Button("Open System Settings") {
                if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Contacts") {
                    NSWorkspace.shared.open(url)
                }
            }
            .font(.caption.bold())
            .padding(.top, 2)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.orange.opacity(0.10))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

/// macOS idle scan breakdown — same shape as the iOS card, no UIKit import.
struct MacScanBreakdown: View {
    let scanned: Int
    let business: Int
    let affiliated: Int
    let protected: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Last scan breakdown")
                .font(.caption.bold())
                .foregroundStyle(.secondary)
            Text("\(scanned.formatted()) contacts scanned · \(business.formatted()) business · \(affiliated.formatted()) affiliated · \(protected.formatted()) personal protected")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.top, 8)
    }
}

struct ReviewQueueView: View {
    @EnvironmentObject var model: ReviewSession
    @State private var searchText = ""
    @State private var manualOverrideResult: MatchResult?
    @State private var showError = false

    var rows: [MatchResult] {
        let trimmed = searchText.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else {
            switch model.bucket {
            case .auto: return model.autoAccepted
            case .review: return model.needsReview
            case .notFound: return model.notFound
            }
        }
        // Search spans every tab, not just the selected one.
        let query = trimmed.lowercased()
        return model.results.filter { result in
            let name = model.displayName(for: result.contactID).lowercased()
            let flags = result.flags.joined(separator: " ").lowercased()
            return name.contains(query) || flags.contains(query)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if case .definite = model.limitedAccessState {
                MacLimitedAccessBlocker()
            } else if case .heuristic(let count) = model.limitedAccessState {
                MacLimitedAccessHeuristicNotice(visibleCount: count)
            } else if model.limitedAccessGranted {
                LimitedAccessBanner()
            }
            HStack {
                Text("Review queue").font(.title2.bold())
                Spacer()
                Button("Select high") { model.selectHigh(true) }
                    .keyboardShortcut("a", modifiers: [.command, .shift])
                Button("Clear high") { model.selectHigh(false) }
                Button("Apply selected (\(model.selected.count))") { Task { await model.applySelected() } }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.return, modifiers: .command)
                if let mostRecent = model.undoHistory.first {
                    Button("Undo last batch") { Task { await model.undo(batchID: mostRecent.id) } }
                        .keyboardShortcut("z", modifiers: .command)
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
                    .fixedSize()
                }
            }
            if model.totalScannedCount > 0 {
                HStack(spacing: 8) {
                    Image(systemName: "shield.checkmark.fill")
                        .foregroundColor(.green)
                    Text("\(model.totalScannedCount) contacts scanned · \(model.protectedPersonCount) personal contacts protected")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    if model.affiliatedTargetsCount > 0 {
                        Text("· \(model.affiliatedTargetsCount) affiliated (opt-in)")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            Text("High-confidence business matches are pre-checked. Personal contacts with company affiliations, favicon fallbacks, and guessed domains stay in Needs review.")
                .foregroundStyle(.secondary)
            List(rows, id: \.contactID) { result in
                ReviewRow(result: result, onManualOverride: {
                    manualOverrideResult = result
                })
            }
            .searchable(text: $searchText, prompt: "Search all tabs…")
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
        case .scanFailed(let underlying):
            return "The scan failed (\(underlying)). Click Scan to try again."
        case .scanIncomplete(let matched, let total):
            return "The scan stopped early: matched \(matched) of \(total). Showing what finished. Click Scan to run it again."
        }
    }
}

extension MatchResult: @retroactive Identifiable {
    public var id: String { contactID }
}

struct ReviewRow: View {
    @EnvironmentObject var model: ReviewSession
    let result: MatchResult
    var onManualOverride: (() -> Void)? = nil

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Toggle("", isOn: Binding(
                get: { model.selected.contains(result.contactID) },
                set: { model.setSelected(result.contactID, $0) }
            ))
            .labelsHidden()
            .disabled(result.candidates.isEmpty)
            LogoThumb(url: model.chosenCandidate(for: result)?.imageURL)
                .frame(width: 56, height: 56)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(model.displayName(for: result.contactID)).font(.headline)
                    if result.flags.contains("affiliated") {
                        Text("Affiliated")
                            .font(.caption2.bold())
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.blue.opacity(0.15))
                            .foregroundStyle(.blue)
                            .clipShape(Capsule())
                    }
                    if result.isRetryable {
                        RetryableBadge()
                    }
                }
                if let exhausted = result.exhaustedLabel {
                    Text(exhausted)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else if !result.isRetryable {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                HStack(spacing: 8) {
                    if result.isRetryable {
                        if model.retryingIDs.contains(result.contactID) {
                            ProgressView()
                                .controlSize(.small)
                        } else {
                            Button("Retry") {
                                Task { await model.retryMatch(for: result.contactID) }
                            }
                            .font(.caption)
                        }
                    } else if result.candidates.count > 1 {
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
        return "\(label(result.confidence)) · \(source) · \(result.candidates.count) candidates\(flags)"
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

/// Web `card--exhausted` treatment for a retryable skip row. Icon-only so
/// the action copy stays the web/native word "Retry", not a third bucket.
struct RetryableBadge: View {
    var body: some View {
        Image(systemName: "arrow.clockwise.circle")
            .font(.caption.weight(.semibold))
            .foregroundStyle(.orange)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Color.orange.opacity(0.15))
            .clipShape(Capsule())
            .accessibilityHidden(true)
    }
}

struct LogoThumb: View {
    let url: URL?
    @State private var decodedDataImage: NSImage?

    var body: some View {
        Group {
            if let url {
                if url.scheme == "data" {
                    if let decodedDataImage {
                        Image(nsImage: decodedDataImage).resizable().scaledToFit()
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
        .frame(width: 56, height: 56)
        .background(Color.gray.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 8))
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
        // Only `Data` crosses the actor boundary — NSImage is not Sendable, so
        // constructing it inside the detached task and returning it is a Swift 6
        // concurrency error.  The base64 decode is the expensive part and still
        // happens off the main actor.
        let payload = url
        let raw = await Task.detached(priority: .utility) { () -> Data? in
            try? Data(contentsOf: payload)
        }.value
        if let raw {
            decodedDataImage = NSImage(data: raw)
        } else {
            decodedDataImage = nil
        }
    }

    private var placeholder: some View {
        Image(systemName: "photo")
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// 2026-09-21 follow-up — macOS blocking call to action when Limited
/// contacts access is detected.  Same shape as the iOS blocker but with
/// a System Settings deep-link to Privacy & Security → Contacts.
struct MacLimitedAccessBlocker: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Limited contacts access detected", systemImage: "person.crop.circle.badge.exclamationmark.fill")
                .font(.headline)
                .foregroundStyle(.orange)
            Text("ContactLogo is set to 'Only selected contacts'. To scan your full address book, open System Settings → Privacy & Security → Contacts and select 'All Contacts' for ContactLogo.")
                .font(.subheadline)
            Button {
                if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Contacts") {
                    NSWorkspace.shared.open(url)
                }
            } label: {
                Label("Open System Settings", systemImage: "arrow.up.right.square.fill")
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.orange.opacity(0.12))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

/// 2026-09-21 — pre-macOS-14 / pre-iOS-18 fallback when the OS is silent
/// about Limited.  Soft warning + the same fix instructions.
struct MacLimitedAccessHeuristicNotice: View {
    let visibleCount: Int
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Only \(visibleCount) contacts are visible", systemImage: "exclamationmark.triangle.fill")
                .font(.subheadline.bold())
                .foregroundStyle(.orange)
            Text("ContactLogo scanned your address book and only found \(visibleCount) entries. If you granted Limited access in System Settings, only the contacts you selected are visible.")
                .font(.caption)
                .foregroundStyle(.secondary)
            Button("Open System Settings") {
                if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Contacts") {
                    NSWorkspace.shared.open(url)
                }
            }
            .font(.caption.bold())
            .padding(.top, 2)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.orange.opacity(0.10))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

#Preview {
    ContentView().environmentObject(ReviewSession())
}
