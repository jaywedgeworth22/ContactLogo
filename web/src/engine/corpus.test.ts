import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { matchContact } from "./match.ts";
import { staticCeiling } from "./match.ts";
import { simpleIconsSlug } from "./logos.ts";
import type { BookContact } from "./classify.ts";

/**
 * ENGINE-CONTRACT R14.2 — the golden corpus is the one artefact all three
 * engines are measured against.  It ran only in the Android suite until now,
 * which is how R10.1b shipped to two engines out of three: nothing was checking
 * the other two.  This is the web half.
 *
 * R14.1: static path only — no network, no image fetch, no clock.  The corpus's
 * `maxConfidence` is the STATIC ceiling, not the final tier, so this compares
 * against `staticCeiling` rather than `ReviewItem.confidence`, which is
 * min(ceiling, assetTier) and needs a candidate list.
 *
 * R14.3: a case this engine cannot satisfy fails loudly here.  Do not skip it,
 * do not delete it, and do not edit the corpus to match the code — the corpus
 * encodes the rulebook, and a disagreement means one of the three engines is
 * wrong.
 */

type CorpusCase = {
  id: string;
  contact: {
    displayName: string | null;
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
  rule?: string;
  why?: string;
};

const here = dirname(fileURLToPath(import.meta.url));
const corpusPath = join(here, "..", "..", "..", "fixtures", "golden-corpus.json");
const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as { cases: CorpusCase[] };

function toBookContact(c: CorpusCase["contact"]): BookContact {
  return {
    id: "corpus",
    displayName: c.displayName ?? "",
    givenName: c.givenName ?? undefined,
    familyName: c.familyName ?? undefined,
    organization: c.organization ?? undefined,
    emails: c.emails,
    websites: c.websites,
    phones: c.phones,
    hadExistingPhoto: c.hasImage,
  };
}

test("golden corpus conformance", () => {
  assert.ok(corpus.cases.length > 0, "expected the golden corpus to contain cases");

  const failures: string[] = [];

  for (const kase of corpus.cases) {
    const item = matchContact(toBookContact(kase.contact));
    const mismatches: string[] = [];

    if (item.contactClass !== kase.expect.class) {
      mismatches.push(`class: got ${item.contactClass} want ${kase.expect.class}`);
    }

    // R7.6 — the engine uses "" where the corpus says null: no query at all.
    const query = item.query === "" ? null : item.query;
    if (query !== kase.expect.query) {
      mismatches.push(`query: got ${JSON.stringify(query)} want ${JSON.stringify(kase.expect.query)}`);
    }

    const domain = item.domain ?? null;
    if (domain !== kase.expect.domain) {
      mismatches.push(`domain: got ${JSON.stringify(domain)} want ${JSON.stringify(kase.expect.domain)}`);
    }

    const via = item.via ?? null;
    if (via !== kase.expect.via) {
      mismatches.push(`via: got ${JSON.stringify(via)} want ${JSON.stringify(kase.expect.via)}`);
    }

    const ceiling = staticCeiling(item);
    if (ceiling !== kase.expect.maxConfidence) {
      mismatches.push(`maxConfidence: got ${ceiling} want ${kase.expect.maxConfidence}`);
    }

    // R14.1 — flags compared as a set; order is R12's business, not the corpus's.
    const got = [...new Set(item.flags)].sort();
    const want = [...new Set(kase.expect.flags)].sort();
    if (got.join(",") !== want.join(",")) {
      mismatches.push(`flags: got [${got}] want [${want}]`);
    }

    if ("simpleIconsSlug" in kase.expect) {
      const wantSlug = kase.expect.simpleIconsSlug ?? null;
      const gotSlug = domain ? simpleIconsSlug(domain) ?? null : null;
      if (gotSlug !== wantSlug) {
        mismatches.push(`simpleIconsSlug: got ${JSON.stringify(gotSlug)} want ${JSON.stringify(wantSlug)}`);
      }
    }

    if (mismatches.length > 0) {
      failures.push(`${kase.id}:\n    ${mismatches.join("\n    ")}`);
    }
  }

  assert.equal(
    failures.length,
    0,
    `${failures.length}/${corpus.cases.length} golden-corpus cases failed:\n\n${failures.join("\n\n")}`,
  );
});
