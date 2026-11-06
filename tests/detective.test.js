/**
 * Expense Detective rules (v1.6 Phase 4, decision D-20): windows, unusual bills
 * (U1), unusually large expenses (U2), small purchases, uncategorised
 * spending, spending pace, review state and reappearance, review records.
 * Fictional data only.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const X = require("../src/detective.js");
const D = require("../src/data-model.js");
const F = require("../src/finance.js");
const I = require("../src/insights.js");
const S = require("../src/storage.js");
const { FakeStorage } = require("./helpers/fake-storage.js");
const { deepFreeze } = require("./fixtures.js");
const { tx, ex, budget, CATEGORIES } = require("./helpers/detective-data.js");

const TODAY = "2026-12-15";          // no pay cycle → window S is 1–15 Dec; candidates from 1 Nov
const NOW = new Date("2026-12-15T09:00:00Z");
const alertsOf = (state, rule, today = TODAY) => X.run(state, today).alerts.filter(a => a.rule === rule);
const bills = (amounts, dates, note = "KPLC token 12/10") => amounts.map((a, i) => ex(a, dates[i], "power", { note }));
const EARLIER = ["2026-09-10", "2026-10-10", "2026-11-10"];

describe("windows", () => {
  it("pay cycle to today when the cycle has started; otherwise this month to today; candidates from 30 days earlier", () => {
    const w1 = X.windows(budget([], { cycleStart: "2026-12-03", payday: "2027-01-03" }), TODAY);
    assert.deepEqual(w1.summary, { start: "2026-12-03", end: TODAY, kind: "cycle" });
    assert.deepEqual(w1.candidates, { start: "2026-11-03", end: TODAY });
    const w2 = X.windows(budget([]), TODAY);
    assert.deepEqual(w2.summary, { start: "2026-12-01", end: TODAY, kind: "month" });
    assert.equal(w2.candidates.start, "2026-11-01");
    const w3 = X.windows(budget([], { cycleStart: "2026-12-20", payday: "2027-01-20" }), TODAY);
    assert.equal(w3.summary.kind, "month", "a cycle that starts after today isn't used");
  });
});

describe("U1 unusual bill", () => {
  const run = (amount, extra = []) => alertsOf(budget([...bills([2000, 2000, 2000], EARLIER), ex(amount, "2026-12-10", "power", { note: "KPLC token 1/12", id: "cand" }), ...extra]), "unusual-bill");

  it("2,499 and 2,500 (exactly 125%) are not flagged; 2,501 and 2,700 are", () => {
    assert.equal(run(2499).length, 0);
    assert.equal(run(2500).length, 0);
    assert.equal(run(2501).length, 1);
    const a = run(2700)[0];
    assert.equal(a.id, "unusual-bill:cand");
    assert.match(a.text, /^KSh\s2,700 on 10 Dec 2026, 35% more than usual\. Usual: KSh\s2,000, the median of your last 3 bills described like this \(Sep 2026, Oct 2026, Nov 2026\)\.$/);
  });

  it("the minimum difference follows the currency: 450 against 300 is not flagged in KES, and is in USD", () => {
    const mk = (cur) => budget([...bills([300, 300, 300], EARLIER), ex(450, "2026-12-10", "power", { note: "KPLC token" })], { currency: cur });
    assert.equal(alertsOf(mk("KES"), "unusual-bill").length, 0);
    assert.equal(alertsOf(mk("USD"), "unusual-bill").length, 1);
  });

  it("needs 3 earlier bills in 3 different months, and says so when there aren't", () => {
    const two = budget([...bills([2000, 2000], ["2026-10-10", "2026-11-10"]), ex(9000, "2026-12-10", "power", { note: "kplc token" })]);
    assert.equal(alertsOf(two, "unusual-bill").length, 0);
    assert.ok(X.run(two, TODAY).checks.some(c => c.kind === "insufficient" && /2 earlier bills in 2 months; needs 3 in 3 different months/.test(c.text)));
    const sameMonth = budget([...bills([2000, 2000, 2000], ["2026-10-01", "2026-10-20", "2026-11-10"]), ex(9000, "2026-12-10", "power", { note: "kplc token" })]);
    assert.equal(alertsOf(sameMonth, "unusual-bill").length, 0);
  });

  it("bills with no description are never grouped, and the checks say why", () => {
    const s = budget([...bills([2000, 2000, 2000], EARLIER, ""), ex(9000, "2026-12-10", "power", { note: "" })]);
    assert.equal(alertsOf(s, "unusual-bill").length, 0);
    assert.ok(X.run(s, TODAY).checks.some(c => /Electricity: 2 bills have no description/.test(c.text)));
    assert.equal(X.normaliseNote(" 12/10 — !! "), "");
  });

  it("descriptions match ignoring numbers, punctuation and capitals; different words don't", () => {
    assert.equal(X.normaliseNote("KPLC token 12/10"), "kplc token");
    assert.equal(X.normaliseNote("kplc-TOKEN (Nov)"), "kplc token nov");
    assert.equal(X.normaliseNote("Kplc   Token 2026"), "kplc token");
    const other = budget([...bills([2000, 2000, 2000], EARLIER, "Kenya Power"), ex(9000, "2026-12-10", "power", { note: "KPLC token" })]);
    assert.equal(alertsOf(other, "unusual-bill").length, 0);
  });

  it("the usual amount is the median of the latest 6 earlier bills (an older large bill doesn't count)", () => {
    const dates = ["2026-05-10", "2026-06-10", "2026-07-10", "2026-08-10", "2026-09-10", "2026-10-10", "2026-11-10"];
    const s = budget([...bills([9000, 2000, 2000, 2000, 3000, 3000, 3000], dates), ex(3200, "2026-12-10", "power", { note: "kplc token" })]);
    const a = alertsOf(s, "unusual-bill");
    assert.equal(a.length, 1, "median of the last 6 is 2,500, so 3,200 is more than 125%");
    assert.match(a[0].text, /Usual: KSh\s2,500/);
  });

  it("only earlier dates are history (a same-day bill isn't), within 12 months of the bill", () => {
    const sameDay = budget([...bills([2000, 2000], ["2026-10-10", "2026-11-10"]), ex(2000, "2026-12-10", "power", { note: "kplc token" }), ex(9000, "2026-12-10", "power", { note: "kplc token" })]);
    assert.equal(alertsOf(sameDay, "unusual-bill").length, 0);
    const edge = (first) => budget([...bills([2000, 2000, 2000], [first, "2026-03-10", "2026-06-10"]), ex(9000, "2026-12-10", "power", { note: "kplc token" })]);
    assert.equal(alertsOf(edge("2025-12-10"), "unusual-bill").length, 1, "exactly 12 months before counts");
    assert.equal(alertsOf(edge("2025-12-09"), "unusual-bill").length, 0, "a day earlier doesn't");
  });

  it("only Bills categories; entries dated after today are ignored", () => {
    const notBills = budget([...[2000, 2000, 2000].map((a, i) => ex(a, EARLIER[i], "food", { note: "kplc token" })), ex(2700, "2026-12-10", "food", { note: "kplc token" })]);
    assert.equal(alertsOf(notBills, "unusual-bill").length, 0);
    const future = budget([...bills([2000, 2000, 2000], EARLIER), ex(9000, "2026-12-20", "power", { note: "kplc token" })]);
    assert.equal(alertsOf(future, "unusual-bill").length, 0);
  });
});

describe("U2 unusually large expense", () => {
  const hist = (amount, cat = "fun", dates = ["2026-10-05", "2026-10-15", "2026-10-25", "2026-11-05", "2026-11-15"]) => dates.map(d => ex(amount, d, cat));
  it("at least 3× the median and at least the threshold more: 3,000 flagged, 2,999 not (median 1,000)", () => {
    assert.equal(alertsOf(budget([...hist(1000), ex(3000, "2026-12-05", "fun")]), "large-expense").length, 1);
    assert.equal(alertsOf(budget([...hist(1000), ex(2999, "2026-12-05", "fun")]), "large-expense").length, 0);
  });

  it("450 against fares of 150 is 3× but only 300 more, so not flagged; a 3,000 taxi is", () => {
    assert.equal(alertsOf(budget([...hist(150, "transport"), ex(450, "2026-12-05", "transport")]), "large-expense").length, 0);
    const a = alertsOf(budget([...hist(150, "transport"), ex(3000, "2026-12-05", "transport", { id: "taxi" })]), "large-expense");
    assert.equal(a.length, 1);
    assert.equal(a[0].id, "large-expense:taxi");
    assert.match(a[0].text, /about 20 times your usual Transport expense \(KSh\s150, the median of 5 expenses in the 180 days before\)/);
  });

  it("needs 5 earlier expenses within 180 days (the edge day counts)", () => {
    const four = budget([...hist(1000).slice(1), ex(5000, "2026-12-05", "fun")]);
    assert.equal(alertsOf(four, "large-expense").length, 0);
    assert.ok(X.run(four, TODAY).checks.some(c => /Fun: 4 earlier expenses in the 180 days before; needs 5/.test(c.text)));
    const edge = (d) => budget([...hist(1000, "fun", [d, "2026-10-15", "2026-10-25", "2026-11-05", "2026-11-15"]), ex(5000, "2026-12-05", "fun")]);
    assert.equal(alertsOf(edge(F.addDays("2026-12-05", -180)), "large-expense").length, 1);
    assert.equal(alertsOf(edge(F.addDays("2026-12-05", -181)), "large-expense").length, 0);
  });

  it("not for Bills or uncategorised spending; only entries in the candidate window (from 30 days before S)", () => {
    assert.equal(alertsOf(budget([...hist(1000, "power"), ex(9000, "2026-12-05", "power")]), "large-expense").length, 0);
    assert.equal(alertsOf(budget([...hist(1000, "other"), ex(9000, "2026-12-05", "other")]), "large-expense").length, 0);
    const at = (d) => alertsOf(budget([...hist(150, "transport", ["2026-09-01", "2026-09-05", "2026-09-10", "2026-09-15", "2026-09-20"]), ex(3000, d, "transport")]), "large-expense").length;
    assert.equal(at("2026-11-01"), 1, "1 Nov = 1 Dec minus 30 days: included");
    assert.equal(at("2026-10-31"), 0, "a day earlier: outside the candidate window");
  });
});

describe("small purchases (window S)", () => {
  const smalls = (n, amount = 100) => Array.from({ length: n }, (_, i) => ex(amount, F.addDays("2026-12-01", i % 14), "transport"));
  it("an alert only with at least 10 purchases making up at least 10% of spending; otherwise an observation", () => {
    const at = (n, other) => X.run(budget([...smalls(n), ex(other, "2026-12-02", "food")]), TODAY).small;
    assert.equal(at(10, 9000).kind, "alert");            // 1,000 of 10,000 = exactly 10%
    assert.equal(at(9, 8100).kind, "observation");        // 9 purchases at 10%
    assert.equal(at(10, 9001).kind, "observation");       // 10 purchases, 9.99%
    const r = X.run(budget([...smalls(9), ex(8100, "2026-12-02", "food")]), TODAY);
    assert.equal(r.observations.length, 1);
    assert.equal(r.alerts.filter(a => a.rule === "small-purchases").length, 0);
  });

  it("an amount equal to the threshold counts as small; figures match the Insights KPI (leakSummary)", () => {
    const s = budget([ex(500, "2026-12-02", "food"), ex(501, "2026-12-03", "food"), ex(120, "2026-12-04", "other")]);
    const sm = X.run(s, TODAY).small;
    const k = I.leakSummary(s, "2026-12-01", TODAY);
    assert.deepEqual([sm.count, sm.total], [k.smallCount, k.smallTotal]);
    assert.equal(sm.count, 2);
  });

  it("follows the currency threshold (USD 5)", () => {
    const s = budget([ex(5, "2026-12-02", "food"), ex(6, "2026-12-03", "food")], { currency: "USD" });
    assert.equal(X.run(s, TODAY).small.count, 1);
  });

  it("compares with the previous window only when records cover all of it", () => {
    const s1 = budget([ex(100, "2026-12-02", "food")]);
    assert.equal(X.run(s1, TODAY).small.previous, null);
    const s2 = budget([ex(100, "2026-11-10", "food"), ex(100, "2026-12-02", "food"), ex(5, "2026-11-01", "food")]);
    const p = X.run(s2, TODAY).small.previous;
    assert.deepEqual([p.start, p.end, p.count], ["2026-11-16", "2026-11-30", 0]);
  });
});

describe("uncategorised spending (window S)", () => {
  it('"Other / uncategorised" and deleted categories count; income, savings and categorised spending don\'t', () => {
    const s = budget([ex(120, "2026-12-02", "other"), ex(300, "2026-12-03", "gone"), ex(50, "2026-11-30", "other"),
      tx("income", 999, "2026-12-02", { cat: "inc-other" }), tx("savings_transfer", 500, "2026-12-02"), ex(100, "2026-12-02", "food")]);
    const [a] = alertsOf(s, "uncategorised");
    assert.equal(a.count, 2);
    assert.equal(a.total, 420);
    assert.match(a.text, /^2 expenses \(KSh\s420\) have no category/);
    assert.equal(alertsOf(budget([ex(100, "2026-12-02", "food")]), "uncategorised").length, 0);
  });

  it("more than 2,000 in one window: shown, but can't be reviewed (explicit message)", () => {
    const many = Array.from({ length: 2001 }, (_, i) => ex(10, F.addDays("2026-12-01", i % 14), "other", { id: `u${i}` }));
    const [a] = alertsOf(budget(many), "uncategorised");
    assert.equal(a.reviewable, false);
    assert.match(a.notReviewableReason, /Too many uncategorised entries/);
    assert.throws(() => X.applyReview(budget(many), a, "reviewed", NOW));
  });
});

describe("spending pace (pay cycle 1–30 Dec: 29 days)", () => {
  const P = { cycleStart: "2026-12-01", payday: "2026-12-30" };
  const pace = (entries, today = "2026-12-06", opts = P) => X.run(budget(entries, opts), today).pace;
  const row = (p, id) => p.rows.find(r => r.categoryId === id);

  it("ahead of pace at 25 percentage points or more: 7,768 of 17,000 on day 6 is ahead; 7,767 isn't", () => {
    assert.equal(row(pace([ex(7768, "2026-12-02", "food")]), "food").status, "ahead");
    assert.equal(row(pace([ex(7767, "2026-12-02", "food")]), "food").status, "on-pace");
    const a = pace([ex(8000, "2026-12-02", "food")]).alerts[0];
    assert.match(a.text, /^Groceries: 47% of its allocation used \(KSh\s8,000 of KSh\s17,000\) with 21% of the pay cycle gone \(6 of 29 days\)\.$/);
  });

  it("not before day 3; not below the threshold; over allocation is information, not an alert", () => {
    assert.equal(row(pace([ex(16000, "2026-12-01", "food")], "2026-12-02"), "food").status, "on-pace");
    assert.equal(pace([ex(16000, "2026-12-01", "food")], "2026-12-02").tooEarly, true);
    const cats = [...CATEGORIES, { id: "pocket", name: "Pocket money", budget: 600, kind: "Personal" }];
    assert.equal(row(pace([ex(499, "2026-12-02", "pocket")], "2026-12-06", { ...P, categories: cats }), "pocket").status, "on-pace");
    assert.equal(row(pace([ex(500, "2026-12-02", "pocket")], "2026-12-06", { ...P, categories: cats }), "pocket").status, "ahead");
    const over = pace([ex(17000, "2026-12-02", "food")]);
    assert.equal(row(over, "food").status, "over");
    assert.equal(over.alerts.length, 0);
    assert.equal(row(pace([]), "food").status, "nothing-spent");
  });

  it("only Essential, Flexible, Personal, Event and Other categories with an allocation; never Bills or Savings", () => {
    const ids = pace([]).rows.map(r => r.categoryId);
    assert.deepEqual(ids, ["food", "transport", "fun"]);
  });

  it("needs a pay cycle; says so after payday; leaves out entries dated after today and says the Budget screen counts them", () => {
    assert.equal(pace([], "2026-12-06", {}).reason, "no-cycle");
    assert.equal(pace([], "2026-12-30").reason, "payday-passed");
    const p = pace([ex(1000, "2026-12-02", "food"), ex(9000, "2026-12-20", "food")]);
    assert.equal(row(p, "food").spent, 1000);
    assert.match(p.futureNote, /Leaves out 1 entry dated after today; the Budget screen includes it/);
  });
});

describe("what never triggers anything", () => {
  it("no spending: no alerts; income never offsets spending; savings moves never count", () => {
    assert.equal(X.run(budget([]), TODAY).alerts.length, 0);
    const s = budget([...bills([2000, 2000, 2000], EARLIER), ex(2700, "2026-12-10", "power", { note: "kplc token" }), tx("income", 700, "2026-12-11", { cat: "inc-other", note: "refund kplc" }),
      tx("savings_transfer", 50000, "2026-12-03"), tx("savings_withdrawal", 40000, "2026-12-04")]);
    const r = X.run(s, TODAY);
    assert.equal(r.alerts.filter(a => a.rule === "unusual-bill").length, 1, "a refund recorded as income doesn't hide the bill");
    assert.equal(r.small.spending, 2700);
  });

  it("identical entries count separately (as in every total); there is no repeated-bill alert", () => {
    const s = budget([...bills([2000, 2000, 2000], EARLIER), ex(2000, "2026-12-10", "power", { note: "kplc token" }), ex(2000, "2026-12-10", "power", { note: "kplc token" })]);
    assert.equal(X.run(s, TODAY).alerts.length, 0);
    const twice = budget([ex(100, "2026-12-02", "other"), ex(100, "2026-12-02", "other")]);
    assert.equal(alertsOf(twice, "uncategorised")[0].count, 2);
  });
});

describe("review state and reappearance (decision 8)", () => {
  const review = (state, alert, status = "reviewed") => X.applyReview(state, alert, status, NOW);
  const stateOf = (state, rule, today = TODAY) => alertsOf(state, rule, today)[0];

  it("U1: reappears when the bill or any earlier bill in the series changes; not when time passes or a note changes within the series", () => {
    const base = [...bills([2000, 2000, 2000], EARLIER).map((t, i) => ({ ...t, id: `b${i}` })), ex(2700, "2026-12-10", "power", { note: "kplc token", id: "c" })];
    const s = review(budget(base), stateOf(budget(base), "unusual-bill"));
    const keep = (mod) => budget(mod(JSON.parse(JSON.stringify(base))), { meta: s.meta });
    assert.equal(stateOf(keep(t => t), "unusual-bill").review.state, "reviewed");
    assert.equal(stateOf(keep(t => t), "unusual-bill", "2026-12-28").review.state, "reviewed", "time alone");
    assert.equal(stateOf(keep(t => { t[3].note = "KPLC token 9/12"; return t; }), "unusual-bill").review.state, "reviewed", "same series");
    assert.equal(stateOf(keep(t => { t[3].amount = 2800; return t; }), "unusual-bill").review.state, "changed");
    assert.equal(stateOf(keep(t => { t[0].amount = 1900; return t; }), "unusual-bill").review.state, "changed", "an earlier bill edited");
    assert.equal(stateOf(keep(t => { t[1].date = "2026-10-11"; return t; }), "unusual-bill").review.state, "changed", "an earlier bill's date");
    assert.equal(stateOf(keep(t => [ex(2000, "2026-08-10", "power", { note: "kplc token" }), ...t]), "unusual-bill").review.state, "changed", "an earlier bill added");
  });

  it("U2: reappears when the history changes even with the same count and median (two amounts swapped)", () => {
    const h = [["h1", 1000, "2026-10-05"], ["h2", 1000, "2026-10-15"], ["h3", 1200, "2026-10-25"], ["h4", 1500, "2026-11-05"], ["h5", 1000, "2026-11-15"]];
    const mk = (rows) => [...rows.map(([id, a, d]) => ex(a, d, "fun", { id })), ex(5000, "2026-12-05", "fun", { id: "big" })];
    const base = budget(mk(h));
    const s = review(base, stateOf(base, "large-expense"));
    const swapped = h.map(r => [...r]); swapped[2][1] = 1500; swapped[3][1] = 1200;
    const after = budget(mk(swapped), { meta: s.meta });
    assert.equal(X.median2(swapped.map(r => r[1])), X.median2(h.map(r => r[1])));
    assert.equal(stateOf(after, "large-expense").review.state, "changed");
    const moved = h.map(r => [...r]); moved[0][2] = "2026-10-06";
    assert.equal(stateOf(budget(mk(moved), { meta: s.meta }), "large-expense").review.state, "changed", "a history date changed");
    assert.equal(stateOf(budget(mk(h), { meta: s.meta }), "large-expense", "2026-12-28").review.state, "reviewed", "time alone");
  });

  it("uncategorised: a new entry, or an amount, date or category-reference change, brings it back; categorising or deleting doesn't", () => {
    const base = [ex(120, "2026-12-02", "other", { id: "u1" }), ex(300, "2026-12-03", "other", { id: "u2" }), ex(80, "2026-12-04", "gone", { id: "u3" })];
    const s0 = budget(base);
    const s = review(s0, stateOf(s0, "uncategorised"), "dismissed");
    const after = (mod) => stateOf(budget(mod(JSON.parse(JSON.stringify(base))), { meta: s.meta }), "uncategorised");
    assert.equal(after(t => t).review.state, "dismissed");
    assert.equal(after(t => t).review.state, "dismissed", "time alone (same day)");
    assert.equal(stateOf(budget(base, { meta: s.meta }), "uncategorised", "2026-12-28").review.state, "dismissed", "time alone");
    assert.equal(after(t => { t[0].categoryId = "food"; return t; }).review.state, "dismissed", "one categorised");
    assert.equal(after(t => t.slice(1)).review.state, "dismissed", "one deleted");
    assert.equal(after(t => { t[0].amount = 125; return t; }).review.state, "changed", "amount");
    assert.equal(after(t => { t[0].date = "2026-12-05"; return t; }).review.state, "changed", "date");
    assert.equal(after(t => { t[2].categoryId = "other"; return t; }).review.state, "changed", "category reference");
    assert.equal(after(t => [...t, ex(10, "2026-12-06", "other")]).review.state, "changed", "new entry");
  });

  it("small purchases: a few more don't bring it back; growth to 125% and by the threshold does; a new threshold does", () => {
    const smalls = (n) => Array.from({ length: n }, (_, i) => ex(100, F.addDays("2026-12-01", i % 10), "transport", { id: `s${i}` }));
    const s0 = budget([...smalls(10), ex(9000, "2026-12-02", "food", { id: "big" })]);
    const s = review(s0, X.run(s0, TODAY).small);
    const st = (n) => X.run(budget([...smalls(n), ex(9000, "2026-12-02", "food", { id: "big" })], { meta: s.meta }), TODAY).small;
    assert.equal(X.reviewStateOf(st(10), s.meta.alertReviews).state, "reviewed");
    assert.equal(X.reviewStateOf(st(12), s.meta.alertReviews).state, "reviewed", "1,200: under 125%");
    assert.equal(X.reviewStateOf(st(14), s.meta.alertReviews).state, "reviewed", "1,400: 140% but only 400 more (under 500)");
    assert.equal(X.reviewStateOf(st(15), s.meta.alertReviews).state, "changed", "1,500: 150% and 500 more");
    const tzs = X.run(budget([...smalls(10), ex(9000, "2026-12-02", "food", { id: "big" })], { meta: s.meta, currency: "TZS" }), TODAY).small;
    assert.equal(X.reviewStateOf(tzs, s.meta.alertReviews).state, "changed", "the threshold changed with the currency");
  });

  it("pace: more spending within 25 points doesn't bring it back, 25 more does; a new allocation does; time alone never", () => {
    const P = { cycleStart: "2026-12-01", payday: "2026-12-30" };
    const s0 = budget([ex(10000, "2026-12-02", "food", { id: "f1" })], P);
    const a0 = X.run(s0, "2026-12-06").pace.alerts[0];
    const s = review(s0, a0);
    const at = (extra, today = "2026-12-06", cats) => X.run(budget([ex(10000, "2026-12-02", "food", { id: "f1" }), ...extra], { ...P, meta: s.meta, ...(cats ? { categories: cats } : {}) }), today).pace.alerts[0];
    const g0 = a0.basis.gapPoints;
    const plus = (pts) => Math.ceil((pts * 17000) / 100);   // spending that adds `pts` points
    assert.equal(X.reviewStateOf(at([ex(plus(24) - 1, "2026-12-03", "food")]), s.meta.alertReviews).state, "reviewed");
    const more = at([ex(plus(25) + 1, "2026-12-03", "food")]);
    assert.ok(more.basis.gapPoints >= g0 + 25);
    assert.equal(X.reviewStateOf(more, s.meta.alertReviews).state, "changed");
    assert.equal(X.reviewStateOf(at([], "2026-12-08"), s.meta.alertReviews).state, "reviewed", "time alone (still ahead, smaller gap)");
    const cats = CATEGORIES.map(c => (c.id === "food" ? { ...c, budget: 16000 } : c));
    assert.equal(X.reviewStateOf(at([], "2026-12-06", cats), s.meta.alertReviews).state, "changed", "allocation changed");
  });
});

describe("review records", () => {
  const setup = () => {
    const base = [...bills([2000, 2000, 2000], EARLIER), ex(2700, "2026-12-10", "power", { note: "kplc token", id: "c" })];
    const s = budget(base);
    return { s, alert: X.run(s, TODAY).alerts.find(a => a.rule === "unusual-bill") };
  };

  it("a new record has exactly the documented fields, and passes the format check", () => {
    const { s, alert } = setup();
    const next = X.applyReview(s, alert, "reviewed", NOW);
    assert.deepEqual(next.meta.alertReviews, [{ id: "unusual-bill:c", rule: "unusual-bill", status: "reviewed", actedAt: NOW.toISOString(), fingerprint: alert.fingerprint }]);
    assert.ok(D.isClean(D.normalizeState(next)));
    assert.equal(X.run(next, TODAY).alerts.find(a => a.id === alert.id).review.state, "reviewed");
    assert.equal(X.run(X.applyReview(next, alert, "dismissed", NOW), TODAY).groups.dismissed.length, 1);
  });

  it("REGRESSION: changing the status keeps every field the record already had, including unknown ones, in order", () => {
    const { s, alert } = setup();
    const existing = { id: alert.id, rule: "unusual-bill", status: "reviewed", actedAt: "2026-12-11T08:00:00.000Z", fingerprint: alert.fingerprint,
      snoozeUntil: "2027-01-01", extra: { nested: { list: [1, 2, 3] } }, basis: { fromTheFuture: true } };
    const other = { id: "future-rule:z", rule: "future-rule", status: "snoozed", actedAt: "2027-01-01T00:00:00.000Z", fingerprint: "abcdef0123456789", note2: "kept" };
    const st = { ...s, meta: { ...s.meta, alertReviews: [existing, other] } };
    const next = X.applyReview(st, alert, "dismissed", NOW);
    const rec = next.meta.alertReviews[0];
    assert.equal(rec.status, "dismissed");
    assert.equal(rec.actedAt, NOW.toISOString());
    assert.equal(rec.snoozeUntil, "2027-01-01");
    assert.deepEqual(rec.extra, { nested: { list: [1, 2, 3] } });
    assert.deepEqual(rec.basis, { fromTheFuture: true }, "a basis this version doesn't write for U1 is kept");
    assert.deepEqual(Object.keys(rec), Object.keys(existing), "same fields, same order");
    assert.deepEqual(next.meta.alertReviews[1], other, "other records untouched");
    // …and it survives the format check, saving and reloading.
    const store = new FakeStorage();
    assert.ok(S.save(store, next).ok);
    assert.deepEqual(S.load(store, NOW).state.meta.alertReviews, next.meta.alertReviews);
  });

  it("a record with a status from a newer version is kept, shown under To review, and replaced only when the user acts", () => {
    const { s, alert } = setup();
    const st = { ...s, meta: { alertReviews: [{ id: alert.id, rule: "unusual-bill", status: "snoozed", actedAt: "2027-01-01T00:00:00.000Z", fingerprint: alert.fingerprint, until: "x" }] } };
    const r = X.run(st, TODAY);
    const shown = r.alerts.find(a => a.id === alert.id);
    assert.equal(shown.review.state, "unknown-status");
    assert.ok(r.groups.toReview.includes(shown));
    const next = X.applyReview(st, alert, "reviewed", NOW);
    assert.equal(next.meta.alertReviews[0].status, "reviewed");
    assert.equal(next.meta.alertReviews[0].until, "x");
  });

  it("'Move back to To review' removes only that record", () => {
    const { s, alert } = setup();
    const other = { id: "future-rule:z", rule: "future-rule", status: "snoozed", actedAt: "2027-01-01T00:00:00.000Z", fingerprint: "abcdef0123456789" };
    const st = X.applyReview({ ...s, meta: { onboarding: "done", alertReviews: [other] } }, alert, "reviewed", NOW);
    const back = X.clearReview(st, alert.id);
    assert.deepEqual(back.meta.alertReviews, [other]);
    assert.equal(back.meta.onboarding, "done");
    const none = X.clearReview(X.applyReview(s, alert, "reviewed", NOW), alert.id);
    assert.equal(none.meta.alertReviews, undefined);
    assert.equal(X.clearReview(s, "nothing:here"), s);
  });

  it("records never contain notes or descriptions, and notes aren't part of any fingerprint", () => {
    const secret = "PRIVATE-NOTE-7731";
    const P = { cycleStart: "2026-12-01", payday: "2026-12-30" };
    const entries = [...bills([2000, 2000, 2000], EARLIER, `kplc ${secret}`), ex(2700, "2026-12-10", "power", { note: `kplc ${secret}` }),
      ...["2026-10-05", "2026-10-15", "2026-10-25", "2026-11-05", "2026-11-15"].map(d => ex(150, d, "transport", { note: secret })), ex(3000, "2026-12-05", "transport", { note: secret }),
      ...Array.from({ length: 12 }, (_, i) => ex(100, F.addDays("2026-12-01", i % 5), "other", { note: secret })), ex(9000, "2026-12-03", "food", { note: secret })];
    let st = budget(entries, P);
    const r = X.run(st, "2026-12-06");
    for (const a of r.alerts.filter(a => a.reviewable)) st = X.applyReview(st, a, "reviewed", NOW);
    assert.ok(st.meta.alertReviews.length >= 4);
    assert.doesNotMatch(JSON.stringify(st.meta.alertReviews), /PRIVATE|kplc/i);
    const renamed = budget(entries.map(t => ({ ...t, note: t.note.replace(secret, "OTHER-TEXT") })), P);
    const fp = (x) => X.run(x, "2026-12-06").alerts.map(a => [a.id, a.fingerprint]).sort();
    assert.deepEqual(fp(renamed), fp(budget(entries, P)));
  });

  it("records not matching a current alert are kept and counted", () => {
    const { s } = setup();
    const st = { ...s, meta: { alertReviews: [{ id: "unusual-bill:gone", rule: "unusual-bill", status: "reviewed", actedAt: "2026-01-01T00:00:00.000Z", fingerprint: "0011223344556677" }] } };
    assert.equal(X.run(st, TODAY).keptRecords, 1);
  });
});

describe("read-only, deterministic and fast", () => {
  it("never changes the data it reads, and gives the same result every time", () => {
    const s = deepFreeze(budget([...bills([2000, 2000, 2000], EARLIER), ex(2700, "2026-12-10", "power", { note: "kplc token" }), ex(120, "2026-12-02", "other")], { cycleStart: "2026-12-01", payday: "2026-12-30" }));
    const before = JSON.stringify(s);
    const a = X.run(s, TODAY), b = X.run(s, TODAY);
    assert.equal(JSON.stringify(s), before);
    assert.deepEqual(a, b);
  });

  it("the fingerprint hash is 64-bit FNV-1a (known test values)", () => {
    assert.equal(X.fnv1a64(""), "cbf29ce484222325");
    assert.equal(X.fnv1a64("a"), "af63dc4c8601ec8c");
    assert.equal(X.fnv1a64("foobar"), "85944171f73967e8");
  });

  it("20,000 entries: every rule in well under a second", () => {
    let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const cats = ["power", "rent", "food", "transport", "fun", "other", "gone"];
    const entries = Array.from({ length: 20000 }, (_, i) => {
      const r = rnd();
      if (r < 0.06) return tx("income", 1 + Math.floor(rnd() * 90000), F.addDays("2024-01-01", Math.floor(rnd() * 1080)), { id: `p${i}`, cat: "inc-salary" });
      return ex(1 + Math.floor(rnd() * 6000), F.addDays("2024-01-01", Math.floor(rnd() * 1080)), cats[Math.floor(rnd() * cats.length)], { id: `p${i}`, note: rnd() < 0.5 ? "kplc token" : "" });
    });
    const s = budget(entries, { cycleStart: "2026-12-01", payday: "2026-12-30" });
    const t0 = process.hrtime.bigint();
    const r = X.run(s, TODAY);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(r.checks.length > 0);
    assert.ok(ms < 1000, `took ${ms.toFixed(0)} ms`);
  });
});
