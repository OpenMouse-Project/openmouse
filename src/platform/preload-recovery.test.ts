import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { installPreloadRecovery } from "./preload-recovery.ts";

let reloads = 0;
const session = new Map<string, string>();

function define(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

function preloadError(target: EventTarget, payload: unknown): Event {
  const event = Object.assign(new Event("vite:preloadError", { cancelable: true }), { payload });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => {
  reloads = 0;
  session.clear();
  for (const name of ["sessionStorage", "location"]) delete (globalThis as Record<string, unknown>)[name];
});

function stubBrowser(): EventTarget {
  define("sessionStorage", { getItem: (k: string) => session.get(k) ?? null, setItem: (k: string, v: string) => void session.set(k, v) });
  define("location", { reload: () => void (reloads += 1) });
  const target = new EventTarget();
  installPreloadRecovery(target);
  return target;
}

const stale = new TypeError("Failed to fetch dynamically imported module: https://control.openmouse.app/assets/registry-C1s4rWBl.js");

test("a stale chunk reloads the page instead of surfacing the error", () => {
  const target = stubBrowser();
  assert.equal(preloadError(target, stale).defaultPrevented, true);
  assert.equal(reloads, 1);
});

test("the same chunk failing again after the reload is left to surface", () => {
  const target = stubBrowser();
  preloadError(target, stale);
  // The reload keeps sessionStorage, so the next page sees the same flag.
  const again = preloadError(stubBrowser(), stale);
  assert.equal(again.defaultPrevented, false);
  assert.equal(reloads, 1);
});

test("a different chunk failing later in the session still recovers", () => {
  const target = stubBrowser();
  preloadError(target, stale);
  const next = new TypeError("Failed to fetch dynamically imported module: https://control.openmouse.app/assets/registry-l1QQ6KD3.js");
  assert.equal(preloadError(target, next).defaultPrevented, true);
  assert.equal(reloads, 2);
});

test("no reload when storage is unavailable, so it cannot loop", () => {
  const target = stubBrowser();
  define("sessionStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
  assert.equal(preloadError(target, stale).defaultPrevented, false);
  assert.equal(reloads, 0);
});
