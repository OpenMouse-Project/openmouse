import assert from "node:assert/strict";
import test from "node:test";
import { ensureLocale } from "../i18n.ts";
import { matchesCommandQuery } from "./command-search.ts";

test("Turkish command search accepts Turkish and original English including uppercase I", async () => {
  await ensureLocale("tr");
  assert.equal(matchesCommandQuery("tr", "copy", "Copy"), true);
  assert.equal(matchesCommandQuery("tr", "KOPYALA", "Copy"), true);
  assert.equal(matchesCommandQuery("tr", "Disabled", "Disabled"), true);
  assert.equal(matchesCommandQuery("tr", "DISABLED", "Disabled"), true);
  assert.equal(matchesCommandQuery("tr", "DEVRE DIŞI", "Disabled"), true);
  assert.equal(matchesCommandQuery("tr", "kopyala", "Other", "Copy"), true);
  assert.equal(matchesCommandQuery("tr", "unrelated", "Copy"), false);
  assert.equal(matchesCommandQuery("en", "kopyala", "Copy"), false);
});
