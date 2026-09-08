import assert from "node:assert/strict";
import test from "node:test";
import { applyBridgeNativeSettings, checkBridgeConnection } from "./bridge.ts";

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

test("native settings are sent to the Bridge as JSON", async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; method?: string; body?: BodyInit | null } | null = null;
  globalThis.fetch = async (input, init) => {
    request = { url: String(input), method: init?.method, body: init?.body };
    return Response.json({ ok: true });
  };

  try {
    await applyBridgeNativeSettings({ brand: "Attack Shark", pollingRateHz: 500 });
    assert.deepEqual(request, {
      url: "http://127.0.0.1:17846/v1/native/settings",
      method: "PUT",
      body: JSON.stringify({ brand: "Attack Shark", pollingRateHz: 500 }),
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
