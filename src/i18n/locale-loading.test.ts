import assert from "node:assert/strict";
import test from "node:test";
import { ensureDisplayLocale, t } from "./index.ts";

test("a failed display-locale load allows rendering with English fallback and a later retry", async () => {
  let rendered = false;
  await ensureDisplayLocale("tr", async () => { throw new Error("lazy chunk unavailable"); })
    .then(() => { rendered = true; });
  assert.equal(rendered, true);
  assert.equal(t("tr", "nav.settings"), "Settings");
  await ensureDisplayLocale("tr");
  assert.equal(t("tr", "nav.settings"), "Ayarlar");
});
