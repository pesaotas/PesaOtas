/**
 * v1.6 Phase 5 guards (presentation only): one date format whatever the
 * browser (KI-37), no long dashes used as joiners in user-facing text, and the
 * logo files in the approved recolour (Option 2) with the owner's traced mark.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
/** Lines of code with their comments removed (good enough for these files: no "//" inside the strings checked). */
const codeLines = (text) => text.split("\n").map((line, i) => ({ n: i + 1, code: line.replace(/^\s*(\*|\/\*|\/\/).*$/, "").replace(/\s\/\/\s.*$/, "") }));

describe("KI-37: dates are written one way, whatever the browser", () => {
  it("app.js never asks the browser to format a date (which writes 'Sept' in some browsers)", () => {
    const hits = codeLines(read("app.js")).filter(l => /toLocale(Date)?String\(/.test(l.code));
    assert.deepEqual(hits, []);
  });
  it("short month names are the fixed ones used by Insights and Expense Detective", () => {
    assert.match(read("app.js"), /const MONTHS_SHORT = \["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"\];/);
    assert.match(read("src/detective.js"), /"Sep"/);
  });
});

describe("Long dashes in user-facing text", () => {
  it("none in app.js or src/ code outside comments", () => {
    const files = ["app.js", ...fs.readdirSync(path.join(ROOT, "src")).map(f => `src/${f}`)];
    const hits = [];
    for (const f of files) for (const l of codeLines(read(f))) if (l.code.includes("—")) hits.push(`${f}:${l.n}`);
    assert.deepEqual(hits, []);
  });
  it("in index.html only the page title keeps one (it matches the installed app's name)", () => {
    const lines = read("index.html").split("\n").filter(l => l.includes("—"));
    assert.deepEqual(lines.map(l => l.trim()), ["<title>PesaOtas — Personal Finance</title>"]);
    assert.equal(JSON.parse(read("manifest.json")).name, "PesaOtas — Personal Finance");
  });
});

describe("Logo: approved recolour (Option 2) of the owner's mark", () => {
  const svgs = ["icon.svg", "icons/src/maskable.svg", "icons/src/apple-touch.svg"];
  it("every source uses brand green on forest with a white arrow line, and none still has the old letter-P mark", () => {
    for (const f of svgs) {
      const s = read(f);
      assert.match(s, /fill="#102C25"/, `${f}: forest background`);
      assert.match(s, /fill="#147D62"/, `${f}: brand-green mark`);
      assert.match(s, /stroke="#FFFFFF"/, `${f}: white arrow line`);
      assert.doesNotMatch(s, /#a7e2c3/i, `${f}: old mint letter`);
    }
  });
  it("the mark's geometry is identical in every file (only position and size differ)", () => {
    const geometry = (s) => s.replace(/<!--[\s\S]*?-->/g, "").replace(/<svg[^>]*>|<\/svg>|<rect width="512"[^>]*\/>/g, "")
      .replace(/transform="translate\([^)]*\) scale\([^)]*\)"/, "").replace(/id="p[a-z]([abk])"/g, 'id="$1"').replace(/url\(#p[a-z]([abk])\)/g, "url(#$1)").trim();
    const [a, b, c] = svgs.map(f => geometry(read(f)));
    assert.equal(a, b);
    assert.equal(a, c);
  });
  it("the sidebar and phone header show the logo file, as decoration (the name is written next to it)", () => {
    const html = read("index.html");
    assert.match(html, /<img class="brand-mark" src="icon.svg" alt="" width="40" height="40">/);
    assert.match(html, /<img class="topbar-logo" src="icon.svg" alt="" width="36" height="36">/);
    assert.doesNotMatch(html, /class="avatar"/);
  });
});
