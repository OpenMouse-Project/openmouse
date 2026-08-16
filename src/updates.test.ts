import assert from "node:assert/strict";
import test from "node:test";

import { compareVersions } from "./updates.ts";

test("semantic versions identify available updates", () => {
  assert.equal(compareVersions("0.1.0", "v0.2.0"), "update-available");
  assert.equal(compareVersions("0.2.0", "0.2.0"), "up-to-date");
  assert.equal(compareVersions("0.3.0", "0.2.0"), "ahead");
});

test("unrecognized versions fail closed", () => {
  assert.equal(compareVersions("dev", "0.2.0"), "unknown");
});
