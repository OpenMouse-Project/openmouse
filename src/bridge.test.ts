import assert from "node:assert/strict";
import test from "node:test";
import { applyBridgeNativeSettings } from "./bridge.ts";

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
