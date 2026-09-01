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
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async list({ prefix }: { prefix: string }) {
      return {
        keys: [...store.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })),
        list_complete: true,
        cursor: undefined,
      };
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
  assert.deepEqual(await response.json(), { count: null, ids: [], reactions: {} });
});

test("the presence endpoint heartbeats into KV and returns the live count and ids", async () => {
  const kv = fakeKv();

  const idA = crypto.randomUUID();
  const first = await onRequest({
    request: new Request("https://openmouse.app/api/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: idA }),
    }),
    env: { PRESENCE_KV: kv },
  });
  assert.deepEqual(await first.json(), { count: 1, ids: [idA], reactions: {} });

  const idB = crypto.randomUUID();
  const second = await onRequest({
    request: new Request("https://openmouse.app/api/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: idB }),
    }),
    env: { PRESENCE_KV: kv },
  });
  const secondBody = await second.json();
  assert.equal(secondBody.count, 2);
  assert.deepEqual(new Set(secondBody.ids), new Set([idA, idB]));
});

test("the presence endpoint caps the number of ids it returns", async () => {
  const kv = fakeKv();
  for (let i = 0; i < 40; i += 1) kv.store.set(`presence:${crypto.randomUUID()}`, "1");

  const response = await onRequest({
    request: new Request("https://openmouse.app/api/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: crypto.randomUUID() }),
    }),
    env: { PRESENCE_KV: kv },
  });
  const body = await response.json();
  assert.equal(body.count, 41);
  assert.equal(body.ids.length, 24);
});

test("the presence endpoint records and returns an allowed reaction", async () => {
  const kv = fakeKv();
  const idA = crypto.randomUUID();

  const response = await onRequest({
    request: new Request("https://openmouse.app/api/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: idA, reaction: "🔥" }),
    }),
    env: { PRESENCE_KV: kv },
  });
  const body = await response.json();
  assert.equal(body.reactions[idA].emoji, "🔥");
  assert.equal(typeof body.reactions[idA].ts, "number");
});

test("the presence endpoint silently ignores a reaction outside the fixed palette", async () => {
  const kv = fakeKv();
  const idA = crypto.randomUUID();

  const response = await onRequest({
    request: new Request("https://openmouse.app/api/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: idA, reaction: "not an emoji, arbitrary text" }),
    }),
    env: { PRESENCE_KV: kv },
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.reactions, {});
});
