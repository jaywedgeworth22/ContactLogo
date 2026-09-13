import assert from "node:assert/strict";
import { test } from "node:test";
import { looksLikeContactCsv, parseGoogleCsv } from "./csv.ts";
import { resolveIdentity } from "./classify.ts";

test("looksLikeContactCsv recognizes Google and Outlook CSV headers", () => {
  assert.ok(looksLikeContactCsv("Name,Given Name,Family Name,E-mail 1 - Value"));
  assert.ok(looksLikeContactCsv("First Name,Last Name,Email Address,Phone 1"));
  assert.ok(!looksLikeContactCsv("Item,Price,Quantity"));
});

test("parseGoogleCsv preserves multiple emails, phones, and websites", () => {
  const csv = [
    "Name,Given Name,Family Name,Organization Name,E-mail 1 - Value,E-mail 2 - Value,Phone 1 - Value,Phone 2 - Value,Website 1 - Value,Website 2 - Value,Photo",
    "John Doe,John,Doe,Acme,john@gmail.com,john@acme.example,+15125550100,+15125550101,https://twitter.com/john,https://acme.example,1",
  ].join("\n");

  const contacts = parseGoogleCsv(csv);
  assert.equal(contacts.length, 1);
  const c = contacts[0]!;
  assert.equal(c.displayName, "John Doe");
  assert.equal(c.email, "john@gmail.com");
  assert.deepEqual(c.emails, ["john@gmail.com", "john@acme.example"]);
  assert.equal(c.phone, "+15125550100");
  assert.deepEqual(c.phones, ["+15125550100", "+15125550101"]);
  assert.equal(c.website, "https://twitter.com/john");
  assert.deepEqual(c.websites, ["https://twitter.com/john", "https://acme.example"]);
  assert.equal(c.hadExistingPhoto, true);
});

test("Issue #75: secondary corporate email in CSV resolves business domain when primary is freemail", () => {
  const csv = [
    "Name,Organization Name,E-mail 1 - Value,E-mail 2 - Value",
    "Acme Services,Acme Services,contact@gmail.com,billing@acmeservices.example",
  ].join("\n");

  const contacts = parseGoogleCsv(csv);
  assert.equal(contacts.length, 1);
  const res = resolveIdentity(contacts[0]!, "Acme Services");
  assert.equal(res?.domain, "acmeservices.example");
  assert.equal(res?.via, "email");
});

test("Issue #75: secondary corporate website in CSV resolves business domain when primary is social", () => {
  const csv = [
    "Name,Organization Name,Website 1 - Value,Website 2 - Value",
    "Stripe Support,Stripe,https://twitter.com/stripesupport,https://stripe.com",
  ].join("\n");

  const contacts = parseGoogleCsv(csv);
  assert.equal(contacts.length, 1);
  const res = resolveIdentity(contacts[0]!, "Stripe");
  assert.equal(res?.domain, "stripe.com");
  assert.equal(res?.via, "website");
});
