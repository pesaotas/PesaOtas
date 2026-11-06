#!/usr/bin/env node
/**
 * Builds the folder that is published to GitHub Pages: ONLY the app files
 * listed in tools/release-files.js, plus an empty .nojekyll. Nothing else from
 * the repository — no tests, docs, tools or stray files (for example a backup
 * someone saved into the folder by mistake) — can be published this way.
 *
 *   node tools/build-site.js [outDir]     default: _site
 *
 * For safety it only replaces an output folder that is empty or contains a
 * previous build. No dependencies.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { DEPLOY_FILES } = require("./release-files.js");
const { stamp, check } = require("./stamp-sw.js");

const ROOT = path.join(__dirname, "..");
const EXTRA = [".nojekyll"];

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(p, base) : [path.relative(base, p).split(path.sep).join("/")];
  });
}

function build(outDir) {
  const allowed = new Set([...DEPLOY_FILES, ...EXTRA]);
  if (fs.existsSync(outDir)) {
    const foreign = listFiles(outDir).filter(f => !allowed.has(f));
    if (foreign.length) throw new Error(`Refusing to replace ${outDir}: it contains files that aren't from a previous build (${foreign.slice(0, 5).join(", ")}).`);
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  for (const f of DEPLOY_FILES) {
    const from = path.join(ROOT, f), to = path.join(outDir, f);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
  fs.writeFileSync(path.join(outDir, ".nojekyll"), "");
  const stamped = stamp(outDir);
  const verified = check(outDir);
  if (!verified.ok) throw new Error(`Build check failed: ${verified.stale.join(", ")}`);
  const published = listFiles(outDir).sort();
  const extra = published.filter(f => !allowed.has(f));
  if (extra.length) throw new Error(`Unexpected files in the build: ${extra.join(", ")}`);
  return { outDir, version: stamped.version, build: stamped.build, files: published };
}

module.exports = { build };

if (require.main === module) {
  const outDir = path.resolve(process.argv[2] || path.join(ROOT, "_site"));
  try {
    const r = build(outDir);
    console.log(`Built PesaOtas ${r.version} (build ${r.build}) into ${r.outDir}: ${r.files.length} files.`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
