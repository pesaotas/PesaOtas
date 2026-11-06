/**
 * Insights calculations (v1.6 Phase 2, decision D-18): fictional data only.
 * Periods and boundaries, fair comparisons, coverage, category totals,
 * savings exclusions, time series, patterns, empty data, and read-only use.
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
let n = 0;
const t = (type, amount, date, extra = {}) => ({ id: `x${++n}`, type, amount, date, note: "", createdAt: n,
  ...(type === "expense" ? { categoryId: "food" } : type === "income" ? { categoryId: "inc-salary" } : { destinationId: "m-shwari" }), ...extra });
function budget(transactions, extra = {}) {
  const r = D.normalizeState({
    app: "PesaOtas", version: 3, currency: "KES", openingBalance: 10000, payday: "2026-11-30",
    categories: [
      { id: "food", name: "Food", budget: 5000, kind: "Essential" },
      { id: "fun", name: "Fun", budget: 1000, kind: "Flexible" },
      { id: "save", name: "Savings", budget: 2000, kind: "Savings", destinationId: "m-shwari" }
    ],
    transactions, savingsDestinations: D.DEFAULT_DESTINATIONS.map(d => ({ ...d })), meta: {}, ...extra
  });
  assert.ok(D.isClean(r), JSON.stringify(r.errors));
  return r.state;
}

describe("periods", () => {
  it("last 30 days ends today and includes it; the previous period is the 30 days before", () => {
    const r = I.periodRange(budget([t("expense", 1, "2026-01-01")]), "30d", TODAY);
    assert.deepEqual([r.start, r.end, r.days], ["2026-10-08", TODAY, 30]);
    assert.deepEqual(r.previous, { start: "2026-09-08", end: "2026-10-07", days: 30 });
  });

  it("last 6 months counts real days, and compares with exactly as many days before", () => {
    const r = I.periodRange(budget([]), "6m", TODAY);
    assert.equal(r.start, "2026-05-07");
    assert.equal(r.days, 184);
    assert.equal(r.previous.days, 184);
    assert.equal(F.daysBetween(r.previous.start, r.previous.end) + 1, 184);
    assert.equal(r.previous.end, "2026-05-06");
    // Month ends and leap years
    assert.equal(I.periodRange(budget([]), "6m", "2026-08-31").start, "2026-03-01");
    assert.equal(I.periodRange(budget([]), "6m", "2028-03-01").start, "2027-09-02");
  });

  it("all time runs from the first record to today, with nothing to compare against", () => {
    const r = I.periodRange(budget([t("expense", 5, "2026-03-04"), t("expense", 5, "2026-05-01")]), "all", TODAY);
    assert.deepEqual([r.start, r.end, r.previous, r.comparable], ["2026-03-04", TODAY, null, false]);
  });

  it("an unknown period falls back to the last 30 days", () => {
    assert.equal(I.periodRange(budget([]), "weird", TODAY).id, "30d");
  });

  it("includes entries on the first and last day, excludes the day before and anything after today", () => {
    const s = budget([t("expense", 1, "2026-10-07"), t("expense", 10, "2026-10-08"), t("expense", 100, TODAY), t("expense", 1000, "2026-11-07")]);
    const sum = I.summary(s, "30d", TODAY);
    assert.equal(sum.expenses.amount, 110);
    assert.equal(sum.futureEntries, 1);
  });
});

describe("fair comparisons", () => {
  it("compare only when records cover the whole previous period", () => {
    const covered = budget([t("expense", 300, "2026-09-08"), t("expense", 400, "2026-10-20")]);
    const short = budget([t("expense", 300, "2026-09-09"), t("expense", 400, "2026-10-20")]);
    assert.equal(I.periodRange(covered, "30d", TODAY).comparable, true);
    assert.equal(I.periodRange(short, "30d", TODAY).comparable, false, "one day short is not enough");
    const sum = I.summary(short, "30d", TODAY);
    for (const k of ["expenses", "averageDaily", "netCash", "leaks"]) assert.equal(sum[k].change, null, k);
    assert.equal(sum.largestCategory.change, null);
    assert.equal(sum.previousTotals, null);
  });

  it("gives the difference and the percentage; no percentage when the previous amount was zero", () => {
    const s = budget([t("expense", 300, "2026-09-08"), t("expense", 400, "2026-10-20"), t("expense", 20, "2026-09-10", { categoryId: "fun" })]);
    const sum = I.summary(s, "30d", TODAY);
    assert.deepEqual(sum.expenses.change, { previous: 320, diff: 80, pct: 25 });
    const zero = budget([t("income", 5, "2026-09-01"), t("expense", 400, "2026-10-20")]);
    assert.deepEqual(I.summary(zero, "30d", TODAY).expenses.change, { previous: 0, diff: 400, pct: null });
  });

  it("averages per day over the same number of days in both periods", () => {
    const s = budget([t("expense", 3000, "2026-09-08"), t("expense", 600, "2026-10-08")]);
    const sum = I.summary(s, "30d", TODAY);
    assert.deepEqual(sum.averageDaily, { amount: 20, days: 30, change: { previous: 100, diff: -80, pct: -80 } });
  });
});

describe("coverage", () => {
  it("when records start part-way through, averages use only the days with records, and say so", () => {
    const s = budget([t("expense", 700, "2026-10-31"), t("expense", 0 + 700, "2026-11-06")]);
    const sum = I.summary(s, "30d", TODAY);
    assert.deepEqual(sum.range.coverage, { recordsStart: "2026-10-31", coveredStart: "2026-10-31", coveredDays: 7, partial: true, empty: false });
    assert.equal(sum.averageDaily.amount, 200);
    assert.equal(sum.averageDaily.days, 7);
  });

  it("with no records, every figure is zero and nothing is invented", () => {
    const sum = I.summary(budget([]), "30d", TODAY);
    assert.equal(sum.range.coverage.empty, true);
    assert.equal(sum.expenses.amount, 0);
    assert.equal(sum.averageDaily.amount, 0);
    assert.equal(sum.largestCategory, null);
    assert.equal(sum.incomeVsExpenses.spentShare, null);
    assert.deepEqual(sum.breakdown.rows, []);
    const all = I.summary(budget([]), "all", TODAY);
    assert.equal(all.range.days, 1);
    assert.equal(all.expenses.amount, 0);
  });

  it("only future-dated entries: the period has no records yet", () => {
    const sum = I.summary(budget([t("expense", 50, "2026-12-01")]), "30d", TODAY);
    assert.equal(sum.range.coverage.empty, true);
    assert.equal(sum.futureEntries, 1);
    assert.equal(sum.expenses.amount, 0);
  });
});

describe("what counts as income and spending", () => {
  const s = budget([
    t("income", 50000, "2026-11-01"), t("expense", 2000, "2026-11-02"),
    t("savings_transfer", 3000, "2026-11-02", { categoryId: "save" }), t("savings_withdrawal", 1000, "2026-11-03"),
    t("expense", 500, "2026-11-04", { categoryId: "fun" })
  ]);
  const sum = I.summary(s, "30d", TODAY);

  it("savings transfers are never spending and withdrawals are never income", () => {
    assert.equal(sum.expenses.amount, 2500);
    assert.equal(sum.incomeVsExpenses.income, 50000);
    assert.equal(sum.totals.transfers, 3000);
    assert.equal(sum.totals.withdrawals, 1000);
    assert.ok(!sum.breakdown.rows.some(r => r.key === "save"), "a linked savings category is not listed as spending");
  });

  it("net cash movement = income − spending − transfers + withdrawals", () => {
    assert.equal(sum.netCash.amount, 50000 - 2500 - 3000 + 1000);
  });

  it("income vs expenses gives the share of income spent", () => {
    assert.equal(sum.incomeVsExpenses.spentShare, 2500 / 50000);
    assert.equal(sum.incomeVsExpenses.difference, 47500);
  });

  it("all-time net cash agrees with the app's own cash calculation", () => {
    const h = insightsState();
    const all = I.summary(h, "all", TODAY);
    assert.equal(h.openingBalance + all.netCash.amount, F.computeTotals(h).cash);
  });
});

describe("categories", () => {
  it("totals and shares per category, largest first, uncategorised and unknown IDs grouped together", () => {
    const s = budget([t("expense", 600, "2026-11-01"), t("expense", 300, "2026-11-02", { categoryId: "other" }),
      t("expense", 100, "2026-11-03", { categoryId: "deleted-cat" }), t("expense", 200, "2026-11-04", { categoryId: "fun" })]);
    const b = I.summary(s, "30d", TODAY).breakdown;
    assert.equal(b.total, 1200);
    assert.deepEqual(b.rows.map(r => [r.name, r.amount, r.count]), [["Food", 600, 1], ["Other / uncategorised", 400, 2], ["Fun", 200, 1]]);
    assert.ok(Math.abs(b.rows.reduce((a, r) => a + r.share, 0) - 1) < 1e-9, "shares add up to 100%");
    assert.deepEqual(I.summary(s, "30d", TODAY).largestCategory.name, "Food");
  });

  it("with a comparison, categories that stopped are included with their change", () => {
    const s = budget([t("expense", 100, "2026-09-08", { categoryId: "fun" }), t("expense", 50, "2026-10-20")]);
    const rows = I.summary(s, "30d", TODAY).breakdown.rows;
    assert.deepEqual(rows.find(r => r.key === "fun").change, { previous: 100, diff: -100, pct: -100 });
    assert.deepEqual(rows.find(r => r.key === "food").change, { previous: 0, diff: 50, pct: null });
  });
});

describe("potential spending leaks", () => {
  it("small purchases and uncategorised spending, each counted once", () => {
    const s = budget([t("expense", 500, "2026-11-01"), t("expense", 501, "2026-11-01"), t("expense", 20, "2026-11-02", { categoryId: "other" }),
      t("expense", 9000, "2026-11-03", { categoryId: "other" })]);
    const l = I.summary(s, "30d", TODAY).leaks;
    assert.deepEqual([l.threshold, l.count, l.total, l.smallCount, l.uncategorisedCount], [500, 3, 9520, 2, 2]);
    assert.equal(l.share, 9520 / 10021);
  });

  it("use the budget currency's threshold", () => {
    for (const code of C.CODES) {
      const s = { ...budget([t("expense", C.info(code).smallPurchase, "2026-11-01"), t("expense", C.info(code).smallPurchase + 1, "2026-11-01")]), currency: code };
      const l = I.summary(s, "30d", TODAY).leaks;
      assert.deepEqual([l.threshold, l.count], [C.info(code).smallPurchase, 1], code);
    }
  });
});

describe("time series", () => {
  const h = insightsState();

  for (const [period, unit] of [["30d", "day"], ["30d", "week"], ["6m", "week"], ["6m", "month"], ["all", "month"]]) {
    it(`${period} by ${unit}: buckets cover the period exactly, and add up to the period totals`, () => {
      const range = I.periodRange(h, period, TODAY);
      const b = I.series(h, range, unit);
      assert.equal(b[0].start, range.start);
      assert.equal(b[b.length - 1].end, range.end);
      for (let i = 1; i < b.length; i++) assert.equal(b[i].start, F.addDays(b[i - 1].end, 1));
      assert.equal(b.reduce((a, x) => a + x.days, 0), range.days);
      const tot = I.summary(h, period, TODAY).totals;
      for (const k of ["income", "expenses", "transfers", "withdrawals", "net"]) assert.equal(b.reduce((a, x) => a + x[k], 0), tot[k], k);
    });
  }

  it("days: one per day; weeks: Monday to Sunday; months: calendar months, ends marked partial", () => {
    const r30 = I.periodRange(h, "30d", TODAY);
    assert.equal(I.series(h, r30, "day").length, 30);
    const weeks = I.series(h, r30, "week");
    assert.deepEqual(weeks.map(w => [w.start, w.end, w.partial]), [
      ["2026-10-08", "2026-10-11", true], ["2026-10-12", "2026-10-18", false], ["2026-10-19", "2026-10-25", false],
      ["2026-10-26", "2026-11-01", false], ["2026-11-02", "2026-11-06", true]]);
    assert.equal(weeks[1].label, "12 Oct – 18 Oct");
    const months = I.series(h, I.periodRange(h, "6m", TODAY), "month");
    assert.deepEqual(months.map(m => m.label), ["May 2026", "Jun 2026", "Jul 2026", "Aug 2026", "Sep 2026", "Oct 2026", "Nov 2026"]);
    assert.deepEqual(months.map(m => m.partial), [true, false, false, false, false, false, true]);
    assert.equal(I.historyUnit("30d"), "week");
    assert.equal(I.historyUnit("6m"), "month");
  });

  it("months before the records start are marked as having no records", () => {
    const s = budget([t("expense", 100, "2026-10-15")]);
    const months = I.series(s, I.periodRange(s, "6m", TODAY), "month");
    assert.equal(months[0].coveredDays, 0);
    assert.equal(months.find(m => m.label === "Oct 2026").coveredDays, 17);
  });
});

describe("patterns", () => {
  const h = insightsState();

  it("are not shown for 30 days, or without 3 complete months", () => {
    assert.equal(I.patterns(h, "30d", TODAY).reason, "period");
    const short = budget([t("expense", 100, "2026-09-01"), t("expense", 100, "2026-10-01")]);
    const p = I.patterns(short, "all", TODAY);
    assert.deepEqual([p.available, p.reason, p.completeMonths], [false, "data", 2]);
  });

  it("find the unusually high month, against the median complete month", () => {
    const p = I.patterns(h, "all", TODAY);
    assert.equal(p.available, true);
    assert.equal(p.completeMonths, 14);
    assert.deepEqual(p.highMonths.map(m => m.label), ["Dec 2025"]);
    assert.ok(p.highMonths[0].abovePct > 25);
  });

  it("flat spending produces no 'unusually high' month", () => {
    const flat = [];
    for (const m of ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]) flat.push(t("expense", 1000, `${m}-05`));
    assert.deepEqual(I.patterns(budget(flat), "all", TODAY).highMonths, []);
  });

  it("list categories with spending in every complete month, and only those", () => {
    const p = I.patterns(h, "all", TODAY);
    assert.deepEqual(p.everyMonth.map(c => c.name), ["Groceries", "Rent", "Transport", "Electricity", "Other / uncategorised"]);
    assert.ok(!p.everyMonth.some(c => c.name === "Fun"), "Fun only in December");
    assert.equal(p.everyMonth.find(c => c.name === "Rent").monthlyAverage, 15000);
  });

  it("a category missing from any one complete month is not 'every month'", () => {
    const tx = [];
    for (const m of ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]) tx.push(t("expense", 1000, `${m}-05`));
    for (const m of ["2026-06", "2026-07", "2026-09", "2026-10"]) tx.push(t("expense", 300, `${m}-06`, { categoryId: "fun" })); // none in August
    const p = I.patterns(budget(tx), "all", TODAY);
    assert.equal(p.available, true);
    assert.deepEqual(p.everyMonth.map(c => c.name), ["Food"]);
  });

  it("biggest changes only when the previous period is fully covered", () => {
    const p6 = I.patterns(h, "6m", TODAY);
    assert.equal(p6.comparable, true);
    assert.deepEqual(p6.decreases.map(r => r.name), ["Groceries", "Fun", "Electricity"]);
    const short = budget([t("expense", 100, "2026-10-15")]);
    assert.deepEqual(I.patterns(short, "30d", TODAY).increases, []);
    assert.equal(I.patterns(short, "30d", TODAY).comparable, false);
  });
});

describe("read-only", () => {
  it("never changes the data it analyses", () => {
    const h = insightsState();
    const before = JSON.stringify(h);
    const frozen = deepFreeze(JSON.parse(before));
    for (const p of ["30d", "6m", "all"]) {
      I.summary(frozen, p, TODAY);
      I.patterns(frozen, p, TODAY);
      for (const u of ["day", "week", "month"]) I.series(frozen, I.periodRange(frozen, p, TODAY), u);
    }
    assert.equal(JSON.stringify(frozen), before);
  });
});
