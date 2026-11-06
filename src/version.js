/**
 * The PesaOtas version number — the single place to change it for a release.
 * Loaded by index.html (shown in the app) and copied into sw.js by
 * `npm run release`. Keep it equal to "version" in package.json (tested).
 */
(function (root) {
  "use strict";
  root.PESAOTAS_VERSION = "1.5.0";
  if (typeof module === "object" && module.exports) module.exports = root.PESAOTAS_VERSION;
})(typeof self !== "undefined" ? self : this);
