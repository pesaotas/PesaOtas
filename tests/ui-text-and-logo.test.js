/**
 * v1.6 Phase 5 guards (presentation only): dates formatted by the app, not the
 * browser (KI-37); no long dashes used as joiners in user-facing text; and the
 * logo: the owner's traced mark in the approved recolour (Option 2), with
 * every generated PNG matching its SVG source.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { readPNG } = require("./helpers/png.js");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
/** Lines of code with comment lines and trailing " // " comments removed (approximate: a " // " inside a string would also be cut). */
const codeLines = (text) => text.split("\n").map((line, i) => ({ n: i + 1, code: line.replace(/^\s*(\*|\/\*|\/\/).*$/, "").replace(/\s\/\/\s.*$/, "") }));

describe("KI-37: dates are formatted by the app, the same in every browser", () => {
  it("app.js never asks the browser to format a date (which writes 'Sept' in some browsers)", () => {
    const hits = codeLines(read("app.js")).filter(l => /toLocale(Date|Time)?String\(|Intl\.DateTimeFormat/.test(l.code));
    assert.deepEqual(hits, []);
  });
  it("month and weekday names come from fixed lists, the same short months as Insights and Expense Detective", () => {
    const app = read("app.js");
    assert.match(app, /const MONTHS_SHORT = \["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"\];/);
    assert.match(app, /const MONTHS_LONG = \["January",/);
    assert.match(read("src/insights.js"), /"Sep"/);
    assert.match(read("src/detective.js"), /"Sep"/);
  });
  it("each context keeps its own format (four formatters, by design)", () => {
    const app = read("app.js");
    for (const fn of ["formatDate", "formatLongDate", "formatDayDate", "formatWhen"]) assert.match(app, new RegExp(`const ${fn} = `), fn);
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

describe("Logo: the owner's traced mark in the approved recolour (Option 2)", () => {
  // The traced mark exactly as approved (Phase 0 trace, Option 2 colours). Each file may only add its
  // own ID prefix and a translate/scale transform.
  const MARK = [
    "<defs>",
    ' <clipPath id="a"><path d="M226.2,764.1 L499.5,472.0 L646.5,315.5 L703.0,370.0 L842.5,223.5 L1115.8,-68.6 L1400,0 L0,0 Z"/></clipPath>',
    ' <clipPath id="b"><path d="M226.2,764.1 L499.5,472.0 L646.5,315.5 L703.0,370.0 L842.5,223.5 L1115.8,-68.6 L1400,800 L0,800 Z"/></clipPath>',
    ' <mask id="k" maskUnits="userSpaceOnUse" x="0" y="0" width="1408" height="768">',
    '  <rect width="1408" height="768" fill="#fff"/>',
    '  <polyline points="499.5,472.0 646.5,315.5 703.0,370.0 842.5,223.5" fill="none" stroke="#000" stroke-width="60" stroke-linejoin="miter" stroke-miterlimit="10"/>',
    '  <polygon points="875.4,254.2 891.0,171.7 809.6,192.8" fill="#000" stroke="#000" stroke-width="29" stroke-linejoin="miter"/>',
    " </mask></defs>",
    '<g fill="#147D62" mask="url(#k)">',
    ' <path clip-path="url(#a)" fill-rule="evenodd" d="M547,174 H697 A95 95 0 0 1 697,364 H547 Z M603,224 H687 A49 49 0 0 1 736,273 V420 H603 Z"/>',
    ' <rect x="547" y="174" width="56" height="312"/>',
    ' <g clip-path="url(#b)"><rect x="636" y="174" width="55" height="312"/><rect x="719" y="174" width="55" height="312"/><rect x="802" y="174" width="55" height="312"/></g>',
    "</g>",
    '<polygon fill="#147D62" points="875.4,254.2 891.0,171.7 809.6,192.8"/>',
    '<polyline points="499.5,472.0 646.5,315.5 703.0,370.0 842.5,223.5" fill="none" stroke="#FFFFFF" stroke-width="31" stroke-linejoin="miter" stroke-miterlimit="10"/>'
  ].join("\n");
  const SOURCES = {
    "icon.svg": { prefix: "pi", background: '<rect width="512" height="512" rx="112.64" fill="#102C25"/>' },
    "icons/src/maskable.svg": { prefix: "pm", background: '<rect width="512" height="512" fill="#102C25"/>' },
    "icons/src/apple-touch.svg": { prefix: "pt", background: '<rect width="512" height="512" fill="#102C25"/>' }
  };
  const markOf = (svg, prefix) => {
    const m = svg.match(/<g transform="translate\([-\d.]+ [-\d.]+\) scale\([\d.]+\)">([\s\S]*)<\/g>\s*<\/svg>\s*$/);
    assert.ok(m, "mark group with a translate/scale transform");
    return m[1].replace(new RegExp(`id="${prefix}([abk])"`, "g"), 'id="$1"').replace(new RegExp(`url\\(#${prefix}([abk])\\)`, "g"), "url(#$1)").trim();
  };

  for (const [file, { prefix, background }] of Object.entries(SOURCES)) {
    it(`${file}: the approved mark, unchanged, on its background`, () => {
      const svg = read(file);
      assert.equal(markOf(svg, prefix), MARK.trim());
      assert.ok(svg.includes(background), `background: ${background}`);
      assert.equal((svg.match(/<rect width="512" height="512"/g) || []).length, 1, "one background");
      assert.doesNotMatch(svg, /#a7e2c3/i, "no trace of the old letter-P icon");
    });
  }
  it("only the approved colours: forest background, brand-green mark, white arrow line", () => {
    for (const file of Object.keys(SOURCES)) {
      const colours = new Set((read(file).match(/(?:fill|stroke)="(#[0-9A-Fa-f]{3,6})"/g) || []).map(s => s.split('"')[1].toUpperCase()));
      // #FFF and #000 are only the mask's knock-out (white keeps, black cuts the gap around the arrow).
      assert.deepEqual([...colours].sort(), ["#000", "#102C25", "#147D62", "#FFF", "#FFFFFF"].sort(), file);
    }
  });
  it("the sidebar and phone header show the logo as decoration, declared at the size they are drawn", () => {
    const html = read("index.html"), css = read("styles.css");
    assert.match(html, /<img class="brand-mark" src="icon.svg" alt="" width="44" height="44">/);
    assert.match(css, /img\.brand-mark\{[^}]*width:44px;height:44px/);
    assert.match(html, /<img class="topbar-logo" src="icon.svg" alt="" width="36" height="36">/);
    assert.match(css, /\.topbar-logo\{[^}]*width:36px;height:36px/);
    assert.doesNotMatch(html, /class="avatar"/);
  });
  it("the saved-on-device pill is read once by screen readers: the short visible word is hidden from them, the full words aren't", () => {
    const html = read("index.html");
    assert.match(html, /<span class="pill-short" aria-hidden="true">Saved<\/span><span class="pill-text"> Saved on this device<\/span>/);
    // On phones the full words are visually hidden with the clip technique (still read), never display:none.
    assert.doesNotMatch(read("styles.css"), /\.pill-text\{[^}]*display:none/);
  });
});

describe("Logo: generated PNG icons", () => {
  const ICONS = [
    ["icons/icon-192.png", "icon.svg", 192], ["icons/icon-512.png", "icon.svg", 512], ["icons/favicon-32.png", "icon.svg", 32],
    ["icons/maskable-192.png", "icons/src/maskable.svg", 192], ["icons/maskable-512.png", "icons/src/maskable.svg", 512],
    ["icons/apple-touch-icon.png", "icons/src/apple-touch.svg", 180]
  ];
  const png = (f) => readPNG(fs.readFileSync(path.join(ROOT, f)));
  const FOREST = [0x10, 0x2c, 0x25];
  const near = (p, c, tol) => Math.abs(p[0] - c[0]) + Math.abs(p[1] - c[1]) + Math.abs(p[2] - c[2]) <= tol;
  const hasRsvg = spawnSync("rsvg-convert", ["--version"]).status === 0;

  it("every icon has its stated size; maskable and Apple icons are opaque", () => {
    for (const [f, , size] of ICONS) {
      const p = png(f);
      assert.equal(p.width, size, f); assert.equal(p.height, size, f);
      if (/maskable|apple/.test(f)) for (let y = 0; y < size; y += 7) for (let x = 0; x < size; x += 7) assert.equal(p.pixel(x, y)[3], 255, `${f} opaque at ${x},${y}`);
    }
  });

  it("each PNG is exactly its SVG source rendered at that size", { skip: hasRsvg ? false : "rsvg-convert (librsvg) is not installed, so the SVGs can't be rendered here" }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pesaotas-icons-"));
    try {
      for (const [f, src, size] of ICONS) {
        const out = path.join(dir, "r.png");
        const r = spawnSync("rsvg-convert", ["-w", String(size), "-h", String(size), path.join(ROOT, src), "-o", out]);
        assert.equal(r.status, 0, `render ${src}`);
        const a = png(f), b = readPNG(fs.readFileSync(out));
        let differ = 0;
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
          const p = a.pixel(x, y), q = b.pixel(x, y);
          // An opaque PNG stores only RGB; compare it against the rendering composited the same way.
          if (Math.max(...p.map((v, i) => Math.abs(v - q[i]))) > 2) differ++;
        }
        assert.equal(differ, 0, `${f} differs from ${src} in ${differ} pixels`);
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("the app icon is the rounded tile with the approved corner (22%), transparent outside it", () => {
    const p = png("icons/icon-512.png");
    assert.equal(p.pixel(0, 0)[3], 0, "corner transparent");
    assert.equal(p.pixel(25, 25)[3], 0, "outside the 112.64 corner arc");
    assert.equal(p.pixel(40, 40)[3], 255, "inside the 112.64 corner arc (a 144 corner would be transparent here)");
    assert.ok(near(p.pixel(256, 20), FOREST, 6), "forest background");
  });

  for (const f of ["icons/maskable-192.png", "icons/maskable-512.png"]) {
    it(`${f}: the whole mark lies inside the maskable safe area (a centred circle of radius 40%)`, () => {
      const p = png(f), c = (p.width - 1) / 2, r = 0.4 * p.width;
      let ink = 0, outside = 0, far = 0;
      for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) {
        if (near(p.pixel(x, y), FOREST, 30)) continue;
        ink++;
        const d = Math.hypot(x - c, y - c);
        far = Math.max(far, d);
        if (d > r) outside++;
      }
      assert.ok(ink > p.width * p.width * 0.08, "the mark is there");
      assert.equal(outside, 0, `${outside} mark pixels outside the safe area (farthest ${far.toFixed(1)} px, limit ${r.toFixed(1)} px)`);
    });
  }
});
