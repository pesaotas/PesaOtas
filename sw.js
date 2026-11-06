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
const VERSION = "1.6.0-dev";
const BUILD = "3596467614bf";
const PRECACHE = [
  ["index.html", "bfce585f8a23f99c0b07a189054af6003637f206ce9725a83b78d6701ba359c4"],
  ["styles.css", "72e160faef44931430127303e10312118147aa925215ab760c94d81b0c9a0726"],
  ["app.js", "4622a7ba42f29adee19c21471431cd78f55b9b415c59b39d357be0391d3da866"],
  ["manifest.json", "18fb5c66878b0e9c51fd1de227dd252c0d65ea5397ed474dea8da72ec573a55f"],
  ["icon.svg", "b0ee30f9b7cb64ec62958e425fefe2cc0955b52a4aa7c8e8c7db13847f8ade9e"],
  ["src/version.js", "5842f002c2afb9566a8e3dcd9b0e35c879f7108b5d8756da43549ff29c601bcd"],
  ["src/currency.js", "06476d6bb85e254a513b2f7a461da8259a8a74a6fa923476c0766c477538090d"],
  ["src/validation.js", "e55d0acd852216ae0c37f7fa7d6d409d03eadfac86f64a0ee94e02d374ae4d68"],
  ["src/finance.js", "8224f61b97cd7324f444f5b8623f7a86b5bd082a4a05cef2c245ab36275bd60a"],
  ["src/data-model.js", "9b7814e420b2eeae3e8940d84272b44585a85bccd1d4e6c961f066ea15bbc83c"],
  ["src/storage.js", "58bfa9358a75f755468e7f9465e1010c36e58aa244c344b7b3edb95770d8283a"],
  ["src/entries.js", "3ee42bb6bbda68e3d52aae439fd4b325e76104ce4d7cc0b35516a445a4c9adf7"],
  ["src/insights.js", "8be260d6aac2c083aed8a10341b89cb3e51b66585149c33873d6b33f9d890570"],
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
