import XCTest
@testable import ContactLogoKit

final class NameNormalizerTests: XCTestCase {
    func testStripsParentheticals() {
        XCTAssertEqual(NameNormalizer.clean("Walgreens (Mason Rd / Cypress)"), "Walgreens")
        XCTAssertEqual(NameNormalizer.clean("H-E-B Pharmacy (Bridgeland)"), "H-E-B Pharmacy")
        XCTAssertEqual(NameNormalizer.clean("Printer at Farm (WF-2950)"), "Printer at Farm")
    }
    func testBrandTail() {
        XCTAssertEqual(NameNormalizer.brandTail("Chris At NTB"), "NTB")
        XCTAssertEqual(NameNormalizer.brandTail("Byron Goode Jr - Root Insurance"), "Root Insurance")
        XCTAssertNil(NameNormalizer.brandTail("FedEx"))
    }
    func testSimilarityGate() {
        XCTAssertTrue(NameNormalizer.passesSimilarity(query: "Cash App", brandName: "Cash App"))
        XCTAssertFalse(NameNormalizer.passesSimilarity(query: "Cash App", brandName: "Bread Zine"))
    }
}

final class DomainDeriverTests: XCTestCase {
    func testSkipsFreemailAndSocial() {
        XCTAssertNil(DomainDeriver.derive(websiteHosts: ["linkedin.com"], emailDomains: ["gmail.com"]))
        XCTAssertNil(DomainDeriver.derive(websiteHosts: ["people"], emailDomains: [])) // ms-outlook://people/... junk
        XCTAssertEqual(DomainDeriver.derive(websiteHosts: ["people"], emailDomains: ["frostbank.com"]), "frostbank.com")
        XCTAssertEqual(DomainDeriver.derive(websiteHosts: ["www.h-e-b.com"], emailDomains: []), "h-e-b.com")
    }
    func testRegistrable() {
        XCTAssertEqual(DomainDeriver.registrableDomain(of: "mail.utexas.edu"), "utexas.edu")
        XCTAssertEqual(DomainDeriver.registrableDomain(of: "doug@texasdescon.com"), "texasdescon.com")
        XCTAssertEqual(DomainDeriver.registrableDomain(of: "shop.example.co.uk"), "example.co.uk")
    }
}

final class RankerTests: XCTestCase {
    private func cand(w: Int, h: Int, type: String? = nil, source: SourceKind = .brandfetch) -> LogoCandidate {
        LogoCandidate(source: source, imageURL: URL(string: "https://cdn.example.com/x.png")!,
                      pixelWidth: w, pixelHeight: h, assetType: type)
    }
    func testSquareIconWins() {
        let wideWordmark = cand(w: 731, h: 208, type: "logo")   // the Walgreens trap
        let squareIcon = cand(w: 400, h: 400, type: "icon")
        let ranked = CandidateRanker.rank([wideWordmark, squareIcon])
        XCTAssertEqual(ranked.first?.pixelWidth, 400)
    }
    func testConfidenceHomonymCap() {
        let icon = cand(w: 400, h: 400, type: "icon")
        XCTAssertEqual(CandidateRanker.confidence(for: icon, nameSimilarityPassed: true,
                                                  homonymRisk: true, domainAgrees: false), .medium)
        XCTAssertEqual(CandidateRanker.confidence(for: icon, nameSimilarityPassed: true,
                                                  homonymRisk: true, domainAgrees: true), .high)
    }
}

final class BlocklistTests: XCTestCase {
    func testGenericAndDevices() {
        XCTAssertTrue(GenericBlocklist.isGeneric("Hospital"))
        XCTAssertTrue(GenericBlocklist.isGeneric("Verification Code"))
        XCTAssertTrue(GenericBlocklist.isGeneric("Printer at Farm"))
        XCTAssertFalse(GenericBlocklist.isGeneric("Walgreens"))
    }
}

final class CompanyCatalogTests: XCTestCase {
    func testKnownBrands() {
        XCTAssertEqual(CompanyCatalog.domain(forName: "Walgreens"), "walgreens.com")
        XCTAssertEqual(CompanyCatalog.domain(forName: "Apple Inc"), "apple.com")
        XCTAssertEqual(CompanyCatalog.domain(forName: "H-E-B"), "heb.com")
        XCTAssertEqual(CompanyCatalog.domain(forName: "The Home Depot"), "homedepot.com")
        XCTAssertEqual(CompanyCatalog.domain(forName: "Charles Schwab"), "schwab.com")
        XCTAssertEqual(CompanyCatalog.domain(forName: "Kroger"), "kroger.com")
        XCTAssertEqual(CompanyCatalog.domain(forName: "Kaiser Permanente"), "kp.org")
        XCTAssertEqual(CompanyCatalog.domain(forName: "Buc-ee's"), "buc-ees.com")
        XCTAssertEqual(CompanyCatalog.domain(forName: "Spectrum"), "spectrum.com")
    }
    func testLocationTail() {
        XCTAssertEqual(CompanyCatalog.domain(forName: "Walgreens Mason Rd"), "walgreens.com")
        XCTAssertEqual(CompanyCatalog.domain(forName: "Walgreens (Mason Rd in Cypress)"), "walgreens.com")
        XCTAssertEqual(CompanyCatalog.domain(forName: "Kroger Marketplace Cypress"), "kroger.com")
    }
    func testUnknown() {
        XCTAssertNil(CompanyCatalog.domain(forName: "Maya Chen"))
    }
}

final class PhoneDirectoryTests: XCTestCase {
    func testPublishedNumbers() {
        XCTAssertEqual(PhoneDirectory.domain(forPhone: "1-800-221-1212"), "delta.com")
        XCTAssertEqual(PhoneDirectory.domain(forPhone: "(800) 925-4733"), "walgreens.com")
        XCTAssertTrue(PhoneDirectory.isBusinessPhone("800-463-3339"))
        XCTAssertFalse(PhoneDirectory.isBusinessPhone("(713) 555-0142"))
    }
}

final class IdentityResolverTests: XCTestCase {
    func testWebsiteBeatsCatalog() {
        let c = ContactIdentity(id: "1", displayName: "Delta", websiteHosts: ["delta.com"])
        let hit = IdentityResolver.resolve(c, brandName: "Delta")
        XCTAssertEqual(hit?.via, .website)
        XCTAssertEqual(hit?.domain, "delta.com")
    }
    func testCatalogWhenNoSite() {
        let c = ContactIdentity(id: "1", displayName: "FedEx")
        let hit = IdentityResolver.resolve(c, brandName: "FedEx")
        XCTAssertEqual(hit?.via, .catalog)
        XCTAssertEqual(hit?.domain, "fedex.com")
    }
    func testPhoneWhenNoName() {
        let c = ContactIdentity(id: "1", displayName: "Customer Service",
                                phoneNumbers: ["800-463-3339"])
        let hit = IdentityResolver.resolve(c, brandName: "Customer Service")
        XCTAssertEqual(hit?.via, .phone)
        XCTAssertEqual(hit?.domain, "fedex.com")
    }
    func testGuessIsFlagged() {
        let c = ContactIdentity(id: "1", displayName: "Acme Widgets LLC")
        let hit = IdentityResolver.resolve(c, brandName: "Acme Widgets")
        XCTAssertEqual(hit?.via, .guess)
        XCTAssertEqual(hit?.domain, "acmewidgets.com")
    }
}

final class ClassificationTests: XCTestCase {
    let pipeline = MatchPipeline(sources: [], fetchImage: { _ in Data() })

    func testPersonStaysPerson() {
        let c = ContactIdentity(id: "1", displayName: "Maya Chen",
                                givenName: "Maya", familyName: "Chen",
                                organization: "Apple", emailDomains: ["hey.com"])
        XCTAssertEqual(pipeline.classify(c), .person)
    }
    func testLoneGivenNameThatIsAFirm() {
        let c = ContactIdentity(id: "1", displayName: "Walgreens",
                                givenName: "Walgreens")
        XCTAssertEqual(pipeline.classify(c), .businessCard)
    }
    func testGenericStillSkipped() {
        let c = ContactIdentity(id: "1", displayName: "Hospital")
        XCTAssertEqual(pipeline.classify(c), .nonBrand)
    }
    func testPersonIsSkippedEvenWithOrg() async {
        let c = ContactIdentity(id: "1", displayName: "Maya Chen",
                                givenName: "Maya", familyName: "Chen",
                                organization: "Apple")
        let result = await pipeline.match(c)
        XCTAssertEqual(result.confidence, .skip)
        XCTAssertTrue(result.flags.contains("person"))
    }
}

final class SimpleIconsTests: XCTestCase {
    func testSlugMapAndDeltaSkip() {
        XCTAssertEqual(SimpleIconsSource.slug(for: "chase.com"), "jpmorgan" as String?)
        XCTAssertEqual(SimpleIconsSource.slug(for: "att.com"), "atandt" as String?)
        XCTAssertNotNil(SimpleIconsSource.url(for: "fedex.com"))
        // R13.3 — the airline is served by the curated mark, never by the
        // Simple Icons "delta" slug, which is a software company.
        XCTAssertNil(SimpleIconsSource.slug(for: "delta.com"))
        XCTAssertNil(SimpleIconsSource.url(for: "delta.com"))
    }
    func testSlugsAreNeverDerived() {
        // R13.2 — an unmapped domain produces no candidate at all; stripping
        // the TLD is right only by accident.
        XCTAssertNil(SimpleIconsSource.slug(for: "bayoucitysprinkler.com"))
        XCTAssertNil(SimpleIconsSource.url(for: "acmeroofing.com"))
    }
}

final class CompaniesLogoPickerTests: XCTestCase {
    func testPicksMappedAndNamedSlugs() {
        let catalog = ["delta-air-lines", "walgreens", "home-depot", "jp-morgan-chase"]
        XCTAssertEqual(
            CompaniesLogoSource.pickSlug(catalog: catalog, domain: "delta.com", name: "Delta"),
            "delta-air-lines"
        )
        XCTAssertEqual(
            CompaniesLogoSource.pickSlug(catalog: catalog, domain: nil, name: "Walgreens"),
            "walgreens"
        )
        XCTAssertEqual(
            CompaniesLogoSource.pickSlug(catalog: catalog, domain: "homedepot.com", name: "Home Depot"),
            "home-depot"
        )
    }
    func testPickIconHrefPrefersSvg() {
        let html = """
        <img src="/img/orig/Walgreens_big.png"><img src="/img/orig/Walgreens.svg">
        """
        XCTAssertEqual(
            CompaniesLogoSource.pickIconHref(html),
            "https://companieslogo.com/img/orig/Walgreens.svg"
        )
    }
}

final class ImageFlagsTests: XCTestCase {
    func testPNGColorType6HasAlpha() {
        // Minimal IHDR: color type 6 (RGBA) at byte 25.
        var png = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
        png.append(contentsOf: [0, 0, 0, 13]) // length
        png.append(contentsOf: Array("IHDR".utf8))
        png.append(contentsOf: [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])
        XCTAssertTrue(ImageFlags.pngHasAlpha(png))
    }
    func testTinyFileRejected() {
        XCTAssertTrue(ImageFlags.isTooSmall(Data(repeating: 0, count: 20)))
        XCTAssertFalse(ImageFlags.isTooSmall(Data(repeating: 1, count: 200)))
    }
}

final class RankerIconicSourcesTests: XCTestCase {
    func testPreferredBeatsFavicon() {
        let fav = LogoCandidate(source: .favicon, imageURL: URL(string: "https://x/f.ico")!,
                                pixelWidth: 128, pixelHeight: 128, assetType: "icon")
        let pref = LogoCandidate(source: .preferred, imageURL: URL(string: "https://x/p.svg")!,
                                 pixelWidth: 400, pixelHeight: 400, assetType: "icon", hasAlpha: true)
        XCTAssertEqual(CandidateRanker.rank([fav, pref]).first?.source, .preferred)
    }
}

final class DefaultSourcesTests: XCTestCase {
    func testNativeSourceOrder() {
        let kinds = DefaultSources.logoSources(brandfetchClientID: nil).map(\.kind)
        XCTAssertEqual(kinds.first, .preferred)
        XCTAssertTrue(kinds.contains(.companiesLogo))
        XCTAssertTrue(kinds.contains(.simpleIcons))
        XCTAssertEqual(kinds.last, .favicon)
        XCTAssertFalse(kinds.contains(.brandfetch))
        let withBrand = DefaultSources.logoSources(brandfetchClientID: "test").map(\.kind)
        XCTAssertEqual(withBrand[1], .brandfetch)
    }
}

// MARK: - ENGINE-CONTRACT conformance of the pieces this lane changed

final class LegalSuffixTests: XCTestCase {
    /// R5.2 — the suffix must be a separate token. Without the leading
    /// separator the `co` alternative eats the end of a word.
    func testSuffixNeedsASeparator() {
        XCTAssertEqual(NameNormalizer.companyKey("Costco"), "costco")
        XCTAssertEqual(NameNormalizer.companyKey("Cisco"), "cisco")
        XCTAssertEqual(NameNormalizer.companyKey("Medico"), "medico")
        XCTAssertEqual(NameNormalizer.companyKey("TRICO"), "trico")
    }
    func testSuffixIsStrippedWhenItIsATokan() {
        XCTAssertEqual(NameNormalizer.companyKey("Apple Inc"), "apple")
        XCTAssertEqual(NameNormalizer.companyKey("Zeta Metalworks, Inc."), "zeta metalworks")
        XCTAssertEqual(NameNormalizer.companyKey("Acme Roofing Co"), "acme roofing")
        XCTAssertEqual(NameNormalizer.companyKey("Bayou City Sprinkler Repair LLC"), "bayou city sprinkler repair")
    }
    func testAmpersandSpellingsCollapse() {
        XCTAssertEqual(NameNormalizer.companyKey("H & R Block"), "h&r block")
        XCTAssertEqual(NameNormalizer.companyKey("H&R Block"), "h&r block")
        XCTAssertEqual(CompanyCatalog.domain(forName: "H & R Block"), "hrblock.com")
    }
    func testGuessSlug() {
        XCTAssertEqual(NameNormalizer.guessSlug("Bayou City Sprinkler Repair LLC"), "bayoucitysprinklerrepair")
        XCTAssertEqual(NameNormalizer.guessSlug("Smith & Sons Plumbing"), "smithandsonsplumbing")
        XCTAssertNil(NameNormalizer.guessSlug("Bo"))
        XCTAssertNil(NameNormalizer.guessSlug("Northwest Harris County Municipal Utility District"))
    }
    func testMedicoStaysOnTheBlocklist() {
        // Only reachable once companyKey stops turning "Medico" into "medi".
        XCTAssertTrue(GenericBlocklist.isNonBrand("Medico"))
    }
}

final class SegmentationTests: XCTestCase {
    /// R6.2 — §5 rule 8, the rule the audit found dead in all three engines.
    func testBrandTailIsRecognised() {
        XCTAssertEqual(NameNormalizer.segment("Byron Goode Jr - Root Insurance").query, "Root Insurance")
        XCTAssertTrue(NameNormalizer.segment("Byron Goode Jr - Root Insurance").isBrandTail)
        XCTAssertTrue(NameNormalizer.segment("Chris At NTB").isBrandTail)
        XCTAssertTrue(NameNormalizer.segment("Dana At Costco").isBrandTail)
        XCTAssertTrue(NameNormalizer.segment("Katy Auto - Firestone Tire").isBrandTail)
    }
    /// R6.3 / R6.4 — decoration is stripped, not searched for.
    func testDecorationIsStripped() {
        let australia = NameNormalizer.segment("Apple - Australia")
        XCTAssertEqual(australia.query, "Apple")
        XCTAssertTrue(australia.decorationStripped)
        XCTAssertFalse(australia.isBrandTail)

        XCTAssertEqual(NameNormalizer.segment("TRICO - General Mgr").query, "TRICO")
        XCTAssertEqual(NameNormalizer.segment("Hsa PTO - Asst Treasurer").query, "Hsa PTO")
        XCTAssertEqual(NameNormalizer.segment("Riverbend Clinic - Voicemail").query, "Riverbend Clinic")
        XCTAssertEqual(NameNormalizer.segment("Walgreens - Mason Rd").query, "Walgreens")
        // Role head, generic tail: the tail survives and R7.5 then rejects it.
        XCTAssertEqual(NameNormalizer.segment("Front Desk - Hospital").query, "Hospital")
    }
    func testRoleTailIsNotABrand() {
        XCTAssertFalse(NameNormalizer.segment("Priya Rao - Regional Manager").isBrandTail)
        XCTAssertNil(NameNormalizer.brandTail("Priya Rao - Regional Manager"))
    }
    func testCatalogTailAllowsSubBrandsButNotTrades() {
        XCTAssertEqual(CompanyCatalog.domain(forName: "H-E-B Pharmacy"), "heb.com")
        // "dental" is a trade word, so Delta Dental must not become the airline.
        XCTAssertNil(CompanyCatalog.domain(forName: "Delta Dental"))
        XCTAssertNil(CompanyCatalog.domain(forName: "Southwest Reservations"))
    }
}

final class StaticMatchTests: XCTestCase {
    let pipeline = MatchPipeline(sources: [], fetchImage: { _ in Data() })

    private func contact(_ display: String, given: String? = nil, family: String? = nil,
                         org: String? = nil, emails: [String] = [], websites: [String] = [],
                         phones: [String] = [], hasImage: Bool = false) -> ContactIdentity {
        ContactIdentity(id: "c", displayName: display, givenName: given, familyName: family,
                        organization: org, emailDomains: emails, websiteHosts: websites,
                        phoneNumbers: phones, hasImage: hasImage)
    }

    /// CL-15 found §5 rule 8 dead in all three engines and the remediation
    /// implemented it, which made this card a business card carrying Root
    /// Insurance's logo.  The owner reversed that on 2026-08-28: individuals do
    /// not get company logos.  §1 already said so — "Person: has given or family
    /// name.  Never a logo target.  Employees are not the company." — and
    /// outranks rule 8, which is now scoped to cards with no name fields.
    ///
    /// This demands *less* logo application than before, which is the safe
    /// direction for a product whose first principle is that a wrong logo is
    /// worse than none.
    func testNamedContactIsNeverALogoTargetEvenWithABrandTail() {
        let byron = contact("Byron Goode Jr - Root Insurance", given: "Byron", family: "Goode")
        let match = pipeline.staticMatch(byron)
        XCTAssertEqual(match.contactClass, .person)
        XCTAssertNil(match.query)
        XCTAssertNil(match.domain)
        XCTAssertEqual(match.maxConfidence, .skip)
        XCTAssertFalse(match.flags.contains("brand-tail"))

        // The "X At Y" form is the plainest case: Chris works at NTB.
        let chris = pipeline.staticMatch(contact("Chris At NTB", given: "Chris"))
        XCTAssertEqual(chris.contactClass, .person)
        XCTAssertNil(chris.domain)
    }

    /// Rule 8 survives for the case it was written for: a card with no name
    /// fields whose display name carries a brand tail, and whose head is not a
    /// person's name.
    func testRule8StillFiresWhenTheCardHasNoNameFields() {
        let match = pipeline.staticMatch(contact("Front Office - Root Insurance"))
        XCTAssertEqual(match.contactClass, .businessCard)
        XCTAssertEqual(match.query, "Root Insurance")
        XCTAssertTrue(match.flags.contains("brand-tail"))

        // A department inside a store is a real business and keeps the brand.
        let pharmacy = pipeline.staticMatch(contact("Pharmacy At Costco"))
        XCTAssertEqual(pharmacy.contactClass, .businessCard)
        XCTAssertEqual(pharmacy.query, "Costco")
    }

    /// Name-field classification alone leaves a hole: a vCard carrying only `FN`
    /// and no `N` parses with no givenName, so "Dana At Costco" would be a
    /// business and wear Costco's mark.  The head of the split settles it.
    func testAtFormIsAPersonEvenWithNoNameFields() {
        for display in ["Dana At Costco", "Chris At NTB", "Byron Goode Jr - Root Insurance"] {
            let match = pipeline.staticMatch(contact(display))
            XCTAssertEqual(match.contactClass, .person, "\(display) should be a person")
            XCTAssertNil(match.domain, "\(display) should have no logo domain")
        }
    }

    func testHeadLooksPersonalDiscriminates() {
        for personal in ["Dana", "Chris", "Byron Goode Jr"] {
            XCTAssertTrue(NameNormalizer.headLooksPersonal(personal), personal)
        }
        // Department, trade, role and place words are not people.
        for business in ["Pharmacy", "Optical", "Front Office", "Katy Auto", "Costco"] {
            XCTAssertFalse(NameNormalizer.headLooksPersonal(business), business)
        }
    }

    func testEmployeeGuardBeatsRule8() {
        let maya = contact("Maya Chen - Apple", given: "Maya", family: "Chen", emails: ["maya@apple.com"])
        let match = pipeline.staticMatch(maya)
        XCTAssertEqual(match.contactClass, .person)
        XCTAssertNil(match.query)
        XCTAssertTrue(match.flags.contains("employee"))
    }

    func testMergedDomainIsCapped() {
        let match = pipeline.staticMatch(contact("NTB", websites: ["https://www.ntb.com"]))
        XCTAssertEqual(match.domain, "ntb.com")
        XCTAssertEqual(match.via, .website)
        XCTAssertEqual(match.maxConfidence, .medium)
        XCTAssertTrue(match.flags.contains("brand-redirect-risk"))
    }

    func testSocialAndPlatformHostsNeverBecomeTheDomain() {
        let linkedIn = pipeline.staticMatch(
            contact("Acme Roofing Co", websites: ["https://www.linkedin.com/company/acme-roofing"]))
        XCTAssertEqual(linkedIn.domain, "acmeroofing.com")
        XCTAssertEqual(linkedIn.via, .guess)
        XCTAssertTrue(linkedIn.flags.contains("social-url-ignored"))

        // R3.2 — the email path is filtered too.
        let socialMail = pipeline.staticMatch(
            contact("Gulf Coast Marine Supply", emails: ["sales@facebook.com"]))
        XCTAssertEqual(socialMail.domain, "gulfcoastmarinesupply.com")
        XCTAssertTrue(socialMail.flags.contains("social-url-ignored"))

        // R3.3 — sites.google.com would otherwise reduce to google.com.
        let littleLeague = pipeline.staticMatch(
            contact("Spring Creek Little League", websites: ["https://sites.google.com/view/springcreekll"]))
        XCTAssertEqual(littleLeague.domain, "springcreeklittleleague.com")
        XCTAssertTrue(littleLeague.flags.contains("platform-host-ignored"))
    }

    func testSubdomainReduction() {
        let match = pipeline.staticMatch(contact("Walgreens", websites: ["https://shop.walgreens.com/store/12345"]))
        XCTAssertEqual(match.domain, "walgreens.com")
        XCTAssertEqual(match.maxConfidence, .high)
        XCTAssertTrue(match.flags.contains("subdomain-reduced"))
    }

    func testHomonymCeilingNeedsContactOwnedEvidence() {
        XCTAssertEqual(pipeline.staticMatch(contact("Delta")).maxConfidence, .medium)
        XCTAssertEqual(pipeline.staticMatch(contact("Delta", websites: ["https://www.delta.com/"])).maxConfidence, .high)
        // R4.2 — the cap is keyed on companyKey, so "Apple Inc" is capped too.
        XCTAssertEqual(pipeline.staticMatch(contact("Apple Inc")).maxConfidence, .medium)
        // A qualified name is a different key and is not a homonym.
        let ibcBank = pipeline.staticMatch(contact("IBC Bank", emails: ["teller@ibc.com"]))
        XCTAssertEqual(ibcBank.maxConfidence, .high)
        XCTAssertFalse(ibcBank.flags.contains("homonym-risk"))
    }

    func testExistingPhotoAndNoIdentityCeilings() {
        let costco = pipeline.staticMatch(contact("Costco", hasImage: true))
        XCTAssertEqual(costco.maxConfidence, .medium)
        XCTAssertTrue(costco.flags.contains("replace-existing"))

        let unresolvable = pipeline.staticMatch(contact("Bo"))
        XCTAssertEqual(unresolvable.contactClass, .businessCard)
        XCTAssertNil(unresolvable.domain)
        XCTAssertEqual(unresolvable.maxConfidence, .skip)
        XCTAssertTrue(unresolvable.flags.contains("no-identity"))
    }

    func testNonBrandIsDecidedBeforeAnySplit() {
        XCTAssertEqual(pipeline.classify(contact("Printer at Farm (WF-2950)")), .nonBrand)
        XCTAssertEqual(pipeline.classify(contact("Front Desk - Hospital")), .nonBrand)
        XCTAssertEqual(pipeline.classify(contact("Verification Code (Twilio Powered)")), .nonBrand)
    }

    func testWorkEmailMayReachHigh() {
        // R10.1b — the domain names the business, so it is evidence, not a guess.
        let match = pipeline.staticMatch(contact("Bluebonnet Dental", emails: ["office@bluebonnetdental.com"]))
        XCTAssertEqual(match.via, .email)
        XCTAssertEqual(match.maxConfidence, .high)
    }

    func testUnrelatedWorkEmailDomainStaysInReview() {
        // R10.1b — "Jay's Receipts" shares no token with "mycustomdomain", so the
        // email identifies the contact without pre-checking a logo for it.  A
        // needless review costs one click; a wrong logo written into an address
        // book costs trust.
        let match = pipeline.staticMatch(contact("Jay's Receipts", emails: ["receipts@mycustomdomain.com"]))
        XCTAssertEqual(match.via, .email)
        XCTAssertEqual(match.maxConfidence, .medium)
        XCTAssertTrue(match.flags.contains("email-domain-unrelated"))
    }
}

final class BackoffTests: XCTestCase {
    func testFullJitterIsBoundedAndGrows() {
        // Deterministic "random": always the top of the range.
        let top: (ClosedRange<Double>) -> Double = { $0.upperBound }
        XCTAssertEqual(HTTPRetry.delay(forAttempt: 0, random: top), 0.5, accuracy: 0.0001)
        XCTAssertEqual(HTTPRetry.delay(forAttempt: 1, random: top), 1.0, accuracy: 0.0001)
        XCTAssertEqual(HTTPRetry.delay(forAttempt: 2, random: top), 2.0, accuracy: 0.0001)
        XCTAssertEqual(HTTPRetry.delay(forAttempt: 9, random: top), HTTPRetry.maxDelay, accuracy: 0.0001)
        // Full jitter: never longer than the ceiling.
        let bottom: (ClosedRange<Double>) -> Double = { $0.lowerBound }
        XCTAssertEqual(HTTPRetry.delay(forAttempt: 3, random: bottom), 0, accuracy: 0.0001)
    }
    func testRetryAfterWins() {
        let bottom: (ClosedRange<Double>) -> Double = { $0.lowerBound }
        XCTAssertEqual(HTTPRetry.delay(forAttempt: 0, retryAfter: 3, random: bottom), 3, accuracy: 0.0001)
        XCTAssertEqual(HTTPRetry.retryAfterSeconds("12"), 12)
        XCTAssertNil(HTTPRetry.retryAfterSeconds("Wed, 21 Oct 2026 07:28:00 GMT"))
    }
    func testRateLimitIsRetriedThenSurfaced() async {
        var calls = 0
        do {
            _ = try await HTTPRetry.withRateLimitRetry(attempts: 2) { () -> Int in
                calls += 1
                throw LogoSourceError.rateLimited(retryAfter: 0)
            }
            XCTFail("expected the rate limit to be rethrown")
        } catch {
            XCTAssertEqual(error as? LogoSourceError, LogoSourceError.rateLimited(retryAfter: 0))
        }
        XCTAssertEqual(calls, 2)
    }
    func testOnlyRateLimitsAreRetried() async {
        var calls = 0
        _ = try? await HTTPRetry.withRateLimitRetry(attempts: 4) { () -> Int in
            calls += 1
            throw LogoSourceError.notFound
        }
        XCTAssertEqual(calls, 1)
    }
}

final class SourceFailureTests: XCTestCase {
    /// A source that 429s must be recorded, not silently dropped for the rest
    /// of the run (ENGINE-CONTRACT R11.6).
    struct RateLimitedSource: LogoSource {
        let kind = SourceKind.brandfetch
        func candidates(forBrandName name: String) async throws -> [LogoCandidate] {
            throw LogoSourceError.rateLimited(retryAfter: 0)
        }
        func candidates(forDomain domain: String) async throws -> [LogoCandidate] {
            throw LogoSourceError.rateLimited(retryAfter: 0)
        }
    }
    struct EmptySource: LogoSource {
        let kind = SourceKind.wikimedia
        func candidates(forBrandName name: String) async throws -> [LogoCandidate] { [] }
        func candidates(forDomain domain: String) async throws -> [LogoCandidate] { [] }
    }

    func testRateLimitedSourceIsReportedAndRowIsRetryable() async {
        let pipeline = MatchPipeline(sources: [RateLimitedSource()], fetchImage: { _ in Data() })
        let result = await pipeline.match(ContactIdentity(id: "1", displayName: "FedEx"))
        XCTAssertEqual(result.confidence, .skip)
        XCTAssertEqual(result.sourceErrors.count, 1)
        XCTAssertEqual(result.sourceErrors.first?.source, .brandfetch)
        XCTAssertTrue(result.sourceErrors.first?.rateLimited == true)
        XCTAssertTrue(result.flags.contains("source-error"))
        XCTAssertTrue(result.isRetryable)
    }

    func testASourceWithNothingToSayIsNotAFailure() async {
        let pipeline = MatchPipeline(sources: [EmptySource()], fetchImage: { _ in Data() })
        let result = await pipeline.match(ContactIdentity(id: "1", displayName: "FedEx"))
        XCTAssertTrue(result.sourceErrors.isEmpty)
        XCTAssertFalse(result.isRetryable)
    }

    func testNameSearchGateDropsUnrelatedBrands() {
        let hit = LogoCandidate(source: .wikimedia, imageURL: URL(string: "https://x/a.png")!,
                                altText: "File:Bread Zine logo.svg")
        XCTAssertFalse(MatchPipeline.passesNameSearchGate(hit, query: "Cash App"))
        let domainHit = LogoCandidate(source: .simpleIcons, imageURL: URL(string: "https://x/b.svg")!,
                                      altText: "raise.com")
        // R9.3 — candidates fetched by domain are exempt from the gate.
        XCTAssertTrue(MatchPipeline.passesNameSearchGate(domainHit, query: "GCX"))
    }
}

final class FallbackTileTests: XCTestCase {
    private func buffer(width: Int, height: Int, background: (UInt8, UInt8, UInt8),
                        ink: (UInt8, UInt8, UInt8), inkRect: (x: Int, y: Int, w: Int, h: Int)) -> [UInt8] {
        var pixels = [UInt8](repeating: 255, count: width * height * 4)
        for y in 0..<height {
            for x in 0..<width {
                let inside = x >= inkRect.x && x < inkRect.x + inkRect.w
                    && y >= inkRect.y && y < inkRect.y + inkRect.h
                let colour = inside ? ink : background
                let offset = (y * width + x) * 4
                pixels[offset] = colour.0
                pixels[offset + 1] = colour.1
                pixels[offset + 2] = colour.2
                pixels[offset + 3] = 255
            }
        }
        return pixels
    }

    func testCentredGlyphOnAFlatFieldIsATile() {
        let pixels = buffer(width: 64, height: 64, background: (240, 240, 240), ink: (20, 20, 20),
                            inkRect: (x: 22, y: 22, w: 20, h: 20))
        XCTAssertTrue(ImageFlags.isCentredGlyph(pixels: pixels, width: 64, height: 64))
    }

    func testAMarkThatReachesTheEdgesIsNotATile() {
        let pixels = buffer(width: 64, height: 64, background: (240, 240, 240), ink: (20, 20, 20),
                            inkRect: (x: 2, y: 27, w: 60, h: 10))
        XCTAssertFalse(ImageFlags.isCentredGlyph(pixels: pixels, width: 64, height: 64))
    }

    func testByteFloorOnlyAppliesToRaster() {
        // A curated SVG mark is often ~400 bytes and must survive.
        let svg = Data("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M0 0h24v24H0z'/></svg>".utf8)
        XCTAssertLessThan(svg.count, ImageFlags.rasterByteFloor)
        XCTAssertFalse(ImageFlags.isFallbackTile(svg))

        var tinyPNG = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
        tinyPNG.append(Data(repeating: 0, count: 100))
        XCTAssertTrue(ImageFlags.isFallbackTile(tinyPNG))
    }

    func testProviderFlagWins() {
        XCTAssertTrue(ImageFlags.isProviderFallback(headerValue: "true"))
        XCTAssertTrue(ImageFlags.isProviderFallback(headerValue: "1"))
        XCTAssertFalse(ImageFlags.isProviderFallback(headerValue: "false"))
        XCTAssertFalse(ImageFlags.isProviderFallback(headerValue: nil))
        XCTAssertTrue(ImageFlags.isFallbackTile(Data(repeating: 9, count: 4096), providerFlagged: true))
    }
}

final class HonestHeadersTests: XCTestCase {
    func testNoSpoofedBrowserOrForgedReferer() {
        let request = BrandfetchSource.imageRequest(url: URL(string: "https://cdn.example.com/logo.png")!)
        let agent = request.value(forHTTPHeaderField: "User-Agent") ?? ""
        let referer = request.value(forHTTPHeaderField: "Referer") ?? ""
        XCTAssertFalse(agent.contains("Chrome"))
        XCTAssertFalse(agent.contains("Mozilla"))
        XCTAssertTrue(agent.contains("ContactLogo"))
        XCTAssertFalse(referer.contains("google.com"))
        XCTAssertFalse(referer.contains("example.com"))
        XCTAssertTrue(referer.contains("contactlogo.com"))
    }
}

final class UndoLogTests: XCTestCase {
    private func makeLog() throws -> UndoLog {
        let dir = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("ContactLogoTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return UndoLog(directory: dir)
    }

    func testBatchesAreOrderedChronologicallyNotByUUID() throws {
        let log = try makeLog()
        var ids: [String] = []
        for index in 0..<3 {
            let entry = ChangeSet.Entry(contactID: "contact-\(index)",
                                        newImageData: Data([1, 2, 3]),
                                        previousImageData: Data([9]))
            ids.append(try log.recordBatch([entry]).lastPathComponent)
            Thread.sleep(forTimeInterval: 0.01)
        }
        let summaries = try log.listBatchSummaries()
        XCTAssertEqual(summaries.count, 3)
        XCTAssertEqual(summaries.first?.id, ids.last)
        XCTAssertEqual(summaries.last?.id, ids.first)
        XCTAssertEqual(summaries.first?.contactCount, 1)
        try? FileManager.default.removeItem(at: log.directory)
    }

    func testPruneKeepsTheMostRecent() throws {
        let log = try makeLog()
        for index in 0..<4 {
            let entry = ChangeSet.Entry(contactID: "contact-\(index)",
                                        newImageData: Data([1]), previousImageData: nil)
            _ = try log.recordBatch([entry])
            Thread.sleep(forTimeInterval: 0.01)
        }
        try log.prune(keeping: 2)
        XCTAssertEqual(try log.listBatchSummaries().count, 2)
        try? FileManager.default.removeItem(at: log.directory)
    }

    func testFileNamesAreNeverContactIdentifiers() throws {
        let log = try makeLog()
        let entry = ChangeSet.Entry(contactID: "../../etc/passwd",
                                    newImageData: Data([1]), previousImageData: Data([7]))
        let dir = try log.recordBatch([entry])
        let files = try FileManager.default.contentsOfDirectory(atPath: dir.path).sorted()
        XCTAssertEqual(files, ["meta.json", "previous-0.img"])
        try? FileManager.default.removeItem(at: log.directory)
    }

    func testTraversalComponentsAreRejected() {
        XCTAssertNil(UndoLog.safeComponent("../../etc/passwd"))
        XCTAssertNil(UndoLog.safeComponent(".."))
        XCTAssertNil(UndoLog.safeComponent(".hidden"))
        XCTAssertNil(UndoLog.safeComponent("a/b.img"))
        XCTAssertEqual(UndoLog.safeComponent("previous-0.img"), "previous-0.img")
    }
}

#if canImport(CoreGraphics) && canImport(ImageIO)
import CoreGraphics

final class ImagePreparerTests: XCTestCase {
    /// CL-06: the two highest-priority sources both return SVG, which Contacts
    /// rejects and `ImageDimensions` cannot measure — so the curated marks
    /// could never satisfy the square rule and never reach high confidence.
    func testCuratedVectorMarkBecomesAMeasurableSquarePNG() throws {
        let svg = try XCTUnwrap(PreferredMarksSource.svg(for: "delta.com"))
        let data = Data(svg.utf8)
        XCTAssertTrue(ImagePreparer.isVector(data))
        XCTAssertNil(ImageDimensions.read(data), "raw SVG has no readable pixel size")

        let prepared = try ImagePreparer.squarePNG(from: data)
        XCTAssertEqual(prepared.width, 512)
        XCTAssertEqual(prepared.height, 512)
        XCTAssertTrue(ImageFlags.isPNG(prepared.data))
        let size = try XCTUnwrap(ImageDimensions.read(prepared.data))
        XCTAssertEqual(size.0, 512)
        XCTAssertEqual(size.1, 512)

        let candidate = LogoCandidate(source: .preferred, imageURL: URL(string: "https://x/mark.png")!,
                                      pixelWidth: prepared.width, pixelHeight: prepared.height,
                                      assetType: "icon", hasAlpha: true)
        XCTAssertTrue(candidate.isSquareish)
        XCTAssertEqual(CandidateRanker.confidence(for: candidate, nameSimilarityPassed: true,
                                                  homonymRisk: false, domainAgrees: true), .high)
    }

    /// §5.3 pad, never crop: a full-bleed source comes back with transparent
    /// margin rather than with its edges cut off.
    func testPaddingNeverCrops() throws {
        let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\">"
            + "<rect x=\"0\" y=\"0\" width=\"100\" height=\"100\" fill=\"#ff0000\"/></svg>"
        let prepared = try ImagePreparer.squarePNG(from: Data(svg.utf8))
        XCTAssertEqual(prepared.width, 512)
        XCTAssertTrue(ImageFlags.pngHasAlpha(prepared.data),
                      "an opaque full-bleed mark must gain a transparent margin")
    }

    func testUndecodableBytesThrowRatherThanBeingWritten() {
        XCTAssertThrowsError(try ImagePreparer.squarePNG(from: Data("not an image".utf8)))
        XCTAssertThrowsError(try ImagePreparer.squarePNG(from: Data()))
    }

    func testPathDataIsParsed() {
        let triangle = SVGRasterizer.parsePathData("M0 0 L10 0 L10 10 Z")
        XCTAssertFalse(triangle.isEmpty)
        XCTAssertEqual(triangle.boundingBox.width, 10, accuracy: 0.001)
        XCTAssertEqual(triangle.boundingBox.height, 10, accuracy: 0.001)

        // Relative commands and packed arc flags must not derail the scanner.
        let curved = SVGRasterizer.parsePathData("M2 2 c1 0 2 1 2 2 a2 2 0 011-1 h3 v3 z")
        XCTAssertFalse(curved.isEmpty)
    }

    /// Simple Icons puts the brand colour on the root `<svg>` and leaves the
    /// glyph's `<path>` bare.  Before the root's paint was inherited, the review
    /// card previewed FedEx purple while Contacts was written a black
    /// silhouette, and simpleicons is a high-tier source, so those marks are
    /// pre-checked.
    func testRootFillIsInheritedByBareChildren() throws {
        let svg = "<svg fill=\"#4D148C\" role=\"img\" viewBox=\"0 0 24 24\">"
            + "<title>FedEx</title><path d=\"M0 0 L24 0 L24 24 Z\"/></svg>"
        let doc = try XCTUnwrap(SVGRasterizer.parse(Data(svg.utf8)))
        let rgba = try XCTUnwrap(doc.shapes.first?.fill.components)
        XCTAssertEqual(rgba[0], CGFloat(0x4D) / 255, accuracy: 0.005)
        XCTAssertEqual(rgba[1], CGFloat(0x14) / 255, accuracy: 0.005)
        XCTAssertEqual(rgba[2], CGFloat(0x8C) / 255, accuracy: 0.005)
    }

    /// An element's own `fill` still wins over the root's, and a root
    /// `fill="none"` really does leave a bare child unpainted.
    func testElementFillOverridesTheInheritedRootFill() throws {
        let svg = "<svg fill=\"none\" viewBox=\"0 0 10 10\">"
            + "<rect x=\"0\" y=\"0\" width=\"10\" height=\"10\" fill=\"#ff0000\"/>"
            + "<rect x=\"0\" y=\"0\" width=\"4\" height=\"4\"/></svg>"
        let doc = try XCTUnwrap(SVGRasterizer.parse(Data(svg.utf8)))
        XCTAssertEqual(doc.shapes.count, 1, "the bare rect inherits fill=\"none\" and paints nothing")
        let rgba = try XCTUnwrap(doc.shapes.first?.fill.components)
        XCTAssertEqual(rgba[0], 1, accuracy: 0.005)
        XCTAssertEqual(rgba[1], 0, accuracy: 0.005)
        XCTAssertEqual(rgba[2], 0, accuracy: 0.005)
    }

    func testViewBoxlessOrEmptyMarkupIsRejected() {
        XCTAssertNil(SVGRasterizer.parse(Data("<svg><g/></svg>".utf8)))
        XCTAssertTrue(SVGRasterizer.looksLikeSVG(Data("<?xml version=\"1.0\"?><svg viewBox=\"0 0 1 1\"></svg>".utf8)))
        XCTAssertFalse(SVGRasterizer.looksLikeSVG(Data([0x89, 0x50, 0x4E, 0x47])))
    }
}

@MainActor
final class ManualCandidateTests: XCTestCase {
    /// VISION's unsure-queue promise: the user's own image becomes the top
    /// candidate, already squared and padded.
    func testManualPickBecomesTheTopCandidate() throws {
        let session = ReviewSession()
        session.results = [MatchResult(contactID: "1", contactClass: .businessCard,
                                       candidates: [], confidence: .skip, flags: [])]
        let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 10 10\">"
            + "<circle cx=\"5\" cy=\"5\" r=\"4\" fill=\"#0033aa\"/></svg>"
        try session.setManualCandidate(for: "1", imageData: Data(svg.utf8))

        XCTAssertEqual(session.results[0].candidates.first?.source, .manual)
        XCTAssertEqual(session.results[0].candidates.first?.pixelWidth, 512)
        XCTAssertTrue(session.results[0].candidates.first?.isSquareish == true)
        XCTAssertEqual(session.chosenIndex["1"], 0)
        XCTAssertTrue(session.selected.contains("1"))
        XCTAssertEqual(session.results[0].candidates.first?.imageURL.scheme, "data")
    }

    func testUnusableManualBytesThrowAndChangeNothing() {
        let session = ReviewSession()
        session.results = [MatchResult(contactID: "1", contactClass: .businessCard,
                                       candidates: [], confidence: .skip, flags: [])]
        XCTAssertThrowsError(try session.setManualCandidate(for: "1", imageData: Data("nope".utf8)))
        XCTAssertTrue(session.results[0].candidates.isEmpty)
        XCTAssertFalse(session.selected.contains("1"))
    }

    func testUndoWithNoBatchIsReportedNotSilent() async {
        let session = ReviewSession()
        session.lastBatchID = nil
        await session.undoLast()
        XCTAssertEqual(session.lastError, ReviewSessionError.noBatchToUndo)
    }
}
#endif
