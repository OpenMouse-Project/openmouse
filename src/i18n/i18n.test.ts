import assert from "node:assert/strict";
import test from "node:test";

import { batteryStateText, connectLabelText, ensureLocale, missingTranslations, t, tp } from "./index.ts";
import { tr } from "./locales/tr.ts";

test("i18n falls back to English until the locale table resolves", async () => {
  assert.equal(t("pt", "nav.settings"), "Settings");
  await ensureLocale("pt");
  assert.equal(t("pt", "nav.settings"), "Configurações");
  assert.equal(t("en", "nav.settings"), "Settings");
  assert.ok(t("pt", "set.reset").length > 0);
  assert.equal(t("pt", "ov.firmware"), "FIRMWARE");
});

test("i18n maps known battery states and passes unknown ones through", () => {
  assert.equal(batteryStateText("pt", "Discharging"), "Descarregando");
  assert.equal(batteryStateText("en", "Discharging"), "Discharging");
  assert.equal(batteryStateText("pt", "SomeFutureState"), "SomeFutureState");
});

test("i18n maps known connect labels and passes dynamic ones through", () => {
  assert.equal(connectLabelText("pt", "Add device"), "Adicionar dispositivo");
  assert.equal(connectLabelText("en", "Add device"), "Add device");
  assert.equal(connectLabelText("pt", "Use Add device if lost"), "Use Add device if lost");
});

test("every locale translates every key", async () => {
  assert.deepEqual(await missingTranslations(), []);
});

test("tp renders provided placeholders and blanks missing ones", () => {
  assert.equal(tp("en", "dpi.slotX", { n: 2 }), "Slot 2 X DPI");
  assert.equal(tp("en", "dpi.slotX", {}), "Slot  X DPI");
});

test("Turkish loads on demand and renders localized labels and templates", async () => {
  await ensureLocale("tr");
  assert.equal(t("tr", "nav.settings"), "Ayarlar");
  assert.equal(t("tr", "set.turkish"), "Türkçe");
  assert.equal(batteryStateText("tr", "Charging"), "Şarj oluyor");
  assert.equal(connectLabelText("tr", "Add device"), "Cihaz ekle");
  assert.equal(tp("tr", "dpi.slotX", { n: 2 }), "Yuva 2 X DPI");
  assert.equal(tp("tr", "ctl.layersCount", { n: 2, s: "s" }), "Cihaz belleğinde 2 katman");
});

test("Turkish preserves English template variables except the English plural suffix", () => {
  const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)]
    .map((match) => match[1]).sort();
  for (const key of Object.keys(tr) as Array<keyof typeof tr>) {
    const source = t("en", key);
    const pluralSuffix = /\w\{s\}/.test(source);
    const expected = placeholders(source).filter((name) => !pluralSuffix || name !== "s");
    assert.deepEqual(placeholders(tr[key]), expected, key);
    if (pluralSuffix) assert.ok(!tr[key].includes("{s}"), `${key} must not append an English plural suffix`);
  }
});
