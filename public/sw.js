const CACHE = "openmouse";
const CACHEABLE_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

function isImmutable(url) {
  if (url.origin === self.location.origin) {
    return url.pathname.startsWith("/assets/") || url.pathname === "/favicon.ico";
  }
  return CACHEABLE_HOSTS.includes(url.hostname);
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(["/index.html", "/favicon.ico"]).catch(() => undefined);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        (await caches.open(CACHE)).put("/index.html", response.clone());
        return response;
      } catch {
        return await caches.match("/index.html") ?? Response.error();
      }
    })());
    return;
  }

  if (!isImmutable(new URL(request.url))) return;

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok || response.type === "opaque") {
      (await caches.open(CACHE)).put(request, response.clone());
    }
    return response;
  })());
});
