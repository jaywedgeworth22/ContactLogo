import Foundation

/// A contact reduced to what the engine needs. Platform shells build these
/// from CNContact (native) or vCard entries (web).
public struct ContactIdentity: Sendable, Hashable {
    public let id: String
    public var displayName: String
    public var givenName: String?
    public var familyName: String?
    public var organization: String?
    public var emailDomains: [String]
    public var websiteHosts: [String]
    /// Raw phone strings (published customer-service numbers from vendor/crest).
    public var phoneNumbers: [String]
    public var hasImage: Bool

    public init(id: String, displayName: String, givenName: String? = nil,
                familyName: String? = nil, organization: String? = nil,
                emailDomains: [String] = [], websiteHosts: [String] = [],
                phoneNumbers: [String] = [], hasImage: Bool = false) {
        self.id = id
        self.displayName = displayName
        self.givenName = givenName
        self.familyName = familyName
        self.organization = organization
        self.emailDomains = emailDomains
        self.websiteHosts = websiteHosts
        self.phoneNumbers = phoneNumbers
        self.hasImage = hasImage
    }
}

public enum ContactClass: Sendable {
    /// Has given/family name. Photo-protected: never overwrite an existing photo.
    case person
    /// No person name — a pure business card ("FedEx", "H-E-B Pharmacy (…)").
    case businessCard
    /// Generic name that is not a brand ("Hospital", "Gift Card", "Printer …").
    case nonBrand
}

public enum SourceKind: String, Sendable {
    case brandfetch, wikimedia, googleCSE, googleScrape
    case simpleIcons, favicon, preferred, companiesLogo, manual
}

/// One logo option for a contact. The pipeline keeps the top N, not just the winner.
public struct LogoCandidate: Sendable, Hashable {
    public let source: SourceKind
    public let imageURL: URL
    public let pageURL: URL?
    public var pixelWidth: Int?
    public var pixelHeight: Int?
    /// Brandfetch asset type: "icon" (pictographic) beats "logo" (wordmark).
    public var assetType: String?
    public var altText: String?
    /// Transparent iconic marks score higher than opaque wordmarks.
    public var hasAlpha: Bool?

    public var aspectRatio: Double? {
        guard let w = pixelWidth, let h = pixelHeight, h > 0 else { return nil }
        return Double(w) / Double(h)
    }

    /// Square rule: 0.8...1.25 required for auto-accept (MATCHING-ENGINE §5.1).
    public var isSquareish: Bool {
        guard let r = aspectRatio else { return false }
        return (0.8...1.25).contains(r)
    }

    public var isPictographic: Bool { assetType == "icon" }

    public init(source: SourceKind, imageURL: URL, pageURL: URL? = nil,
                pixelWidth: Int? = nil, pixelHeight: Int? = nil,
                assetType: String? = nil, altText: String? = nil,
                hasAlpha: Bool? = nil) {
        self.source = source
        self.imageURL = imageURL
        self.pageURL = pageURL
        self.pixelWidth = pixelWidth
        self.pixelHeight = pixelHeight
        self.assetType = assetType
        self.altText = altText
        self.hasAlpha = hasAlpha
    }
}

public enum Confidence: Int, Comparable, Sendable {
    case skip = 0, low = 1, medium = 2, high = 3
    public static func < (lhs: Confidence, rhs: Confidence) -> Bool {
        lhs.rawValue < rhs.rawValue
    }
}

/// A source that failed during a run (ENGINE-CONTRACT R11.6).  A source that
/// errored is not the same as a source that found nothing, and neither may be
/// silent: a contact whose search was incomplete is retryable, not "not found".
public struct SourceFailure: Sendable, Hashable {
    public let source: SourceKind
    public let reason: String
    /// The source gave up after exhausting its 429 backoff budget.
    public let rateLimited: Bool

    public init(source: SourceKind, reason: String, rateLimited: Bool = false) {
        self.source = source
        self.reason = reason
        self.rateLimited = rateLimited
    }
}

public struct MatchResult: Sendable {
    public let contactID: String
    public var contactClass: ContactClass
    /// Ranked, best first. Empty when nothing acceptable was found.
    public var candidates: [LogoCandidate]
    public var confidence: Confidence
    /// Trap flags for the review UI ("homonym-risk", "fallback-tile", ...).
    public var flags: [String]
    /// Sources that errored while matching this contact. Non-empty means the
    /// search was incomplete — the row belongs in a retryable state.
    public var sourceErrors: [SourceFailure]

    /// True when nothing was found *and* at least one source failed, i.e. the
    /// answer is "we do not know yet", not "there is no logo".
    public var isRetryable: Bool { candidates.isEmpty && !sourceErrors.isEmpty }

    /// Web `exhausted-label` copy for a completed miss. Nil when `isRetryable`
    /// — R11.6: that row is not "no logo exists". Person/non-brand cards are
    /// a different fact and do not use this string either.
    public var exhaustedLabel: String? {
        guard candidates.isEmpty, !isRetryable, contactClass == .businessCard else { return nil }
        return "No logo found"
    }

    public init(contactID: String, contactClass: ContactClass,
                candidates: [LogoCandidate], confidence: Confidence, flags: [String] = [],
                sourceErrors: [SourceFailure] = []) {
        self.contactID = contactID
        self.contactClass = contactClass
        self.candidates = candidates
        self.confidence = confidence
        self.flags = flags
        self.sourceErrors = sourceErrors
    }
}

/// What actually gets written — and what is needed to undo it.
public struct ChangeSet: Sendable {
    public struct Entry: Sendable {
        public let contactID: String
        public let newImageData: Data
        /// nil means the contact previously had no image.
        public let previousImageData: Data?

        public init(contactID: String, newImageData: Data, previousImageData: Data?) {
            self.contactID = contactID
            self.newImageData = newImageData
            self.previousImageData = previousImageData
        }
    }
    public let createdAt: Date
    public var entries: [Entry]
    public init(createdAt: Date = Date(), entries: [Entry]) {
        self.createdAt = createdAt
        self.entries = entries
    }
}
