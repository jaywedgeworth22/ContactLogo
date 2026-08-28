import assert from "node:assert/strict";
import { test } from "node:test";
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
  removeCandidate,
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
