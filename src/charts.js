/**
 * PesaOtas charts — presentation-only SVG builders (v1.6 Phase 3, decision D-19).
 *
 * These functions turn figures that src/insights.js has already worked out into
 * SVG markup. They do no money calculations, read no data and touch no page or
 * storage. Every piece of text is escaped. Charts are drawn at the real pixel
 * width they are given (no viewBox scaling), so 12px text stays 12px.
 *
 * Colours were checked with a colour-blindness validator (D-19): income blue and
 * expense coral pass every check; the six category colours pass for neighbouring
 * slices, including the last slice next to the first.
 *
 * Browser: `window.PesaCharts`. Node: `require("./src/charts.js")`.
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory(require("./currency.js"));
  else root.PesaCharts = factory(root.PesaCurrency);
})(typeof self !== "undefined" ? self : this, function (C) {
  "use strict";

  const COLORS = Object.freeze({
    spending: "#d76c59",          // the app's expense coral
    spendingSelected: "#a94a3a",
    spendingTint: "#f3c9c0",      // partly covered: lighter fill, dashed outline
    income: "#2a78d6",
    incomeSelected: "#1c5cab",
    incomeTint: "#b7d3f6",
    categories: Object.freeze(["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"]),
    grid: "#e8eeeb",
    baseline: "#9aa6a0",
    axisText: "#5f6b66",          // 5.6:1 on white
    ink: "#182b27",
    hatch: "#b7c2bc",
    selectBand: "#e3f1ea",
    hoverBand: "#f1f5f3",
    surface: "#ffffff"
  });
  const FONT = 12;                // never smaller (D-19)
  const CHAR = 7.2;               // average width of a 12px character, for layout estimates

  const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const safeId = (id) => String(id).toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const r1 = (n) => Math.round(n * 10) / 10;

  /** Round axis maximum and evenly spaced ticks from 0 (whole units). */
  function niceScale(max, count = 4) {
    if (!(max > 0)) return { max: 1, step: 1, ticks: [0] };
    const raw = max / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = Math.max(1, [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => s >= raw));
    const top = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Math.round(v));
    return { max: top, step, ticks };
  }

  /** "KSh 20K", "$1.5K", "USh 2M" — short amounts for axis labels only (full amounts are in the panel and table). */
  function compactAmount(n, code) {
    const info = C.info(code);
    const num = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
    return info.space ? `${info.symbol} ${num}` : `${info.symbol}${num}`; // same spacing as PesaCurrency.format
  }

  /** Show every k-th label so labels never overlap (the last is always shown). */
  function labelStep(count, band, longest) {
    const need = longest * CHAR + 10;
    return Math.max(1, Math.ceil(need / Math.max(band, 1)));
  }

  /** A bar with a 4px rounded top and a square base. */
  function barPath(x, y, w, h) {
    if (h <= 0 || w <= 0) return "";
    const r = Math.min(4, w / 2, h);
    return `M${r1(x)},${r1(y + h)}V${r1(y + r)}Q${r1(x)},${r1(y)} ${r1(x + r)},${r1(y)}H${r1(x + w - r)}Q${r1(x + w)},${r1(y)} ${r1(x + w)},${r1(y + r)}V${r1(y + h)}Z`;
  }

  function hatchDef(id) {
    return `<pattern id="${id}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="${COLORS.hatch}" stroke-width="2"/></pattern>`;
  }

  /** Shared frame: gridlines, axis labels, x labels. */
  function frame({ width, height, scale, code, ticks, subTicks, n, selected, hover, plotTop, plotBottom, left, band }) {
    let out = "";
    const plotH = plotBottom - plotTop;
    for (const v of scale.ticks) {
      const y = plotBottom - (v / scale.max) * plotH;
      out += `<line x1="${left}" x2="${width}" y1="${r1(y)}" y2="${r1(y)}" stroke="${v === 0 ? COLORS.baseline : COLORS.grid}" stroke-width="1"/>`;
      out += `<text x="${left - 6}" y="${r1(y + 4)}" text-anchor="end" font-size="${FONT}" fill="${COLORS.axisText}">${esc(compactAmount(v, code))}</text>`;
    }
    if (hover !== null && hover !== undefined && hover >= 0 && hover < n && hover !== selected) {
      out = `<rect class="chart-hover" x="${r1(left + hover * band)}" y="${plotTop}" width="${r1(band)}" height="${plotH}" fill="${COLORS.hoverBand}"/>` + out;
    }
    if (selected !== null && selected !== undefined && selected >= 0 && selected < n) {
      out = `<rect class="chart-selected-band" x="${r1(left + selected * band)}" y="${plotTop}" width="${r1(band)}" height="${plotH}" fill="${COLORS.selectBand}"/>` + out;
    }
    const longest = Math.max(1, ...ticks.map(t => String(t).length));
    const step = labelStep(n, band, longest);
    for (let i = 0; i < n; i++) {
      const show = i === selected || (i % step === 0 && (n - 1 - i >= step || i === n - 1)) || i === n - 1;
      if (!show) continue;
      const cx = left + (i + 0.5) * band;
      const anchor = i === 0 && band < longest * CHAR ? "start" : i === n - 1 && band < longest * CHAR ? "end" : "middle";
      const x = anchor === "start" ? left + i * band : anchor === "end" ? left + (i + 1) * band : cx;
      const weight = i === selected ? ` font-weight="700" fill="${COLORS.ink}"` : ` fill="${COLORS.axisText}"`;
      out += `<text x="${r1(x)}" y="${plotBottom + 17}" text-anchor="${anchor}" font-size="${FONT}"${weight}>${esc(ticks[i])}</text>`;
      if (subTicks && subTicks[i]) out += `<text x="${r1(x)}" y="${plotBottom + 32}" text-anchor="${anchor}" font-size="${FONT}" fill="${COLORS.axisText}">${esc(subTicks[i])}</text>`;
    }
    return out;
  }

  /**
   * Spending trend: one column per bar.
   * @param {{id:string, width:number, height?:number, code:string,
   *   bars:Array<{value:number, state:string, tick:string, subTick?:string, title:string}>,
   *   selected?:number, hover?:number}} o
   * @returns {{svg:string, hit:{left:number, band:number, count:number}}}
   */
  function trendChart(o) {
    const id = safeId(o.id), width = Math.max(200, Math.floor(o.width)), height = o.height || 220;
    const n = o.bars.length;
    const scale = niceScale(Math.max(0, ...o.bars.map(b => b.value)));
    const left = Math.ceil(Math.max(...scale.ticks.map(v => compactAmount(v, o.code).length)) * CHAR) + 10;
    const hasSub = o.bars.some(b => b.subTick);
    const plotTop = 8, plotBottom = height - (hasSub ? 40 : 26);
    const plotH = plotBottom - plotTop;
    const band = (width - left) / Math.max(n, 1);
    const bw = Math.max(1, Math.min(24, band - 2));
    let marks = "";
    o.bars.forEach((b, i) => {
      const x = left + i * band + (band - bw) / 2;
      const sel = i === o.selected;
      let m = "";
      if (b.state === "no-history") {
        m += `<rect x="${r1(left + i * band + 1)}" y="${plotTop}" width="${r1(Math.max(1, band - 2))}" height="${plotH}" fill="url(#${id}-hatch)"/>`;
      } else if (b.value > 0) {
        const h = Math.max(2, (b.value / scale.max) * plotH);
        const partly = b.state === "partly-covered";
        const fill = partly ? COLORS.spendingTint : sel ? COLORS.spendingSelected : COLORS.spending;
        m += `<path d="${barPath(x, plotBottom - h, bw, h)}" fill="${fill}"${partly ? ` stroke="${sel ? COLORS.spendingSelected : COLORS.spending}" stroke-width="1.5" stroke-dasharray="3 2"` : ""}/>`;
      } else {
        // Covered, nothing spent: a zero marker on the baseline (not a gap).
        m += `<rect x="${r1(x)}" y="${plotBottom - 3}" width="${r1(bw)}" height="3" rx="1" fill="${b.state === "partly-covered" ? COLORS.spendingTint : COLORS.axisText}"${b.state === "partly-covered" ? ` stroke="${COLORS.spending}" stroke-width="1" stroke-dasharray="2 2"` : ""}/>`;
      }
      marks += `<g class="chart-mark" data-index="${i}" data-state="${esc(b.state)}"${sel ? ' data-selected="true"' : ""}><title>${esc(b.title)}</title>${m}</g>`;
    });
    const svg = `<svg class="chart-svg" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" aria-hidden="true" focusable="false" font-family="inherit">` +
      `<defs>${hatchDef(`${id}-hatch`)}</defs>` +
      frame({ width, height, scale, code: o.code, ticks: o.bars.map(b => b.tick), subTicks: hasSub ? o.bars.map(b => b.subTick || "") : null, n, selected: o.selected, hover: o.hover, plotTop, plotBottom, left, band }) +
      marks + `</svg>`;
    return { svg, hit: { left, band, count: n } };
  }

  /**
   * Income vs expenses: a pair of columns per month (income left, expenses right).
   * @param {{id, width, height?, code, months:Array<{income:number, expenses:number, state:string, tick:string, subTick?:string, title:string}>, selected?, hover?}} o
   */
  function pairedChart(o) {
    const id = safeId(o.id), width = Math.max(200, Math.floor(o.width)), height = o.height || 220;
    const n = o.months.length;
    const scale = niceScale(Math.max(0, ...o.months.map(m => Math.max(m.income, m.expenses))));
    const left = Math.ceil(Math.max(...scale.ticks.map(v => compactAmount(v, o.code).length)) * CHAR) + 10;
    const hasSub = o.months.some(m => m.subTick);
    const plotTop = 8, plotBottom = height - (hasSub ? 40 : 26);
    const plotH = plotBottom - plotTop;
    const band = (width - left) / Math.max(n, 1);
    const bw = Math.max(1, Math.min(24, (band - 6) / 2));
    let marks = "";
    o.months.forEach((m, i) => {
      const sel = i === o.selected;
      const cx = left + (i + 0.5) * band;
      let g = "";
      if (m.state === "no-history") {
        g += `<rect x="${r1(left + i * band + 1)}" y="${plotTop}" width="${r1(Math.max(1, band - 2))}" height="${plotH}" fill="url(#${id}-hatch)"/>`;
      } else {
        const partly = m.state === "partly-covered";
        for (const [k, x] of [["income", cx - 1 - bw], ["expenses", cx + 1]]) {
          const v = m[k];
          const base = k === "income" ? COLORS.income : COLORS.spending;
          const dark = k === "income" ? COLORS.incomeSelected : COLORS.spendingSelected;
          const tint = k === "income" ? COLORS.incomeTint : COLORS.spendingTint;
          if (v > 0) {
            const h = Math.max(2, (v / scale.max) * plotH);
            g += `<path data-series="${k}" d="${barPath(x, plotBottom - h, bw, h)}" fill="${partly ? tint : sel ? dark : base}"${partly ? ` stroke="${sel ? dark : base}" stroke-width="1.5" stroke-dasharray="3 2"` : ""}/>`;
          } else {
            g += `<rect data-series="${k}" x="${r1(x)}" y="${plotBottom - 3}" width="${r1(bw)}" height="3" rx="1" fill="${COLORS.axisText}"/>`;
          }
        }
      }
      marks += `<g class="chart-mark" data-index="${i}" data-state="${esc(m.state)}"${sel ? ' data-selected="true"' : ""}><title>${esc(m.title)}</title>${g}</g>`;
    });
    const svg = `<svg class="chart-svg" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" aria-hidden="true" focusable="false" font-family="inherit">` +
      `<defs>${hatchDef(`${id}-hatch`)}</defs>` +
      frame({ width, height, scale, code: o.code, ticks: o.months.map(m => m.tick), subTicks: hasSub ? o.months.map(m => m.subTick || "") : null, n, selected: o.selected, hover: o.hover, plotTop, plotBottom, left, band }) +
      marks + `</svg>`;
    return { svg, hit: { left, band, count: n } };
  }

  /** SVG path for a ring segment between two angles (radians, 0 = top, clockwise). */
  function arcPath(cx, cy, ro, ri, a0, a1) {
    const pt = (r, a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
    if (a1 - a0 >= 2 * Math.PI - 1e-6) {
      // A whole ring: two halves (a single arc can't close on itself).
      return arcPath(cx, cy, ro, ri, 0, Math.PI) + arcPath(cx, cy, ro, ri, Math.PI, 2 * Math.PI);
    }
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const [x0, y0] = pt(ro, a0), [x1, y1] = pt(ro, a1), [x2, y2] = pt(ri, a1), [x3, y3] = pt(ri, a0);
    return `M${r1(x0)},${r1(y0)}A${ro},${ro} 0 ${large} 1 ${r1(x1)},${r1(y1)}L${r1(x2)},${r1(y2)}A${ri},${ri} 0 ${large} 0 ${r1(x3)},${r1(y3)}Z`;
  }

  /** Start and end angles for each share (shares add up to 1). */
  function donutAngles(values) {
    const total = values.reduce((a, v) => a + v, 0);
    let a = 0;
    return values.map(v => { const a0 = a; a += total > 0 ? (v / total) * 2 * Math.PI : 0; return [a0, a]; });
  }

  /**
   * Category donut. Slices in the given order (largest first), coloured by
   * position from COLORS.categories; a 2px white gap separates slices.
   * @param {{id, size:number, segments:Array<{value:number, title:string}>, selected?:number, centre?:{value:string, label:string}}} o
   */
  function donutChart(o) {
    const size = Math.max(160, Math.floor(o.size));
    const cx = size / 2, cy = size / 2, ro = size / 2 - 8, ri = ro * 0.62;
    const angles = donutAngles(o.segments.map(s => s.value));
    let marks = "";
    o.segments.forEach((s, i) => {
      const [a0, a1] = angles[i];
      if (a1 <= a0) return;
      const sel = i === o.selected;
      const mid = (a0 + a1) / 2;
      const pull = sel && o.segments.length > 1 ? 6 : 0;
      const dx = pull * Math.sin(mid), dy = -pull * Math.cos(mid);
      const color = COLORS.categories[i % COLORS.categories.length];
      marks += `<g class="chart-mark" data-index="${i}"${sel ? ' data-selected="true"' : ""} transform="translate(${r1(dx)},${r1(dy)})"><title>${esc(s.title)}</title>` +
        `<path d="${arcPath(cx, cy, sel ? ro + 2 : ro, ri, a0, a1)}" fill="${color}" stroke="${COLORS.surface}" stroke-width="2"/>` +
        (sel ? `<path d="${arcPath(cx, cy, ro + 2, ri, a0, a1)}" fill="none" stroke="${COLORS.ink}" stroke-width="2"/>` : "") + `</g>`;
    });
    const centre = o.centre ? `<text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="16" font-weight="800" fill="${COLORS.ink}">${esc(o.centre.value)}</text>` +
      `<text x="${cx}" y="${cy + 17}" text-anchor="middle" font-size="${FONT}" fill="${COLORS.axisText}">${esc(o.centre.label)}</text>` : "";
    return { svg: `<svg class="chart-svg" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" aria-hidden="true" focusable="false" font-family="inherit">${marks}${centre}</svg>` };
  }

  /** Which bar a pointer x (relative to the SVG) is nearest to; -1 if outside. */
  function indexAt(hit, x) {
    if (!hit || hit.count === 0 || x < hit.left - hit.band / 2) return -1;
    return Math.min(hit.count - 1, Math.max(0, Math.floor((x - hit.left) / hit.band)));
  }

  return Object.freeze({ COLORS, FONT, esc, safeId, niceScale, compactAmount, labelStep, barPath, arcPath, donutAngles, trendChart, pairedChart, donutChart, indexAt });
});
