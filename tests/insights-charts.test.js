/**
 * Chart data (v1.6 Phase 3, decision D-19): fictional data only.
 * Groupings for each period, period clipping kept separate from coverage,
 * income vs expenses months, category grouping (≤6 separately, >6 → five plus
 * "Other categories (N)"), read-only drill-through, empty and future-only
 * histories, currencies, read-only use, and 20,000-entry performance.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const I = require("../src/insights.js");
const D = require("../src/data-model.js");
const F = require("../src/finance.js");
const C = require("../src/currency.js");
const { deepFreeze } = require("./fixtures.js");
const { insightsState } = require("./helpers/insights-data.js");

const TODAY = "2026-11-06";
const PERIOD_IDS = ["30d", "6m", "all"];
let n = 0;
const t = (type, amount, date, extra = {}) => ({ id: `c${++n}`, type, amount, date, note: "", createdAt: n,
  ...(type === "expense" ? { categoryId: "food" } : type === "income" ? { categoryId: "inc-salary" } : { destinationId: "m-shwari" }), ...extra });
function budget(transactions, categories) {
  const r = D.normalizeState({
    app: "PesaOtas", version: 3, currency: "KES", openingBalance: 10000, payday: "2026-11-30",
    categories: categories || [{ id: "food", name: "Food", budget: 5000, kind: "Essential" }],
    transactions, savingsDestinations: D.DEFAULT_DESTINATIONS.map(d => ({ ...d })), meta: {}
  });
  assert.ok(D.isClean(r), JSON.stringify(r.errors));
  return r.state;
}
const dow = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay(); // 0 = Sunday, 1 = Monday

describe("spending trend: grouping for each period", () => {
  const h = insightsState();

  it("days for Last 30 days, weeks for Last 6 months, months for All time", () => {
    assert.deepEqual(PERIOD_IDS.map(I.trendUnit), ["day", "week", "month"]);
    assert.equal(I.trendUnit("nonsense"), "day", "unknown periods use the default (Last 30 days)");
    const counts = PERIOD_IDS.map(p => I.spendingTrend(h, p, TODAY).buckets.length);
    assert.deepEqual(counts, [30, 27, 15]); // 8 Oct–6 Nov; weeks from 7 May; Sep 2025–Nov 2026
  });

  it("bars run back-to-back from the period's first day to today, and add up to total expenses", () => {
    for (const p of PERIOD_IDS) {
      const tr = I.spendingTrend(h, p, TODAY);
      const sum = I.summary(h, p, TODAY);
      assert.equal(tr.buckets[0].start, sum.range.start, p);
      assert.equal(tr.buckets.at(-1).end, TODAY, p);
      for (let i = 1; i < tr.buckets.length; i++) assert.equal(tr.buckets[i].start, F.addDays(tr.buckets[i - 1].end, 1), `${p} bar ${i}`);
      assert.equal(tr.total, sum.expenses.amount, p);
      assert.equal(tr.buckets.reduce((a, b) => a + b.days, 0), sum.range.days, p);
      assert.equal(tr.max, Math.max(...tr.buckets.map(b => b.expenses)), p);
    }
  });

  it("weeks run Monday to Sunday; only the first and last can be cut short by the period", () => {
    const { buckets } = I.spendingTrend(h, "6m", TODAY);
    buckets.forEach((b, i) => {
      if (i > 0) assert.equal(dow(b.start), 1, `${b.start} starts on a Monday`);
      if (i < buckets.length - 1) assert.equal(dow(b.end), 0, `${b.end} ends on a Sunday`);
      assert.equal(b.clipped, i === 0 || i === buckets.length - 1, b.label);
    });
    assert.equal(buckets[0].label, "7–10 May 2026");   // Thursday 7 May to Sunday 10 May
    assert.equal(buckets[0].days, 4);
    assert.equal(buckets.at(-1).label, "2–6 Nov 2026");
    assert.equal(buckets.at(-1).soFar, true);
    assert.equal(buckets[1].label, "11–17 May 2026");
  });

  it("a week across two months is labelled with both", () => {
    const { buckets } = I.spendingTrend(h, "6m", TODAY);
    assert.ok(buckets.some(b => b.label === "25–31 May 2026"));
    assert.ok(buckets.some(b => b.label === "29 Jun – 5 Jul 2026"), buckets.map(b => b.label).join(", "));
  });

  it("All time starts at the first record: a month cut short there is labelled by its dates, not as partly covered", () => {
    const s = insightsState({ from: "2025-09-15" });
    const { buckets } = I.spendingTrend(s, "all", TODAY);
    assert.equal(buckets[0].label, "15–30 Sep 2025");
    assert.equal(buckets[0].clipped, true);
    assert.equal(buckets[0].state, "spending", "the period starts with the records, so the bar is fully covered");
    assert.equal(buckets[0].coveredDays, buckets[0].days);
    assert.equal(buckets[1].label, "Oct 2025");
    assert.equal(buckets.at(-1).label, "1–6 Nov 2026");
    assert.equal(buckets.at(-1).soFar, true);
  });
});

describe("spending trend: coverage is separate from period clipping (D-19)", () => {
  it("records starting mid-week: earlier bars have no history, the bar where records begin is partly covered", () => {
    const s = insightsState({ from: "2026-10-28" }); // a Wednesday
    const days = I.spendingTrend(s, "30d", TODAY).buckets;
    assert.ok(days.filter(b => b.start < "2026-10-28").every(b => b.state === "no-history" && b.expenses === 0 && b.coveredDays === 0));
    assert.ok(days.filter(b => b.start >= "2026-10-28").every(b => b.state !== "no-history" && b.state !== "partly-covered"), "a day is never partly covered");
    const weeks = I.spendingTrend(s, "6m", TODAY).buckets;
    const w = weeks.find(b => b.start === "2026-10-26");
    assert.deepEqual([w.state, w.clipped, w.coveredDays, w.days, w.coveredStart], ["partly-covered", false, 5, 7, "2026-10-28"]);
    assert.ok(weeks.filter(b => b.end < "2026-10-26").every(b => b.state === "no-history"));
    assert.equal(weeks[0].state, "no-history");
    assert.equal(weeks[0].clipped, true, "cut short by the period, and also before the records: both are reported");
  });

  it("a covered day with no spending is 'no-spending', not missing history", () => {
    const { buckets } = I.spendingTrend(insightsState(), "30d", TODAY);
    const sunday = buckets.find(b => b.start === "2026-10-11"); // a Sunday with no fictional spending
    assert.deepEqual([sunday.state, sunday.expenses, sunday.coveredDays], ["no-spending", 0, 1]);
    assert.equal(buckets.find(b => b.start === "2026-10-12").state, "spending");
  });

  it("states: no history, partly covered, no spending, spending — and nothing else", () => {
    const s = budget([t("income", 1000, "2026-10-29"), t("expense", 300, "2026-11-02")]);
    const weeks = I.spendingTrend(s, "6m", TODAY).buckets;
    assert.deepEqual([...new Set(weeks.map(b => b.state))].sort(), ["no-history", "partly-covered", "spending"]);
    assert.equal(weeks.find(b => b.start === "2026-10-26").state, "partly-covered");
    const days = I.spendingTrend(s, "30d", TODAY).buckets;
    assert.equal(days.find(b => b.start === "2026-10-30").state, "no-spending");
    assert.equal(days.find(b => b.start === "2026-11-02").state, "spending");
  });

  it("covered days in the bars add up to the approved denominator (D-18)", () => {
    for (const s of [insightsState(), insightsState({ from: "2026-10-28" }), insightsState({ from: "2026-07-14" })]) {
      for (const p of PERIOD_IDS) {
        const tr = I.spendingTrend(s, p, TODAY);
        assert.equal(tr.buckets.reduce((a, b) => a + b.coveredDays, 0), I.summary(s, p, TODAY).averageDaily.days, p);
      }
    }
  });
});

describe("income vs expenses by month", () => {
  const h = insightsState();

  it("Last 30 days: the two months it overlaps, cut to the period (8–31 Oct, 1–6 Nov), both labelled partial", () => {
    const { months } = I.incomeExpenseMonths(h, "30d", TODAY);
    assert.deepEqual(months.map(m => [m.label, m.start, m.end, m.days, m.clipped, m.soFar]), [
      ["8–31 Oct 2026", "2026-10-08", "2026-10-31", 24, true, false],
      ["1–6 Nov 2026", "2026-11-01", "2026-11-06", 6, true, true]
    ]);
    assert.ok(months.every(m => m.state !== "partly-covered"), "clipping isn't a coverage problem");
  });

  it("other periods: calendar months, with only the edge months cut to the period", () => {
    const six = I.incomeExpenseMonths(h, "6m", TODAY).months;
    assert.equal(six.length, 7);
    assert.equal(six[0].label, "7–31 May 2026");
    assert.ok(six.slice(1, -1).every(m => !m.clipped && /^[A-Z][a-z]{2} 2026$/.test(m.label)));
    const all = I.incomeExpenseMonths(h, "all", TODAY).months;
    assert.equal(all.length, 15);
    assert.equal(all[0].label, "Sep 2025");
    assert.equal(all[0].clipped, false);
  });

  it("months add up to the period's income and expenses; savings moves are neither", () => {
    for (const p of PERIOD_IDS) {
      const r = I.incomeExpenseMonths(h, p, TODAY);
      const sum = I.summary(h, p, TODAY);
      assert.equal(r.income, sum.incomeVsExpenses.income, p);
      assert.equal(r.expenses, sum.incomeVsExpenses.expenses, p);
      assert.ok(r.months.every(m => m.difference === m.income - m.expenses));
    }
    const s = budget([t("income", 5000, "2026-10-01"), t("savings_transfer", 2000, "2026-10-02"), t("savings_withdrawal", 900, "2026-11-03"), t("expense", 400, "2026-11-04")]);
    const { months } = I.incomeExpenseMonths(s, "6m", TODAY);
    const oct = months.find(m => m.start === "2026-10-01"), nov = months.find(m => m.start === "2026-11-01");
    assert.deepEqual([oct.income, oct.expenses, nov.income, nov.expenses], [5000, 0, 0, 400]);
  });

  it("a month where records begin is partly covered; months before have no history", () => {
    const s = insightsState({ from: "2026-10-31" });
    const { months } = I.incomeExpenseMonths(s, "30d", TODAY);
    assert.deepEqual(months.map(m => [m.state, m.coveredDays, m.coveredStart]), [["partly-covered", 1, "2026-10-31"], ["spending", 6, "2026-11-01"]]);
    const six = I.incomeExpenseMonths(s, "6m", TODAY).months;
    assert.ok(six.slice(0, 5).every(m => m.state === "no-history"));
  });
});

describe("category donut: grouping (D-19)", () => {
  const withCategories = (k) => {
    const cats = Array.from({ length: k }, (_, i) => ({ id: `k${i + 1}`, name: `Cat ${String.fromCharCode(65 + i)}`, budget: 100, kind: "Flexible" }));
    const tx = cats.map((c, i) => t("expense", 1000 - i * 50, "2026-11-01", { categoryId: c.id }));
    return budget(tx, cats);
  };

  it("five or fewer categories: all shown separately", () => {
    for (const k of [1, 4, 5]) {
      const r = I.categorySegments(withCategories(k), "30d", TODAY);
      assert.equal(r.segments.length, k);
      assert.equal(r.grouped, false);
      assert.ok(r.segments.every(s => !s.group));
    }
  });

  it("exactly six: all six shown separately, never 'Other categories (1)'", () => {
    const r = I.categorySegments(withCategories(6), "30d", TODAY);
    assert.equal(r.segments.length, 6);
    assert.equal(r.grouped, false);
    assert.ok(!r.segments.some(s => /Other categories/.test(s.name)));
    assert.equal(r.segments[5].name, "Cat F");
    const h = I.categorySegments(insightsState(), "all", TODAY); // the fictional history has six, too
    assert.equal(h.segments.length, 6);
    assert.ok(h.segments.some(s => s.name === "Other / uncategorised" && !s.group));
  });

  it("more than six: the five largest, then 'Other categories (N)' with N ≥ 2", () => {
    for (const [k, rest] of [[7, 2], [10, 5]]) {
      const r = I.categorySegments(withCategories(k), "30d", TODAY);
      assert.equal(r.segments.length, 6);
      assert.equal(r.grouped, true);
      assert.deepEqual(r.segments.slice(0, 5).map(s => s.name), ["Cat A", "Cat B", "Cat C", "Cat D", "Cat E"]);
      const g = r.segments[5];
      assert.equal(g.name, `Other categories (${rest})`);
      assert.equal(g.key, I.GROUP_KEY);
      assert.equal(g.group, true);
      assert.equal(g.members.length, rest);
      assert.equal(g.amount, g.members.reduce((a, m) => a + m.amount, 0));
      assert.equal(g.count, g.members.reduce((a, m) => a + m.count, 0));
    }
  });

  it("slices add up to total spending and shares to 100%", () => {
    for (const s of [insightsState(), insightsState({ extraCategories: 4 }), withCategories(10)]) {
      for (const p of PERIOD_IDS) {
        const r = I.categorySegments(s, p, TODAY);
        assert.equal(r.segments.reduce((a, x) => a + x.amount, 0), r.total, p);
        assert.equal(r.total, I.summary(s, p, TODAY).expenses.amount, p);
        if (r.total > 0) assert.ok(Math.abs(r.segments.reduce((a, x) => a + x.share, 0) - 1) < 1e-9, p);
      }
    }
  });

  it("ties at the cut-off are settled alphabetically, as in the category list", () => {
    const cats = ["Zeta", "Alpha", "Mid", "Beta", "Gamma", "Delta", "Echo"].map((name, i) => ({ id: `t${i}`, name, budget: 1, kind: "Flexible" }));
    const s = budget(cats.map(c => t("expense", 100, "2026-11-01", { categoryId: c.id })), cats);
    const r = I.categorySegments(s, "30d", TODAY);
    assert.deepEqual(r.segments.slice(0, 5).map(x => x.name), ["Alpha", "Beta", "Delta", "Echo", "Gamma"]);
    assert.deepEqual(r.segments[5].members.map(m => m.name), ["Mid", "Zeta"]);
  });

  it("'Other / uncategorised' stays its own slice in the top five, and is a member of the group otherwise", () => {
    const cats = Array.from({ length: 6 }, (_, i) => ({ id: `u${i}`, name: `U${i}`, budget: 1, kind: "Flexible" }));
    const big = budget(cats.map((c, i) => t("expense", 100 + i, "2026-11-01", { categoryId: c.id })).concat([t("expense", 9999, "2026-11-02", { categoryId: "deleted" })]), cats);
    const r1 = I.categorySegments(big, "30d", TODAY);
    assert.equal(r1.segments[0].name, "Other / uncategorised");
    assert.equal(r1.segments[0].group, false);
    assert.equal(r1.segments[5].name, "Other categories (2)");
    const small = budget(cats.map((c, i) => t("expense", 100 + i, "2026-11-01", { categoryId: c.id })).concat([t("expense", 1, "2026-11-02", { categoryId: "deleted" })]), cats);
    const r2 = I.categorySegments(small, "30d", TODAY);
    assert.ok(r2.segments[5].members.some(m => m.key === I.UNCATEGORISED && m.name === "Other / uncategorised"));
    assert.ok(!r2.segments.slice(0, 5).some(s => s.key === I.UNCATEGORISED));
  });

  it("categories with no spending in the period aren't slices", () => {
    const s = budget([t("expense", 500, "2026-01-05", { categoryId: "fun" }), t("expense", 300, "2026-11-01")],
      [{ id: "food", name: "Food", budget: 1, kind: "Essential" }, { id: "fun", name: "Fun", budget: 1, kind: "Flexible" }]);
    assert.deepEqual(I.categorySegments(s, "30d", TODAY).segments.map(x => x.name), ["Food"]);
  });
});

describe("drill-through entries (read-only)", () => {
  const h = insightsState({ extraCategories: 3 });

  it("each trend bar's entries add up to the bar", () => {
    for (const p of PERIOD_IDS) {
      for (const b of I.spendingTrend(h, p, TODAY).buckets) {
        const r = I.entriesFor(h, { start: b.start, end: b.end, types: ["expense"] }, TODAY);
        assert.equal(r.total, b.expenses, `${p} ${b.label}`);
        assert.ok(r.entries.every(x => x.type === "expense" && x.date >= b.start && x.date <= b.end));
      }
    }
  });

  it("each category's entries add up to its slice, including the grouped categories", () => {
    for (const p of PERIOD_IDS) {
      const seg = I.categorySegments(h, p, TODAY);
      for (const s of seg.segments) {
        const r = I.entriesFor(h, { start: seg.range.start, end: seg.range.end, categoryKeys: s.members.map(m => m.key) }, TODAY);
        assert.equal(r.total, s.amount, `${p} ${s.name}`);
        assert.equal(r.count, s.count, `${p} ${s.name}`);
      }
    }
  });

  it("uncategorised entries (deleted or unknown categories) are found by the uncategorised key", () => {
    const r = I.entriesFor(h, { start: "2026-10-01", end: TODAY, categoryKeys: [I.UNCATEGORISED] }, TODAY);
    assert.ok(r.count > 0);
    assert.ok(r.entries.every(x => x.categoryId === "other"));
  });

  it("newest first, then most recently recorded — the order of the Transactions screen", () => {
    const s = budget([t("expense", 1, "2026-11-01"), t("expense", 2, "2026-11-05"), t("expense", 3, "2026-11-01"), t("expense", 4, "2026-11-03")]);
    const r = I.entriesFor(s, { start: "2026-10-08", end: TODAY, types: ["expense"] }, TODAY);
    assert.deepEqual(r.entries.map(x => x.amount), [2, 4, 3, 1]);
  });

  it("never includes entries dated after today, even if asked for a later end date", () => {
    const s = budget([t("expense", 100, "2026-11-06"), t("expense", 999, "2026-11-07"), t("expense", 50, "2026-12-01")]);
    const r = I.entriesFor(s, { start: "2026-11-01", end: "2026-11-30", types: ["expense"] }, TODAY);
    assert.deepEqual([r.count, r.total], [1, 100]);
  });
});

describe("empty and future-only histories", () => {
  for (const [name, tx] of [["no records", []], ["only future entries", [{ type: "expense", amount: 500, date: "2026-11-07" }, { type: "income", amount: 900, date: "2027-01-01" }]]]) {
    it(`${name}: no history anywhere, nothing invented`, () => {
      const s = budget(tx.map(x => t(x.type, x.amount, x.date)));
      for (const p of PERIOD_IDS) {
        const tr = I.spendingTrend(s, p, TODAY);
        assert.equal(tr.hasHistory, false, p);
        assert.equal(tr.total, 0);
        assert.ok(tr.buckets.length > 0 && tr.buckets.every(b => b.state === "no-history" && b.expenses === 0 && b.coveredStart === null), p);
        const m = I.incomeExpenseMonths(s, p, TODAY);
        assert.deepEqual([m.hasHistory, m.income, m.expenses], [false, 0, 0], p);
        const seg = I.categorySegments(s, p, TODAY);
        assert.deepEqual([seg.total, seg.segments.length], [0, 0], p);
        assert.equal(I.entriesFor(s, { start: tr.range.start, end: TODAY }, TODAY).count, 0);
      }
    });
  }
});

describe("currencies and read-only use", () => {
  it("the same figures in every supported currency (whole units, never converted)", () => {
    const base = JSON.stringify([I.spendingTrend(insightsState(), "6m", TODAY).buckets, I.categorySegments(insightsState(), "all", TODAY).segments]);
    for (const cur of C.CODES) {
      const s = insightsState({ currency: cur });
      assert.equal(JSON.stringify([I.spendingTrend(s, "6m", TODAY).buckets, I.categorySegments(s, "all", TODAY).segments]), base, cur);
    }
  });

  it("never changes the data it reads", () => {
    const s = deepFreeze(insightsState({ extraCategories: 4 }));
    const before = JSON.stringify(s);
    for (const p of PERIOD_IDS) {
      const tr = I.spendingTrend(s, p, TODAY);
      I.incomeExpenseMonths(s, p, TODAY);
      const seg = I.categorySegments(s, p, TODAY);
      I.entriesFor(s, { start: tr.range.start, end: TODAY, types: ["expense"] }, TODAY);
      I.entriesFor(s, { start: tr.range.start, end: TODAY, categoryKeys: seg.segments.at(-1).members.map(m => m.key) }, TODAY);
    }
    assert.equal(JSON.stringify(s), before);
  });
});

describe("performance with 20,000 entries", () => {
  it("prepares every chart for every period in well under a second", () => {
    const base = insightsState();
    const cats = base.categories.map(c => c.id).concat(["gone-1", "gone-2"]);
    let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const tx = [];
    for (let i = 0; i < 20000; i++) {
      const r = rnd(), type = r < 0.85 ? "expense" : r < 0.93 ? "income" : r < 0.98 ? "savings_transfer" : "savings_withdrawal";
      tx.push({ id: `p${i}`, type, amount: 1 + Math.floor(rnd() * 5000), date: F.addDays("2023-11-07", Math.floor(rnd() * 1096)), note: "", createdAt: i,
        ...(type === "expense" ? { categoryId: cats[Math.floor(rnd() * cats.length)] } : type === "income" ? { categoryId: "inc-salary" } : { destinationId: "m-shwari" }) });
    }
    const s = D.normalizeState({ ...base, transactions: tx }).state;
    assert.equal(s.transactions.length, 20000);
    const t0 = process.hrtime.bigint();
    for (const p of PERIOD_IDS) {
      const tr = I.spendingTrend(s, p, TODAY);
      const m = I.incomeExpenseMonths(s, p, TODAY);
      const seg = I.categorySegments(s, p, TODAY);
      const b = tr.buckets.at(-1);
      I.entriesFor(s, { start: b.start, end: b.end, types: ["expense"] }, TODAY);
      assert.equal(tr.total, I.summary(s, p, TODAY).expenses.amount);
      assert.equal(m.expenses, tr.total);
      assert.equal(seg.total, tr.total);
    }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(ms < 1000, `took ${ms.toFixed(0)} ms`);
  });
});
