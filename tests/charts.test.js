/**
 * SVG chart builders (v1.6 Phase 3, decision D-19): presentation only.
 * Scales, shapes, states, selection, escaping of hostile names, text size,
 * true-width drawing, pointer mapping and the validated colours.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const X = require("../src/charts.js");
const C = require("../src/currency.js");

const HOSTILE = `<script>alert("x")</script> & 'quotes' "here"`;
const bars = (values, extra = {}) => values.map((v, i) => ({ value: v, state: v > 0 ? "spending" : "no-spending", tick: `${i + 1} Oct`, title: `Bar ${i}`, ...extra }));
const fontSizes = (svg) => [...svg.matchAll(/font-size="([\d.]+)"/g)].map(m => Number(m[1]));
const heights = (svg) => [...svg.matchAll(/ d="M[\d.-]+,([\d.-]+)V([\d.-]+)/g)].map(m => Number(m[1]) - Number(m[2]));

describe("escaping and safe IDs", () => {
  it("escapes every special character", () => {
    assert.equal(X.esc(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
    assert.equal(X.esc(42), "42");
  });

  it("hostile category names, labels and titles never appear as markup", () => {
    const outputs = [
      X.trendChart({ id: HOSTILE, width: 400, code: "KES", bars: [{ value: 10, state: "spending", tick: HOSTILE, subTick: HOSTILE, title: HOSTILE }], selected: 0 }).svg,
      X.pairedChart({ id: "p", width: 400, code: "KES", months: [{ income: 5, expenses: 3, state: "spending", tick: HOSTILE, title: HOSTILE }], selected: 0 }).svg,
      X.donutChart({ id: "d", size: 240, segments: [{ value: 3, title: HOSTILE }, { value: 1, title: HOSTILE }], selected: 0, centre: { value: HOSTILE, label: HOSTILE } }).svg
    ];
    for (const svg of outputs) {
      assert.doesNotMatch(svg, /<script/i);
      assert.doesNotMatch(svg, /alert\("x"\)/);
      assert.match(svg, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; &#39;quotes&#39;/);
    }
    assert.equal(X.safeId(HOSTILE), X.safeId(HOSTILE).replace(/[^a-z0-9-]/g, ""));
    assert.match(outputs[0], /<pattern id="[a-z0-9-]+-hatch"/);
  });
});

describe("scales and compact amounts", () => {
  it("niceScale: from 0, at least the maximum, whole even steps", () => {
    for (const max of [1, 7, 99, 150, 999, 36780, 228920, 12345678]) {
      const s = X.niceScale(max);
      assert.equal(s.ticks[0], 0);
      assert.ok(s.max >= max, `${max}`);
      assert.ok(s.max < max * 2.6, `${max} → ${s.max}`);
      assert.ok(Number.isInteger(s.step) && s.step >= 1);
      s.ticks.forEach((v, i) => i && assert.equal(v - s.ticks[i - 1], s.step));
      assert.equal(s.ticks.at(-1), s.max);
    }
    assert.deepEqual(X.niceScale(0), { max: 1, step: 1, ticks: [0] });
    assert.deepEqual(X.niceScale(-5).ticks, [0]);
  });

  it("compact axis amounts use each currency's symbol and spacing", () => {
    for (const code of C.CODES) {
      const full = C.format(1234, code), short = X.compactAmount(20000, code);
      const prefix = full.slice(0, full.indexOf("1"));
      assert.ok(short.startsWith(prefix) && short.endsWith("20K"), `${code}: ${short} vs ${full}`);
    }
    assert.equal(X.compactAmount(1500000, "KES"), "KSh 1.5M");
    assert.equal(X.compactAmount(0, "USD"), "$0");
  });

  it("labels are thinned so they never overlap", () => {
    assert.equal(X.labelStep(30, 100, 6), 1);
    assert.ok(X.labelStep(30, 9, 6) >= 6);
  });
});

describe("spending trend chart", () => {
  it("drawn at the width given (no scaling), with text never below 12px", () => {
    for (const width of [288, 375, 1200]) {
      const { svg } = X.trendChart({ id: "t", width, code: "KES", bars: bars(Array.from({ length: 30 }, (_, i) => i * 37)) });
      assert.match(svg, new RegExp(`<svg [^>]*width="${width}"`));
      assert.doesNotMatch(svg, /viewBox/);
      assert.ok(fontSizes(svg).every(f => f >= 12), String(fontSizes(svg)));
      assert.match(svg, /aria-hidden="true"/);
    }
  });

  it("one mark per bar; bars at most 24px wide; no negative heights", () => {
    const { svg, hit } = X.trendChart({ id: "t", width: 900, code: "KES", bars: bars([5, 0, 300, 120, 0, 7]) });
    assert.equal((svg.match(/class="chart-mark"/g) || []).length, 6);
    assert.equal(hit.count, 6);
    assert.ok(heights(svg).every(h => h >= 0));
    const widths = [...svg.matchAll(/M([\d.]+),[\d.]+V[\d.]+Q[\d.]+,[\d.]+ [\d.]+,[\d.]+H([\d.]+)Q([\d.]+)/g)].map(m => Number(m[3]) - Number(m[1]));
    assert.ok(widths.length === 4 && widths.every(w => w <= 24.01), String(widths));
  });

  it("each state looks different: hatching, zero marker, dashed partial bar, plain bar", () => {
    const { svg } = X.trendChart({ id: "s", width: 600, code: "KES", bars: [
      { value: 0, state: "no-history", tick: "a", title: "a" },
      { value: 0, state: "no-spending", tick: "b", title: "b" },
      { value: 40, state: "partly-covered", tick: "c", title: "c" },
      { value: 80, state: "spending", tick: "d", title: "d" }] });
    const mark = (i) => svg.match(new RegExp(`<g class="chart-mark" data-index="${i}"[^>]*>(.*?)</g>`))[1];
    assert.match(mark(0), /fill="url\(#s-hatch\)"/);
    assert.match(mark(1), /<rect [^>]*height="3"/);
    assert.match(mark(2), /stroke-dasharray/);
    assert.match(mark(2), new RegExp(X.COLORS.spendingTint));
    assert.match(mark(3), new RegExp(`fill="${X.COLORS.spending}"`));
    assert.doesNotMatch(mark(3), /stroke-dasharray/);
  });

  it("the selected bar is marked, darker, and has its label shown in bold", () => {
    const { svg } = X.trendChart({ id: "t", width: 320, code: "KES", bars: bars(Array.from({ length: 30 }, () => 100)), selected: 13 });
    assert.match(svg, /data-index="13" data-state="spending" data-selected="true"/);
    assert.equal((svg.match(/data-selected/g) || []).length, 1);
    assert.match(svg, /class="chart-selected-band"/);
    assert.match(svg.match(/data-index="13"[^]*?<\/g>/)[0], new RegExp(X.COLORS.spendingSelected));
    assert.match(svg, /font-weight="700"[^>]*>14 Oct</);
  });

  it("a hovered bar gets a light band; no band without hover", () => {
    assert.match(X.trendChart({ id: "t", width: 400, code: "KES", bars: bars([1, 2, 3]), hover: 1 }).svg, /class="chart-hover"/);
    assert.doesNotMatch(X.trendChart({ id: "t", width: 400, code: "KES", bars: bars([1, 2, 3]) }).svg, /class="chart-hover"/);
  });

  it("pointer position → nearest bar", () => {
    const { hit } = X.trendChart({ id: "t", width: 400, code: "KES", bars: bars([1, 2, 3, 4]) });
    assert.equal(X.indexAt(hit, hit.left + 1), 0);
    assert.equal(X.indexAt(hit, hit.left + hit.band * 2.5), 2);
    assert.equal(X.indexAt(hit, 10000), 3);
    assert.equal(X.indexAt(hit, 0), -1);
    assert.equal(X.indexAt({ left: 0, band: 1, count: 0 }, 5), -1);
  });
});

describe("income vs expenses chart", () => {
  it("income on the left, expenses on the right, in the validated colours", () => {
    const { svg } = X.pairedChart({ id: "p", width: 500, code: "KES", months: [{ income: 60000, expenses: 36000, state: "spending", tick: "Oct", title: "Oct" }] });
    const inc = svg.match(/data-series="income" d="M([\d.]+)[^"]*" fill="([^"]+)"/), exp = svg.match(/data-series="expenses" d="M([\d.]+)[^"]*" fill="([^"]+)"/);
    assert.ok(Number(inc[1]) < Number(exp[1]));
    assert.equal(inc[2], X.COLORS.income);
    assert.equal(exp[2], X.COLORS.spending);
  });

  it("no history: hatched, no bars; zero values: zero markers; partly covered: dashed", () => {
    const { svg } = X.pairedChart({ id: "p", width: 500, code: "KES", months: [
      { income: 0, expenses: 0, state: "no-history", tick: "a", title: "a" },
      { income: 0, expenses: 500, state: "spending", tick: "b", title: "b" },
      { income: 900, expenses: 100, state: "partly-covered", tick: "c", title: "c" }] });
    const mark = (i) => svg.match(new RegExp(`<g class="chart-mark" data-index="${i}"[^>]*>(.*?)</g>`))[1];
    assert.match(mark(0), /url\(#p-hatch\)/);
    assert.doesNotMatch(mark(0), /data-series/);
    assert.match(mark(1), /data-series="income" x=[^>]*height="3"/);
    assert.equal((mark(2).match(/stroke-dasharray/g) || []).length, 2);
    assert.ok(fontSizes(svg).every(f => f >= 12));
  });
});

describe("category donut", () => {
  it("slice angles add up to a full circle, in order, at their true size", () => {
    const a = X.donutAngles([50, 30, 15, 4, 0.5, 0.5]);
    assert.equal(a[0][0], 0);
    assert.ok(Math.abs(a.at(-1)[1] - 2 * Math.PI) < 1e-9);
    a.forEach(([s, e], i) => { assert.ok(e >= s); if (i) assert.equal(s, a[i - 1][1]); });
    assert.ok(Math.abs((a[4][1] - a[4][0]) - 0.005 * 2 * Math.PI) < 1e-9, "a 0.5% slice stays 0.5%");
  });

  it("a single category draws a whole ring", () => {
    const { svg } = X.donutChart({ id: "d", size: 240, segments: [{ value: 10, title: "Food" }] });
    assert.equal((svg.match(/class="chart-mark"/g) || []).length, 1);
    assert.equal((svg.match(/A\d/g) || []).length, 4, "two half-rings, each with an outer and inner arc");
  });

  it("slices take the six validated colours in order; the selected slice is outlined and pulled out", () => {
    const segs = [6, 5, 4, 3, 2, 1].map((v, i) => ({ value: v, title: `S${i}` }));
    const { svg } = X.donutChart({ id: "d", size: 260, segments: segs, selected: 2, centre: { value: "KSh 21", label: "spent" } });
    const fills = [...svg.matchAll(/<path d="[^"]+" fill="(#[0-9a-f]{6})"/g)].map(m => m[1]);
    assert.deepEqual(fills, [...X.COLORS.categories]);
    assert.match(svg, /data-index="2" data-selected="true" transform="translate\((?!0,0)/);
    assert.match(svg, new RegExp(`fill="none" stroke="${X.COLORS.ink}"`));
    assert.ok(fontSizes(svg).every(f => f >= 12));
  });

  it("nothing to draw when there is no spending", () => {
    const { svg } = X.donutChart({ id: "d", size: 240, segments: [] });
    assert.doesNotMatch(svg, /chart-mark/);
  });
});

describe("validated colours (D-19)", () => {
  it("are the colours that passed the colour-blindness check; changing them needs a new check", () => {
    assert.equal(X.COLORS.income, "#2a78d6");
    assert.equal(X.COLORS.spending, "#d76c59");
    assert.deepEqual([...X.COLORS.categories], ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"]);
    assert.ok(Object.isFrozen(X.COLORS) && Object.isFrozen(X.COLORS.categories));
  });
});
