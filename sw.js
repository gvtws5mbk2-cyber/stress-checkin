var CACHE_NAME = "stress-checkin-v25";
var ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./trends.html",
  "./trends.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

// Stale-while-revalidate: serveer direct uit de cache (snelle start) en
// ververs op de achtergrond. Nieuwe code komt binnen via de CACHE_NAME-bump:
// de nieuwe service worker haalt alle assets vers op en de app herlaadt
// zichzelf via controllerchange.
self.addEventListener("fetch", function (event) {
  var url = new URL(event.request.url);
  if (url.hostname === "api.github.com") return;
  if (event.request.method !== "GET") return;
  if (url.origin !== location.origin) return;

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      var network = fetch(event.request, { cache: "no-store" }).then(function (response) {
        if (response.ok) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, clone); });
        }
        return response;
      });
      if (cached) {
        network.catch(function () {});
        return cached;
      }
      return network.catch(function () {
        return caches.match("./index.html");
      });
    })
  );
});
