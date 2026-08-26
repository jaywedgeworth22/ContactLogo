import type { BookContact } from "./classify.ts";

function unescapeVcard(value: string): string {
  return value.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

function escapeVcard(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
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

export function parseVcard(text: string): BookContact[] {
  const lines = unfold(text);
  const contacts: BookContact[] = [];
  let current: Partial<BookContact> & { showAsCompany?: boolean } | null = null;
  let currentRawLines: string[] = [];

  const flush = () => {
    if (!current) return;
    const assembled = [current.givenName, current.familyName].filter(Boolean).join(" ").trim();
    const name = current.displayName || current.organization || assembled;
    if (!name) {
      current = null;
      currentRawLines = [];
      return;
    }
    contacts.push({
      id: newId(),
      displayName: name,
      givenName: current.givenName,
      familyName: current.familyName,
      organization: current.organization,
      email: current.email,
      phone: current.phone,
      website: current.website,
      photoDataUrl: current.photoDataUrl,
      hadExistingPhoto: Boolean(current.hadExistingPhoto || current.photoDataUrl),
      rawVcard: currentRawLines.join("\r\n") + "\r\n",
    });
    current = null;
    currentRawLines = [];
  };

  for (const line of lines) {
    if (!line) continue;
    const upper = line.toUpperCase();
    if (upper === "BEGIN:VCARD") {
      current = {};
      currentRawLines = [line];
      continue;
    }
    if (upper === "END:VCARD") {
      if (currentRawLines.length) currentRawLines.push(line);
      flush();
      continue;
    }
    if (!current) continue;
    currentRawLines.push(line);
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const left = line.slice(0, colon);
    const value = unescapeVcard(line.slice(colon + 1));
    const name = left.split(";")[0]?.replace(/^item\d+\./i, "").toUpperCase() ?? "";
    if (name === "FN" && value.trim()) current.displayName = value.trim();
    else if (name === "N") {
      const parts = value.split(";");
      const family = parts[0]?.trim();
      const given = parts[1]?.trim();
      if (family) current.familyName = family;
      if (given) current.givenName = given;
      if (!current.displayName) {
        const assembled = [given, family].filter(Boolean).join(" ").trim();
        if (assembled) current.displayName = assembled;
      }
    } else if (name === "ORG" && value.trim()) current.organization = value.split(";")[0]?.trim();
    else if (name === "EMAIL" && !current.email && value.trim()) current.email = value.trim();
    else if (name === "TEL" && !current.phone && value.trim()) current.phone = value.trim();
    else if (name === "URL" && !current.website && value.trim()) current.website = value.trim();
    else if (name === "PHOTO") {
      current.hadExistingPhoto = true;
      if (!current.photoDataUrl) current.photoDataUrl = parsePhoto(left, value);
    }
  }
  flush();
  return contacts;
}

function foldLine(line: string): string {
  if (line.length <= 73) return line;
  const chunks = [line.slice(0, 73)];
  let remaining = line.slice(73);
  while (remaining.length > 72) {
    chunks.push(" " + remaining.slice(0, 72));
    remaining = remaining.slice(72);
  }
  if (remaining) chunks.push(" " + remaining);
  return chunks.join("\r\n");
}

function photoBase64(dataUrl: string): { type: string; data: string } | null {
  const match = /^data:image\/(jpeg|jpg|png|webp|gif|svg\+xml);base64,(.+)$/i.exec(dataUrl);
  if (!match) return null;
  const raw = match[1].toLowerCase();
  const type = raw === "jpg" || raw === "jpeg" ? "JPEG" : raw === "svg+xml" ? "PNG" : raw.toUpperCase();
  return { type, data: match[2].replace(/\s+/g, "") };
}

export function contactToVcard(contact: BookContact): string {
  if (contact.rawVcard) {
    const rawLines = unfold(contact.rawVcard);
    const photo = contact.photoDataUrl ? photoBase64(contact.photoDataUrl) : null;
    let isVCard4 = false;
    for (const line of rawLines) {
      if (/^VERSION:\s*4(\.0)?/i.test(line.trim())) {
        isVCard4 = true;
        break;
      }
    }
    const outputLines: string[] = [];
    for (const line of rawLines) {
      if (!line) continue;
      const upper = line.toUpperCase();
      const colon = upper.indexOf(":");
      const name = colon >= 0 ? upper.slice(0, colon).split(";")[0]?.replace(/^ITEM\d+\./i, "") ?? "" : "";
      if (name === "PHOTO") {
        continue;
      }
      if (upper === "END:VCARD") {
        if (contact.photoDataUrl) {
          if (isVCard4) {
            outputLines.push(foldLine(`PHOTO:${contact.photoDataUrl}`));
          } else if (photo) {
            outputLines.push(foldLine(`PHOTO;ENCODING=b;TYPE=${photo.type}:${photo.data}`));
          }
        }
        outputLines.push(line);
        continue;
      }
      outputLines.push(line);
    }
    return outputLines.join("\r\n") + "\r\n";
  }

  const lines = ["BEGIN:VCARD", "VERSION:3.0"];
  lines.push(`FN:${escapeVcard(contact.displayName)}`);
  if (contact.givenName || contact.familyName) {
    lines.push(`N:${escapeVcard(contact.familyName ?? "")};${escapeVcard(contact.givenName ?? "")};;;`);
  }
  if (contact.organization) {
    lines.push(`ORG:${escapeVcard(contact.organization)}`);
    lines.push("X-ABShowAs:COMPANY");
  }
  if (contact.email) lines.push(`EMAIL;TYPE=INTERNET:${escapeVcard(contact.email)}`);
  if (contact.phone) lines.push(`TEL;TYPE=WORK,VOICE:${escapeVcard(contact.phone)}`);
  if (contact.website) {
    const url = contact.website.includes("://") ? contact.website : `https://${contact.website}`;
    lines.push(`URL:${escapeVcard(url)}`);
  }
  if (contact.photoDataUrl) {
    const photo = photoBase64(contact.photoDataUrl);
    if (photo) lines.push(foldLine(`PHOTO;ENCODING=b;TYPE=${photo.type}:${photo.data}`));
  }
  lines.push("END:VCARD");
  return lines.join("\r\n") + "\r\n";
}

export function contactsToVcard(contacts: BookContact[]): string {
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
