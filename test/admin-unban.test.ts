import assert from "node:assert/strict";
import test from "node:test";
import { onRequest } from "../functions/api/admin/unban.js";

class FakeKV {
  store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
  async list({ prefix = "" } = {}): Promise<{ keys: { name: string }[] }> {
    return {
      keys: [...this.store.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })),
    };
  }
}

function request({ token = "s3cret", ip = "203.0.113.7", method = "POST" }: { token?: string | null; ip?: string | null; method?: string } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  const init: RequestInit = { method, headers };
  if (method !== "GET" && method !== "HEAD") init.body = ip === null ? "{}" : JSON.stringify({ ip });
  return new Request("https://openmouse.app/api/admin/unban", init);
}

async function unban(request: Request, kv = new FakeKV(), env: Record<string, unknown> = {}) {
  return onRequest({ request, env: { ADMIN_TOKEN: "s3cret", SECURITY_KV: kv, ...env } });
}

test("unban rejects a missing token without touching storage", async () => {
  const kv = new FakeKV();
  await kv.put("ban:203.0.113.7", "artwork");
  const response = await unban(request({ token: null }), kv);
  assert.equal(response.status, 401);
  assert.equal(await kv.get("ban:203.0.113.7"), "artwork");
});

test("unban rejects a wrong token", async () => {
  const response = await unban(request({ token: "nope" }));
  assert.equal(response.status, 401);
});

test("unban fails closed when ADMIN_TOKEN is not configured", async () => {
  const kv = new FakeKV();
  const response = await unban(request(), kv, { ADMIN_TOKEN: "" });
  assert.equal(response.status, 401);
});

test("unban clears the ban, strikes and rejection buckets", async () => {
  const kv = new FakeKV();
  await kv.put("ban:203.0.113.7", "artwork");
  await kv.put("strikes:203.0.113.7", "12");
  await kv.put(`artscreen:203.0.113.7:${new Date().toISOString().slice(0, 10)}`, "6");
  await kv.put("ban:198.51.100.1", "security");

  const response = await unban(request(), kv);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(await kv.get("ban:203.0.113.7"), null);
  assert.equal(await kv.get("strikes:203.0.113.7"), null);
  assert.equal(await kv.get(`artscreen:203.0.113.7:${new Date().toISOString().slice(0, 10)}`), null);
  // Untouched neighbours survive.
  assert.equal(await kv.get("ban:198.51.100.1"), "security");
});

test("unban rejects a missing ip", async () => {
  const response = await unban(request({ ip: null }));
  assert.equal(response.status, 400);
});

test("unban rejects non-POST methods", async () => {
  const response = await unban(request({ method: "GET" }));
  assert.equal(response.status, 405);
});
