import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

test("Android native Sentry inits masked Replay and profiling", () => {
  const app = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../Apps/ContactLogoAndroid/app/src/main/java/com/contactlogo/ContactLogoApp.kt",
    ),
    "utf8",
  );
  assert.match(app, /SentryAndroid\.init/);
  assert.match(app, /sessionReplay\.sessionSampleRate = 0\.1/);
  assert.match(app, /sessionReplay\.onErrorSampleRate = 1\.0/);
  assert.match(app, /profilesSampleRate = 0\.1/);
  assert.match(app, /setMaskAllText\(true\)/);
});

test("sentry configures subtle feedback integration", () => {
  const sentrySrc = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "sentry.ts"),
    "utf8",
  );
  assert.match(sentrySrc, /feedbackIntegration\(/);
  assert.match(sentrySrc, /autoInject:\s*false/);
  assert.match(sentrySrc, /formTitle:\s*"Report a Problem"/);
  assert.match(sentrySrc, /export function openSentryFeedback/);
});
