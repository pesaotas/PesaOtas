/**
 * Release and deployment checks (Phase 5, decision D-14): the service worker's
 * file list is current, the install manifest and icons are valid, every path
 * works under a GitHub Pages subpath, nothing third-party is loaded, and no
 * personal data can end up in the repository or the published site.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { PRECACHE_FILES, DEPLOY_FILES } = require("../tools/release-files.js");
const stamp = require("../tools/stamp-sw.js");
const { build } = require("../tools/build-site.js");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const pngSize = (f) => {
  const b = fs.readFileSync(path.join(ROOT, f));
  assert.equal(b.toString("hex", 0, 8), "89504e470d0a1a0a", `${f} is not a PNG`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};
const hasGit = (() => {
  try { execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: ROOT, stdio: "pipe" }); return true; }
  catch { return false; }
})();

describe("release block in sw.js", () => {
  it("is up to date with every app file (run `npm run release` after changing a file)", () => {
    const result = stamp.check(ROOT);
    assert.ok(result.ok, `sw.js is out of date for: ${(result.stale || []).join(", ")}`);
  });

  it("uses the same version as package.json and src/version.js", () => {
    const pkg = JSON.parse(read("package.json")).version;
    assert.equal(require("../src/version.js"), pkg);
    assert.match(read("sw.js"), new RegExp(`const VERSION = "${pkg.replace(/\./g, "\\.")}";`));
  });

  it("lists only files that exist, and every file the app loads", () => {
    for (const f of PRECACHE_FILES) assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} missing`);
    const html = read("index.html");
    const refs = [...html.matchAll(/\b(?:href|src)="([^"#]+)"/g)].map(m => m[1]);
    assert.ok(refs.length >= 10);
    for (const r of refs) assert.ok(PRECACHE_FILES.includes(r), `${r} is used by index.html but not cached`);
    const manifest = JSON.parse(read("manifest.json"));
    for (const icon of manifest.icons) assert.ok(PRECACHE_FILES.includes(icon.src), `${icon.src} not cached`);
    assert.ok(!PRECACHE_FILES.includes("sw.js"), "the service worker must not cache itself");
    assert.deepEqual(DEPLOY_FILES, [...PRECACHE_FILES, "sw.js"]);
  });

  it("fingerprints text the same with Windows line endings or a byte-order mark", () => {
    const lf = Buffer.from("a\nb\n");
    assert.equal(stamp.fingerprintBuffer(Buffer.from("a\r\nb\r\n"), "x.js"), stamp.fingerprintBuffer(lf, "x.js"));
    assert.equal(stamp.fingerprintBuffer(Buffer.from("﻿a\nb\n"), "x.css"), stamp.fingerprintBuffer(lf, "x.css"));
    // Images are compared byte for byte.
    assert.notEqual(stamp.fingerprintBuffer(Buffer.from("a\r\nb\r\n"), "x.png"), stamp.fingerprintBuffer(lf, "x.png"));
  });

  it("changes the build when any single file changes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pesaotas-release-"));
    try {
      for (const f of DEPLOY_FILES) {
        fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
        fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
      }
      const before = stamp.computeRelease(dir).build;
      fs.appendFileSync(path.join(dir, "styles.css"), "\n/* changed */\n");
      assert.notEqual(stamp.computeRelease(dir).build, before);
      assert.equal(stamp.check(dir).ok, false);
      stamp.stamp(dir);
      assert.equal(stamp.check(dir).ok, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("install manifest and icons", () => {
  const manifest = JSON.parse(read("manifest.json"));

  it("has the name, colours and display settings browsers need to install it", () => {
    assert.equal(manifest.name, "PesaOtas — Personal Finance");
    assert.equal(manifest.short_name, "PesaOtas");
    assert.equal(manifest.display, "standalone");
    assert.equal(manifest.start_url, "./");
    assert.equal(manifest.scope, "./");
    assert.equal(manifest.id, "./");
    assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
    assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
    assert.match(read("index.html"), new RegExp(`<meta name="theme-color" content="${manifest.theme_color}">`));
  });

  it("lists PNG icons whose real sizes match, including maskable ones", () => {
    const png = manifest.icons.filter(i => i.type === "image/png");
    for (const size of ["192x192", "512x512"]) {
      for (const purpose of ["any", "maskable"]) {
        assert.ok(png.some(i => i.sizes === size && i.purpose === purpose), `${size} ${purpose} icon missing`);
      }
    }
    for (const icon of png) {
      const [w, h] = pngSize(icon.src);
      assert.equal(`${w}x${h}`, icon.sizes, icon.src);
    }
    assert.deepEqual(pngSize("icons/apple-touch-icon.png"), [180, 180]);
    assert.deepEqual(pngSize("icons/favicon-32.png"), [32, 32]);
  });
});

describe("works under a GitHub Pages subpath, with nothing third-party", () => {
  it("uses only relative paths", () => {
    const html = read("index.html");
    for (const m of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
      assert.ok(!m[1].startsWith("/") && !/^[a-z]+:/i.test(m[1]), `absolute path: ${m[1]}`);
    }
    for (const icon of JSON.parse(read("manifest.json")).icons) assert.ok(!icon.src.startsWith("/"));
    assert.match(read("app.js"), /register\("\.\/sw\.js"\)/);
    assert.doesNotMatch(read("sw.js"), /["'`]\/(?!\/)/, "sw.js must not use paths from the site root");
  });

  it("loads nothing from other websites and sends nothing anywhere", () => {
    for (const f of DEPLOY_FILES.filter(f => /\.(html|css|js|json|svg)$/.test(f))) {
      const urls = [...read(f).matchAll(/https?:\/\/[^\s"'`)<>]+/g)].map(m => m[0])
        .filter(u => u !== "http://www.w3.org/2000/svg");
      assert.deepEqual(urls, [], `${f} refers to ${urls.join(", ")}`);
    }
    const code = DEPLOY_FILES.filter(f => f.endsWith(".js")).map(read).join("\n");
    assert.doesNotMatch(code, /XMLHttpRequest|sendBeacon|WebSocket|EventSource|import\(/);
    // The only network request in the whole app is the service worker fetching the app's own files.
    for (const f of DEPLOY_FILES.filter(f => f.endsWith(".js") && f !== "sw.js")) {
      assert.doesNotMatch(read(f), /\bfetch\(/, `${f} must not make network requests`);
    }
  });

  it("keeps the service worker away from saved data", () => {
    const code = read("sw.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""); // code only, not comments
    assert.doesNotMatch(code, /localStorage|sessionStorage|indexedDB|pesaotas\.data|pesaflow\.personal/);
  });
});

describe("publishing never includes personal data", () => {
  it("builds a site with exactly the app files and nothing else", () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "pesaotas-site-"));
    try {
      fs.writeFileSync(path.join(ROOT, "pesaotas-backup-test-only.json"), "{}"); // must never be published
      const result = build(out);
      const files = [];
      const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach(e =>
        e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.relative(out, path.join(d, e.name)).split(path.sep).join("/")));
      walk(out);
      assert.deepEqual(files.sort(), [...DEPLOY_FILES, ".nojekyll"].sort());
      assert.equal(stamp.check(out).ok, true);
      assert.equal(result.files.length, DEPLOY_FILES.length + 1);
    } finally {
      fs.rmSync(path.join(ROOT, "pesaotas-backup-test-only.json"), { force: true });
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  it("refuses to build into a folder holding other files", () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "pesaotas-site-"));
    try {
      fs.writeFileSync(path.join(out, "my-notes.txt"), "keep me");
      assert.throws(() => build(out), /aren't from a previous build/);
      assert.equal(fs.readFileSync(path.join(out, "my-notes.txt"), "utf8"), "keep me");
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  it("names every downloaded file so .gitignore keeps it out of the repository", { skip: !hasGit && "not a git checkout" }, () => {
    const names = [...read("app.js").matchAll(/`(pesa[a-z]*-[^`]*\.json)`/g)].map(m => m[1].replace(/\$\{[^}]+\}/g, "2026-11-06"));
    assert.ok(names.length >= 4, "expected the backup and safety-copy file names");
    for (const n of [...names, "pesaflow-backup-2026-01-01.json", "my-budget-backup.json", "_site/index.html"]) {
      assert.doesNotThrow(() => execFileSync("git", ["check-ignore", "-q", n], { cwd: ROOT }), `${n} is not ignored`);
    }
  });

  it("tracks no JSON files except the manifest and package.json", { skip: !hasGit && "not a git checkout" }, () => {
    const tracked = execFileSync("git", ["ls-files", "*.json"], { cwd: ROOT, encoding: "utf8" }).trim().split("\n").filter(Boolean);
    assert.deepEqual(tracked.sort(), ["manifest.json", "package.json"]);
  });
});
