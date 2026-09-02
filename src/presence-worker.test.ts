import assert from "node:assert/strict";
import test from "node:test";
import { onRequest } from "../functions/api/presence.js";

const BASE_ENV = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key" };

test("the presence endpoint rejects non-POST methods", async () => {
  const response = await onRequest({
    request: new Request("https://openmouse.app/api/presence"),
    env: {},
  });
  assert.equal(response.status, 405);
});

test("the presence endpoint rejects cross-origin requests", async () => {
  const response = await onRequest({
    request: new Request("https://openmouse.app/api/presence", {
      method: "POST",
      headers: { Origin: "https://attacker.example", "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: crypto.randomUUID() }),
    }),
    env: {},
  });
  assert.equal(response.status, 403);
});

test("the presence endpoint rejects a malformed session id", async () => {
  const response = await onRequest({
    request: new Request("https://openmouse.app/api/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "not-a-uuid" }),
    }),
    env: {},
  });
  assert.equal(response.status, 400);
});

test("the presence endpoint reports a null count when Supabase isn't configured", async () => {
  const response = await onRequest({
    request: new Request("https://openmouse.app/api/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: crypto.randomUUID() }),
    }),
    env: {},
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { count: null, ids: [] });
});

test("the presence endpoint calls the heartbeat RPC and forwards its count/ids", async () => {
  const sessionId = crypto.randomUUID();
  const originalFetch = globalThis.fetch;
  let calledUrl: string | undefined;
  let calledBody: unknown;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calledUrl = url;
    calledBody = JSON.parse(init.body as string);
    return new Response(JSON.stringify({ count: 3, ids: [sessionId, crypto.randomUUID(), crypto.randomUUID()] }), { status: 200 });
  }) as typeof fetch;

  try {
    const response = await onRequest({
      request: new Request("https://openmouse.app/api/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      }),
      env: BASE_ENV,
    });
    const body = await response.json();
    assert.equal(body.count, 3);
    assert.equal(body.ids.length, 3);
    assert.equal(calledUrl, "https://example.supabase.co/rest/v1/rpc/heartbeat_page_presence");
    assert.deepEqual(calledBody, { p_session_id: sessionId });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the presence endpoint reports a null count when the RPC call fails", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ message: "boom" }), { status: 500 })) as typeof fetch;

  try {
    const response = await onRequest({
      request: new Request("https://openmouse.app/api/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: crypto.randomUUID() }),
      }),
      env: BASE_ENV,
    });
    assert.deepEqual(await response.json(), { count: null, ids: [] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
