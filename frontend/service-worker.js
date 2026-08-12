const CACHE_NAME = "htn-attendance-v1";
const CORE_ASSETS = [
  "/index.html",
  "/manifest.json",
  "/css/styles.css",
  "/js/api.js",
  "/js/app.js",
  "/js/admin.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Cache-first for the app shell, network for everything else (API calls
// should always hit the network - never cache attendance data).
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return; // never intercept API calls

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
