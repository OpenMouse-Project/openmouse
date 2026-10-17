import assert from "node:assert/strict";
import test from "node:test";
import { ensureLocale } from "../i18n/index.ts";
import { profileLabel } from "./profile-label.ts";

test("saved profile names remain exact while missing names get a localized fallback", async () => {
  await ensureLocale("tr");
  assert.equal(profileLabel("tr", ["Default", "Mouse 1611", ""], 0), "Default");
  assert.equal(profileLabel("tr", ["Default", "Mouse 1611", ""], 1), "Mouse 1611");
  assert.equal(profileLabel("tr", ["Default", "Mouse 1611", ""], 2), "");
  assert.equal(profileLabel("tr", undefined, 1), "Profil 2");
});
