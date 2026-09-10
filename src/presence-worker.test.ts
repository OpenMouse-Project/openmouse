import assert from "node:assert/strict";
import test from "node:test";
import { onRequest } from "../functions/api/presence.js";

function fakeKv() {
  const store = new Map<string, string>();
  return {
    store,
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async list({ prefix }: { prefix: string }) {
      const keys = [...store.keys()]
        .filter((key) => key.startsWith(prefix))
        .map((name) => ({ name }));
      return { keys };
    },
  };
}

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

test("the presence endpoint reports a null count when PRESENCE_KV isn't configured", async () => {
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

test("the presence endpoint records the heartbeat and returns every live session id", async () => {
  const kv = fakeKv();
  const sessionId = crypto.randomUUID();
  const other = crypto.randomUUID();
  kv.store.set(`presence:${other}`, "1");

  const response = await onRequest({
    request: new Request("https://openmouse.app/api/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    }),
    env: { PRESENCE_KV: kv },
  });

  const body = await response.json();
  assert.equal(body.count, 2);
  assert.deepEqual(new Set(body.ids), new Set([sessionId, other]));
  assert.equal(kv.store.get(`presence:${sessionId}`), "1");
});
