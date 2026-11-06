#!/usr/bin/env node
/**
 * Writes the release block into sw.js: the version, a build ID, and a SHA-256
 * fingerprint of every app file. Any change to any app file therefore changes
 * sw.js, which is how browsers detect a new version (decision D-14).
 *
 *   node tools/stamp-sw.js            stamp the repository's sw.js
 *   node tools/stamp-sw.js <dir>      stamp <dir>/sw.js (used for _site)
 *   node tools/stamp-sw.js --check    exit 1 if sw.js is out of date
 *
 * Text files are fingerprinted with Windows line endings (CRLF) treated as LF
 * and any byte-order mark removed — the service worker does exactly the same —
 * so editing on Windows can't break updates. No dependencies.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { PRECACHE_FILES } = require("./release-files.js");

const TEXT = /\.(html|css|js|json|svg)$/i;
const BEGIN = "// RELEASE:BEGIN";
const END = "// RELEASE:END";

function fingerprintBuffer(buffer, file) {
  let data = buffer;
  if (TEXT.test(file)) {
    data = Buffer.from(buffer.toString("utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n"), "utf8");
  }
  return crypto.createHash("sha256").update(data).digest("hex");
}

function readVersion(dir) {
  const text = fs.readFileSync(path.join(dir, "src/version.js"), "utf8");
  const m = text.match(/PESAOTAS_VERSION\s*=\s*"(\d+\.\d+\.\d+)"/);
  if (!m) throw new Error("Couldn't find PESAOTAS_VERSION in src/version.js");
  return m[1];
}

/** The release block for the files in `dir`. */
function computeRelease(dir) {
  const missing = PRECACHE_FILES.filter(f => !fs.existsSync(path.join(dir, f)));
  if (missing.length) throw new Error(`Missing app files: ${missing.join(", ")}`);
  const entries = PRECACHE_FILES.map(f => [f, fingerprintBuffer(fs.readFileSync(path.join(dir, f)), f)]);
  const version = readVersion(dir);
  const build = crypto.createHash("sha256").update(entries.map(e => e.join(":")).join("\n")).digest("hex").slice(0, 12);
  const lines = [
    `${BEGIN} — written by \`npm run release\`; do not edit by hand.`,
    `const VERSION = "${version}";`,
    `const BUILD = "${build}";`,
    "const PRECACHE = [",
    ...entries.map(([f, h], i) => `  ["${f}", "${h}"]${i < entries.length - 1 ? "," : ""}`),
    "];",
    END
  ];
  return { version, build, entries, block: lines.join("\n") };
}

function currentBlock(swText) {
  const a = swText.indexOf(BEGIN), b = swText.indexOf(END);
  if (a < 0 || b < a) throw new Error("sw.js has no RELEASE:BEGIN / RELEASE:END block");
  return { a, b: b + END.length, block: swText.slice(a, b + END.length) };
}

function stamp(dir) {
  const swPath = path.join(dir, "sw.js");
  const sw = fs.readFileSync(swPath, "utf8");
  const release = computeRelease(dir);
  const at = currentBlock(sw);
  const next = sw.slice(0, at.a) + release.block + sw.slice(at.b);
  if (next !== sw) fs.writeFileSync(swPath, next);
  return { ...release, changed: next !== sw };
}

/** Which files differ between sw.js and what's on disk (empty = up to date). */
function check(dir) {
  const sw = fs.readFileSync(path.join(dir, "sw.js"), "utf8");
  const release = computeRelease(dir);
  const block = currentBlock(sw).block;
  if (block === release.block) return { ok: true, version: release.version, build: release.build, stale: [] };
  const stamped = new Map([...block.matchAll(/\["([^"]+)", "([0-9a-f]{64})"\]/g)].map(m => [m[1], m[2]]));
  const stale = release.entries.filter(([f, h]) => stamped.get(f) !== h).map(([f]) => f);
  for (const f of stamped.keys()) if (!PRECACHE_FILES.includes(f)) stale.push(`${f} (no longer an app file)`);
  if (!block.includes(`const VERSION = "${release.version}";`)) stale.push("src/version.js (version number)");
  return { ok: false, version: release.version, build: release.build, stale };
}

module.exports = { fingerprintBuffer, computeRelease, stamp, check, TEXT };

if (require.main === module) {
  const args = process.argv.slice(2);
  const dir = path.resolve(args.find(a => !a.startsWith("--")) || path.join(__dirname, ".."));
  try {
    if (args.includes("--check")) {
      const r = check(dir);
      if (r.ok) { console.log(`sw.js is up to date (PesaOtas ${r.version}, build ${r.build}).`); process.exit(0); }
      console.error(`sw.js is out of date for: ${r.stale.join(", ")}.\nRun: npm run release`);
      process.exit(1);
    }
    const r = stamp(dir);
    console.log(`${r.changed ? "Stamped" : "Already up to date:"} sw.js — PesaOtas ${r.version}, build ${r.build}, ${r.entries.length} files.`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
