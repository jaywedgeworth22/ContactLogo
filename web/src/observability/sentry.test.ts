import assert from "node:assert/strict";
import { test } from "node:test";
import { countLogoMatch, sentryStarted, startSentry } from "./sentry.ts";

test("startSentry is inert without a DSN", () => {
  startSentry();
  assert.equal(sentryStarted(), false);
});

test("countLogoMatch never throws when Sentry is dark", () => {
  assert.doesNotThrow(() => countLogoMatch(0));
  assert.doesNotThrow(() => countLogoMatch(12));
});
