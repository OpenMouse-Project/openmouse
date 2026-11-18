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
    for (const pattern of ['+(*)', '+(*a)', '*(a*)', '+(@(*a))', 'prefix+(*a)suffix', '+(*[ab])', '+(a*|b)']) {
      for (const options of [{}, { maxExtglobRecursion: false }, { capture: true }]) {
        const match = pm(pattern, options);
        assert.equal(match('a'.repeat(80) + '!'), false);
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
  assert.equal(picomatch("+(\\*)")("***"), true);
  assert.equal(typeof picomatch.scan("src/**/*.tsx").base, "string");
});

test("all build-tool consumers resolve the patched local fork", () => {
  const manifest = require("picomatch/package.json");
  assert.equal(manifest.name, "@openmouse/picomatch-safe");
  for (const consumer of ["vite", "fdir", "tinyglobby"]) {
    const consumerRequire = createRequire(require.resolve(`${consumer}/package.json`));
    assert.equal(consumerRequire.resolve("picomatch"), require.resolve("picomatch"));
  }
});
