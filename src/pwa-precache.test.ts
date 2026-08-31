import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { BYPASS, PRECACHE_PAGES } from "../build/pwa-vite-plugin.ts";

test("every page in the repo is precached, so none of them break offline", () => {
  const pages = readdirSync(".").filter((name) => name.endsWith(".html")).sort();

  assert.deepEqual([...PRECACHE_PAGES].sort(), pages);
});

const bypassed = (path: string): boolean => BYPASS.some((pattern) => pattern.test(path));

test("vote and request endpoints bypass the cache", () => {
  assert.equal(bypassed("/api/mouse-vote"), true);
  assert.equal(bypassed("/api/voting-config"), true);
});

// These live on main, behind the licence middleware. Caching either one would
// let a revoked session keep working, so the bypass has to survive a merge.
test("the licensed control app and its bundle bypass the cache", () => {
  assert.equal(bypassed("/control-app.html"), true);
  assert.equal(bypassed("/control-app"), true);
  assert.equal(bypassed("/protected-assets/control-abc123.js"), true);
  assert.equal(bypassed("/control"), true);
  assert.equal(bypassed("/control.html"), true);
});

test("ordinary pages and assets are still cached", () => {
  assert.equal(bypassed("/"), false);
  assert.equal(bypassed("/supported.html"), false);
  assert.equal(bypassed("/assets/main-abc123.js"), false);
  assert.equal(bypassed("/devices/razer-viper.webp"), false);
  assert.equal(bypassed("/contributors.html"), false);
});
