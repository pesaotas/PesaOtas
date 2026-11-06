/**
 * PesaOtas service worker — offline support and safe updates (decision D-14).
 *
 * Financial data is NEVER touched here. Service workers cannot read or write
 * localStorage, where all PesaOtas data lives. This file only keeps copies of
 * the app's own files (HTML, CSS, JavaScript, icons) so it works offline.
 *
 * How an update works:
 *  1. Every release lists each app file with a SHA-256 fingerprint (the block
 *     below, written by `npm run release`). Any change to any file changes this
 *     file, so the browser notices a new version.
 *  2. The new version installs in the background into its own cache. Unchanged
 *     files are copied from the current cache; changed files are downloaded
 *     (revalidating the browser's HTTP cache) and must match their fingerprint.
 *  3. If anything fails — offline, a server error, or a half-finished deployment
 *     still serving old files — the incomplete cache is deleted and the current
 *     version keeps working, online and offline. The browser retries at the
 *     next update check.
 *  4. A complete new version WAITS. The app shows "A new version is ready" and
 *     switches only when the user chooses Update now (message SKIP_WAITING).
 *     Exception: pages from v1.0–v1.4 have no update prompt, so when this
 *     worker replaces that older one it takes over by itself (the user sees the
 *     new version on the next launch).
 *  5. When a new version takes over, older PesaOtas app caches are removed.
 *     No other cache, and no data, is ever touched.
 */
"use strict";

// RELEASE:BEGIN — written by `npm run release`; do not edit by hand.
const VERSION = "1.5.0";
const BUILD = "6d4e69950ece";
const PRECACHE = [
  ["index.html", "e7ad2a045b067ea4348def49a6b5cfcc536491028e403a9441035320c20c971a"],
  ["styles.css", "78aa795931a9888d2d6638fb5eb245f703e9b1a046333fef68a8343ecb21b460"],
  ["app.js", "a98e95af8125b9c0c9ae915b67f268d489f96e1babe6c80e88bee92582ef38f8"],
  ["manifest.json", "18fb5c66878b0e9c51fd1de227dd252c0d65ea5397ed474dea8da72ec573a55f"],
  ["icon.svg", "b0ee30f9b7cb64ec62958e425fefe2cc0955b52a4aa7c8e8c7db13847f8ade9e"],
  ["src/version.js", "e3a7b23346b29cbf0d2508f64d884375e7648732d1a99dd5ea9543b5fd5a3f83"],
  ["src/validation.js", "9f0ec781e635863eac4f2eaaba6d5f063271a86a02d2dd259383bbb5a369cf43"],
  ["src/finance.js", "8224f61b97cd7324f444f5b8623f7a86b5bd082a4a05cef2c245ab36275bd60a"],
  ["src/data-model.js", "63ff560a251bd521c28866e02a866e338195fec959d4e649c322e2649918d29a"],
  ["src/storage.js", "ba97aeff187b0339cc6551e480dea51379627343bb41431c854b5f1c0cc721b6"],
  ["src/entries.js", "fddfce55420804c146f7be3e840c3761f457df5e5db048d6e41aad51f4b9bd1a"],
  ["icons/icon-192.png", "8108201013d2b840110e15cf673aebf8d8442539ee411d5c2e9617f410e4bd5c"],
  ["icons/icon-512.png", "bc3188217d1dabe481bab6051cf5f89c237f0ecb0753a62f6cfa50593ece3611"],
  ["icons/maskable-192.png", "14bb41445fa81172f3380fe46bc3804cded7f7a61dd7351d85df7b18a0944f48"],
  ["icons/maskable-512.png", "019aff6cf98d49cfc0084f33295247dd9ff932056a022bfbbbe2ae45d73b0d3d"],
  ["icons/apple-touch-icon.png", "7eccbdd1f592207b20dc7ebfde092ff5c76cef4a697c002423c29a0d8246aa68"],
  ["icons/favicon-32.png", "d5a8b3f7a666c29af79b61903a3876f43ff2d1f5ab097da05ddf655ac6a8d0ca"]
];
// RELEASE:END

const PREFIX = "pesaotas-shell-";
const CACHE = `${PREFIX}${VERSION}-${BUILD}`;
const LEGACY = /^(pesaflow-v|pesaotas-v)\d/; // cache names used by v1.0–v1.4
const TEXT = /\.(html|css|js|json|svg)$/i;

const scopeURL = (path) => new URL(path, self.registration.scope).href;
const ownCache = (name) => name !== CACHE && (name.startsWith(PREFIX) || LEGACY.test(name));

/** SHA-256 of a response body. Text: byte-order mark removed, CRLF read as LF (same as tools/stamp-sw.js). */
async function fingerprint(response, path) {
  let data = await response.arrayBuffer();
  if (TEXT.test(path)) {
    const text = new TextDecoder("utf-8").decode(data).replace(/\r\n/g, "\n"); // TextDecoder drops a BOM
    data = new TextEncoder().encode(text);
  }
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

self.addEventListener("install", event => {
  event.waitUntil(installVersion());
});

async function installVersion() {
  const existed = await caches.has(CACHE);
  const cache = await caches.open(CACHE);
  try {
    const previous = (await caches.keys()).filter(ownCache);
    for (const [path, hash] of PRECACHE) {
      const url = scopeURL(path);
      const have = await cache.match(url);
      if (have && await fingerprint(have, path) === hash) continue;
      let reused = false;
      for (const name of previous) {
        const old = await (await caches.open(name)).match(url);
        if (old && await fingerprint(old.clone(), path) === hash) {
          await cache.put(url, old);
          reused = true;
          break;
        }
      }
      if (reused) continue;
      const response = await fetch(url, { cache: "no-cache" });
      if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
      if (await fingerprint(response.clone(), path) !== hash) {
        throw new Error(`${path} doesn't match PesaOtas ${VERSION} yet (deployment may still be in progress)`);
      }
      await cache.put(url, response);
    }
  } catch (error) {
    // Never leave a half-built version behind. A cache that already existed
    // belongs to a working version, so it is left alone.
    if (!existed) await caches.delete(CACHE);
    throw error;
  }
  const names = await caches.keys();
  const replacingLegacy = names.some(n => LEGACY.test(n)) && !names.some(n => n.startsWith(PREFIX) && n !== CACHE);
  if (replacingLegacy) await self.skipWaiting();
}

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(ownCache).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  event.respondWith(respond(request, url));
});

async function respond(request, url) {
  const cache = await caches.open(CACHE);
  const path = url.href.slice(self.registration.scope.length).split(/[?#]/)[0];
  const isApp = request.mode === "navigate" && (path === "" || path === "index.html");
  const cached = await cache.match(isApp ? scopeURL("index.html") : scopeURL(path));
  if (cached) return cached;
  try {
    return await fetch(request);
  } catch (error) {
    if (request.mode === "navigate") {
      const app = await cache.match(scopeURL("index.html"));
      if (app) return app;
    }
    return Response.error();
  }
}

self.addEventListener("message", event => {
  const data = event.data || {};
  if (data.type === "SKIP_WAITING") self.skipWaiting();
  if (data.type === "GET_VERSION" && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ version: VERSION, build: BUILD });
  }
});
