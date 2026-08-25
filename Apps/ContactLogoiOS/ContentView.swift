import SwiftUI
import ContactLogoKit
#if canImport(UIKit)
import UIKit
#endif

/// Three-bucket review queue (same contract as macOS and the web app).
struct ContentView: View {
    @EnvironmentObject var model: ReviewSession

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
                if model.stage == .idle || model.stage == .review {
                    Button("Scan") { Task { await model.scanAndMatch() } }
                }
            }
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
            if model.lastBatchID != nil {
                Button("Undo last batch") { Task { await model.undoLast() } }
                    .padding(.horizontal)
            }
            List(rows, id: \.contactID) { result in
                ReviewRow(result: result, onPreview: {
                    previewResult = result
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
    }
}

extension MatchResult: @retroactive Identifiable {
    public var id: String { contactID }
}

struct ReviewRow: View {
    @EnvironmentObject var model: ReviewSession
    let result: MatchResult
    var onPreview: (() -> Void)? = nil

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
                if result.candidates.count > 1 {
                    HStack(spacing: 8) {
                        Button("Try another") { model.cycleCandidate(result.contactID) }
                            .font(.caption)
                        Text("(\((model.chosenIndex[result.contactID] ?? 0) + 1)/\(result.candidates.count))")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
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

    var body: some View {
        Group {
            if let url {
                if url.scheme == "data", let data = try? Data(contentsOf: url) {
                    dataImage(data)
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
    }

    @ViewBuilder
    private func dataImage(_ data: Data) -> some View {
        #if canImport(UIKit)
        if let ui = UIImage(data: data) {
            Image(uiImage: ui).resizable().scaledToFit()
        } else {
            placeholder
        }
        #else
        placeholder
        #endif
    }

    private var placeholder: some View {
        Image(systemName: "photo")
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

