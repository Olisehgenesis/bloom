const CACHE_NAME = "bloom-pwa-v5";
const URLS_TO_CACHE = [
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/favicon-32.png",
  "/favicon-16.png",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(URLS_TO_CACHE)),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.origin) return;

  // Never cache (let the network/Next.js handle):
  //  - API routes
  //  - HTML navigations (document requests)
  //  - Next.js build assets / RSC / HMR
  //  - React Server Component payloads (?_rsc=...)
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/_next/") ||
    url.searchParams.has("_rsc") ||
    request.headers.get("RSC") ||
    request.mode === "navigate" ||
    request.destination === "document"
  ) {
    return;
  }

  // Stale-while-revalidate for small static assets (icons, manifest, images).
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});

// Allow the client to force an immediate SW activation after a deploy.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
