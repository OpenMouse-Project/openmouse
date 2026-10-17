import assert from "node:assert/strict";
import test from "node:test";
import { ensureLocale } from "../i18n/index.ts";
import { lunafurySettingLabel, lunafurySettingPriority, lunafuryTrackingVisible } from "./lunafury-labels.ts";

test("LunaFury Chinese names match the vendor's command mappings", async () => {
  await ensureLocale("zh");
  const status = { brand: "LunaFury" };
  assert.equal(lunafurySettingLabel(status, "zh", "angleSnapping"), "直线修正");
  assert.equal(lunafurySettingLabel(status, "zh", "hyperMode"), "竞技模式");
  assert.equal(lunafurySettingLabel(status, "zh", "performanceMode"), "追踪模式");
  assert.equal(lunafurySettingLabel(status, "zh", "motionSync"), "运动同步");
  assert.equal(lunafurySettingLabel(status, "zh", "rippleControl"), "波纹控制");
});

test("LunaFury English labels also use the official names", () => {
  const status = { brand: "LunaFury" };
  assert.equal(lunafurySettingLabel(status, "en", "angleSnapping"), "Angle Snap");
  assert.equal(lunafurySettingLabel(status, "en", "hyperMode"), "Competitive Mode");
  assert.equal(lunafurySettingLabel(status, "en", "performanceMode"), "Tracking Mode");
});

test("other brands and unrelated settings retain their existing labels", () => {
  for (const brand of ["Lamzu", "WLMouse", "CRDRAKO", "Teevolution", "Attack Shark", "VXE"]) {
    for (const setting of ["angleSnapping", "hyperMode", "performanceMode", "motionSync", "rippleControl"]) {
      assert.equal(lunafurySettingLabel({ brand }, "en", setting), undefined);
    }
  }
  assert.equal(lunafurySettingLabel(null, "zh", "hyperMode"), undefined);
  assert.equal(lunafurySettingLabel({ brand: "LunaFury" }, "en", "turboMode"), undefined);
  assert.equal(lunafurySettingLabel({ brand: "LunaFury" }, "en", "toString"), undefined);
});

test("LunaFury tracking appears only when competitive mode is confirmed on", () => {
  for (const hyperMode of [false, null, undefined]) {
    assert.equal(lunafuryTrackingVisible({ brand: "LunaFury", hyperMode }), false);
  }
  assert.equal(lunafuryTrackingVisible({ brand: "LunaFury", hyperMode: true }), true);
  const status = { brand: "LunaFury", hyperMode: false, performanceMode: true };
  assert.equal(lunafuryTrackingVisible(status), false);
  assert.equal(status.performanceMode, true, "hiding tracking must not change its stored state");
});

test("other brands keep their existing performance visibility and write order", () => {
  for (const brand of ["WLMouse", "CRDRAKO", "Lamzu", "Teevolution", "Attack Shark"]) {
    assert.equal(lunafuryTrackingVisible({ brand, hyperMode: false }), true);
    assert.equal(lunafurySettingPriority({ brand }, "hyperMode", true), undefined);
    assert.equal(lunafurySettingPriority({ brand }, "hyperMode", false), undefined);
  }
});

test("LunaFury competitive mode enables before tracking and disables after it", () => {
  const status = { brand: "LunaFury" };
  assert.equal(lunafurySettingPriority(status, "hyperMode", true), -1);
  assert.equal(lunafurySettingPriority(status, "hyperMode", false), 1);
  assert.equal(lunafurySettingPriority(status, "performanceMode", true), undefined);
  assert.equal(lunafurySettingPriority(null, "hyperMode", true), undefined);
});
