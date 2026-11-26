import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  onLocalNetworkPermissionGranted,
  refreshLocalNetworkPermission,
  reloadOnceForBridge,
} from "./local-network-permission.ts";

const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");

function stubNavigator(value: unknown): void {
  Object.defineProperty(globalThis, "navigator", { value, configurable: true, writable: true });
}

afterEach(() => {
  if (original) Object.defineProperty(globalThis, "navigator", original);
  else delete (globalThis as { navigator?: unknown }).navigator;
});

test("reports the state of the first permission name the browser knows", async () => {
  const asked: string[] = [];
  stubNavigator({
    permissions: {
      query: async ({ name }: { name: string }) => {
        asked.push(name);
        if (name === "loopback-network") throw new TypeError("unknown permission");
        return { state: "denied" };
      },
    },
  });
  assert.equal(await refreshLocalNetworkPermission(), "denied");
  assert.deepEqual(asked, ["loopback-network", "local-network-access"]);
});

test("passes granted and prompt through", async () => {
  for (const state of ["granted", "prompt"]) {
    stubNavigator({ permissions: { query: async () => ({ state }) } });
    assert.equal(await refreshLocalNetworkPermission(), state);
  }
});

test("is unknown when no permission name can be queried or the API is missing", async () => {
  stubNavigator({ permissions: { query: async () => { throw new TypeError("unknown permission"); } } });
  assert.equal(await refreshLocalNetworkPermission(), "unknown");
  stubNavigator({});
  assert.equal(await refreshLocalNetworkPermission(), "unknown");
});

test("allowing the prompt fires the granted callback once, an already allowed page never does", async () => {
  const status = { state: "prompt", onchange: null as null | (() => void) };
  stubNavigator({ permissions: { query: async () => status } });
  await refreshLocalNetworkPermission();
  let granted = 0;
  const stop = onLocalNetworkPermissionGranted(() => void (granted += 1));
  status.state = "granted";
  status.onchange?.();
  status.onchange?.();
  assert.equal(granted, 1);

  const already = { state: "granted", onchange: null as null | (() => void) };
  stubNavigator({ permissions: { query: async () => already } });
  await refreshLocalNetworkPermission();
  already.onchange?.();
  assert.equal(granted, 1);
  assert.equal(status.onchange, null, "the old status is released");
  stop();
});

test("a refresh that observes the grant fires the callback once", async () => {
  const status = { state: "prompt", onchange: null as null | (() => void) };
  stubNavigator({ permissions: { query: async () => status } });
  await refreshLocalNetworkPermission();
  let granted = 0;
  const stop = onLocalNetworkPermissionGranted(() => void (granted += 1));
  status.state = "granted";
  await refreshLocalNetworkPermission();
  assert.equal(granted, 1);
  await refreshLocalNetworkPermission();
  assert.equal(granted, 1, "seeing granted again is not a new grant");
  stop();
});

test("reloads for Bridge only once per session", () => {
  const session = new Map<string, string>();
  let reloads = 0;
  const define = (name: string, value: unknown): void => {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  };
  define("sessionStorage", { getItem: (k: string) => session.get(k) ?? null, setItem: (k: string, v: string) => void session.set(k, v) });
  define("location", { reload: () => void (reloads += 1) });
  reloadOnceForBridge();
  reloadOnceForBridge();
  assert.equal(reloads, 1);
  define("sessionStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
  reloadOnceForBridge();
  assert.equal(reloads, 1, "no reload when storage is unavailable, so it cannot loop");
  for (const name of ["sessionStorage", "location"]) delete (globalThis as Record<string, unknown>)[name];
});
