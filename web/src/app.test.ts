import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BookContact } from "./engine/classify.ts";
import type { LogoHit } from "./engine/logos.ts";
import type { ReviewItem } from "./engine/match.ts";
import {
  GUESSED_DOMAIN_NOTE,
  badgeText,
  filterItems,
  humanFlagPhrases,
  isExhaustedItem,
  isNonBrandItem,
  itemMatchesFilter,
  itemMatchesQuery,
  metaLine,
  partitionSections,
  trimViewCache,
  removeCandidate,
  skippedNotice,
  visibleSlice,
} from "./app.ts";

function contact(over: Partial<BookContact> = {}): BookContact {
  return { id: "c1", displayName: "Walgreens", ...over };
}

function hit(over: Partial<LogoHit> = {}): LogoHit {
  return { src: "https://cdn.example/a.png", source: "brandfetch", kind: "icon", ...over };
}

function item(over: Partial<ReviewItem> = {}): ReviewItem {
  return {
    contact: contact(),
    contactClass: "businessCard",
    query: "Walgreens",
    domain: "walgreens.com",
    via: "catalog",
    candidates: [hit()],
    confidence: "high",
    flags: [],
    selected: true,
    chosenIndex: 0,
    ...over,
  };
}

test("no raw engine flag or via identifier reaches the metadata line", () => {
  const line = metaLine(
    item({
      via: "guess",
      confidence: "medium",
      flags: ["homonym-risk", "via-guess", "guessed-domain"],
    }),
  );
  assert.equal(line, "Brandfetch (HD) · guessed from name · name is also a common word");
  for (const raw of ["homonym-risk", "via-guess", "guessed-domain", "medium"]) {
    assert.ok(!line.includes(raw), `leaked ${raw}`);
  }
});

test("only user-relevant flags are phrased; the rest are dropped", () => {
  assert.deepEqual(humanFlagPhrases(["via-catalog", "person", "photo-protected"]), []);
  assert.deepEqual(humanFlagPhrases(["brand-tail", "replace-existing", "brand-tail"]), [
    "matched a partial name",
    "replaces an existing photo",
  ]);
});

test("an unknown via value is suppressed rather than printed", () => {
  const line = metaLine(item({ via: "sidechannel" as ReviewItem["via"], flags: [] }));
  assert.equal(line, "Brandfetch (HD)");
});

test("badge copy matches the tier, and skip has no badge", () => {
  assert.equal(badgeText("high"), "High confidence");
  assert.equal(badgeText("medium"), "Needs a look");
  assert.equal(badgeText("low"), "Low confidence");
  assert.equal(badgeText("skip"), undefined);
  assert.equal(GUESSED_DOMAIN_NOTE, "Domain guessed — check before applying");
});

test("a card that exhausts every candidate is unchecked, re-tiered and terminal", () => {
  const target = item({ candidates: [hit({ src: "a" }), hit({ src: "b" })], selected: true, confidence: "high" });

  assert.equal(removeCandidate(target, "a"), true);
  assert.equal(target.chosenIndex, 0);
  assert.equal(target.candidates[0].src, "b");
  assert.equal(target.selected, true);
  assert.equal(isExhaustedItem(target), false);

  assert.equal(removeCandidate(target, "b"), true);
  assert.equal(target.candidates.length, 0);
  assert.equal(target.selected, false);
  assert.equal(target.confidence, "skip");
  assert.equal(isExhaustedItem(target), true);
  assert.equal(removeCandidate(target, "b"), false);
});

test("removing a later candidate falls back to the last surviving one", () => {
  const target = item({ candidates: [hit({ src: "a" }), hit({ src: "b" })], chosenIndex: 1 });
  removeCandidate(target, "b");
  assert.equal(target.chosenIndex, 0);
  assert.equal(target.candidates.length, 1);
});

test("exhausted business cards and non-brand contacts are different buckets", () => {
  const ready = item({ confidence: "high" });
  const review = item({ confidence: "medium" });
  const exhausted = item({ candidates: [], confidence: "skip", selected: false });
  const nonBrand = item({
    contactClass: "nonBrand",
    candidates: [],
    confidence: "skip",
    selected: false,
    flags: ["non-brand"],
  });
  const person = item({
    contactClass: "person",
    candidates: [],
    confidence: "skip",
    selected: false,
    flags: ["photo-protected"],
  });

  const groups = partitionSections([ready, review, exhausted, nonBrand, person]);
  assert.deepEqual(groups.ready, [ready]);
  assert.deepEqual(groups.review, [review]);
  assert.deepEqual(groups.nonbrand, [nonBrand, person]);
  assert.deepEqual(groups.notfound, [exhausted]);
  assert.equal(isNonBrandItem(exhausted), false);
  assert.equal(isExhaustedItem(nonBrand), false);
});

test("filter chips select the tiers they name", () => {
  const ready = item({ confidence: "high" });
  const review = item({ confidence: "medium" });
  const exhausted = item({ candidates: [], confidence: "skip", selected: false });
  const nonBrand = item({ contactClass: "nonBrand", candidates: [], confidence: "skip", flags: ["non-brand"] });
  const withPhoto = item({ contact: contact({ hadExistingPhoto: true }) });
  const all = [ready, review, exhausted, nonBrand, withPhoto];

  assert.deepEqual(filterItems(all, "", "all"), all);
  assert.deepEqual(filterItems(all, "", "ready"), [ready, withPhoto]);
  assert.deepEqual(filterItems(all, "", "review"), [review]);
  assert.deepEqual(filterItems(all, "", "notfound"), [exhausted]);
  assert.equal(itemMatchesFilter(nonBrand, "notfound"), false);
  assert.deepEqual(filterItems(all, "", "missingphoto"), [ready, review, exhausted, nonBrand]);
});

test("search covers name, organization, domain, query and phone", () => {
  const target = item({
    contact: contact({ displayName: "Bayou City Sprinkler", organization: "Bayou City LLC", phone: "713-555-0142" }),
    domain: "bayoucity.com",
    query: "Bayou City Sprinkler",
  });
  assert.equal(itemMatchesQuery(target, "sprink"), true);
  assert.equal(itemMatchesQuery(target, "LLC"), true);
  assert.equal(itemMatchesQuery(target, "bayoucity.com"), true);
  assert.equal(itemMatchesQuery(target, "555-0142"), true);
  assert.equal(itemMatchesQuery(target, "  "), true);
  assert.equal(itemMatchesQuery(target, "walgreens"), false);
});

test("filter and search compose", () => {
  const ready = item({ contact: contact({ id: "a", displayName: "Walgreens" }), confidence: "high" });
  const other = item({ contact: contact({ id: "b", displayName: "FedEx" }), confidence: "high" });
  assert.deepEqual(filterItems([ready, other], "fed", "ready"), [other]);
});

test("virtualization mounts a window, not the whole book", () => {
  const rows = visibleSlice(14379, 3, 260, 0, 800, 2);
  assert.equal(rows.start, 0);
  assert.ok(rows.end <= 30, `mounted ${rows.end} cards`);
  assert.equal(rows.totalHeight, Math.ceil(14379 / 3) * 260);
  assert.equal(rows.offsetY, 0);

  const scrolled = visibleSlice(14379, 3, 260, 26_000, 800, 2);
  assert.equal(scrolled.offsetY, (Math.floor(26_000 / 260) - 2) * 260);
  assert.equal(scrolled.start, (Math.floor(26_000 / 260) - 2) * 3);
  assert.ok(scrolled.end - scrolled.start <= 30);

  const end = visibleSlice(14379, 3, 260, 10_000_000, 800, 2);
  assert.equal(end.end, 14379);
});

test("virtualization degrades safely at the edges", () => {
  assert.deepEqual(visibleSlice(0, 3, 260, 0, 800), { start: 0, end: 0, offsetY: 0, totalHeight: 0 });
  const single = visibleSlice(2, 0, 0, -50, -10, 0);
  assert.equal(single.start, 0);
  assert.equal(single.end, 1);
});

/**
 * CL-11 — the export notice must not claim an unqualified success when a logo
 * could not be embedded.  `embedSrc` falls back to the remote URL and
 * `contactToVcard` writes only `data:` photos, so the logo is silently absent
 * from the downloaded file.
 */
test("skippedNotice names the logos missing from an export", () => {
  assert.equal(skippedNotice([]), "");
  assert.match(skippedNotice(["Acme"]), /1 logo could not be embedded and is missing from the file: Acme\./);
  assert.match(skippedNotice(["A", "B"]), /2 logos .* are missing from the file: A, B\./);
  // Long lists are truncated so one bad network run cannot produce an
  // unreadable notice, but the count stays honest.
  const many = ["A", "B", "C", "D", "E"];
  assert.match(skippedNotice(many), /5 logos/);
  assert.match(skippedNotice(many), /A, B, C and 2 more\./);
});

/**
 * CL-09 — the view cache has to shrink as well as grow, or scrolling a long
 * queue retains every card and its images.  It must not shrink so eagerly that
 * it stops reusing visible cards, which is the same finding's other half.
 */
test("trimViewCache bounds the cache without evicting mounted views", () => {
  const keys = Array.from({ length: 10 }, (_, i) => ({ i }));
  const cache = new Map(keys.map((k) => [k, `v${k.i}`] as const));

  // Under the cap: nothing is touched, so a re-render reuses every card.
  assert.equal(trimViewCache(cache, keys.slice(0, 3), 20), 0);
  assert.equal(cache.size, 10);

  // Over the cap: least-recently-used first, mounted views exempt.
  const mounted = [keys[0], keys[1]];
  assert.equal(trimViewCache(cache, mounted, 4), 6);
  assert.equal(cache.size, 4);
  assert.ok(cache.has(keys[0]) && cache.has(keys[1]), "a mounted view was evicted");

  // An empty window — a zero-height viewport, or a filter matching nothing —
  // must not clear the cache, or every paint rebuilds every card.
  const before = cache.size;
  assert.equal(trimViewCache(cache, [], before + 5), 0);
  assert.equal(cache.size, before);
});

/**
 * Both silent-fallback helpers in `logos.ts` resolve to their *input* when they
 * give up — `embedSrc` to the remote URL, `padAndSquareImage` to the unpadded
 * source — and report why only if handed a callback.  Every call that then
 * writes the result somewhere the user can see (a downloaded vCard, someone's
 * Google Contacts) therefore has to pass one; a call that forgets looks
 * completely healthy and ships a corrupt or unpadded PHOTO under a success
 * notice.  Two of these three call sites shipped without a callback, at
 * different times, so this is a wiring assertion rather than a style rule.
 *
 * The behavioural path is unreachable from Node: `padAndSquareImage` returns
 * early when there is no `document`, so no stub short of a canvas would drive
 * `onFallback`.  Scanning the source is what is left, in the same spirit as
 * `csp.test.ts`.
 */
test("every export and sync path collects embed and padding failures", () => {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "app.ts"), "utf8");
  const calls = [...source.matchAll(/\b(embedSrc|padAndSquareImage)\s*\(/g)];
  assert.ok(calls.length >= 4, `expected the export and sync call sites, found ${calls.length}`);
  for (const call of calls) {
    // The argument list runs to the matching close paren; nested parens in the
    // callback body mean a naive `indexOf(")")` would stop far too early.
    let depth = 1;
    let i = call.index! + call[0].length;
    for (; i < source.length && depth > 0; i += 1) {
      if (source[i] === "(") depth += 1;
      else if (source[i] === ")") depth -= 1;
    }
    const args = source.slice(call.index! + call[0].length, i - 1);
    const line = source.slice(0, call.index).split("\n").length;
    assert.ok(
      /onFallback|\(reason,\s*detail\)/.test(args),
      `${call[1]} at app.ts:${line} drops its failure reason on the floor`,
    );
  }
});
