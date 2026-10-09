import assert from "node:assert/strict";
import test from "node:test";

import { batteryStateText, connectLabelText, ensureLocale, missingTranslations, t, tp } from "./i18n.ts";

test("i18n falls back to English until the locale table resolves", async () => {
  assert.equal(t("pt", "nav.settings"), "Settings");
  await ensureLocale("pt");
  assert.equal(t("pt", "nav.settings"), "Configurações");
  assert.equal(t("en", "nav.settings"), "Settings");
  // Unknown locale-shaped input still resolves through the typed API;
  // the safety net below must never surface an empty string.
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

test("Chinese DPI views and editor notes use clear localized wording", async () => {
  await ensureLocale("zh");
  assert.equal(t("zh", "dpi.viewStages"), "全部档位");
  assert.equal(t("zh", "dpi.viewSingle"), "当前 DPI");
  assert.equal(t("zh", "dpi.viewSlots"), "全部档位");
  for (const key of ["dpi.stageToggle", "dpi.editorCountNote", "dpi.editorFixedNote",
    "dpi.stagesReadOnly", "dpi.editorGenericNote"] as const) {
    const text = t("zh", key);
    assert.match(text, /[\u4e00-\u9fff]/);
    assert.doesNotMatch(text, /One row|Include this|These DPI stages/);
  }
  assert.equal(tp("zh", "dpi.stageDpi", { n: 2 }), "第 2 档 DPI");
  assert.match(tp("zh", "dpi.editorFixedNote", { total: 6 }), /6 个固定 DPI 档位/);
});
test("LunaFury official-style DPI controls have localized count and apply guidance", async () => {
  await ensureLocale("zh");
  assert.equal(t("zh", "luna.dpiStageCount"), "档位数量");
  assert.match(t("zh", "luna.dpiStageNote"), /彩色档位块.*应用.*鼠标/);
});
