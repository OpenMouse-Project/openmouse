import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const picomatch = require("picomatch");

test("repeated wildcard extglobs cannot block the build process", () => {
  const script = `
    const assert = require('node:assert/strict');
    const pm = require(${JSON.stringify(require.resolve("picomatch"))});
    for (const pattern of ['+(*)', '+(*a)', '*(a*)', '+(@(*a))', 'prefix+(*a)suffix', '+(*[ab])', '+(a*|b)', '+([*a)', '+([*])']) {
      for (const options of [{}, { maxExtglobRecursion: false }, { capture: true }, { nobracket: true }, { nobracket: true, maxExtglobRecursion: false }]) {
        if (pattern === '+([*])' && !options.nobracket) continue;
        const match = pm(pattern, options);
        assert.equal(match('a'.repeat(80) + '!'), false);
        assert.equal(match('[a'.repeat(40) + '!'), false);
        assert.equal(match(pattern), true);
      }
    }
  `;
  const child = spawnSync(process.execPath, ["-e", script], { timeout: 2000, encoding: "utf8" });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
});

test("normal file globs and safe extglobs keep matching", () => {
  assert.equal(picomatch("src/**/*.{ts,tsx}")("src/features/devices/MagneticButtons.tsx"), true);
  assert.equal(picomatch("src/**/*.{ts,tsx}")("src/styles/base.css"), false);
  assert.equal(picomatch("**/!(*.test).ts")("src/main.test.ts"), false);
  assert.equal(picomatch("**/!(*.test).ts")("src/main.ts"), true);
  assert.equal(picomatch("+(foo|bar)")("foobarfoo"), true);
  assert.equal(picomatch("+([a*])")("a*a"), true);
  assert.equal(picomatch("+([*])")("***"), true);
  assert.equal(picomatch("+(\\*)")("***"), true);
  assert.equal(typeof picomatch.scan("src/**/*.tsx").base, "string");
});

test("backslash removal handles unterminated bracket input in linear time", () => {
  const script = `
    const assert = require('node:assert/strict');
    const utils = require(${JSON.stringify(require.resolve("picomatch/lib/utils.js"))});
    for (const value of ['[' + ';'.repeat(200000), '['.repeat(50000) + ';'.repeat(50000)]) {
      assert.equal(utils.removeBackslashes(value), value);
    }
  `;
  const child = spawnSync(process.execPath, ["-e", script], { timeout: 2000, encoding: "utf8" });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
});

test("backslash removal preserves bracket, escape and newline behavior", () => {
  const { removeBackslashes } = require("picomatch/lib/utils.js");
  for (const [input, expected] of [
    ["a\\b", "ab"], ["a\\", "a\\"], ["a\\\nb", "a\\\nb"],
    ["[a\\b]", "[a\\b]"], ["[a\\]b]", "[a\\]b]"], ["[]]\\x", "[]]x"],
    ["[\\a", "[a"], ["[a\\\n]", "[a\\\n]"], ["[a\n\\b]", "[a\nb]"],
    ["\\[a\\b]", "[a\\b]"], ["[a\u2028\\b]", "[a\u2028b]"],
  ]) assert.equal(removeBackslashes(input), expected, JSON.stringify(input));
});

test("all build-tool consumers resolve the patched local fork", () => {
  const manifest = require("picomatch/package.json");
  assert.equal(manifest.name, "@openmouse/picomatch-safe");
  for (const consumer of ["vite", "fdir", "tinyglobby"]) {
    const consumerRequire = createRequire(require.resolve(`${consumer}/package.json`));
    assert.equal(consumerRequire.resolve("picomatch"), require.resolve("picomatch"));
  }
});
