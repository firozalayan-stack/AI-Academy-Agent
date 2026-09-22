// Minimal service worker for the Labour Code Navigator PWA.
// Strategy: network-first for navigations/HTML so visitors always get the
// latest deployed content (this app has been updated often); falls back to
// a cached copy only when offline. Static assets (icons, manifest) are
// cached opportunistically. This also satisfies Chrome's installability
// requirement (an active service worker with a fetch handler).

var CACHE_NAME = "lcn-shell-v1";
var SHELL_URLS = [
  "/",
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon-maskable.svg"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(SHELL_URLS).catch(function () {
        // Best-effort — don't fail install if one asset can't be pre-cached.
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (key) { return key !== CACHE_NAME; })
          .map(function (key) { return caches.delete(key); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return; // never intercept POSTs (e.g. /api/chat)

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // don't touch cross-origin calls

  event.respondWith(
    fetch(req)
      .then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      })
      .catch(function () {
        return caches.match(req).then(function (cached) {
          return cached || caches.match("/");
        });
      })
  );
});
