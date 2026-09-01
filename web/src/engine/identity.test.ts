import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveHost, registrableDomain } from "./domain.ts";
import { companyKey, guessSlug, isRoleOrPlace, splitSegments } from "./normalize.ts";
import { analyzeContact, resolveIdentity, type BookContact } from "./classify.ts";
import { applySimilarityGate, assetTier, matchContact, staticCeiling, type RankedHit } from "./match.ts";

const card = (over: Partial<BookContact> & { displayName: string }): BookContact => ({
  id: "t",
  ...over,
});

test("R1 reduces a host to its registrable domain", () => {
  assert.equal(registrableDomain("https://shop.walgreens.com/store/12345"), "walgreens.com");
  assert.equal(registrableDomain("https://housing.utexas.edu/apply?year=2026"), "utexas.edu");
  assert.equal(registrableDomain("https://shop.example.co.uk/"), "example.co.uk");
  assert.equal(registrableDomain("mail.utexas.edu"), "utexas.edu");
  assert.equal(registrableDomain("doug@texasdescon.com"), "texasdescon.com");
  assert.equal(registrableDomain("https://acme.example.com:8443/x#y"), "example.com");
  assert.equal(registrableDomain("https://acme%20co.example.com"), "example.com");
  assert.equal(registrableDomain("...bluebonnetdental.com."), "bluebonnetdental.com");
});

test("R1 rejects what is not a website", () => {
  assert.equal(registrableDomain("ms-outlook://people/0123456789"), undefined);
  assert.equal(registrableDomain("tel:+17135550142"), undefined);
  assert.equal(registrableDomain("localhost"), undefined);
  assert.equal(registrableDomain(""), undefined);
});

test("R1.8 stripping www. is not a subdomain reduction", () => {
  const www = deriveHost("https://www.bluebonnetdental.com");
  assert.equal(www?.domain, "bluebonnetdental.com");
  assert.equal(www?.subdomainReduced, false);

  const shop = deriveHost("https://shop.walgreens.com/store/1");
  assert.equal(shop?.subdomainReduced, true);
  assert.equal(shop?.host, "shop.walgreens.com");

  const user = deriveHost("doug@texasdescon.com");
  assert.equal(user?.userinfoStripped, true);
});

test("CL-13 a subdomain still finds the catalog brand and its glyph", () => {
  const item = matchContact(card({ displayName: "Walgreens", website: "https://shop.walgreens.com/store/12345" }));
  assert.equal(item.domain, "walgreens.com");
  assert.equal(item.via, "website");
  assert.equal(item.flags.includes("subdomain-reduced"), true);
  // walgreens Simple Icons slug 404s; ticker pack is the remaining high-tier glyph.
  assert.equal(item.candidates[0]?.source, "ticker");
});

test("CL-03 a social URL never becomes the logo domain", () => {
  for (const url of [
    "https://www.linkedin.com/company/acme-roofing",
    "https://facebook.com/acmeroofing",
    "https://www.yelp.com/biz/acme-roofing",
    "https://instagram.com/acmeroofing",
    "https://x.com/acmeroofing",
    "https://github.com/acmeroofing",
  ]) {
    const item = matchContact(card({ displayName: "Acme Roofing Co", website: url }));
    assert.equal(item.domain, "acmeroofing.com", url); // the legal suffix "Co" is stripped by companyKey
    assert.equal(item.via, "guess", url);
    assert.equal(item.flags.includes("social-url-ignored"), true, url);
    assert.notEqual(item.confidence, "high");
    assert.equal(item.selected, false, url);
  }
});

test("a social host is skipped but a real website behind it still wins", () => {
  const item = matchContact(
    card({
      displayName: "Katy Barbershop",
      websites: ["https://instagram.com/katybarbershop", "https://katybarbershop.com"],
    }),
  );
  assert.equal(item.domain, "katybarbershop.com");
  assert.equal(item.via, "website");
  assert.deepEqual(item.flags, ["social-url-ignored", "via-website"]);
});

test("R3.2 a social email domain is ignored too", () => {
  const id = resolveIdentity(card({ displayName: "Gulf Coast Marine Supply", email: "sales@facebook.com" }), "Gulf Coast Marine Supply");
  assert.equal(id?.domain, "gulfcoastmarinesupply.com");
  assert.equal(id?.via, "guess");
  assert.equal(id?.flags.includes("social-url-ignored"), true);
});

test("R3.3 a tenant host never lends the platform's favicon", () => {
  const wix = matchContact(card({ displayName: "Acme Bakery", website: "https://acmebakery.wixsite.com/home" }));
  assert.equal(wix.domain, "acmebakery.com");
  assert.equal(wix.flags.includes("platform-host-ignored"), true);

  const sites = matchContact(card({ displayName: "Spring Creek Little League", website: "https://sites.google.com/view/springcreekll" }));
  assert.equal(sites.domain, "springcreeklittleleague.com");
  assert.equal(sites.flags.includes("platform-host-ignored"), true);
});

test("R5.2 the legal suffix must be a separate token", () => {
  assert.equal(companyKey("Costco"), "costco");
  assert.equal(companyKey("Cisco"), "cisco");
  assert.equal(companyKey("Medico"), "medico");
  assert.equal(companyKey("TRICO"), "trico");
  assert.equal(companyKey("Apple Inc"), "apple");
  assert.equal(companyKey("Zeta Metalworks, Inc."), "zeta metalworks");
  assert.equal(companyKey("Acme Roofing Co"), "acme roofing");
  assert.equal(companyKey("H & R Block"), "h&r block");
});

test("CL-14 the guessed slug runs on companyKey, not the raw name", () => {
  assert.equal(guessSlug("Bayou City Sprinkler Repair LLC"), "bayoucitysprinklerrepair");
  assert.equal(guessSlug("Bayou City Sprinkler Repair"), "bayoucitysprinklerrepair");
  assert.equal(guessSlug("Smith & Sons Plumbing"), "smithandsonsplumbing");
  assert.equal(guessSlug("Bo"), undefined);
  assert.equal(guessSlug("Northwest Harris County Municipal Utility District"), undefined);

  const withSuffix = matchContact(card({ displayName: "Bayou City Sprinkler Repair LLC" }));
  const without = matchContact(card({ displayName: "Bayou City Sprinkler Repair" }));
  assert.equal(withSuffix.domain, "bayoucitysprinklerrepair.com");
  assert.equal(withSuffix.domain, without.domain);
  assert.equal(withSuffix.confidence, without.confidence);
});

test("R6.1 splits on the first separator only", () => {
  assert.deepEqual(splitSegments("Chris At NTB"), { head: "Chris", tail: "NTB", separator: "at" });
  assert.equal(splitSegments("Byron Goode Jr - Root Insurance")?.tail, "Root Insurance");
  assert.equal(splitSegments("A - B - C"), undefined);
  assert.equal(splitSegments("Bayou City Sprinkler Repair"), undefined);
  assert.equal(isRoleOrPlace("Asst Treasurer"), true);
  assert.equal(isRoleOrPlace("Mason Rd"), true);
  assert.equal(isRoleOrPlace("Root Insurance"), false);
});

/**
 * CL-15 found MATCHING-ENGINE §5 rule 8 dead in all three engines, and the
 * remediation implemented it — which made "Byron Goode Jr - Root Insurance" and
 * "Chris At NTB" business cards carrying the brand's logo.
 *
 * The owner reversed that on 2026-08-28: individuals do not get company logos.
 * §1 already said so — "Person: has given or family name. Never a logo target.
 * Employees are not the company." — and outranks rule 8, which is now scoped to
 * cards with no name fields at all.
 *
 * These assertions are the reversal, not a weakened test: they demand *less*
 * logo application than before, which is the safe direction for a product whose
 * first principle is that a wrong logo is worse than none.
 */
test("§1 — a named contact is never a logo target, even with a known brand tail", () => {
  const byron = analyzeContact(card({ displayName: "Byron Goode Jr - Root Insurance", givenName: "Byron", familyName: "Goode" }));
  assert.equal(byron.contactClass, "person");
  assert.equal(byron.query, "");
  assert.equal(byron.flags.includes("brand-tail"), false);

  // The "X At Y" form is the plainest case: Chris works at NTB.
  const chris = matchContact(card({ displayName: "Chris At NTB", givenName: "Chris" }));
  assert.equal(chris.contactClass, "person");
  assert.equal(chris.domain, undefined);
  assert.equal(chris.confidence, "skip");
  assert.equal(chris.selected, false);

  const dana = matchContact(card({ displayName: "Dana At Costco", givenName: "Dana" }));
  assert.equal(dana.contactClass, "person");
  assert.equal(dana.domain, undefined);
});

test("§5 rule 8 still fires when the card has no name fields", () => {
  // The case rule 8 was written for: an org-only card whose display name carries
  // a brand tail. Nothing here claims to be a person, so nothing is mislabelled.
  const orgOnly = analyzeContact(card({ displayName: "Front Office - Root Insurance" }));
  assert.equal(orgOnly.contactClass, "businessCard");
  assert.equal(orgOnly.query, "Root Insurance");
  assert.equal(orgOnly.flags.includes("brand-tail"), true);
});

test("R7.3.b an employee of the tail brand stays a person", () => {
  const maya = analyzeContact(card({ displayName: "Maya Chen - Apple", givenName: "Maya", familyName: "Chen", email: "maya@apple.com" }));
  assert.equal(maya.contactClass, "person");
  assert.deepEqual(maya.flags, ["person", "employee"]);

  // Previously this became a business card, on the reasoning that a freemail
  // address meant the person did not work at the tail brand. Under §1 the email
  // is irrelevant: the name fields already settle it.
  const stranger = analyzeContact(card({ displayName: "Maya Chen - Apple", givenName: "Maya", familyName: "Chen", email: "maya@gmail.com" }));
  assert.equal(stranger.contactClass, "person");
  assert.equal(stranger.query, "");
});

test("R6.2 does not fire on a role tail", () => {
  const priya = analyzeContact(card({ displayName: "Priya Rao - Regional Manager", givenName: "Priya", familyName: "Rao" }));
  assert.equal(priya.contactClass, "person");
  assert.equal(priya.query, "");
});

test("R6.3/R6.4 decoration is stripped from either side", () => {
  assert.equal(analyzeContact(card({ displayName: "Apple - Australia" })).query, "Apple");
  assert.equal(analyzeContact(card({ displayName: "TRICO - General Mgr" })).query, "TRICO");
  assert.equal(analyzeContact(card({ displayName: "Riverbend Clinic - Voicemail" })).query, "Riverbend Clinic");
  assert.equal(analyzeContact(card({ displayName: "Walgreens - Mason Rd" })).flags.includes("decoration-stripped"), true);

  const generic = analyzeContact(card({ displayName: "Front Desk - Hospital" }));
  assert.equal(generic.contactClass, "nonBrand"); // R7.5 re-tests the chosen segment
  assert.deepEqual(generic.flags, ["non-brand"]);
});

test("R4 the blocklists are keyed on companyKey", () => {
  assert.equal(analyzeContact(card({ displayName: "Medico" })).contactClass, "nonBrand");
  assert.equal(analyzeContact(card({ displayName: "Market Manager" })).contactClass, "nonBrand");
  assert.equal(analyzeContact(card({ displayName: "Printer at Farm (WF-2950)" })).contactClass, "nonBrand");
  // GENERIC is tested before HOMONYM (R4.1): a non-brand is skipped, not capped.
  assert.equal(analyzeContact(card({ displayName: "Jerry" })).contactClass, "nonBrand");
  assert.equal(analyzeContact(card({ displayName: "Apple Inc" })).flags.includes("homonym-risk"), true);
  assert.equal(analyzeContact(card({ displayName: "IBC Bank" })).flags.includes("homonym-risk"), false);
});

test("R8 order: website, work email, catalog, phone, guess", () => {
  assert.equal(resolveIdentity(card({ displayName: "Delta", website: "https://delta.com" }), "Delta")?.via, "website");
  assert.equal(resolveIdentity(card({ displayName: "Mercury", email: "ops@mercury.com" }), "Mercury")?.via, "email");
  assert.equal(resolveIdentity(card({ displayName: "Delta", phone: "1-800-221-1212" }), "Delta")?.via, "catalog");
  assert.equal(resolveIdentity(card({ displayName: "Southwest Reservations", phone: "1-800-435-9792" }), "Southwest Reservations")?.via, "phone");
  assert.equal(resolveIdentity(card({ displayName: "The Guys", email: "nobody@icloud.com", website: "ms-outlook://people/9", phone: "+1 713 555 0142" }), "The Guys")?.via, "guess");
  assert.equal(resolveIdentity(card({ displayName: "Bo" }), "Bo"), undefined);
});

test("R10 the static ceiling caps what evidence cannot support", () => {
  const at = (flags: string[], via: "website" | "email" | "catalog" | "phone" | "guess") =>
    staticCeiling({ contactClass: "businessCard", via, flags });
  assert.equal(at([], "website"), "high");
  // R10.1b — an email domain that names the business may reach high; one that
  // does not is capped, whatever the source quality.
  assert.equal(at([], "email"), "high");
  assert.equal(at(["email-domain-unrelated"], "email"), "medium");
  assert.equal(at(["replace-existing"], "email"), "medium");
  assert.equal(at([], "guess"), "medium");
  assert.equal(at(["homonym-risk"], "catalog"), "medium"); // name-derived cannot resolve a homonym
  assert.equal(at(["homonym-risk"], "website"), "high");
  assert.equal(at(["brand-tail"], "catalog"), "medium");
  assert.equal(at(["replace-existing"], "website"), "medium");
  assert.equal(at(["brand-redirect-risk"], "website"), "medium");
  assert.equal(staticCeiling({ contactClass: "person", via: undefined, flags: [] }), "skip");
  assert.equal(staticCeiling({ contactClass: "businessCard", via: undefined, flags: ["no-identity"] }), "skip");
});

test("R11.4 a favicon is never high, whatever the identity", () => {
  const google: RankedHit = {
    src: "https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&url=https://acmeroofing.com&size=256",
    source: "google",
    kind: "icon",
  };
  assert.equal(assetTier(google, "website"), "medium");
  assert.equal(assetTier({ src: "https://icons.duckduckgo.com/ip3/x.com.ico", source: "favicon", kind: "icon" }, "catalog"), "medium");
  assert.equal(assetTier({ src: "https://icons.duckduckgo.com/ip3/x.com.ico", source: "favicon", kind: "icon" }, "guess"), "low");
  assert.equal(assetTier({ src: "https://logo.clearbit.com/x.com?size=512", source: "clearbit", kind: "icon" }, "website"), "medium");
  assert.equal(assetTier({ src: "https://img.logo.dev/x.com?size=512", source: "logodev", kind: "icon" }, "website"), "medium");
  assert.equal(assetTier({ src: "https://cdn.simpleicons.org/fedex", source: "simpleicons", kind: "icon" }, "catalog"), "high");
  assert.equal(assetTier({ src: "https://cdn.brandfetch.io/x.com/w/512/h/512", source: "brandfetch", kind: "icon" }, "website"), "high");
  assert.equal(assetTier({ src: "https://example.com/logo.png", source: "brandfetch", kind: "unknown" }, "website"), "medium");
});

test("CL-16 the similarity gate drops a name-search candidate that is not the brand", () => {
  const byDomain: RankedHit = { src: "https://cdn.brandfetch.io/cash.app/w/512/h/512", source: "brandfetch", kind: "icon" };
  const byName: RankedHit = { src: "https://example.com/breadzine.svg", source: "brandfetch", kind: "icon", brandName: "Bread Zine" };
  const rightName: RankedHit = { src: "https://example.com/cashapp.svg", source: "brandfetch", kind: "icon", brandName: "Cash App" };

  const kept = applySimilarityGate("Cash App", [byDomain, byName, rightName]);
  assert.deepEqual(kept, [byDomain, rightName]); // R9.3 exempts domain-fetched candidates
  assert.deepEqual(applySimilarityGate("Cash App", [byName]), []);
});

test("R9.4 nothing left to show is skip, not a silent low", () => {
  const item = matchContact(card({ displayName: "Northwest Harris County Municipal Utility District" }));
  assert.equal(item.confidence, "skip");
  assert.equal(item.candidates.length, 0);
  assert.equal(item.flags.includes("no-identity"), true);
});

test("R7.6 a person and a non-brand carry no query, domain or via", () => {
  for (const c of [
    card({ displayName: "Maya Chen", givenName: "Maya", familyName: "Chen" }),
    card({ displayName: "Hospital" }),
  ]) {
    const item = matchContact(c);
    assert.equal(item.query, "");
    assert.equal(item.domain, undefined);
    assert.equal(item.via, undefined);
    assert.equal(item.confidence, "skip");
    assert.equal(item.candidates.length, 0);
  }
});

test("R12.1 flags come out in contract order", () => {
  const item = matchContact(
    card({ displayName: "Delta", websites: ["https://linkedin.com/company/delta", "https://shop.delta.com/x"], hadExistingPhoto: true }),
  );
  assert.deepEqual(item.flags, [
    "homonym-risk",
    "social-url-ignored",
    "subdomain-reduced",
    "via-website",
    "replace-existing",
  ]);
});
