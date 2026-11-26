import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import { displayTemplate, displayText, ensureLocale, tp } from "./index.ts";
import { trExtra } from "./locales/tr-extra.ts";

test("Turkish legacy display catalog translates every literal entry", async () => {
  await ensureLocale("tr");
  for (const [english, turkish] of Object.entries(trExtra)) {
    if (/\{\w+\}/.test(english)) continue;
    assert.equal(displayText("tr", english), turkish, english);
    assert.equal(displayText("en", english), english, english);
  }
});

test("Turkish dynamic messages translate values and preserve user names", async () => {
  await ensureLocale("tr");
  assert.equal(displayText("tr", "~3.3 days"), "~3.3 gün");
  assert.equal(displayText("tr", "Mouse 1611 · Receiver 0116"), "Fare 1611 · Alıcı 0116");
  assert.equal(displayText("tr", "Loaded Default."), "Default yüklendi.");
  assert.equal(displayText("tr", "Push this profile to your mouse the moment Default is detected running."), "Default çalıştığında bu profil farenize uygulanır.");
  assert.equal(displayText("tr", "Opening Default discards them. Continue?"), "Default açılırsa kaydedilmemiş değişiklikler silinir. Devam edilsin mi?");
  assert.equal(displayText("tr", "both actuation"), "Her iki düğmenin tetikleme noktası");
  assert.equal(displayText("tr", "  Breathing dual  "), "  Nefes alma (iki renk)  ");
  assert.equal(displayText("tr", 1600), 1600);
  assert.equal(displayText("tr", undefined), undefined);
  assert.equal(displayText("tr", "UnknownFutureProtocolCode"), "UnknownFutureProtocolCode");
});

test("Turkish elapsed time, status and whole sentences retain their actual values", async () => {
  await ensureLocale("tr");
  assert.equal(tp("tr", "hw.finishTime", { s: "4.2" }), "4.2 saniyede tamamlandı");
  assert.equal(tp("tr", "ctl.pairEnded", { s: 7 }), "Eşleştirme, fare çevrimiçi olmadan sona erdi (durum 7).");
  assert.equal(displayText("tr", "Finished in 4.2 s"), "4.2 saniyede tamamlandı");
  assert.equal(displayText("tr", "Pairing ended without an online mouse (status 7)."), "Eşleştirme, fare çevrimiçi olmadan sona erdi (durum 7).");
  assert.equal(displayText("tr", "About 80 h per full charge at 1,000 Hz"), "1,000 Hz hızında tam şarjla yaklaşık 80 saat");
  const source = "{from} has {n} change{s} you have not flashed:\n\n{changes}\n\nOpening {to} discards {pronoun}. Continue?";
  const vars = { from: "Default", n: 2, s: "s", changes: "  • DPI 800\n  • DPI 1600", to: "Mouse 1611", pronoun: "them" };
  const message = displayTemplate("tr", source, vars);
  assert.equal(message, "Default profilinde fareye yazılmamış 2 değişiklik var:\n\n  • DPI 800\n  • DPI 1600\n\nMouse 1611 açılırsa bu değişiklikler silinir. Devam edilsin mi?");
  assert.ok(displayTemplate("en", source, vars).startsWith("Default has 2 changes"));
});

test("control UI contains no untranslated static JSX copy outside technical names", () => {
  const root = dirname(fileURLToPath(import.meta.url));
  const technical = new Set(["Hz", "G-Shift", "G", "ms", "mm", "LightForce", "v", "LUNAFURY", "Easy-Switch", "W", "INCOTT", "FINALMOUSE", "X", "Y", "PRO", "x", "y", "Bridge", "OpenMouse", "0x"]);
  const missing: string[] = [];
  const visitFiles = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visitFiles(path);
      else if (entry.name.endsWith(".tsx")) {
        const file = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        const visit = (node: ts.Node): void => {
          if (ts.isJsxText(node)) {
            const value = node.text.replace(/\s+/g, " ").trim();
            if (/[A-Za-z]/.test(value) && !technical.has(value)) missing.push(`${entry.name}: ${value}`);
          }
          ts.forEachChild(node, visit);
        };
        visit(file);
      }
    }
  };
  for (const area of ["app", "features", "shared"]) visitFiles(join(root, "..", area));
  assert.deepEqual(missing, []);
});
