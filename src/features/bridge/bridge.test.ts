import assert from "node:assert/strict";
import test from "node:test";
import { applyBridgeNativeSettings } from "./bridge.ts";
import * as bridge from "./bridge.ts";

test("local application API reads and writes only the loopback batch endpoint", async () => {
  assert.equal(typeof bridge.bridgeLocalApplications, "function");
  assert.equal(typeof bridge.saveBridgeLocalApplications, "function");
  const originalFetch = globalThis.fetch;
  const applications = [{ id: "local:editor", name: "Editor", executable: "editor.exe", path: "C:/Tools/editor.exe", kind: "app" as const }];
  const requests: { url: string; method?: string; body?: BodyInit | null }[] = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), method: init?.method, body: init?.body });
    return Response.json(init?.method === "PUT" ? { ok: true } : applications);
  };
  try {
    assert.deepEqual(await bridge.bridgeLocalApplications(), applications);
    await bridge.saveBridgeLocalApplications(applications);
    assert.deepEqual(requests, [
      { url: "http://127.0.0.1:17846/v1/local-applications", method: undefined, body: undefined },
      { url: "http://127.0.0.1:17846/v1/local-applications", method: "PUT", body: JSON.stringify({ applications }) },
    ]);
  } finally { globalThis.fetch = originalFetch; }
});

test("a saved local app's icon id is read from Bridge but never written back", async () => {
  const originalFetch = globalThis.fetch;
  const bodies: (BodyInit | null | undefined)[] = [];
  globalThis.fetch = async (_input, init) => { bodies.push(init?.body); return Response.json({ ok: true }); };
  try {
    await bridge.saveBridgeLocalApplications([{ id: "local:hunt", name: "Hunt", executable: "HuntGame.exe", path: "C:/Games/HuntGame.exe", kind: "game", iconId: "e2d0cf998041c322" }]);
    assert.deepEqual(JSON.parse(String(bodies[0])), { applications: [{ id: "local:hunt", name: "Hunt", executable: "HuntGame.exe", path: "C:/Games/HuntGame.exe", kind: "game" }] });
  } finally { globalThis.fetch = originalFetch; }
  assert.equal(bridge.bridgeIconUrl("a/b"), "http://127.0.0.1:17846/v1/applications/a%2Fb/icon");
});

test("local application failures expose HTTP status and never report unsupported saves as success", async () => {
  assert.equal(typeof bridge.bridgeLocalApplications, "function");
  const originalFetch = globalThis.fetch;
  try {
    for (const status of [404, 400, 500]) {
      globalThis.fetch = async () => new Response(null, { status });
      await assert.rejects(bridge.bridgeLocalApplications(), { status });
      await assert.rejects(bridge.saveBridgeLocalApplications([]), { status });
    }
    globalThis.fetch = async () => { throw new TypeError("offline"); };
    await assert.rejects(bridge.saveBridgeLocalApplications([]), /offline/);
  } finally { globalThis.fetch = originalFetch; }
});

test("local application reads forward cancellation", async () => {
  assert.equal(typeof bridge.bridgeLocalApplications, "function");
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  controller.abort();
  globalThis.fetch = async (_input, init) => {
    assert.equal(init?.signal?.aborted, true);
    throw new DOMException("Aborted", "AbortError");
  };
  try { await assert.rejects(bridge.bridgeLocalApplications(controller.signal), { name: "AbortError" }); }
  finally { globalThis.fetch = originalFetch; }
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
