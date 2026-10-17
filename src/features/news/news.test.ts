import assert from "node:assert/strict";
import test from "node:test";
import { fetchNews } from "./news.ts";

const CDN_URL = "https://cdn.jsdelivr.net/gh/OpenMouse-Project/openmouse@main/public/news.json";
const FALLBACK_URL = "/news.json";

function withFetch(
  handler: (url: string) => Promise<Response>,
  fn: () => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => handler(String(input));
  return fn().finally(() => {
    globalThis.fetch = originalFetch;
  });
}

test("news is parsed from the CDN payload", async () => {
  let requested = "";
  await withFetch(async (url) => {
    requested = url;
    return Response.json({
      id: "razer",
      level: "critical",
      message: "Razer mice may not be detected.",
      url: "https://openmouse.app/blog/razer-windows-chrome-153",
    });
  }, async () => {
    const item = await fetchNews();
    assert.equal(requested, CDN_URL);
    assert.deepEqual(item, {
      id: "razer",
      level: "critical",
      message: "Razer mice may not be detected.",
      url: "https://openmouse.app/blog/razer-windows-chrome-153",
    });
  });
});

test("falls back to the bundled copy when the CDN is unreachable", async () => {
  const requested: string[] = [];
  await withFetch(async (url) => {
    requested.push(url);
    if (url === CDN_URL) throw new TypeError("network error");
    return Response.json({ id: "razer", level: "warning", message: "Still here." });
  }, async () => {
    const item = await fetchNews();
    assert.deepEqual(requested, [CDN_URL, FALLBACK_URL]);
    assert.equal(item?.id, "razer");
  });
});

test("falls back when the CDN answers with an error status", async () => {
  const requested: string[] = [];
  await withFetch(async (url) => {
    requested.push(url);
    if (url === CDN_URL) return new Response("nope", { status: 503 });
    return Response.json({ id: "razer", message: "Bundled copy." });
  }, async () => {
    const item = await fetchNews();
    assert.deepEqual(requested, [CDN_URL, FALLBACK_URL]);
    assert.equal(item?.message, "Bundled copy.");
  });
});

test("an unknown level degrades to info instead of hiding the notice", async () => {
  await withFetch(
    async () => Response.json({ id: "x", level: "banana", message: "Hello" }),
    async () => {
      assert.equal((await fetchNews())?.level, "info");
    },
  );
});

test("a payload without a message or id produces no banner", async () => {
  await withFetch(
    async () => Response.json({ id: "x", level: "critical" }),
    async () => {
      assert.equal(await fetchNews(), null);
    },
  );
});

test("an aborted request does not retry against the fallback", async () => {
  const requested: string[] = [];
  const controller = new AbortController();
  controller.abort();
  await withFetch(async (url) => {
    requested.push(url);
    throw new DOMException("Aborted", "AbortError");
  }, async () => {
    await assert.rejects(() => fetchNews(controller.signal));
  });
  assert.deepEqual(requested, [CDN_URL]);
});
