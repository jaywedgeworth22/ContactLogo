# Native Kit ↔ Shell Contract

This document is the API boundary between `Sources/ContactLogoKit/**` (engine +
`ReviewSession`, owned by the kit agent) and `Apps/ContactLogoiOS/**` /
`Apps/ContactLogoMac/**` (SwiftUI shells, owned by the shell agent). Both sides
implement against this literally — the kit exposes exactly these symbols, the
shells call exactly these symbols. Anything not specified here is an
implementation detail of whichever side owns the file.

Findings addressed: CL-05, CL-06, CL-11, CL-19, CL-20, and the missing
per-contact override from VISION.md.

---

## 1. Error surfacing (CL-11)

### Problem being fixed
`applySelected()` swallows every failure (`catch { /* stay in review */ }`) and
`undoLast()` clears `lastBatchID` even when the restore throws — a failed undo
silently removes the only way to retry it.

### Kit API

```swift
/// A user-facing failure from an apply or undo operation. Kept small and
/// enum-shaped so shells can switch over it for copy without string-matching.
public enum ReviewSessionError: Error, Equatable, Sendable {
    /// One or more contacts failed to write; the batch that *did* succeed
    /// (if any) is still recorded and undoable via `lastBatchID`.
    case applyFailed(succeeded: Int, failed: Int, underlying: String)
    /// Nothing was selected, or every selected row had no fetchable image.
    case nothingToApply
    /// `undoLast()` was called but the batch directory could not be restored.
    /// `lastBatchID` is left set (see stage-transition rule below) so the
    /// shell can offer Retry instead of losing the batch.
    case undoFailed(batchID: String, underlying: String)
    /// `undoLast()` was called with no recorded batch.
    case noBatchToUndo
}

extension ReviewSession {
    /// Non-nil exactly when the most recent `applySelected()` or `undoLast()`
    /// ended in failure. Cleared at the start of the next `applySelected()`,
    /// `undoLast()`, or `scanAndMatch()` call. Shells render this as a banner
    /// or alert bound to `$lastError`; it is not cleared by dismissing a sheet.
    @Published public private(set) var lastError: ReviewSessionError?
}
```

### Stage transitions (replaces the current silent-catch behavior)

- `applySelected()`
  1. `lastError = nil`, `stage = .applying`.
  2. Build `entries` as today (candidates with no fetchable image are simply
     excluded from the batch, not an error).
  3. If `entries.isEmpty` → `lastError = .nothingToApply`, `stage = .review`,
     return. No `UndoLog` write.
  4. `UndoLog().recordBatch(entries)` throws → `lastError = .applyFailed(succeeded: 0, failed: entries.count, underlying: ...)`,
     `stage = .review`, `lastBatchID` **unchanged**, return.
  5. Otherwise set `lastBatchID = dir.lastPathComponent` *before* writing any
     contact, then write each entry's image individually, collecting
     per-entry failures instead of aborting the loop on the first throw.
  6. If any writes failed: `lastError = .applyFailed(succeeded: n, failed: m, underlying: ...)`.
     `lastBatchID` stays set — the batch on disk is a true record of what was
     attempted and is still undoable/retryable. Successfully-selected rows are
     removed from `selected`; failed rows stay selected so the shell can
     retry with one more tap of Apply.
  7. `stage = .review` always at the end (success or failure) — `applying` is
     never a terminal stage.

- `undoLast()`
  1. `lastError = nil`.
  2. `guard let id = lastBatchID else { lastError = .noBatchToUndo; return }`.
  3. On `UndoLog().restore(batchID:using:)` throw: `lastError = .undoFailed(batchID: id, underlying: ...)`.
     **`lastBatchID` is NOT cleared.** The shell keeps showing "Undo last
     batch" so the user can retry.
  4. On success: `lastBatchID = nil`.

Shells: bind an `.alert` or inline banner to `model.lastError` (present when
non-nil, `Text` from a `switch`, single "OK"/"Retry" action that calls the same
op again). Do not add app-local error state — `lastError` is the only source
of truth.

---

## 2. Image preparation (CL-06)

### Problem being fixed
`applySelected()` writes whatever `fetchImage()` returned straight into
`CNContact.imageData` behind a `data.count > 80` guard. SVG (Simple Icons,
`PreferredMarksSource` data URLs) is written as-is, which `CNContactStore`
rejects, and `ImageDimensions.read` never parses SVG, so those candidates can
never satisfy `isSquareish` and never reach `.high` confidence.

### Kit API — new file `Sources/ContactLogoKit/Store/ImagePreparer.swift`

```swift
/// Rasterizes a fetched candidate image to a padded, square PNG suitable for
/// `CNContact.imageData` — the native equivalent of the web canvas path
/// (`padAndSquareImage` in web/src/engine/logos.ts). Runs on iOS (CoreGraphics
/// + a system SVG-capable renderer) and macOS.
public enum ImagePreparer {
    public enum Error: Swift.Error, Sendable {
        /// The source bytes could not be decoded as a raster image or SVG.
        case undecodable
        /// Decoded but rasterization/encoding to PNG failed.
        case renderFailed
    }

    /// Output edge length in points. Matches the web default (512×512).
    public static let outputSize: CGFloat = 512
    /// Matches web's 15% safe margin for circular contact icons.
    public static let paddingFraction: CGFloat = 0.15

    /// Decodes `data` (PNG/JPEG/WebP raster, or SVG/XML vector), draws it
    /// centered with `paddingFraction` margin onto a transparent
    /// `outputSize`×`outputSize` canvas preserving aspect ratio (pad, never
    /// crop — MATCHING-ENGINE §5.3), and returns PNG-encoded bytes plus the
    /// pixel dimensions actually written (always `outputSize`×`outputSize`
    /// on success, so the result always satisfies `isSquareish`).
    ///
    /// Throws `.undecodable` / `.renderFailed` instead of ever returning
    /// raw/undersized bytes — callers must not fall back to unprepared data.
    public static func squarePNG(from data: Data) throws -> (data: Data, width: Int, height: Int)
}
```

### `ReviewSession.applySelected()` call-site change

Replace the direct `data.count > 80` guard with:

```swift
guard let url = chosenCandidate(for: result)?.imageURL,
      let raw = try? await Self.fetchImage(url) else { continue }
guard let prepared = try? ImagePreparer.squarePNG(from: raw) else { continue }
// prepared.data is what gets written to CNContact.imageData / UndoLog.
```

A candidate that fails to rasterize is treated the same as one with no
fetchable image: silently excluded from the batch (not a `lastError` — this is
a per-row, expected condition covered by "not found" copy in the review row,
not an apply-time failure). `UndoLog` continues to store exactly the bytes
that were written, unchanged.

### Confidence-scoring consequence
`MatchPipeline` (kit-owned, not shell-owned, but noted here because CL-06 spans
both): once `ImagePreparer` exists, the pipeline should run candidate bytes
through it (or at minimum through `ImageDimensions.read` after an SVG→raster
pre-pass) before scoring, so vector marks can report real pixel dimensions and
reach `.high` confidence. That change lives in
`Sources/ContactLogoKit/Pipeline/MatchPipeline.swift`, which the kit agent
owns directly — this contract only fixes the *write* path since that's what
CL-06's repro exercises.

---

## 3. Settings (CL-19)

### Problem being fixed
Brandfetch only activates via `CONTACTLOGO_BRANDFETCH_CLIENT_ID` /
`CONTACTLOGO_BRANDFETCH_API_KEY` process environment variables, which GUI apps
launched from Finder/Springboard never have set — dead in shipping builds.
ARCHITECTURE.md promises a Settings screen that does not exist.

### Kit API — new file `Sources/ContactLogoKit/Store/SettingsStore.swift`

```swift
/// Persisted user settings, backed by UserDefaults(suiteName:) so iOS and
/// macOS share the same storage layer (App Group id is the shell's concern —
/// pass nil to use `.standard` when no group is configured).
@MainActor
public final class SettingsStore: ObservableObject {
    @Published public var brandfetchClientID: String = ""
    @Published public var brandfetchAPIKey: String = ""
    /// Mirrors the web "skip contacts that already have a photo" toggle
    /// (MATCHING-ENGINE photo-protection policy) — on by default.
    @Published public var skipContactsWithExistingPhoto: Bool = true

    public init(suiteName: String? = nil) // loads persisted values immediately
    public func save()                    // shells call after each edit, or
                                           // rely on didSet if the kit wires
                                           // that internally — either is fine,
                                           // but `save()` must exist and be
                                           // idempotent for shells that batch edits
}
```

`ReviewSession.makePipeline()` / `scanAndMatch()` change: `ReviewSession` gains
an optional settings dependency so scans use saved credentials instead of only
`ProcessInfo.environment`:

```swift
extension ReviewSession {
    /// Injected by the shell at construction. When set, `scanAndMatch()`
    /// builds the pipeline from `settings.brandfetchClientID/APIKey` first,
    /// falling back to the existing `DefaultSources.env(_:)` process-env
    /// lookup when both are empty (keeps CLI/CI behavior unchanged).
    public convenience init(settings: SettingsStore?)
}
```

Shells: instantiate one `SettingsStore` at the app root (`@StateObject`),
inject it into `ReviewSession(settings:)`, and build a Settings
screen/sheet with two `SecureField`s (client ID, API key) and the photo-skip
`Toggle`, each bound directly to the store's `@Published` properties, calling
`store.save()` `onSubmit`/`onChange`. This is the shell's screen to build; the
kit's job is only the store and the pipeline wiring above.

---

## 4. Undo history (CL-20)

### Problem being fixed
`lastBatchID` is in-memory only (lost on quit) even though every batch is
already durable in `UndoLog`'s directory. `UndoLog.listBatches()` exists but is
never called, and it sorts by UUID string, which has no chronological
relationship to when the batch was created.

### `UndoLog` changes (kit-owned file, specified here since the shell reads its output)

```swift
public struct UndoLog: Sendable {
    public struct BatchSummary: Sendable, Identifiable {
        public let id: String          // batch directory name (UUID)
        public let createdAt: Date     // from BatchMeta, real chronological key
        public let contactCount: Int
    }

    /// Chronologically ordered (newest first) by `BatchMeta.createdAt`,
    /// replacing the current UUID-string sort. Reads each batch's meta.json;
    /// a batch whose meta.json is missing/corrupt is skipped, not thrown.
    public func listBatchSummaries() throws -> [BatchSummary]

    /// Deletes batches older than `keeping` most-recent (by createdAt) or
    /// older than `olderThan`, whichever is stricter when both are given.
    /// Call opportunistically after `recordBatch` succeeds. Default policy:
    /// keep the most recent 20 batches, no time limit.
    public func prune(keeping: Int = 20, olderThan: Date? = nil) throws
}
```

### `ReviewSession` changes

```swift
extension ReviewSession {
    /// Replaces bare `lastBatchID: String?` as the primary undo-history API.
    /// Populated from `UndoLog().listBatchSummaries()` at `init()` and
    /// refreshed after every successful `applySelected()`/`undoLast()`, so
    /// history survives app relaunch.
    @Published public private(set) var undoHistory: [UndoLog.BatchSummary] = []

    /// Restores a specific batch by id rather than only "the last one".
    /// Same stage/error semantics as `undoLast()` (§1); on success removes
    /// that entry (and anything newer, since restoring an older batch over
    /// a newer one is not supported) from `undoHistory` and clears
    /// `lastBatchID` if it matches.
    public func undo(batchID: String) async
}
```

`lastBatchID` stays for source compatibility (existing shell code keeps
building) but becomes derived: `lastBatchID = undoHistory.first?.id`, kept in
sync by the kit, not written by shells.

Shells: replace the single "Undo last batch" button with a list/menu built
from `model.undoHistory` (id, relative `createdAt`, `contactCount`), each row
calling `model.undo(batchID:)`. `Apps/ContactLogoMac/ContentView.swift` and
`Apps/ContactLogoiOS/ContentView.swift` both currently gate on
`model.lastBatchID != nil` — that condition still works unchanged
(`undoHistory.isEmpty` is equivalent) for a minimal fix, but the multi-batch
list is the intended UI per this contract.

---

## 5. Background matching (CL-05)

### Problem being fixed
`MatchBackgroundTask.handle()` calls `task.setTaskCompleted(success: true)`
and returns without running anything. There is no `expirationHandler`, no
progress reporting, and no cancellation path.

### Kit API — new file `Sources/ContactLogoKit/Store/BackgroundMatchRunner.swift`

The kit exposes a *platform-agnostic* runner; `BGProcessingTask` itself is a
`UIKit`/iOS-only type and stays in `Apps/ContactLogoiOS/**`, owned by the
shell agent.

```swift
@MainActor
public final class BackgroundMatchRunner {
    public init(session: ReviewSession)

    /// Runs `session.scanAndMatch()` to completion or until `cancel()` is
    /// called. Safe to call from a `BGProcessingTask` launch handler.
    /// Returns `true` if matching completed (results are in `session.results`,
    /// stage is `.review`); returns `false` if cancelled before completion —
    /// in that case `session.stage` is left as `.idle` and no partial
    /// `results` are published, so the next foreground scan starts clean.
    public func run() async -> Bool

    /// Cooperative cancellation: sets an internal flag `run()` checks between
    /// contacts (the same per-contact loop `scanAndMatch()` already has), so
    /// it stops promptly rather than mid-`await`. Call from the task's
    /// `expirationHandler`.
    public func cancel()
}
```

### Persist-before-notify (issue #32)

The overnight notification is a promise the next launch has to keep.  `run()`
therefore writes the queue to disk *and only then* returns `true`.  The shell
must not call `setTaskCompleted` or post the notification until `run()` has
returned `true`.

Kit API — `Sources/ContactLogoKit/Store/ReviewQueueStore.swift`:

```swift
public struct PersistedReviewQueue: Codable, Equatable, Sendable {
    public static let currentSchemaVersion = 1
    public var schemaVersion: Int
    public var scannedAt: Date
    public var contactStoreChangeToken: Data?
    public var results: [MatchResult]
    public var selected: [String]
    public var chosenIndex: [String: Int]
    public var names: [String: String]
}

public struct ReviewQueueStore: Sendable {
    public init(directory: URL? = nil,
                currentChangeToken: @escaping @Sendable () -> Data? = ReviewQueueStore.liveChangeToken)
    public func save(_ snapshot: PersistedReviewQueue) throws
    /// Production read: non-empty, current schema, change token still matches.
    /// Anything else is deleted rather than shown.
    public func loadFresh() throws -> PersistedReviewQueue?
    public func clear() throws
}

extension ReviewSession {
    public convenience init(settings: SettingsStore?, queueStore: ReviewQueueStore?)
    /// False if the write failed — the background runner must not notify.
    @discardableResult public func persistReviewQueue() -> Bool
}
```

Rules:

- `MatchResult` and its members are `Codable`.  `ContactClass` has a `String`
  raw value (`person` / `businessCard` / `nonBrand`).  `Confidence` keeps its
  `Int` raw value.
- Photo bytes are never persisted.  `data:` and local-file candidates are
  stripped on save; only `http`/`https` URLs remain.
- The payload is stamped with the scan date and
  `CNContactStore.currentHistoryToken` captured when contacts were enumerated.
  A mismatch (including nil vs non-nil) discards the file.  Never show a queue
  built against contacts that have since changed.
- `ReviewSession` loads `loadFresh()` on init and enters `.review` when the
  snapshot is non-empty.
- `BackgroundMatchRunner.run()` calls `persistReviewQueue()` after a completed
  scan and returns `false` if that write fails, so the notification cannot
  outrun the data.
- ENGINE-CONTRACT R11.6: `sourceErrors` round-trip with the rest of
  `MatchResult`, so a retryable row is still retryable after relaunch.

### Shell responsibilities (`Apps/ContactLogoiOS/ContactLogoiOSApp.swift`)

The kit runner gives the shell everything it needs to implement the real
task body; the shell still owns:

- Adding `UIBackgroundModes` → `processing` to `project.yml`'s iOS target
  `Info.plist`, and registering the task identifier
  (`BGTaskSchedulerPermittedIdentifiers`) there too.
- Calling `MatchBackgroundTask.schedule()` at app-launch time (not only from
  inside `handle()`, so the first background run isn't dependent on a
  previous one already having fired).
- Wiring the real handler:

```swift
static func handle(_ task: BGProcessingTask) {
    let runner = BackgroundMatchRunner(session: /* shared/model-owned session */)
    task.expirationHandler = { runner.cancel() }
    let work = Task {
        // run() persists the queue before returning true (issue #32).
        let completed = await runner.run()
        task.setTaskCompleted(success: completed)
        if completed { /* post a local UNUserNotificationCenter notification
                           summarizing session.autoAccepted.count etc. */ }
        schedule()
    }
    task.expirationHandler = { runner.cancel(); work.cancel() }
}
```

(Exact notification content/UI and `project.yml` edits are the shell agent's
file to write — `BackgroundMatchRunner` above is the full kit-side surface
this depends on.)

---

## 6. Per-contact override (VISION.md unsure-queue promise)

### Problem being fixed
VISION.md promises search/upload/paste-your-own for rows in the unsure queue;
neither shell exposes it. The web app's equivalent is picking a URL/file and
inserting it as a synthetic top candidate.

### Kit API — extend `ReviewSession`

```swift
extension ReviewSession {
    /// Injects a user-supplied candidate as the new top choice for `id` and
    /// selects it. `source` is `.manual` (already defined in `SourceKind`).
    /// `imageData` is prepared via `ImagePreparer.squarePNG(from:)` (§2)
    /// before being wrapped in a data: URL for `LogoCandidate.imageURL` —
    /// callers do not pre-square the image themselves. Throws
    /// `ImagePreparer.Error` if the supplied bytes can't be decoded; on
    /// throw, the result/selection for `id` is left unchanged.
    public func setManualCandidate(for id: String, imageData: Data) throws

    /// Same as above but the source is a URL the shell already resolved
    /// (e.g. from a search-provider tap or a pasted URL) rather than raw
    /// bytes the shell picked from a file/photo picker. Fetches via
    /// `Self.fetchImage(url)` then behaves exactly like the `imageData`
    /// overload, including its throwing behavior.
    public func setManualCandidate(for id: String, imageURL: URL) async throws
}
```

Both overloads: prepend a new `LogoCandidate(source: .manual, imageURL: <data:
URL of the squared PNG>, pixelWidth: 512, pixelHeight: 512)` to
`results[idx].candidates`, set `chosenIndex[id] = 0`, and `selected.insert(id)`
— mirroring what `setChosenIndex`/`cycleCandidate` already do, so no other
`ReviewSession` state needs shell-side bookkeeping.

Shells: add a "Search / Upload / Paste" action on each unsure-queue row
(`PhotosPicker`/`NSOpenPanel` for upload; a text field for a pasted URL; a
search UI is optional and out of scope for this contract) that calls one of
the two overloads and surfaces `ReviewSessionError`-style failures the same
way as §1 (a local `@State var manualError: Error?` is fine here since this is
shell-local UI state, not session state).

---

## Summary of new/changed kit symbols

| Symbol | File |
|---|---|
| `ReviewSessionError` | `Store/ReviewSession.swift` |
| `ReviewSession.lastError` | `Store/ReviewSession.swift` |
| `ImagePreparer` | `Store/ImagePreparer.swift` (new) |
| `SettingsStore` | `Store/SettingsStore.swift` (new) |
| `ReviewSession.init(settings:)` | `Store/ReviewSession.swift` |
| `UndoLog.BatchSummary`, `listBatchSummaries()`, `prune(keeping:olderThan:)` | `Store/UndoLog.swift` |
| `ReviewSession.undoHistory`, `undo(batchID:)` | `Store/ReviewSession.swift` |
| `BackgroundMatchRunner` | `Store/BackgroundMatchRunner.swift` (new) |
| `ReviewSession.setManualCandidate(for:imageData:)` / `(for:imageURL:)` | `Store/ReviewSession.swift` |
| `PersistedReviewQueue`, `ReviewQueueStore` | `Store/ReviewQueueStore.swift` (new) |
| `ReviewSession.persistReviewQueue()`, `init(settings:queueStore:)` | `Store/ReviewSession.swift` |

Everything under `BGTaskScheduler`, `UIBackgroundModes`,
`BGTaskSchedulerPermittedIdentifiers`, notifications, `PhotosPicker`/
`NSOpenPanel`, and the actual Settings screen UI belongs to the shell agent's
files and is out of the kit's surface.

---

## Follow-up — first-party logo cache (web-only this change)

The web engine now tries `GET /api/logo/:registrableDomain` first and falls
through to live CDNs on 404.  Native Swift and Kotlin clients keep fetching
those CDNs directly in this change; wiring them to the same-origin cache is a
follow-up once the Vercel function is in production.

Do not send contact names, emails, or phones to that endpoint.  The key is the
registrable domain only.  Clients that receive SVG or an unpadded raster still
apply ENGINE-CONTRACT R11.7 locally (512×512 canvas, 15% inset).
