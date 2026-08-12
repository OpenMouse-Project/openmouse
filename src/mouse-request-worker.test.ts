import assert from "node:assert/strict";
import test from "node:test";
import { onRequest } from "../functions/api/mouse-request.js";

test("the protected request endpoint rejects non-POST methods", async () => {
  const response = await onRequest({ request: new Request("https://openmouse.app/api/mouse-request"), env: {} });
  assert.equal(response.status, 405);
});

test("the protected request endpoint rejects cross-origin requests", async () => {
  const response = await onRequest({
    request: new Request("https://openmouse.app/api/mouse-request", {
      method: "POST",
      headers: { Origin: "https://attacker.example", "Content-Type": "application/json" },
      body: JSON.stringify({ manufacturer: "Logitech", model: "G502", connection: "Wired", turnstileToken: "token" }),
    }),
    env: {},
  });
  assert.equal(response.status, 403);
});

test("the protected request endpoint validates field lengths before external calls", async () => {
  const response = await onRequest({
    request: new Request("https://openmouse.app/api/mouse-request", {
      method: "POST",
      headers: { Origin: "https://openmouse.app", "Content-Type": "application/json" },
      body: JSON.stringify({ manufacturer: "", model: "G502", connection: "Wired", turnstileToken: "token" }),
    }),
    env: {},
  });
  assert.equal(response.status, 400);
});
