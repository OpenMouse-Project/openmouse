import { test } from "node:test";
import assert from "node:assert/strict";
import { BYPASS, pageUrl, PRECACHE_PAGES, renderServiceWorker } from "../build/pwa-vite-plugin.ts";

test("the root page is precached", () => {
  assert.deepEqual(PRECACHE_PAGES, ["index.html"]);
});

test("the root page serves from /, other pages keep their own path", () => {
  assert.equal(pageUrl("index.html"), "/");
  assert.equal(pageUrl("check.html"), "/check.html");
});

const bypassed = (path: string): boolean => BYPASS.some((pattern) => pattern.test(path));

test("api endpoints bypass the cache", () => {
  assert.equal(bypassed("/api/presence"), true);
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
  assert.equal(bypassed("/assets/main-abc123.js"), false);
  assert.equal(bypassed("/devices/razer-viper.webp"), false);
});

test("the generated worker caps the font cache", () => {
  const source = renderServiceWorker("test", []);
  assert.ok(source.includes("FONT_CACHE_LIMIT"));
  assert.ok(source.includes("trimCache(cacheName, FONT_CACHE_LIMIT)"));
});
