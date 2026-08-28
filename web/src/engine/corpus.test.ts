import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  analyzeContact,
  resolveIdentity,
  type BookContact,
  type IdentityVia,
} from "./classify.ts";
import { simpleIconsSlug } from "./logos.ts";
import { staticCeiling } from "./match.ts";
import { passesSimilarity } from "./normalize.ts";

type CorpusCase = {
  id: string;
  contact: {
    displayName: string;
    givenName: string | null;
    familyName: string | null;
    organization: string | null;
    emails: string[];
    websites: string[];
    phones: string[];
    hasImage: boolean;
  };
  expect: {
    class: string;
    query: string | null;
    domain: string | null;
    via: string | null;
    maxConfidence: string;
    flags: string[];
    simpleIconsSlug?: string | null;
  };
};

function loadCorpus(): CorpusCase[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, "../../../fixtures/golden-corpus.json");
  const root = JSON.parse(readFileSync(path, "utf8")) as { cases: CorpusCase[] };
  return root.cases;
}

function toContact(c: CorpusCase["contact"]): BookContact {
  return {
    id: "corpus",
    displayName: c.displayName,
    givenName: c.givenName ?? undefined,
    familyName: c.familyName ?? undefined,
    organization: c.organization ?? undefined,
    emails: c.emails,
    websites: c.websites,
    phones: c.phones,
    hadExistingPhoto: c.hasImage,
  };
}

function staticEval(contact: BookContact) {
  const analysis = analyzeContact(contact);
  if (analysis.contactClass !== "businessCard") {
    return {
      contactClass: analysis.contactClass,
      query: analysis.query || null,
      domain: null as string | null,
      via: null as IdentityVia | null,
      maxConfidence: "skip" as const,
      flags: new Set(analysis.flags),
    };
  }
  const identity = resolveIdentity(contact, analysis.query);
  const flags = [...analysis.flags, ...(identity?.flags ?? [])];
  if (identity) {
    flags.push(`via-${identity.via}`);
    if (identity.via === "guess") flags.push("guessed-domain");
    if (
      identity.via === "email" &&
      !passesSimilarity(analysis.query, identity.domain.replace(/\.[^.]+$/, ""))
    ) {
      flags.push("email-domain-unrelated");
    }
  } else {
    flags.push("no-identity");
  }
  if (contact.hadExistingPhoto) flags.push("replace-existing");
  return {
    contactClass: analysis.contactClass,
    query: analysis.query || null,
    domain: identity?.domain ?? null,
    via: identity?.via ?? null,
    maxConfidence: staticCeiling({
      contactClass: "businessCard",
      via: identity?.via,
      flags,
    }),
    flags: new Set(flags),
  };
}

test("golden corpus: static path agrees on every case", () => {
  const cases = loadCorpus();
  assert.ok(cases.length > 0, "expected the golden corpus to contain cases");
  const failures: string[] = [];

  for (const item of cases) {
    const result = staticEval(toContact(item.contact));
    const mismatches: string[] = [];
    if (result.contactClass !== item.expect.class) {
      mismatches.push(`class: got ${result.contactClass} want ${item.expect.class}`);
    }
    if (result.query !== item.expect.query) {
      mismatches.push(`query: got ${result.query} want ${item.expect.query}`);
    }
    if (result.domain !== item.expect.domain) {
      mismatches.push(`domain: got ${result.domain} want ${item.expect.domain}`);
    }
    if (result.via !== item.expect.via) {
      mismatches.push(`via: got ${result.via} want ${item.expect.via}`);
    }
    if (result.maxConfidence !== item.expect.maxConfidence) {
      mismatches.push(
        `maxConfidence: got ${result.maxConfidence} want ${item.expect.maxConfidence}`,
      );
    }
    const expectedFlags = new Set(item.expect.flags);
    if (
      result.flags.size !== expectedFlags.size ||
      [...expectedFlags].some((flag) => !result.flags.has(flag))
    ) {
      mismatches.push(
        `flags: got ${[...result.flags].sort().join(",")} want ${[...expectedFlags].sort().join(",")}`,
      );
    }
    if ("simpleIconsSlug" in item.expect) {
      const actualSlug = result.domain ? (simpleIconsSlug(result.domain) ?? null) : null;
      if (actualSlug !== item.expect.simpleIconsSlug) {
        mismatches.push(
          `simpleIconsSlug: got ${actualSlug} want ${item.expect.simpleIconsSlug}`,
        );
      }
    }
    if (mismatches.length) failures.push(`${item.id}:\n    ${mismatches.join("\n    ")}`);
  }

  assert.equal(failures.length, 0, `${failures.length}/${cases.length} failed:\n\n${failures.join("\n\n")}`);
});
