import XCTest
@testable import ContactLogoKit

/// ENGINE-CONTRACT R14.2: the Swift kit must agree with
/// `fixtures/golden-corpus.json` on every static (no-network) case.
final class GoldenCorpusTests: XCTestCase {
    func testGoldenCorpusConformance() throws {
        let url = try XCTUnwrap(Self.corpusURL())
        let data = try Data(contentsOf: url)
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let cases = try XCTUnwrap(root["cases"] as? [[String: Any]])
        XCTAssertFalse(cases.isEmpty, "expected the golden corpus to contain cases")

        let pipeline = MatchPipeline(sources: [], fetchImage: { _ in Data() })
        var failures: [String] = []

        for item in cases {
            let id = item["id"] as? String ?? "<unnamed case>"
            let contactJSON = try XCTUnwrap(item["contact"] as? [String: Any])
            let expect = try XCTUnwrap(item["expect"] as? [String: Any])
            let result = pipeline.staticMatch(Self.contact(from: contactJSON))
            var mismatches: [String] = []

            let actualClass: String
            switch result.contactClass {
            case .person: actualClass = "person"
            case .businessCard: actualClass = "businessCard"
            case .nonBrand: actualClass = "nonBrand"
            }
            let expectedClass = expect["class"] as? String
            if actualClass != expectedClass {
                mismatches.append("class: got \(actualClass) want \(expectedClass ?? "nil")")
            }

            let expectedQuery = expect["query"] as? String
            if result.query != expectedQuery {
                mismatches.append("query: got \(result.query ?? "nil") want \(expectedQuery ?? "nil")")
            }

            let expectedDomain = expect["domain"] as? String
            if result.domain != expectedDomain {
                mismatches.append("domain: got \(result.domain ?? "nil") want \(expectedDomain ?? "nil")")
            }

            let expectedVia = expect["via"] as? String
            let actualVia = result.via?.rawValue
            if actualVia != expectedVia {
                mismatches.append("via: got \(actualVia ?? "nil") want \(expectedVia ?? "nil")")
            }

            let expectedConfidence = expect["maxConfidence"] as? String
            let actualConfidence: String
            switch result.maxConfidence {
            case .skip: actualConfidence = "skip"
            case .low: actualConfidence = "low"
            case .medium: actualConfidence = "medium"
            case .high: actualConfidence = "high"
            }
            if actualConfidence != expectedConfidence {
                mismatches.append("maxConfidence: got \(actualConfidence) want \(expectedConfidence ?? "nil")")
            }

            let expectedFlags = Set((expect["flags"] as? [String]) ?? [])
            let actualFlags = Set(result.flags)
            if actualFlags != expectedFlags {
                mismatches.append("flags: got \(actualFlags.sorted()) want \(expectedFlags.sorted())")
            }

            if expect.keys.contains("simpleIconsSlug") {
                let expectedSlug = expect["simpleIconsSlug"] as? String
                let actualSlug = result.domain.flatMap { SimpleIconsSource.slug(for: $0) }
                if actualSlug != expectedSlug {
                    mismatches.append("simpleIconsSlug: got \(actualSlug ?? "nil") want \(expectedSlug ?? "nil")")
                }
            }

            if !mismatches.isEmpty {
                failures.append("\(id):\n    " + mismatches.joined(separator: "\n    "))
            }
        }

        if !failures.isEmpty {
            XCTFail("\(failures.count)/\(cases.count) golden-corpus cases failed:\n\n" + failures.joined(separator: "\n\n"))
        }
    }

    private static func contact(from json: [String: Any]) -> ContactIdentity {
        func str(_ key: String) -> String? {
            guard let value = json[key] as? String, !value.isEmpty else { return nil }
            return value
        }
        func list(_ key: String) -> [String] {
            (json[key] as? [String]) ?? []
        }
        return ContactIdentity(
            id: "corpus",
            displayName: str("displayName") ?? "",
            givenName: str("givenName"),
            familyName: str("familyName"),
            organization: str("organization"),
            emailDomains: list("emails"),
            websiteHosts: list("websites"),
            phoneNumbers: list("phones"),
            hasImage: json["hasImage"] as? Bool ?? false
        )
    }

    private static func corpusURL() -> URL? {
        var dir = URL(fileURLWithPath: #filePath)
        for _ in 0..<3 { dir.deleteLastPathComponent() }
        let candidate = dir.appendingPathComponent("fixtures/golden-corpus.json")
        return FileManager.default.isReadableFile(atPath: candidate.path) ? candidate : nil
    }
}
