import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ensureLocale, t, tp } from "../../i18n/index.ts";
import { parseLocalTarget, presetGames, gameIdentity, matchesGame, profileApplication, localTargetIdentity, replaceGameProfile } from "./local-applications.ts";
import * as targets from "./local-applications.ts";
import type { BridgeGame, BridgeProfile } from "../bridge/bridge.ts";

const local: BridgeGame = { name: "Editor", executables: ["editor.exe"], id: "local:editor", source: "local", path: "C:\\Tools\\editor.exe", kind: "app" };
const preset: BridgeGame = { name: "Editor", executables: ["editor.exe"] };
const profile = (localId?: string, device = "mouse:one"): BridgeProfile => ({ application: { name: "Editor", executable: "editor.exe", path: "", ...(localId ? { localId } : {}) }, device: { id: device, name: device }, settings: { dpi: 800, pollingRateHz: null } });

test("local-only Bridge caches do not hide available OpenMouse presets", () => {
  assert.deepEqual(presetGames([local], [preset]), [preset]);
  assert.deepEqual(presetGames([local, { ...preset, source: "preset" }], []), [{ ...preset, source: "preset" }]);
  assert.deepEqual(presetGames([], [preset]), [preset]);
  assert.deepEqual(presetGames([preset], []), [preset]);
});

test("profile auto-apply switch has a localized programmatic name", () => {
  const source = readFileSync(new URL("./GameProfilePanel.tsx", import.meta.url), "utf8");
  const switches = source.match(/<button\b[^>]*role="switch"[^>]*>/g) ?? [];
  assert.equal(switches.length, 1);
  assert.match(switches[0], /aria-label=\{t\(locale, "games.autoApply"\)\}/);
});

test("game and app profile copy describes local targets and profile activation", async () => {
  assert.equal(t("en", "games.subtitle"), "Choose a preset or add your own games and apps, saved locally in Bridge.");
  assert.equal(t("en", "games.settingsHint"), "Saved only to the profile for {name}. These settings apply when the profile is active, and your previous settings return when it stops.");
  for (const locale of ["en", "ar", "de", "es", "fr", "ja", "ko", "pt", "ru", "tr", "vi", "zh"] as const) {
    await ensureLocale(locale);
    const subtitle = t(locale, "games.subtitle");
    const hint = t(locale, "games.settingsHint");
    assert.ok(!subtitle.includes("\u2014") && !hint.includes("\u2014"), locale);
    assert.equal((hint.match(/\{name\}/g) ?? []).length, 1, locale);
    assert.ok(tp(locale, "games.settingsHint", { name: "Editor" }).includes("Editor"), locale);
    if (locale !== "en") {
      assert.notEqual(subtitle, t("en", "games.subtitle"), locale);
      assert.notEqual(hint, t("en", "games.settingsHint"), locale);
    }
  }
});

test("manual targets preserve exact paths and derive executable leaves", () => {
  assert.deepEqual(parseLocalTarget('  "C:\\Program Files\\Editor\\editor.exe"  '), { executable: "editor.exe", path: "C:\\Program Files\\Editor\\editor.exe" });
  assert.deepEqual(parseLocalTarget("/usr/bin/editor"), { executable: "editor", path: "/usr/bin/editor" });
  assert.deepEqual(parseLocalTarget("editor.exe"), { executable: "editor.exe", path: "" });
  assert.deepEqual(parseLocalTarget("\\\\server\\share\\editor.exe"), { executable: "editor.exe", path: "\\\\server\\share\\editor.exe" });
});

test("manual targets reject commands, wildcards, relative paths and malformed quotes", () => {
  for (const input of ["", "../editor", "folder/editor.exe", "C:editor.exe", "C:\\Tools\\", "editor.exe --flag", "editor.exe;calc", "*.exe", "https://host/app.exe", "\"editor.exe", "editor\n.exe", "a".repeat(256), "/" + "a".repeat(1024)]) assert.equal(parseLocalTarget(input), null, input);
});

test("manual targets reject Windows executable arguments without requiring flags", () => {
  for (const input of ["editor.exe file.txt", "EDITOR.EXE document", "C:/Tools/editor.exe file.txt"]) assert.equal(parseLocalTarget(input), null, input);
});

test("manual targets reject C1 control characters", () => {
  for (const code of [0x80, 0x85, 0x9f]) assert.equal(parseLocalTarget(`C:/Tools/editor${String.fromCharCode(code)}.exe`), null);
});

test("manual UNC targets require a server, share and executable", () => {
  for (const input of ["//server/editor", "//server", "\\\\server\\editor"]) assert.equal(parseLocalTarget(input), null, input);
  for (const path of ["//server/share/editor", "\\\\server\\share\\editor"]) assert.deepEqual(parseLocalTarget(path), { executable: "editor", path });
});

test("manual targets preserve literal punctuation in installation paths and names", () => {
  for (const path of ["C:/Users/O'Connor/Apps & Tools/editor.exe", "C:/Apps/$Tools/editor.exe", "C:/Apps/Tools - Stable/editor.exe", "//server/share$/Tom Clancy's Game.exe"]) assert.deepEqual(parseLocalTarget(path), { executable: path.split("/").pop(), path });
  for (const executable of ["Tom Clancy's Game.exe", "Tools & Games.exe", "$Editor.exe"]) assert.deepEqual(parseLocalTarget(executable), { executable, path: "" });
});

test("local identities are stable through rename and cannot collide with presets", () => {
  assert.equal(gameIdentity(local), gameIdentity({ ...local, name: "Renamed" }));
  assert.notEqual(gameIdentity(local), gameIdentity(preset));
  assert.equal(matchesGame(profile("local:editor"), { ...local, name: "Renamed" }), true);
  assert.equal(matchesGame(profile(), local), false);
  assert.equal(matchesGame(profile("local:other"), local), false);
  assert.equal(matchesGame(profile("local:editor"), preset), false);
  assert.equal(matchesGame(profile(), preset), true);
});

test("saved local profiles carry canonical metadata without changing preset schema", () => {
  assert.deepEqual(profileApplication(local), { name: "Editor", executable: "editor.exe", path: "C:\\Tools\\editor.exe", localId: "local:editor" });
  assert.deepEqual(profileApplication(preset), { name: "Editor", executable: "editor.exe", path: "" });
});

test("canonical local game and profile metadata retain activation, bundles and stable links", () => {
  const target = { id: "local:editor", name: "Editor", executable: "Editor", path: "/Applications/Editor.app/Contents/MacOS/Editor", kind: "app" as const, activation: "running" as const, bundlePath: "/Applications/Editor.app", bundleIdentifier: "org.editor" };
  assert.equal(typeof targets.localGame, "function");
  const game = targets.localGame(target);
  assert.deepEqual(game, { name: target.name, executables: [target.executable], id: target.id, source: "local", path: target.path, kind: target.kind, activation: target.activation, bundlePath: target.bundlePath, bundleIdentifier: target.bundleIdentifier });
  assert.deepEqual(profileApplication(game), { name: target.name, executable: target.executable, path: target.path, localId: target.id, activation: target.activation, bundlePath: target.bundlePath, bundleIdentifier: target.bundleIdentifier });
});

test("a local game carries Bridge's icon id to the grid but not into its profile", () => {
  const game = targets.localGame({ id: "local:hunt", name: "Hunt", executable: "HuntGame.exe", path: "C:\\Games\\HuntGame.exe", kind: "game", iconId: "abc" });
  assert.equal(game.iconId, "abc");
  assert.equal("iconId" in profileApplication(game), false);
  assert.equal("iconId" in targets.localGame({ id: "local:old", name: "Old", executable: "old.exe", path: "C:\\old.exe", kind: "game" }), false);
});

test("activation defaults preserve legacy category semantics without overriding explicit choice", () => {
  assert.equal(typeof targets.targetActivation, "function");
  assert.equal(targets.targetActivation({ kind: "app" }), "focused");
  assert.equal(targets.targetActivation({ kind: "game" }), "running");
  assert.equal(targets.targetActivation({ kind: "app", activation: "running" }), "running");
  assert.equal(targets.targetActivation({ kind: "game", activation: "focused" }), "focused");
});

test("duplicate targets respect Windows normalization and POSIX case", () => {
  assert.equal(localTargetIdentity({ executable: "Editor.EXE", path: "" }), localTargetIdentity({ executable: "editor.exe", path: "" }));
  assert.equal(localTargetIdentity({ executable: "editor.exe", path: "C:\\Tools\\Editor.exe" }), localTargetIdentity({ executable: "editor.exe", path: "c:/tools/editor.exe" }));
  assert.notEqual(localTargetIdentity({ executable: "Editor", path: "/bin/Editor" }), localTargetIdentity({ executable: "Editor", path: "/bin/editor" }));
  assert.notEqual(localTargetIdentity({ executable: "editor.exe", path: "" }), localTargetIdentity({ executable: "editor.exe", path: "C:/editor.exe" }));
});

test("clearing local settings preserves preset and other device profiles", () => {
  const others = [profile(), profile("local:other"), profile("local:editor", "mouse:two")];
  assert.deepEqual(replaceGameProfile([profile("local:editor"), ...others], local, "mouse:one", null), others);
  const changed = { ...profile("local:editor"), settings: { dpi: 1600, pollingRateHz: null } };
  assert.deepEqual(replaceGameProfile([profile("local:editor"), ...others], local, "mouse:one", changed), [...others, changed]);
});


test("manual target limits count Unicode characters without silently truncating", () => {
  assert.deepEqual(parseLocalTarget("a".repeat(255)), { executable: "a".repeat(255), path: "" });
  assert.equal(parseLocalTarget("a".repeat(256)), null);
  assert.deepEqual(parseLocalTarget("é".repeat(255)), { executable: "é".repeat(255), path: "" });
  const path = "/" + "d".repeat(767) + "/" + "e".repeat(255);
  assert.equal([...path].length, 1024);
  assert.deepEqual(parseLocalTarget(path), { executable: "e".repeat(255), path });
  assert.equal(parseLocalTarget("/" + path), null);
});

test("manual target paths cannot contain dot-segment aliases or Windows streams", () => {
  for (const value of ["C:/Tools/../editor.exe", "/bin/./editor", "C:/Tools:stream/editor.exe", "C:/Tools/editor.exe:stream", "//", "./editor.exe"]) assert.equal(parseLocalTarget(value), null, value);
});
