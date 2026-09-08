import assert from "node:assert/strict";
import test from "node:test";
import { checkBridgeConnection } from "./bridge.ts";

test("checkBridgeConnection handshakes before requesting status", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string }> = [];
  const status = {
    version: "1.1.0",
    platform: "windows",
    linuxDistribution: null,
    uptimeSeconds: 10,
    activeGames: [],
    trackedGameCount: 0,
    batteryThresholdPercent: 20,
    autostartEnabled: false,
    foregroundApplication: null,
    activeProfile: null,
    visibleApplicationCount: 0,
    profileCount: 0,
    clientConnected: true,
  };

  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), method: init?.method ?? "GET" });
    return Response.json(requests.length === 1 ? { ok: true } : status);
  };

  try {
    assert.deepEqual(await checkBridgeConnection(), status);
    assert.deepEqual(requests, [
      { url: "http://127.0.0.1:17846/v1/handshake", method: "PUT" },
      { url: "http://127.0.0.1:17846/v1/status", method: "GET" },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
