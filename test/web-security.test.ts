import assert from "node:assert/strict";
import test from "node:test";
import { onRequest as app } from "../functions/_middleware.js";

for (const [name, handler] of [["app", app]] as const) {
  test(`${name}: API routes never trust asset destinations or extensions`, async () => {
    for (const path of ["/api", "/api/feedback", "/api/anything.png", "/%61pi/file.png"]) {
      const response = await handler({ request: new Request(`https://example.test${path}`, { headers: { "Sec-Fetch-Dest": "image" } }), env: { SECURITY_KV: { get: async () => "1" } }, next: async () => new Response("unsafe") });
      assert.equal(response.status, 403, path);
    }
  });
  test(`${name}: forged asset destinations do not bypass rate or exploit checks`, async () => {
    const env = { SECURITY_KV: { get: async (key: string) => key.startsWith("window:") ? "240" : null, put: async () => {} } };
    const next = async () => new Response("unsafe");
    const headers = { "Sec-Fetch-Dest": "image" };
    assert.equal((await handler({ request: new Request("https://example.test/api/data", { headers }), env, next })).status, 429);
    assert.equal((await handler({ request: new Request("https://example.test/api/data?value=javascript:alert", { headers }), env, next })).status, 403);
  });
  test(`${name}: actual streamed limits apply without KV and with absent or false lengths`, async () => {
    for (const headers of [{}, { "Content-Length": "1" }]) {
      let cancelled = false;
      let pulls = 0;
      const body = new ReadableStream({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } });
      const response = await handler({ request: new Request("https://example.test/api/upload", { method: "PUT", body, duplex: "half", headers } as RequestInit), env: {}, next: async () => new Response("unsafe") });
      assert.equal(response.status, 413);
      assert.equal(cancelled, true);
      assert.ok(pulls <= 11);
    }
  });
  test(`${name}: bounded body remains available downstream`, async () => {
    const request = new Request("https://example.test/api/upload", { method: "POST", body: "legitimate" });
    const response = await handler({ request, env: {}, next: async (forwarded = request) => new Response(await forwarded.text()) });
    assert.equal(await response.text(), "legitimate");
  });
}
