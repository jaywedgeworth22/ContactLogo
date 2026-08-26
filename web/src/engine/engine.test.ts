import assert from "node:assert/strict";
import { test } from "node:test";
import { lookupCompanyDomain } from "./catalog.ts";
import { lookupPhoneDomain, isBusinessPhone } from "./phones.ts";
import { brandTail, cleanName, companyKey, passesSimilarity } from "./normalize.ts";
import {
  classifyContact,
  inferCompanyFromLoneName,
  resolveIdentity,
  type BookContact,
} from "./classify.ts";
import { matchContact } from "./match.ts";
import { parseVcard, contactToVcard } from "./vcard.ts";
import { looksLikeContactCsv, parseGoogleCsv } from "./csv.ts";
import { simpleIconsSlug } from "./logos.ts";

test("clean strips store locations and legal suffixes", () => {
  assert.equal(cleanName("Walgreens (Mason Rd / Cypress)"), "Walgreens");
  assert.equal(companyKey("Apple Inc"), "apple");
  assert.equal(companyKey("The Home Depot"), "the home depot");
});

test("catalog finds brands and location tails", () => {
  assert.equal(lookupCompanyDomain("Walgreens"), "walgreens.com");
  assert.equal(lookupCompanyDomain("Walgreens Mason Rd"), "walgreens.com");
  assert.equal(lookupCompanyDomain("H-E-B"), "heb.com");
  assert.equal(lookupCompanyDomain("Charles Schwab"), "schwab.com");
  assert.equal(lookupCompanyDomain("Kaiser Permanente"), "kp.org");
  assert.equal(lookupCompanyDomain("Buc-ee's"), "buc-ees.com");
  assert.equal(lookupCompanyDomain("Spectrum"), "spectrum.com");
  assert.equal(lookupCompanyDomain("Kroger Marketplace Cypress"), "kroger.com");
  assert.equal(lookupCompanyDomain("Maya Chen"), undefined);
});

test("phone directory", () => {
  assert.equal(lookupPhoneDomain("1-800-221-1212"), "delta.com");
  assert.equal(lookupPhoneDomain("(800) 463-3339"), "fedex.com");
  assert.equal(isBusinessPhone("800-463-3339"), true);
  assert.equal(isBusinessPhone("(713) 555-0142"), false);
});

test("brand tail and similarity", () => {
  assert.equal(brandTail("Chris At NTB"), "NTB");
  assert.equal(brandTail("Byron Goode Jr - Root Insurance"), "Root Insurance");
  assert.equal(passesSimilarity("Cash App", "Cash App"), true);
  assert.equal(passesSimilarity("Cash App", "Bread Zine"), false);
});

test("people stay people; lone firm name becomes a business card", () => {
  const person: BookContact = {
    id: "1",
    displayName: "Maya Chen",
    givenName: "Maya",
    familyName: "Chen",
    organization: "Apple",
    email: "maya@hey.com",
  };
  assert.equal(classifyContact(person), "person");
  assert.equal(inferCompanyFromLoneName(person), undefined);

  const lone: BookContact = { id: "2", displayName: "Walgreens", givenName: "Walgreens" };
  assert.equal(classifyContact(lone), "businessCard");
  assert.equal(inferCompanyFromLoneName(lone), "Walgreens");

  const generic: BookContact = { id: "3", displayName: "Hospital" };
  assert.equal(classifyContact(generic), "nonBrand");
});

test("review-first: catalog icon is high; guess is never auto", () => {
  const fedex = matchContact({ id: "1", displayName: "FedEx" });
  assert.equal(fedex.via, "catalog");
  assert.equal(fedex.confidence, "high");
  assert.equal(fedex.selected, true);

  const guess = matchContact({ id: "2", displayName: "Acme Widgets" });
  assert.equal(guess.via, "guess");
  assert.notEqual(guess.confidence, "high");
  assert.equal(guess.selected, false);

  const hospital = matchContact({ id: "3", displayName: "Hospital" });
  assert.equal(hospital.confidence, "skip");
});

test("photo-protected people are skipped", () => {
  const person: BookContact = {
    id: "1",
    displayName: "Maya Chen",
    givenName: "Maya",
    familyName: "Chen",
    hadExistingPhoto: true,
  };
  assert.equal(matchContact(person).flags.includes("photo-protected"), true);
});

test("vcard round-trip keeps org and photo", () => {
  const card = contactToVcard({
    id: "1",
    displayName: "FedEx",
    organization: "FedEx",
    email: "x@fedex.com",
    photoDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  });
  const parsed = parseVcard(card);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.organization, "FedEx");
  assert.equal(parsed[0]?.hadExistingPhoto, true);
});

test("vcard preserves all original properties during export", () => {
  const raw = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "FN:Alice Smith",
    "N:Smith;Alice;;;",
    "EMAIL;TYPE=HOME:alice@home.com",
    "EMAIL;TYPE=WORK:alice@work.com",
    "TEL;TYPE=CELL:555-1234",
    "ADR;TYPE=HOME:;;123 Main St;City;ST;12345;USA",
    "NOTE:VIP Client",
    "BDAY:1990-01-01",
    "X-CUSTOM-FIELD:custom-value",
    "END:VCARD",
  ].join("\r\n");

  const [contact] = parseVcard(raw);
  assert.ok(contact);
  assert.equal(contact.displayName, "Alice Smith");

  // Export without new photo should preserve raw card exactly
  const exportedRaw = contactToVcard(contact);
  assert.equal(exportedRaw.includes("ADR;TYPE=HOME"), true);
  assert.equal(exportedRaw.includes("NOTE:VIP Client"), true);
  assert.equal(exportedRaw.includes("BDAY:1990-01-01"), true);
  assert.equal(exportedRaw.includes("X-CUSTOM-FIELD:custom-value"), true);

  // Export with new photo should inject PHOTO while keeping all existing fields
  contact.photoDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const exportedWithPhoto = contactToVcard(contact);
  assert.equal(exportedWithPhoto.includes("PHOTO;ENCODING=b;TYPE=PNG:"), true);
  assert.equal(exportedWithPhoto.includes("ADR;TYPE=HOME"), true);
  assert.equal(exportedWithPhoto.includes("NOTE:VIP Client"), true);
  assert.equal(exportedWithPhoto.includes("BDAY:1990-01-01"), true);
  assert.equal(exportedWithPhoto.includes("X-CUSTOM-FIELD:custom-value"), true);
});

test("vcard 4.0 preserves data URI photo format during export", () => {
  const raw = [
    "BEGIN:VCARD",
    "VERSION:4.0",
    "FN:Bob Jones",
    "N:Jones;Bob;;;",
    "NOTE:vCard 4 contact",
    "END:VCARD",
  ].join("\r\n");

  const [contact] = parseVcard(raw);
  assert.ok(contact);
  contact.photoDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const exportedWithPhoto = contactToVcard(contact);
  assert.equal(exportedWithPhoto.includes("PHOTO:data:image/png;base64,"), true);
  assert.equal(exportedWithPhoto.includes("PHOTO;ENCODING="), false);
  assert.equal(exportedWithPhoto.includes("VERSION:4.0"), true);
  assert.equal(exportedWithPhoto.includes("NOTE:vCard 4 contact"), true);
});

test("google csv import", () => {
  const csv = "Name,Given Name,Organization Name,E-mail 1 - Value\nFedEx,FedEx,FedEx,x@fedex.com\n";
  assert.equal(looksLikeContactCsv(csv), true);
  const rows = parseGoogleCsv(csv);
  assert.equal(rows[0]?.displayName, "FedEx");
  assert.equal(rows[0]?.email, "x@fedex.com");
});

test("simple icons slug map", () => {
  assert.equal(simpleIconsSlug("chase.com"), "jpmorgan");
  assert.equal(simpleIconsSlug("att.com"), "atandt");
});

test("identity prefers website then catalog then phone", () => {
  const site = resolveIdentity({ id: "1", displayName: "Delta", website: "https://delta.com" }, "Delta");
  assert.equal(site?.via, "website");
  const catalog = resolveIdentity({ id: "2", displayName: "FedEx" }, "FedEx");
  assert.equal(catalog?.via, "catalog");
  const phone = resolveIdentity({ id: "3", displayName: "Help", phone: "800-463-3339" }, "Help");
  assert.equal(phone?.via, "phone");
  assert.equal(phone?.domain, "fedex.com");
});

test("people are never logo targets; lone firm names are", async () => {
  const employee = matchContact({
    id: "1",
    displayName: "Maya Chen",
    givenName: "Maya",
    familyName: "Chen",
    organization: "Apple",
  });
  assert.equal(employee.confidence, "skip");
  assert.equal(employee.flags.includes("person"), true);
});

test("existing business photos stay in review", () => {
  const fedex = matchContact({ id: "1", displayName: "FedEx", hadExistingPhoto: true });
  assert.equal(fedex.flags.includes("replace-existing"), true);
  assert.notEqual(fedex.confidence, "high");
  assert.equal(fedex.selected, false);
});

test("companies logo slug picker matches Swift", async () => {
  const { pickCompaniesLogoSlug, pickCompaniesLogoIconHref } = await import("./companieslogo.ts");
  const catalog = ["delta-air-lines", "walgreens", "home-depot", "jp-morgan-chase"];
  assert.equal(pickCompaniesLogoSlug(catalog, { domain: "delta.com", name: "Delta" }), "delta-air-lines");
  assert.equal(pickCompaniesLogoSlug(catalog, { name: "Walgreens" }), "walgreens");
  assert.equal(
    pickCompaniesLogoIconHref('<img src="/img/orig/Walgreens_big.png"><img src="/img/orig/Walgreens.svg">'),
    "https://companieslogo.com/img/orig/Walgreens.svg",
  );
});

test("source labels cover every logo source", async () => {
  const { sourceLabel } = await import("./logos.ts");
  assert.equal(sourceLabel("preferred"), "Iconic mark");
  assert.equal(sourceLabel("simpleicons"), "Simple Icons");
  assert.equal(sourceLabel("ticker"), "Stock Ticker Pack (HD)");
  assert.equal(sourceLabel("brandfetch"), "Brandfetch (HD)");
  assert.equal(sourceLabel("logodev"), "Logo.dev (HD)");
  assert.equal(sourceLabel("clearbit"), "Clearbit (512px)");
  assert.equal(sourceLabel("google"), "Google (256px)");
  assert.equal(sourceLabel("favicon"), "Favicon");
  assert.equal(sourceLabel("upload"), "Your file");
  assert.equal(sourceLabel("crop"), "Custom crop");
  assert.equal(sourceLabel("url"), "Pasted URL");
});

test("ticker lookup works for public companies", async () => {
  const { lookupCompanyTicker } = await import("./catalog.ts");
  assert.equal(lookupCompanyTicker("apple.com"), "AAPL");
  assert.equal(lookupCompanyTicker("tesla.com"), "TSLA");
  assert.equal(lookupCompanyTicker("schwab.com"), "SCHW");
  assert.equal(lookupCompanyTicker("random-site.com"), undefined);
});

test("nextCandidateIndex never wraps past the last source", async () => {
  const { nextCandidateIndex } = await import("./logos.ts");
  assert.equal(nextCandidateIndex(0, 5), 1);
  assert.equal(nextCandidateIndex(3, 5), 4);
  assert.equal(nextCandidateIndex(4, 5), undefined);
  assert.equal(nextCandidateIndex(0, 1), undefined);
  assert.equal(nextCandidateIndex(0, 0), undefined);
  // The #21 alt-thumb used `(i + 1) % n`, which returns 0 here and re-renders forever.
  assert.notEqual((4 + 1) % 5, nextCandidateIndex(4, 5) ?? -1);
});

test("candidateUrls provides high-res sources and avoids unknown simpleicons", async () => {
  const { candidateUrls } = await import("./logos.ts");
  const known = candidateUrls("apple.com");
  assert.equal(known.some((c) => c.source === "simpleicons"), true);
  assert.equal(known.some((c) => c.source === "ticker"), true);
  assert.equal(known.some((c) => c.source === "brandfetch"), true);
  assert.equal(known.some((c) => c.source === "logodev"), true);
  assert.equal(known.some((c) => c.source === "clearbit"), true);
  assert.equal(known.some((c) => c.source === "google"), true);

  const unknown = candidateUrls("random-local-bakery.com");
  assert.equal(unknown.some((c) => c.source === "simpleicons"), false);
  assert.equal(unknown.some((c) => c.source === "ticker"), false);
  assert.equal(unknown.some((c) => c.source === "brandfetch"), true);
  assert.equal(unknown.some((c) => c.source === "logodev"), true);
  assert.equal(unknown.some((c) => c.source === "clearbit"), true);
  assert.equal(unknown.some((c) => c.source === "google"), true);
});

test("email and guessed domains stay in review", async () => {
  const emailItem = matchContact({
    id: "101",
    displayName: "Jay's Receipts",
    email: "receipts@mycustomdomain.com",
  });
  assert.notEqual(emailItem.confidence, "high");
  assert.equal(emailItem.selected, false);
});

test("google person mapping", async () => {
  const { personToBookContact } = await import("./google-contacts.ts");
  const contact = personToBookContact({
    names: [{ displayName: "FedEx", givenName: "FedEx" }],
    organizations: [{ name: "FedEx" }],
    emailAddresses: [{ value: "x@fedex.com" }],
  });
  assert.equal(contact?.displayName, "FedEx");
  assert.equal(contact?.organization, "FedEx");
  assert.equal(contact?.importSource, "google");
});

test("device picker is off in Node", async () => {
  const { canPickDeviceContacts } = await import("./picker.ts");
  assert.equal(canPickDeviceContacts(), false);
});
