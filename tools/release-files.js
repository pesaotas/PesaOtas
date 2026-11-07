/**
 * The files that make up the PesaOtas app — everything a browser needs, and
 * nothing else. Used by:
 *   - tools/stamp-sw.js   to fingerprint them into sw.js (offline cache list)
 *   - tools/build-site.js to publish ONLY these files to GitHub Pages
 *   - tests/release.test.js
 * Tests, docs, tools and anything else in the repository are never published.
 * When you add a file the app loads, add it here and run `npm run release`.
 */
"use strict";

const PRECACHE_FILES = Object.freeze([
  "index.html",
  "styles.css",
  "app.js",
  "manifest.json",
  "icon.svg",
  "src/version.js",
  "src/currency.js",
  "src/validation.js",
  "src/finance.js",
  "src/data-model.js",
  "src/storage.js",
  "src/entries.js",
  "src/insights.js",
  "src/charts.js",
  "src/detective.js",
  "icons/pesaotas-192.png",
  "icons/pesaotas-512.png",
  "icons/pesaotas-maskable-192.png",
  "icons/pesaotas-maskable-512.png",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png"
]);

/** Published files: the cached app files plus the service worker itself. */
const DEPLOY_FILES = Object.freeze([...PRECACHE_FILES, "sw.js"]);

module.exports = { PRECACHE_FILES, DEPLOY_FILES };
