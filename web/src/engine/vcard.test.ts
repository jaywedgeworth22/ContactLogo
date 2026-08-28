import assert from "node:assert/strict";
import { test } from "node:test";
import { parseVcard, contactToVcard, contactsToVcard } from "./vcard.ts";

/** The card from docs/EVALUATION-2026-08.md CL-01, plus the fields it lost. */
const RICH_CARD_LINES = [
  "BEGIN:VCARD",
  "VERSION:3.0",
  "UID:urn:uuid:6f3c1b1e-9a4e-4c2f-9a1e-0b7d5f2c8a11",
  "N:Reyes;Dana;Q;Dr.;PhD",
  String.raw`FN:Dr. Dana Q. Reyes\, PhD`,
  "ORG:Acme Corp;Field Services",
  "TITLE:Regional Manager",
  "EMAIL;TYPE=INTERNET,WORK:dana@acme.example",
  "EMAIL;TYPE=INTERNET,HOME:dana.reyes@fastmail.example",
  "TEL;TYPE=WORK,VOICE:+1-512-555-0143",
  "TEL;TYPE=CELL:+1-512-555-0199",
  "ADR;TYPE=WORK:;;1 Industrial Way;Austin;TX;78701;USA",
  "URL:https://acme.example",
  "URL:https://www.linkedin.example/in/danareyes",
  "BDAY:1979-04-12",
  String.raw`NOTE:Prefers email\; call only in an emergency\, please.`,
  "IMPP;X-SERVICE-TYPE=Jabber:xmpp:dana@acme.example",
  "CATEGORIES:Vendors,Field Ops",
  "item1.X-ABLabel:Field office",
  "X-SOCIALPROFILE;TYPE=linkedin:https://www.linkedin.example/in/danareyes",
  "REV:2026-01-04T18:20:00Z",
  "END:VCARD",
];

const RICH_CARD = RICH_CARD_LINES.join("\r\n") + "\r\n";

const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Logical lines of a serialized card: CRLF split plus RFC 6350 unfolding. */
function logicalLines(vcf: string): string[] {
  const out: string[] = [];
  for (const line of vcf.replace(/\r\n/g, "\n").split("\n")) {
    if (!line) continue;
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out;
}

function octets(text: string): number {
  return new TextEncoder().encode(text).length;
}

test("round-trip of a rich card loses nothing", () => {
  const parsed = parseVcard(RICH_CARD);
  assert.equal(parsed.length, 1);

  const out = contactToVcard(parsed[0]!);
  assert.deepEqual(logicalLines(out), RICH_CARD_LINES);

  // And the same card survives a second trip through the parser.
  assert.deepEqual(logicalLines(contactToVcard(parseVcard(out)[0]!)), RICH_CARD_LINES);
});

test("round-trip keeps every property the audit listed as lost", () => {
  const out = contactToVcard(parseVcard(RICH_CARD)[0]!);
  for (const line of [
    "UID:urn:uuid:6f3c1b1e-9a4e-4c2f-9a1e-0b7d5f2c8a11",
    "TITLE:Regional Manager",
    "ADR;TYPE=WORK:;;1 Industrial Way;Austin;TX;78701;USA",
    "BDAY:1979-04-12",
    "IMPP;X-SERVICE-TYPE=Jabber:xmpp:dana@acme.example",
    "CATEGORIES:Vendors,Field Ops",
    "X-SOCIALPROFILE;TYPE=linkedin:https://www.linkedin.example/in/danareyes",
    "item1.X-ABLabel:Field office",
    "N:Reyes;Dana;Q;Dr.;PhD",
    "ORG:Acme Corp;Field Services",
    String.raw`NOTE:Prefers email\; call only in an emergency\, please.`,
  ]) {
    assert.ok(logicalLines(out).includes(line), `missing ${line}`);
  }
});

test("UID survives export so re-import updates instead of duplicating", () => {
  const contact = parseVcard(RICH_CARD)[0]!;
  const uid = "UID:urn:uuid:6f3c1b1e-9a4e-4c2f-9a1e-0b7d5f2c8a11";
  assert.ok(logicalLines(contactToVcard(contact)).includes(uid));

  // Still there once a logo has been applied, which is the whole point.
  const updated = { ...contact, photoDataUrl: PNG_1PX };
  assert.ok(logicalLines(contactToVcard(updated)).includes(uid));
});

test("repeated properties all come back", () => {
  const lines = logicalLines(contactToVcard(parseVcard(RICH_CARD)[0]!));
  assert.equal(lines.filter((l) => l.startsWith("EMAIL")).length, 2);
  assert.equal(lines.filter((l) => l.startsWith("TEL")).length, 2);
  assert.equal(lines.filter((l) => l.startsWith("URL")).length, 2);
  assert.ok(lines.includes("EMAIL;TYPE=INTERNET,HOME:dana.reyes@fastmail.example"));
  assert.ok(lines.includes("TEL;TYPE=CELL:+1-512-555-0199"));
  assert.ok(lines.includes("URL:https://www.linkedin.example/in/danareyes"));
});

test("convenience accessors still describe the card", () => {
  const contact = parseVcard(RICH_CARD)[0]!;
  assert.equal(contact.displayName, "Dr. Dana Q. Reyes, PhD");
  assert.equal(contact.givenName, "Dana");
  assert.equal(contact.familyName, "Reyes");
  assert.equal(contact.organization, "Acme Corp");
  assert.equal(contact.email, "dana@acme.example");
  assert.equal(contact.phone, "+1-512-555-0143");
  assert.equal(contact.website, "https://acme.example");
  assert.equal(contact.hadExistingPhoto, false);
  assert.equal(contact.photoDataUrl, undefined);
});

test("X-ABShowAs is never invented for a person with an employer", () => {
  const person = contactToVcard({
    id: "1",
    displayName: "Dana Reyes",
    givenName: "Dana",
    familyName: "Reyes",
    organization: "Acme Corp",
    email: "dana@acme.example",
  });
  assert.equal(/X-ABShowAs/i.test(person), false);

  // Same for a person imported from a vCard.
  assert.equal(/X-ABShowAs/i.test(contactToVcard(parseVcard(RICH_CARD)[0]!)), false);
});

test("X-ABShowAs is emitted for a real business card", () => {
  const business = contactToVcard({
    id: "2",
    displayName: "FedEx",
    organization: "FedEx",
    email: "info@fedex.com",
  });
  assert.ok(business.includes("\r\nX-ABShowAs:COMPANY\r\n"));
});

test("a source card's own X-ABShowAs is preserved, not duplicated", () => {
  const company = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "FN:Acme Roofing Co",
    "ORG:Acme Roofing Co",
    "X-ABShowAs:COMPANY",
    "END:VCARD",
  ].join("\r\n");
  const out = logicalLines(contactToVcard(parseVcard(company)[0]!));
  assert.equal(out.filter((l) => l.toUpperCase().startsWith("X-ABSHOWAS")).length, 1);
  assert.ok(out.includes("X-ABShowAs:COMPANY"));
});

test("applying a logo replaces only the photo", () => {
  const contact = parseVcard(RICH_CARD)[0]!;
  const out = contactToVcard({ ...contact, photoDataUrl: PNG_1PX });
  const lines = logicalLines(out);
  assert.equal(lines.filter((l) => l.startsWith("PHOTO")).length, 1);
  assert.ok(lines.some((l) => l.startsWith("PHOTO;ENCODING=b;TYPE=PNG:")));
  for (const line of RICH_CARD_LINES) assert.ok(lines.includes(line), `lost ${line}`);

  const reparsed = parseVcard(out)[0]!;
  assert.equal(reparsed.photoDataUrl, PNG_1PX);
  assert.equal(reparsed.hadExistingPhoto, true);
});

test("an untouched photo is re-emitted byte for byte", () => {
  const card = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "FN:FedEx",
    "ORG:FedEx",
    `PHOTO;ENCODING=b;TYPE=PNG:${PNG_1PX.split(",")[1]}`,
    "END:VCARD",
  ].join("\r\n");
  const parsed = parseVcard(card)[0]!;
  assert.equal(parsed.photoDataUrl, PNG_1PX);
  assert.deepEqual(logicalLines(contactToVcard(parsed)), logicalLines(card));
});

test("svg photos are not written out under a PNG label", () => {
  const svg = "data:image/svg+xml;base64," + "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=";
  const out = contactToVcard({ id: "3", displayName: "Acme", organization: "Acme", photoDataUrl: svg });
  assert.equal(/TYPE=PNG/i.test(out), false);
  assert.ok(out.includes("PHOTO;VALUE=URI:data:image/svg+xml;base64,"));
  assert.equal(parseVcard(out)[0]?.photoDataUrl, svg);
});

test("vCard 4.0 cards keep their version and photo form", () => {
  const card = ["BEGIN:VCARD", "VERSION:4.0", "FN:Acme Ltd", "ORG:Acme Ltd", "END:VCARD"].join("\r\n");
  const out = contactToVcard({ ...parseVcard(card)[0]!, photoDataUrl: PNG_1PX });
  assert.ok(logicalLines(out).includes("VERSION:4.0"));
  assert.ok(logicalLines(out).includes(`PHOTO:${PNG_1PX}`));
});

test("folding stays under 75 octets and never splits a character", () => {
  const note = `NOTE:${"é".repeat(200)}`;
  const card = ["BEGIN:VCARD", "VERSION:3.0", "FN:Zoë Müller", note, "END:VCARD"].join("\r\n");
  const out = contactToVcard(parseVcard(card)[0]!);
  for (const line of out.split("\r\n")) assert.ok(octets(line) <= 75, `too long: ${octets(line)}`);
  assert.equal(out.includes("\uFFFD"), false);
  assert.deepEqual(logicalLines(out), logicalLines(card));
});

test("folding counts octets, not characters", () => {
  // 60 characters, 120 octets: short by JS length, over the limit on the wire.
  const card = ["BEGIN:VCARD", "VERSION:3.0", "FN:Zoë", `NOTE:${"é".repeat(56)}`, "END:VCARD"].join("\r\n");
  const out = contactToVcard(parseVcard(card)[0]!);
  for (const line of out.split("\r\n")) assert.ok(octets(line) <= 75, `too long: ${octets(line)}`);
  assert.deepEqual(logicalLines(out), logicalLines(card));
});

test("a long photo folds and unfolds losslessly", () => {
  const data = "A".repeat(4000);
  const contact = { id: "4", displayName: "Acme", photoDataUrl: `data:image/png;base64,${data}` };
  const out = contactToVcard(contact);
  for (const line of out.split("\r\n")) assert.ok(octets(line) <= 75);
  assert.equal(parseVcard(out)[0]?.photoDataUrl, `data:image/png;base64,${data}`);
});

test("escaped separators survive the round trip", () => {
  const contact = parseVcard(RICH_CARD)[0]!;
  const note = logicalLines(contactToVcard(contact)).find((l) => l.startsWith("NOTE:"));
  assert.equal(note, String.raw`NOTE:Prefers email\; call only in an emergency\, please.`);

  const literal = ["BEGIN:VCARD", "VERSION:3.0", String.raw`FN:C:\\Windows\;drive`, "END:VCARD"].join("\r\n");
  const parsed = parseVcard(literal)[0]!;
  assert.equal(parsed.displayName, "C:\\Windows;drive");
  assert.deepEqual(logicalLines(contactToVcard(parsed)), logicalLines(literal));
});

test("a colon inside a quoted parameter is not mistaken for the value", () => {
  const card = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "FN:Dana Reyes",
    'TEL;TYPE=WORK;X-LABEL="Front desk: reception":+1-512-555-0143',
    "END:VCARD",
  ].join("\r\n");
  const parsed = parseVcard(card)[0]!;
  assert.equal(parsed.phone, "+1-512-555-0143");
  assert.deepEqual(logicalLines(contactToVcard(parsed)), logicalLines(card));
});

test("edits to the modelled fields are written back in place", () => {
  const contact = parseVcard(RICH_CARD)[0]!;
  const out = logicalLines(contactToVcard({ ...contact, organization: "Acme Corporation" }));
  // Only the first ORG component changes; the department survives.
  assert.ok(out.includes("ORG:Acme Corporation;Field Services"));
  assert.equal(out.filter((l) => l.startsWith("ORG")).length, 1);
});

test("a card with no FN is kept and given one", () => {
  const card = ["BEGIN:VCARD", "VERSION:3.0", "N:Reyes;Dana;;;", "TEL:+1-512-555-0143", "END:VCARD"].join("\r\n");
  const parsed = parseVcard(card);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.displayName, "Dana Reyes");
  const out = logicalLines(contactToVcard(parsed[0]!));
  assert.ok(out.includes("N:Reyes;Dana;;;"));
  assert.ok(out.includes("TEL:+1-512-555-0143"));
  assert.ok(out.includes("FN:Dana Reyes"));
});

test("a full backup keeps every card and every line", () => {
  const second = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "FN:Acme Roofing Co",
    "ORG:Acme Roofing Co",
    "X-ABShowAs:COMPANY",
    "NOTE:Second card",
    "END:VCARD",
  ];
  const book = RICH_CARD + second.join("\r\n") + "\r\n";
  const contacts = parseVcard(book);
  assert.equal(contacts.length, 2);
  assert.deepEqual(logicalLines(contactsToVcard(contacts)), [...RICH_CARD_LINES, ...second]);
});

/**
 * "Download backup" is the promise the whole undo story rests on, so it must
 * re-emit the card it was given.  Export normalizes a bare website to
 * `https://` so synthesized cards stay clickable in Apple Contacts, and that
 * normalization used to leak onto cards that already carried their own
 * bare `URL:` line — rewriting a field nobody approved.
 */
test("a card's own bare URL is not rewritten by the backup export", () => {
  const lines = ["BEGIN:VCARD", "VERSION:3.0", "FN:Acme Roofing", "ORG:Acme Roofing", "URL:acme.example", "END:VCARD"];
  const contacts = parseVcard(lines.join("\r\n") + "\r\n");
  assert.equal(contacts[0]?.website, "acme.example");
  assert.deepEqual(logicalLines(contactsToVcard(contacts)), lines);
});

test("a website the app actually changed is written with a scheme", () => {
  const contacts = parseVcard(
    ["BEGIN:VCARD", "VERSION:3.0", "FN:Acme Roofing", "URL:old.example", "END:VCARD"].join("\r\n") + "\r\n",
  );
  contacts[0]!.website = "acme.example";
  assert.ok(
    logicalLines(contactsToVcard(contacts)).includes("URL:https://acme.example"),
    "a replaced website still gets normalized",
  );
});

test("a card with no URL at all gets a normalized one", () => {
  const card = contactToVcard({ id: "1", displayName: "FedEx", organization: "FedEx", website: "fedex.com" });
  assert.ok(logicalLines(card).includes("URL:https://fedex.com"));
});

// Mirrors "vcard round-trip keeps org and photo" in engine.test.ts, which this
// lane must not break.
test("synthesized cards still round-trip org and photo", () => {
  const card = contactToVcard({
    id: "1",
    displayName: "FedEx",
    organization: "FedEx",
    email: "x@fedex.com",
    photoDataUrl: PNG_1PX,
  });
  const parsed = parseVcard(card);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.organization, "FedEx");
  assert.equal(parsed[0]?.hadExistingPhoto, true);
});

/**
 * vCard 2.1 QUOTED-PRINTABLE soft line breaks (§2.1.3).  A continuation has no
 * leading whitespace and no property colon, so it looked like a malformed line
 * and was dropped: "Download backup" truncated the property and left the `=`
 * behind, which is malformed QP as well as lost data — the CL-01 failure mode
 * in a shape the original fix did not cover.
 */
const qpCard = (...body: string[]) =>
  ["BEGIN:VCARD", "VERSION:2.1", "FN:X", ...body, "END:VCARD"].join("\r\n") + "\r\n";

test("a quoted-printable soft line break round-trips", () => {
  const out = contactsToVcard(parseVcard(qpCard(
    "NOTE;ENCODING=QUOTED-PRINTABLE:First half=",
    "and the second half",
  )));
  assert.match(out, /First halfand the second half/);
  // Emitted whole: RFC 6350 whitespace folding is not how 2.1 continues a QP
  // value, so folding it would splice spaces into the content.
  assert.ok(!/\r\n[ \t]/.test(out), "a QP value must not be whitespace-folded");
});

test("consecutive soft line breaks all join", () => {
  const out = contactsToVcard(parseVcard(qpCard(
    "NOTE;ENCODING=QUOTED-PRINTABLE:one=", "two=", "three",
  )));
  assert.match(out, /onetwothree/);
});

test("a leading space in a quoted-printable continuation is content, not a fold", () => {
  const out = contactsToVcard(parseVcard(qpCard("NOTE;ENCODING=QUOTED-PRINTABLE:a=", " b")));
  assert.match(out, /a b/);
});

test("base64 padding is not mistaken for a soft line break", () => {
  // The reason the join is gated on ENCODING=QUOTED-PRINTABLE rather than on a
  // trailing "=": base64 padding ends with one, and joining on the character
  // alone splices the next property into the photo.
  const out = contactsToVcard(parseVcard(qpCard(
    "PHOTO;ENCODING=BASE64:iVBORw0KGgoAAAANSUhEUg==",
    "TEL:+15125550100",
  )));
  assert.match(out, /\+15125550100/);
  assert.match(out, /iVBORw0KGgoAAAANSUhEUg==/);
});

test("a dangling = before END:VCARD does not swallow the card boundary", () => {
  // Exactly what the old truncating export produced, so the parser has to
  // survive reading its own bad output.
  const out = contactsToVcard(parseVcard(qpCard("NOTE;ENCODING=QUOTED-PRINTABLE:dangling=")));
  assert.match(out, /END:VCARD/);
  assert.equal(out.split("BEGIN:VCARD").length, 2);
});
