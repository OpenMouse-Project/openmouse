import assert from "node:assert/strict";
import test from "node:test";

import { permissionGraphicFor } from "./permission-state.ts";

test("permission onboarding shows only the action the user currently needs", () => {
  assert.equal(permissionGraphicFor("checking", false), null);
  assert.equal(permissionGraphicFor("prompt", false), "prompt");
  assert.equal(permissionGraphicFor("denied", false), "settings");
  assert.equal(permissionGraphicFor("granted", false), null);
  assert.equal(permissionGraphicFor("unsupported", false), null);
  assert.equal(permissionGraphicFor("denied", true), null);
});
