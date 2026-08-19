const CACHE_NAME = "htn-attendance-v2";
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

// Network-first for the app shell: always try to fetch the latest version
// first, and only fall back to the cached copy if the network request
// fails (offline / flaky connection). This is what makes deploys actually
// reach phones - the old cache-first version could serve a stale app shell
// indefinitely, since nothing ever forced it to re-check the network.
// API calls are never intercepted - attendance data must always be live.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return;
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
