import { classifyContact, type BookContact } from "./classify.ts";

/**
 * One content line of a source vCard, kept verbatim so export can re-emit it.
 * VISION.md: the address book is the user's, not ours — anything we do not
 * model is still written back exactly as it arrived.
 */
export type VcardProperty = {
  /** Upper-case property name with any `item1.` group prefix removed. */
  name: string;
  /** Everything left of the value colon, exactly as written (group, name, parameters). */
  prefix: string;
  /** Parameter text after the property name, e.g. `;TYPE=WORK,VOICE` (may be empty). */
  params: string;
  /** Value exactly as written on the wire: unfolded, still escaped. */
  value: string;
};

/** The card a contact was parsed from, retained so nothing is lost on export. */
export type VcardRecord = {
  /** VERSION value of the source card, e.g. "3.0". */
  version: string;
  /** Every content line between BEGIN and END, in source order, including VERSION. */
  properties: VcardProperty[];
};

/** A BookContact that still carries the vCard it came from. */
export type VcardContact = BookContact & { vcard?: VcardRecord };

const RASTER_PHOTO_TYPE: Record<string, string> = {
  jpeg: "JPEG",
  jpg: "JPEG",
  png: "PNG",
  gif: "GIF",
  webp: "WEBP",
  tiff: "TIFF",
  bmp: "BMP",
};

const encoder = new TextEncoder();

function octets(text: string): number {
  return encoder.encode(text).length;
}

function isAscii(text: string): boolean {
  return !/[^\x00-\x7F]/.test(text);
}

/** Single pass so `\\n` stays a literal backslash followed by an `n`. */
function unescapeVcard(value: string): string {
  return value.replace(/\\([\s\S])/g, (_match, ch: string) => (ch === "n" || ch === "N" ? "\n" : ch));
}

function escapeVcard(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

/** Split a structured value on separators the producer did not escape. */
function splitComponents(value: string): string[] {
  const parts: string[] = [];
  let buffer = "";
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]!;
    if (ch === "\\" && i + 1 < value.length) {
      buffer += ch + value[i + 1];
      i += 1;
    } else if (ch === ";") {
      parts.push(buffer);
      buffer = "";
    } else {
      buffer += ch;
    }
  }
  parts.push(buffer);
  return parts;
}

function unfold(text: string): string[] {
  const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const lines: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

/** First colon that is not inside a quoted parameter value. */
function splitLine(line: string): { prefix: string; value: string } | null {
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === ":" && !quoted) return { prefix: line.slice(0, i), value: line.slice(i + 1) };
  }
  return null;
}

function splitPrefix(prefix: string): { name: string; params: string } {
  let quoted = false;
  let semi = -1;
  for (let i = 0; i < prefix.length; i += 1) {
    const ch = prefix[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === ";" && !quoted) {
      semi = i;
      break;
    }
  }
  const head = semi < 0 ? prefix : prefix.slice(0, semi);
  const params = semi < 0 ? "" : prefix.slice(semi);
  const dot = head.indexOf(".");
  const name = (dot > 0 ? head.slice(dot + 1) : head).trim().toUpperCase();
  return { name, params };
}

function property(prefix: string, value: string): VcardProperty {
  const { name, params } = splitPrefix(prefix);
  return { name, prefix, params, value };
}

function parsePhoto(params: string, value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("data:image/")) return trimmed;
  const typeMatch = /TYPE=([A-Za-z0-9+-]+)/i.exec(params);
  const rawType = (typeMatch?.[1] ?? "jpeg").toLowerCase();
  const mime =
    rawType === "jpg" || rawType === "jpeg"
      ? "jpeg"
      : rawType === "png"
        ? "png"
        : rawType === "webp"
          ? "webp"
          : rawType.includes("svg")
            ? "svg+xml"
            : "jpeg";
  const data = trimmed.replace(/\s+/g, "");
  if (data.length < 40) return undefined;
  return `data:image/${mime};base64,${data}`;
}

function newId(): string {
  return crypto.randomUUID();
}

function firstValued(properties: VcardProperty[], name: string): VcardProperty | undefined {
  return properties.find((p) => p.name === name && p.value.trim() !== "");
}

function plain(properties: VcardProperty[], name: string): string | undefined {
  const found = firstValued(properties, name);
  if (!found) return undefined;
  const text = unescapeVcard(found.value).trim();
  return text || undefined;
}

function component(properties: VcardProperty[], name: string, index: number): string | undefined {
  const found = firstValued(properties, name);
  if (!found) return undefined;
  const text = unescapeVcard(splitComponents(found.value)[index] ?? "").trim();
  return text || undefined;
}

function buildContact(properties: VcardProperty[]): VcardContact | null {
  const version = plain(properties, "VERSION") ?? "3.0";
  const displayName = plain(properties, "FN");
  const familyName = component(properties, "N", 0);
  const givenName = component(properties, "N", 1);
  const organization = component(properties, "ORG", 0);
  const email = plain(properties, "EMAIL");
  const phone = plain(properties, "TEL");
  const website = plain(properties, "URL");
  const photoLines = properties.filter((p) => p.name === "PHOTO");
  let photoDataUrl: string | undefined;
  for (const line of photoLines) {
    photoDataUrl = parsePhoto(line.params, line.value);
    if (photoDataUrl) break;
  }

  const assembled = [givenName, familyName].filter(Boolean).join(" ").trim();
  const name = displayName || assembled || organization || email || phone;
  if (!name) return null;

  return {
    id: newId(),
    displayName: name,
    givenName,
    familyName,
    organization,
    email,
    phone,
    website,
    photoDataUrl,
    hadExistingPhoto: photoLines.length > 0,
    vcard: { version, properties },
  };
}

export function parseVcard(text: string): VcardContact[] {
  const contacts: VcardContact[] = [];
  let properties: VcardProperty[] | null = null;

  for (const line of unfold(text)) {
    if (!line.trim()) continue;
    const upper = line.trim().toUpperCase();
    if (upper === "BEGIN:VCARD") {
      properties = [];
      continue;
    }
    if (upper === "END:VCARD") {
      if (properties) {
        const contact = buildContact(properties);
        if (contact) contacts.push(contact);
      }
      properties = null;
      continue;
    }
    if (!properties) continue;
    const split = splitLine(line);
    if (!split) continue;
    const { name, params } = splitPrefix(split.prefix);
    if (!name) continue;
    properties.push({ name, prefix: split.prefix, params, value: split.value });
  }

  return contacts;
}

/**
 * RFC 6350 §3.2: fold at 75 octets, never inside a character.  Continuation
 * lines spend one octet on their leading space.
 */
function foldLine(line: string): string {
  if (isAscii(line)) {
    if (line.length <= 75) return line;
    const chunks = [line.slice(0, 75)];
    let rest = line.slice(75);
    while (rest.length > 74) {
      chunks.push(rest.slice(0, 74));
      rest = rest.slice(74);
    }
    if (rest) chunks.push(rest);
    return chunks.join("\r\n ");
  }
  const chunks: string[] = [];
  let current = "";
  let used = 0;
  let limit = 75;
  for (const ch of line) {
    const size = ch.codePointAt(0)! < 0x80 ? 1 : octets(ch);
    if (used + size > limit) {
      chunks.push(current);
      current = "";
      used = 0;
      limit = 74;
    }
    current += ch;
    used += size;
  }
  if (current) chunks.push(current);
  return chunks.join("\r\n ");
}

function photoProperty(dataUrl: string, version: string): VcardProperty | null {
  const match = /^data:image\/([a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(dataUrl.trim());
  if (!match) return null;
  const subtype = match[1]!.toLowerCase();
  const data = match[2]!.replace(/\s+/g, "");
  if (!data) return null;
  if (version.startsWith("4")) return property("PHOTO", `data:image/${subtype};base64,${data}`);
  const type = RASTER_PHOTO_TYPE[subtype];
  // vCard 3.0 TYPE is a raster image subtype.  SVG has no honest TYPE here, so
  // it goes out as a URI rather than being mislabelled as PNG.
  if (!type) return property("PHOTO;VALUE=URI", `data:image/${subtype};base64,${data}`);
  return property(`PHOTO;ENCODING=b;TYPE=${type}`, data);
}

function sameName(a: string | undefined, b: string | undefined): boolean {
  const left = (a ?? "").trim().toLowerCase();
  const right = (b ?? "").trim().toLowerCase();
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

/**
 * CL-02 / VISION.md: a person with an employer is still a person.  Only a card
 * that is the company — no personal name, and a display name that is the
 * organization — may be shown as a company in Apple Contacts.
 */
function showsAsCompany(contact: BookContact): boolean {
  if (!contact.organization?.trim()) return false;
  if (contact.givenName?.trim() || contact.familyName?.trim()) return false;
  if (classifyContact(contact) !== "businessCard") return false;
  return sameName(contact.displayName, contact.organization);
}

function normalizedWebsite(website: string): string {
  return website.includes("://") ? website : `https://${website}`;
}

/** Update a modelled value in place, without ever blanking a line the card had. */
function updateFlat(
  properties: VcardProperty[],
  name: string,
  next: string | undefined,
  template: string,
): void {
  const trimmed = next?.trim();
  if (!trimmed) return;
  const index = properties.findIndex((p) => p.name === name && p.value.trim() !== "");
  if (index < 0) {
    properties.push(property(template, escapeVcard(trimmed)));
    return;
  }
  if (unescapeVcard(properties[index]!.value).trim() === trimmed) return;
  properties[index] = { ...properties[index]!, value: escapeVcard(trimmed) };
}

/** Same, for one component of a structured value; the other components survive. */
function updateComponents(
  properties: VcardProperty[],
  name: string,
  updates: Array<{ index: number; value: string | undefined }>,
  template: string,
  width: number,
): void {
  const wanted = updates.filter((u) => Boolean(u.value?.trim()));
  if (wanted.length === 0) return;
  const index = properties.findIndex((p) => p.name === name);
  if (index < 0) {
    const components = new Array<string>(width).fill("");
    for (const update of wanted) components[update.index] = escapeVcard(update.value!.trim());
    properties.push(property(template, components.join(";")));
    return;
  }
  const components = splitComponents(properties[index]!.value);
  let changed = false;
  for (const update of wanted) {
    while (components.length <= update.index) components.push("");
    const current = unescapeVcard(components[update.index] ?? "").trim();
    const next = update.value!.trim();
    if (current === next) continue;
    components[update.index] = escapeVcard(next);
    changed = true;
  }
  if (changed) properties[index] = { ...properties[index]!, value: components.join(";") };
}

function applyPhoto(properties: VcardProperty[], contact: VcardContact, version: string): void {
  const next = contact.photoDataUrl;
  if (!next) return;
  const index = properties.findIndex((p) => p.name === "PHOTO");
  if (index >= 0) {
    const current = parsePhoto(properties[index]!.params, properties[index]!.value);
    if (current === next) return; // untouched: re-emit the card's own bytes
  }
  const line = photoProperty(next, version);
  if (!line) return; // unrecognized source (e.g. a remote URL): keep what the card had
  if (index < 0) {
    properties.push(line);
    return;
  }
  properties[index] = line;
  // The applied logo replaces the card's image, so any further PHOTO lines it
  // supersedes go with it.  Everything else on the card is left alone.
  for (let i = properties.length - 1; i > index; i -= 1) {
    if (properties[i]!.name === "PHOTO") properties.splice(i, 1);
  }
}

/** Re-emit the source card, with only the fields the app can change updated. */
function rewriteProperties(record: VcardRecord, contact: VcardContact): VcardProperty[] {
  const properties = record.properties.map((p) => ({ ...p }));
  updateFlat(properties, "FN", contact.displayName, "FN");
  updateComponents(
    properties,
    "N",
    [
      { index: 0, value: contact.familyName },
      { index: 1, value: contact.givenName },
    ],
    "N",
    5,
  );
  updateComponents(properties, "ORG", [{ index: 0, value: contact.organization }], "ORG", 1);
  updateFlat(properties, "EMAIL", contact.email, "EMAIL;TYPE=INTERNET");
  updateFlat(properties, "TEL", contact.phone, "TEL;TYPE=WORK,VOICE");
  updateFlat(
    properties,
    "URL",
    contact.website ? normalizedWebsite(contact.website) : undefined,
    "URL",
  );
  applyPhoto(properties, contact, record.version);
  return properties;
}

/** Build a card for a contact that never came from a vCard (CSV, Google, device). */
function synthesizeProperties(contact: BookContact): VcardProperty[] {
  const properties: VcardProperty[] = [];
  properties.push(property("FN", escapeVcard(contact.displayName)));
  if (contact.givenName || contact.familyName) {
    properties.push(
      property("N", `${escapeVcard(contact.familyName ?? "")};${escapeVcard(contact.givenName ?? "")};;;`),
    );
  }
  if (contact.organization) {
    properties.push(property("ORG", escapeVcard(contact.organization)));
    if (showsAsCompany(contact)) properties.push(property("X-ABShowAs", "COMPANY"));
  }
  if (contact.email) properties.push(property("EMAIL;TYPE=INTERNET", escapeVcard(contact.email)));
  if (contact.phone) properties.push(property("TEL;TYPE=WORK,VOICE", escapeVcard(contact.phone)));
  if (contact.website) {
    properties.push(property("URL", escapeVcard(normalizedWebsite(contact.website))));
  }
  if (contact.photoDataUrl) {
    const photo = photoProperty(contact.photoDataUrl, "3.0");
    if (photo) properties.push(photo);
  }
  return properties;
}

export function contactToVcard(contact: VcardContact): string {
  const record = contact.vcard;
  const properties = record ? rewriteProperties(record, contact) : synthesizeProperties(contact);
  const lines = ["BEGIN:VCARD"];
  if (!properties.some((p) => p.name === "VERSION")) lines.push(`VERSION:${record?.version ?? "3.0"}`);
  for (const p of properties) lines.push(foldLine(`${p.prefix}:${p.value}`));
  lines.push("END:VCARD");
  return lines.join("\r\n") + "\r\n";
}

export function contactsToVcard(contacts: VcardContact[]): string {
  return contacts.map(contactToVcard).join("");
}

export function downloadText(filename: string, contents: string, type: string) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function backupFilename(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `contactlogo-backup-${y}${m}${d}.vcf`;
}
