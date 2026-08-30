import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { BYPASS, PRECACHE_PAGES } from "../build/pwa-vite-plugin.ts";

test("every page in the repo is precached, so none of them break offline", () => {
  const pages = readdirSync(".").filter((name) => name.endsWith(".html")).sort();
  const precached = PRECACHE_PAGES.map((page) => page.file).sort();

  assert.deepEqual(precached, pages);
});

test("the root page is precached at / rather than /index.html", () => {
  const index = PRECACHE_PAGES.find((page) => page.file === "index.html");

  assert.equal(index?.url, "/");
});

test("every other page is precached at its own path", () => {
  for (const page of PRECACHE_PAGES) {
    if (page.file === "index.html") continue;
    assert.equal(page.url, `/${page.file}`);
  }
});

test("vote and request endpoints bypass the cache", () => {
  const bypassed = (path: string): boolean => BYPASS.some((pattern) => pattern.test(path));

  assert.equal(bypassed("/api/mouse-vote"), true);
  assert.equal(bypassed("/api/voting-config"), true);
  assert.equal(bypassed("/"), false);
  assert.equal(bypassed("/supported.html"), false);
  assert.equal(bypassed("/assets/main-abc123.js"), false);
  assert.equal(bypassed("/devices/razer-viper.webp"), false);
});
