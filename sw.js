// Bump CACHE_NAME whenever APP_FILES or any cached file changes, so installed
// copies fetch the new files. (A proper update strategy is planned for Phase 5.)
const CACHE_NAME = "pesaotas-v1.4.0";
const APP_FILES = [
  "./", "./index.html", "./styles.css",
  "./src/validation.js", "./src/finance.js", "./src/data-model.js", "./src/storage.js", "./src/entries.js",
  "./app.js", "./manifest.json", "./icon.svg"
];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_FILES)));
  self.skipWaiting();
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match("./index.html"))));
});