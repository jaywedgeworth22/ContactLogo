import XCTest
@testable import ContactLogoKit

/// ENGINE-CONTRACT R14.2 — the golden corpus, run against the Swift engine.
///
/// It ran only in the Android suite until now, which is how R10.1b shipped to
/// two engines out of three and how R8.3's catalog-tail rule came to mean three
/// different things: nothing was comparing them.  All three suites load this
/// same file now.
///
/// R14.1: static path only — `staticMatch`, no network, no image fetch, no
/// clock.  The corpus's `maxConfidence` is the STATIC ceiling; the final tier is
/// min(ceiling, assetTier) and needs a candidate list, which this never builds.
///
/// R14.3: a case this engine cannot satisfy fails loudly here.  Do not skip it,
/// do not delete it, and do not edit the corpus to match the code — the corpus
/// encodes the rulebook, so a disagreement means an engine is wrong.
final class GoldenCorpusTests: XCTestCase {

    private struct Corpus: Decodable {
        struct Case: Decodable {
            struct Contact: Decodable {
                let displayName: String?
                let givenName: String?
                let familyName: String?
                let organization: String?
                let emails: [String]
                let websites: [String]
                let phones: [String]
                let hasImage: Bool
            }
            struct Expect: Decodable {
                /// `class` in the JSON; renamed here because it is a keyword.
                let contactClass: String
                let query: String?
                let domain: String?
                let via: String?
                let maxConfidence: String
                let flags: [String]
                let simpleIconsSlug: String?

                enum CodingKeys: String, CodingKey {
                    case contactClass = "class"
                    case query, domain, via, maxConfidence, flags, simpleIconsSlug
                }
            }
            let id: String
            let contact: Contact
            let expect: Expect
        }
        let cases: [Case]
    }

    /// Walks up from this source file to the repo root.  SwiftPM has no resource
    /// bundle for a fixture that three languages share, and hard-coding a
    /// working directory breaks under `swift test` vs Xcode.
    private func corpusURL() throws -> URL {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        for _ in 0..<12 {
            let candidate = dir.appendingPathComponent("fixtures/golden-corpus.json")
            if FileManager.default.fileExists(atPath: candidate.path) { return candidate }
            dir = dir.deletingLastPathComponent()
        }
        throw XCTSkip("fixtures/golden-corpus.json not found above \(#filePath)")
    }

    private static func name(_ c: Confidence) -> String {
        switch c {
        case .skip: return "skip"
        case .low: return "low"
        case .medium: return "medium"
        case .high: return "high"
        }
    }

    private static func name(_ c: ContactClass) -> String {
        switch c {
        case .person: return "person"
        case .businessCard: return "businessCard"
        case .nonBrand: return "nonBrand"
        }
    }

    func testGoldenCorpusConformance() throws {
        let data = try Data(contentsOf: try corpusURL())
        let corpus = try JSONDecoder().decode(Corpus.self, from: data)
        XCTAssertFalse(corpus.cases.isEmpty, "expected the golden corpus to contain cases")

        // R14.1 — no network: the pipeline is built with no sources and a fetch
        // that would trap if the static path ever reached for one.
        let pipeline = MatchPipeline(sources: []) { _ in
            XCTFail("R14.1 violation: the static path fetched an image")
            return Data()
        }

        var failures: [String] = []

        for kase in corpus.cases {
            let c = kase.contact
            let contact = ContactIdentity(
                id: "corpus",
                displayName: c.displayName ?? "",
                givenName: c.givenName,
                familyName: c.familyName,
                organization: c.organization,
                // The Swift shell hands the engine raw fields; DomainDeriver does
                // the scheme/userinfo/subdomain work, so the corpus's full URLs
                // and addresses go in as they are written.
                emailDomains: c.emails,
                websiteHosts: c.websites,
                phoneNumbers: c.phones,
                hasImage: c.hasImage
            )

            let result = pipeline.staticMatch(contact)
            var mismatches: [String] = []

            let gotClass = Self.name(result.contactClass)
            if gotClass != kase.expect.contactClass {
                mismatches.append("class: got \(gotClass) want \(kase.expect.contactClass)")
            }

            if result.query != kase.expect.query {
                mismatches.append("query: got \(String(describing: result.query)) want \(String(describing: kase.expect.query))")
            }

            if result.domain != kase.expect.domain {
                mismatches.append("domain: got \(String(describing: result.domain)) want \(String(describing: kase.expect.domain))")
            }

            let gotVia = result.via?.rawValue
            if gotVia != kase.expect.via {
                mismatches.append("via: got \(String(describing: gotVia)) want \(String(describing: kase.expect.via))")
            }

            let gotConfidence = Self.name(result.maxConfidence)
            if gotConfidence != kase.expect.maxConfidence {
                mismatches.append("maxConfidence: got \(gotConfidence) want \(kase.expect.maxConfidence)")
            }

            // R14.1 — flags compared as a set; order is R12's business.
            let gotFlags = Set(result.flags)
            let wantFlags = Set(kase.expect.flags)
            if gotFlags != wantFlags {
                mismatches.append("flags: got \(gotFlags.sorted()) want \(wantFlags.sorted())")
            }

            if let wantSlug = kase.expect.simpleIconsSlug {
                let gotSlug = result.domain.flatMap { SimpleIconsSource.slug(for: $0) }
                if gotSlug != wantSlug {
                    mismatches.append("simpleIconsSlug: got \(String(describing: gotSlug)) want \(wantSlug)")
                }
            }

            if !mismatches.isEmpty {
                failures.append("\(kase.id):\n    " + mismatches.joined(separator: "\n    "))
            }
        }

        XCTAssertTrue(
            failures.isEmpty,
            "\(failures.count)/\(corpus.cases.count) golden-corpus cases failed:\n\n"
                + failures.joined(separator: "\n\n")
        )
    }
}
