import assert from "node:assert/strict";
import { test } from "node:test";
import {
  didCredentialStorageFail,
  getBrandfetchClientId,
  getLogoDevToken,
  hasHdLogoKeys,
  setBrandfetchClientId,
  setLogoDevToken,
} from "./settings.ts";

function installStorage(impl: {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}) {
  Object.defineProperty(globalThis, "localStorage", { value: impl, configurable: true });
}

test("Brandfetch and Logo.dev keys persist in localStorage and report HD coverage", () => {
  const store = new Map<string, string>();
  installStorage({
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      store.set(k, v);
    },
    removeItem: (k) => {
      store.delete(k);
    },
  });

  assert.equal(hasHdLogoKeys(), false);
  assert.equal(setBrandfetchClientId(" bf-client "), true);
  assert.equal(getBrandfetchClientId(), "bf-client");
  assert.equal(hasHdLogoKeys(), true);
  assert.equal(setLogoDevToken("ld-token"), true);
  assert.equal(getLogoDevToken(), "ld-token");
  assert.equal(didCredentialStorageFail(), false);
  assert.equal(setBrandfetchClientId(""), true);
  assert.equal(getBrandfetchClientId(), "");
  assert.equal(hasHdLogoKeys(), true, "Logo.dev token still counts as an HD key");
  setLogoDevToken("");
});

test("a refused localStorage write is live for this session and flagged, like Keychain failure", () => {
  installStorage({
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("quota");
    },
    removeItem: () => {
      throw new Error("quota");
    },
  });

  assert.equal(setBrandfetchClientId("session-only"), false);
  assert.equal(didCredentialStorageFail(), true);
  assert.equal(getBrandfetchClientId(), "session-only");
});
