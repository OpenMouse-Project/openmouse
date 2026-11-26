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

const ORIGIN = "https://control.openmouse.app";
const html = (): Response => new Response("<!doctype html>", { headers: { "Content-Type": "text/html; charset=utf-8" } });
const script = (): Response => new Response("export {};", { headers: { "Content-Type": "application/javascript" } });

/** Runs the generated worker against an in-memory Cache API and a stub network. */
function loadWorker(precache: string[], network: (url: string) => Response) {
  const stored = new Map<string, Response>();
  const cache = {
    // Like the real cache.add(): any ok response is stored, whatever its type.
    add: async (url: string) => {
      const response = await fetch(url);
      if (!response.ok) throw new TypeError(`${url} answered ${response.status}`);
      await cache.put(url, response);
    },
    match: async (request: Request | string) => stored.get(new URL(typeof request === "string" ? request : request.url, ORIGIN).href)?.clone(),
    put: async (request: Request | string, response: Response) => void stored.set(new URL(typeof request === "string" ? request : request.url, ORIGIN).href, response),
  };
  const listeners = new Map<string, (event: unknown) => void>();
  const fetched: string[] = [];
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: (event: unknown) => void) => void listeners.set(type, listener),
    skipWaiting: async () => {},
  };
  const caches = { open: async () => cache, match: cache.match };
  const fetch = async (request: Request | string) => {
    const url = new URL(typeof request === "string" ? request : request.url, ORIGIN).href;
    fetched.push(url);
    return network(url);
  };
  new Function("self", "caches", "fetch", renderServiceWorker("test", precache))(self, caches, fetch);

  return {
    stored,
    fetched,
    async install(): Promise<void> {
      let done: Promise<unknown> = Promise.resolve();
      listeners.get("install")!({ waitUntil: (promise: Promise<unknown>) => void (done = promise) });
      await done;
    },
    async request(path: string): Promise<Response> {
      let response: Promise<Response> | undefined;
      const request = new Request(new URL(path, ORIGIN));
      listeners.get("fetch")!({ request, respondWith: (value: Promise<Response>) => void (response = value) });
      assert.ok(response, `${path} was handled by the worker`);
      return response;
    },
  };
}

test("an asset answered with the HTML fallback is not precached", async () => {
  const worker = loadWorker(["/", "/assets/main-new.js", "/assets/registry-old.js"], (url) =>
    url.endsWith("registry-old.js") || url.endsWith("/") ? html() : script());
  await worker.install();
  assert.deepEqual([...worker.stored.keys()].sort(), [`${ORIGIN}/`, `${ORIGIN}/assets/main-new.js`]);
});

test("a pruned chunk that comes back as HTML is not cached", async () => {
  const worker = loadWorker([], html);
  const response = await worker.request("/assets/registry-old.js");
  assert.match(response.headers.get("Content-Type") ?? "", /text\/html/);
  assert.equal(worker.stored.size, 0);
});

test("a mixed-case HTML content type is still recognised", async () => {
  const worker = loadWorker([], () => new Response("<!doctype html>", { headers: { "Content-Type": "Text/HTML; charset=utf-8" } }));
  await worker.request("/assets/registry-old.js");
  assert.equal(worker.stored.size, 0);
});

test("a cached HTML copy of an asset is treated as a miss", async () => {
  const worker = loadWorker([], script);
  worker.stored.set(`${ORIGIN}/assets/registry-new.js`, html());
  const response = await worker.request("/assets/registry-new.js");
  assert.equal(response.headers.get("Content-Type"), "application/javascript");
  assert.deepEqual(worker.fetched, [`${ORIGIN}/assets/registry-new.js`]);
  assert.equal(worker.stored.get(`${ORIGIN}/assets/registry-new.js`)?.headers.get("Content-Type"), "application/javascript");
});

test("cached assets are still served without touching the network", async () => {
  const worker = loadWorker([], script);
  worker.stored.set(`${ORIGIN}/assets/main-new.js`, script());
  await worker.request("/assets/main-new.js");
  assert.deepEqual(worker.fetched, []);
});
