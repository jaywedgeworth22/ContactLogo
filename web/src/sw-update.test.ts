import assert from "node:assert/strict";
import { test } from "node:test";
import { isSessionDismissed, rememberSessionDismiss, shouldOfferWaitingWorker } from "./sw-update.ts";

test("waiting worker is offered until the session skip", () => {
  assert.equal(shouldOfferWaitingWorker({ waiting: true, dismissed: false }), true);
  assert.equal(shouldOfferWaitingWorker({ waiting: true, dismissed: true }), false);
  assert.equal(shouldOfferWaitingWorker({ waiting: false, dismissed: false }), false);
});

test("session dismiss is remembered in the provided storage", () => {
  const store = new Map<string, string>();
  const storage = {
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
    key() {
      return null;
    },
    get length() {
      return store.size;
    },
  } as Storage;

  assert.equal(isSessionDismissed(storage), false);
  rememberSessionDismiss(storage);
  assert.equal(isSessionDismissed(storage), true);
});
