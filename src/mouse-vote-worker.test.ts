import assert from "node:assert/strict";
import test from "node:test";
import { onRequest } from "../functions/api/mouse-vote.js";

test("the protected vote endpoint rejects non-POST methods", async () => {
  const response = await onRequest({
    request: new Request("https://openmouse.app/api/mouse-vote"),
    env: {},
  });
  assert.equal(response.status, 405);
});

test("the protected vote endpoint rejects cross-origin requests", async () => {
  const response = await onRequest({
    request: new Request("https://openmouse.app/api/mouse-vote", {
      method: "POST",
      headers: { Origin: "https://attacker.example", "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: crypto.randomUUID(), turnstileToken: "token" }),
    }),
    env: {},
  });
  assert.equal(response.status, 403);
});

test("the protected vote endpoint fails closed without secrets", async () => {
  const response = await onRequest({
    request: new Request("https://openmouse.app/api/mouse-vote", {
      method: "POST",
      headers: { Origin: "https://openmouse.app", "CF-Connecting-IP": "192.0.2.1", "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: crypto.randomUUID(), turnstileToken: "token" }),
    }),
    env: {},
  });
  assert.equal(response.status, 503);
});
