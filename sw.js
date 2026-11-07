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
const VERSION = "1.6.0";
const BUILD = "6789934fb7f5";
const PRECACHE = [
  ["index.html", "465a0fb37a01c271d463ddc363e7af9c134466de436860756a82532819b07f00"],
  ["styles.css", "2c7fbd57bef02c830b7a939268015e87238dcf7be9f1459895084d567cf27381"],
  ["app.js", "ea18056a670ff0e732d1b10f4659aa7d5291b94c4f4d11c339befbaee0d224f4"],
  ["manifest.json", "a4f08aa069682afea6c53c755be89c893ce997d6906b23438437cfada582a807"],
  ["icon.svg", "caff807cec8eb0dbd47994677233b36e351c5fa6251a68b6ed2afbf2df2a71d9"],
  ["src/version.js", "0c91f4346820ce6b203edb0e4a590cb028ad77476d07977e3240c57cf1291396"],
  ["src/currency.js", "06476d6bb85e254a513b2f7a461da8259a8a74a6fa923476c0766c477538090d"],
  ["src/validation.js", "e55d0acd852216ae0c37f7fa7d6d409d03eadfac86f64a0ee94e02d374ae4d68"],
  ["src/finance.js", "8224f61b97cd7324f444f5b8623f7a86b5bd082a4a05cef2c245ab36275bd60a"],
  ["src/data-model.js", "5088363c7517410d8cbaa3a1d3c59c99a6198b5a723a9f7f4fb5af091cf19476"],
  ["src/storage.js", "742a621ac845a7ab9669868b42fc93b9de26a5c168ec8e834856eab4ae81af88"],
  ["src/entries.js", "3ee42bb6bbda68e3d52aae439fd4b325e76104ce4d7cc0b35516a445a4c9adf7"],
  ["src/insights.js", "e44f10c4be8f96abd5bae34d71fd622a8b4db4308ddc442574f460423c4584d3"],
  ["src/charts.js", "50871b455b65e4513b994e66bff953a5f1b53bd4b8b7f9ae2fa5b1bf168f6283"],
  ["src/detective.js", "e4f5452db3b33a68b20e67ec68f295865eb36c824e64b1a0303cb5ac73257927"],
  ["icons/pesaotas-192.png", "97e946f552a52a987b9e63f95fbf5b3a925ff8c547842ec3dc23df25bedee10d"],
  ["icons/pesaotas-512.png", "05b3c99acd29d71f65ddec64bd7f40892a33b1c54c06587fdae9154f6f8a9aae"],
  ["icons/pesaotas-maskable-192.png", "56fb867347f6298709a5c0aa62bb2bf082897d964afb4c1d590f1d76be0fcebb"],
  ["icons/pesaotas-maskable-512.png", "2f29848b79a3c4ab98e75aa1e4915f875a01ed5eff32408cc32e9311033510b3"],
  ["icons/apple-touch-icon.png", "327db4490d8713c31cd8606655fd40ac8eb0725606167f84302c5b1578e47435"],
  ["icons/favicon-32.png", "abe022d8b19bc1b8478ec9881b35cae9057941edd9feebdb239c07eee171c07e"]
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
