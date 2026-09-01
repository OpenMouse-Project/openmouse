import assert from "node:assert/strict";
import test from "node:test";
import { onRequest } from "../functions/api/presence.js";

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

test("the presence endpoint reports a null count when no KV namespace is bound", async () => {
  const response = await onRequest({
    request: new Request("https://openmouse.app/api/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: crypto.randomUUID() }),
    }),
    env: {},
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { count: null });
});

test("the presence endpoint heartbeats into KV and returns the live count", async () => {
  const store = new Map<string, string>();
  const kv = {
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async list({ prefix }: { prefix: string }) {
      return {
        keys: [...store.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })),
        list_complete: true,
        cursor: undefined,
      };
    },
  };

  const first = await onRequest({
    request: new Request("https://openmouse.app/api/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: crypto.randomUUID() }),
    }),
    env: { PRESENCE_KV: kv },
  });
  assert.deepEqual(await first.json(), { count: 1 });

  const second = await onRequest({
    request: new Request("https://openmouse.app/api/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: crypto.randomUUID() }),
    }),
    env: { PRESENCE_KV: kv },
  });
  assert.deepEqual(await second.json(), { count: 2 });
});
