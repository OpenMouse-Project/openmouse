import assert from "node:assert/strict";
import test from "node:test";
import { onRequest } from "../functions/_middleware.js";

class FakeKV {
  store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

async function guarded(request: Request, kv = new FakeKV()) {
  return onRequest({
    request,
    env: { SECURITY_KV: kv },
    next: async () => new Response("passed-through", { status: 200 }),
  });
}

test("the guard passes requests through when no SECURITY_KV binding is set", async () => {
  const response = await onRequest({
    request: new Request("https://openmouse.app/api/presence"),
    env: {},
    next: async () => new Response("passed-through", { status: 200 }),
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "passed-through");
});

test("the guard bypasses a permanently banned IP", async () => {
  const kv = new FakeKV();
  await kv.put("ban:1.2.3.4", "1");
  const response = await guarded(
    new Request("https://openmouse.app/", { headers: { "CF-Connecting-IP": "1.2.3.4" } }),
    kv,
  );
  assert.equal(response.status, 403);
});

test("the guard blocks exploit URLs and counts a strike", async () => {
  const kv = new FakeKV();
  const response = await guarded(
    new Request("https://openmouse.app/api/admin/login%2e%2e%2f%2e%2e%2f.env"),
    kv,
  );
  assert.equal(response.status, 403);
  assert.ok(await kv.get("strikes:unknown"));
});

test("the guard blocks cross-site POSTs", async () => {
  const response = await guarded(
    new Request("https://openmouse.app/api/artwork/upload", {
      method: "POST",
      headers: { Origin: "https://attacker.example" },
    }),
  );
  assert.equal(response.status, 403);
});

test("the guard allows same-origin POSTs", async () => {
  const response = await guarded(
    new Request("https://openmouse.app/api/artwork/upload", {
      method: "POST",
      headers: { Origin: "https://openmouse.app" },
    }),
  );
  assert.equal(response.status, 200);
});

test("the guard rejects oversized POST bodies", async () => {
  const response = await guarded(
    new Request("https://openmouse.app/api/artwork/upload", {
      method: "POST",
      headers: { "Content-Length": String(9 * 1024 * 1024) },
    }),
  );
  assert.equal(response.status, 413);
});

test("the guard rate-limits aggressive GET traffic with a strike", async () => {
  const kv = new FakeKV();
  let lastStatus = 200;
  for (let i = 0; i < 241; i++) {
    const response = await guarded(new Request("https://openmouse.app/assets/app.js"), kv);
    lastStatus = response.status;
  }
  assert.equal(lastStatus, 429);
  assert.ok(await kv.get("strikes:unknown"));
});

test("repeated abuse permanently bans the IP", async () => {
  const kv = new FakeKV();
  let lastStatus = 200;
  for (let i = 0; i < 26; i++) {
    const response = await guarded(
      new Request("https://openmouse.app/api/admin%2e%2e%2f%2e%2e%2f.env"),
      kv,
    );
    lastStatus = response.status;
  }
  assert.equal(lastStatus, 403);
  assert.equal(await kv.get("ban:unknown"), "1");
});