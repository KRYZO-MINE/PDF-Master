const CACHE_NAME = "pdf-master-shell-__PRECACHE_REVISION__";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const manifestResponse = await fetch("/precache-manifest.json", { cache: "no-store" });
    if (!manifestResponse.ok) throw new Error("Could not load the PDF MASTER offline asset manifest.");
    const manifest = await manifestResponse.json();
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(["/", ...manifest.urls]);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.filter((name) => name.startsWith("pdf-master-shell-") && name !== CACHE_NAME).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request, { ignoreVary: true }) || await cache.match("/", { ignoreVary: true });
      if (cached) return cached;
      try {
        return await fetch(request);
      } catch {
        return cache.match("/offline.html", { ignoreVary: true });
      }
    })());
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreVary: true });
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
      await cache.put(request, response.clone());
    }
    return response;
  })());
});
