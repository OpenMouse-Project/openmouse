import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { BYPASS, pageUrl, precachePages } from "../build/pwa-vite-plugin.ts";

test("every page in the repo is precached by one of the build targets", () => {
  const pages = readdirSync(".").filter((name) => name.endsWith(".html")).sort();
  const covered = [...new Set([...precachePages("app"), ...precachePages("landing")])].sort();

  assert.deepEqual(covered, pages);
});

test("each target serves its own root page from /", () => {
  assert.equal(pageUrl("index.html", "app"), "/");
  assert.equal(pageUrl("landing.html", "landing"), "/");
});

test("a page that is not the target's root keeps its own path", () => {
  assert.equal(pageUrl("check.html", "app"), "/check.html");
  assert.equal(pageUrl("landing.html", "app"), "/landing.html");
  assert.equal(pageUrl("index.html", "landing"), "/index.html");
});

test("an unknown target falls back to the app page set", () => {
  assert.deepEqual(precachePages("nonsense"), precachePages("app"));
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
