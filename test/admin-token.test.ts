import assert from "node:assert/strict";
import test from "node:test";

import { isAdminRequest, safeEqual, tokenFrom } from "../functions/_lib/admin.js";

function request(headers = {}) {
  return { headers: new Headers(headers) };
}

test("tokenFrom prefers a Bearer token", () => {
  assert.equal(tokenFrom(request({ Authorization: "Bearer s3cret" })), "s3cret");
  assert.equal(tokenFrom(request({ Authorization: "bearer   spaced  " })), "spaced");
});

test("tokenFrom falls back to x-admin-token and empty when missing", () => {
  assert.equal(tokenFrom(request({ "x-admin-token": "fallback" })), "fallback");
  assert.equal(tokenFrom(request()), "");
});

test("safeEqual rejects wrong-length secrets without leaking equality", () => {
  assert.equal(safeEqual("s3cret", "s3cret"), true);
  assert.equal(safeEqual("s3cret", "wrong!"), false);
  assert.equal(safeEqual("short", "much-longer-secret"), false);
  assert.equal(safeEqual("", "s3cret"), false);
});

test("isAdminRequest fails closed without a configured secret", () => {
  const authed = request({ Authorization: "Bearer s3cret" });
  assert.equal(isAdminRequest(authed, {}), false);
  assert.equal(isAdminRequest(authed, { ADMIN_TOKEN: "" }), false);
  assert.equal(isAdminRequest(authed, { ADMIN_TOKEN: "s3cret" }), true);
  assert.equal(isAdminRequest(request(), { ADMIN_TOKEN: "s3cret" }), false);
});
