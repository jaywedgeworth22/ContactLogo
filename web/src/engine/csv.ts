import type { BookContact } from "./classify.ts";

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  while (i < src.length) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  row.push(field);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

function col(header: string[], row: string[], ...names: string[]): string | undefined {
  const lower = header.map((h) => h.trim().toLowerCase());
  for (const name of names) {
    const idx = lower.indexOf(name.toLowerCase());
    if (idx >= 0 && row[idx]?.trim()) return row[idx]!.trim();
  }
  for (const name of names) {
    const idx = lower.findIndex((h) => h.startsWith(name.toLowerCase()));
    if (idx >= 0 && row[idx]?.trim()) return row[idx]!.trim();
  }
  return undefined;
}

function allCols(header: string[], row: string[], patterns: RegExp[]): string[] {
  const values: string[] = [];
  const seen = new Set<string>();
  for (let idx = 0; idx < header.length; idx++) {
    const h = header[idx]?.trim() ?? "";
    if (!h) continue;
    for (const pat of patterns) {
      if (pat.test(h)) {
        const val = row[idx]?.trim();
        if (val && !seen.has(val)) {
          seen.add(val);
          values.push(val);
        }
        break;
      }
    }
  }
  return values;
}

export function looksLikeContactCsv(text: string): boolean {
  const first = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0]?.toLowerCase() ?? "";
  return (
    first.includes("given name") ||
    first.includes("family name") ||
    first.includes("e-mail") ||
    first.includes("email") ||
    first.includes("organization") ||
    first.includes("phone 1")
  );
}

export function parseGoogleCsv(text: string): BookContact[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0] ?? [];
  const out: BookContact[] = [];
  for (const row of rows.slice(1)) {
    const given = col(header, row, "Given Name", "First Name");
    const family = col(header, row, "Family Name", "Last Name");
    const name =
      col(header, row, "Name") ||
      [given, family].filter(Boolean).join(" ").trim() ||
      col(header, row, "Organization Name", "Organization");
    if (!name) continue;

    const emails = allCols(header, row, [
      /^e-?mail(\s*\d+)?\s*-\s*value$/i,
      /^e-?mail(\s*\d+)?\s*address$/i,
      /^e-?mail$/i,
    ]);
    const phones = allCols(header, row, [
      /^phone(\s*\d+)?\s*-\s*value$/i,
      /^(mobile|home|business|work|primary|other)?\s*phone(\s*\d+)?$/i,
      /^phone$/i,
    ]);
    const websites = allCols(header, row, [
      /^website(\s*\d+)?\s*-\s*value$/i,
      /^web\s*page(\s*\d+)?$/i,
      /^website(\s*\d+)?$/i,
      /^url(\s*\d+)?$/i,
    ]);
    const primaryEmail = emails[0] ?? col(header, row, "E-mail 1 - Value", "E-mail Address", "Email", "Email Address");
    const primaryPhone = phones[0] ?? col(header, row, "Phone 1 - Value", "Mobile Phone", "Phone", "Home Phone", "Business Phone");
    const primaryWebsite = websites[0] ?? col(header, row, "Website 1 - Value", "Web Page", "Website");

    out.push({
      id: crypto.randomUUID(),
      displayName: name,
      givenName: given,
      familyName: family,
      organization: col(header, row, "Organization Name", "Organization", "Company"),
      email: primaryEmail,
      phone: primaryPhone,
      website: primaryWebsite,
      emails: emails.length > 0 ? emails : undefined,
      phones: phones.length > 0 ? phones : undefined,
      websites: websites.length > 0 ? websites : undefined,
      hadExistingPhoto: Boolean(col(header, row, "Photo", "Photo 1")),
    });
  }
  return out;
}
