/**
 * Phase 3: pay cycles, real cycle lengths, calendar-day counting (KI-16),
 * user-confirmed rollover (KI-09, KI-25), date-ordered savings (KI-24) and
 * D-10 across cycles.
 */
"use strict";
process.env.TZ = "Africa/Nairobi";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const F = require("../src/finance.js");
const D = require("../src/data-model.js");
const S = require("../src/storage.js");
const { FakeStorage } = require("./helpers/fake-storage.js");

let n = 0;
const tx = (type, amount, date, extra = {}) => ({ id: `t${++n}`, type, amount, date, note: "", createdAt: n, ...extra });
const exp = (amount, categoryId, date) => tx("expense", amount, date, { categoryId });
const inc = (amount, date) => tx("income", amount, date, { categoryId: "inc-salary" });
const save = (amount, destinationId, date) => tx("savings_transfer", amount, date, { destinationId });
const wd = (amount, destinationId, date) => tx("savings_withdrawal", amount, date, { destinationId });
const at = (iso, hh = 10) => new Date(`${iso}T${String(hh).padStart(2, "0")}:00:00+03:00`);

/**
 * A plan with a November cycle (1 Nov → payday 1 Dec):
 *   opening 10,000 · Rent 6,000 (Bills) · Food 5,000 (Essential) · Fun 2,000 (Flexible)
 *   Savings 3,000 linked to M-Shwari (starts at 0)
 */
function plan(...transactions) {
  return {
    app: "PesaOtas", version: 2, currency: "KES",
    openingBalance: 10000, payday: "2026-12-01", cycleStart: "2026-11-01",
    categories: [
      { id: "rent", name: "Rent", budget: 6000, kind: "Bills" },
      { id: "food", name: "Food", budget: 5000, kind: "Essential" },
      { id: "fun", name: "Fun", budget: 2000, kind: "Flexible" },
      { id: "sav", name: "Savings", budget: 3000, kind: "Savings", destinationId: "m-shwari" }
    ],
    transactions,
    savingsDestinations: [
      { id: "kcb-mpesa", name: "KCB M-PESA", openingBalance: 0, archived: false, builtIn: true },
      { id: "m-shwari", name: "M-Shwari", openingBalance: 0, archived: false, builtIn: true }
    ],
    meta: {}
  };
}
/** A typical November: salary in, rent paid, some food and fun, 2,000 saved. */
const november = () => [
  inc(30000, "2026-11-01"), exp(6000, "rent", "2026-11-02"), exp(3500, "food", "2026-11-10"),
  exp(1200, "fun", "2026-11-15"), save(2000, "m-shwari", "2026-11-20")
];
const roll = (state, start, nextPayday, extra = {}) => F.startNewCycle(state, { start, nextPayday, now: at("2026-12-01", 9), ...extra });

describe("calendar days and real cycle lengths", () => {
  it("counts real month lengths: 30, 31, 28 and 29 days", () => {
    assert.equal(F.daysBetween("2026-11-01", "2026-12-01"), 30);
    assert.equal(F.daysBetween("2026-12-01", "2027-01-01"), 31);
    assert.equal(F.daysBetween("2027-02-01", "2027-03-01"), 28);
    assert.equal(F.daysBetween("2028-02-01", "2028-03-01"), 29);
  });

  it("cycle length, elapsed days and days left come from the actual dates (no 30-day assumption)", () => {
    const s = plan(); s.cycleStart = "2027-02-01"; s.payday = "2027-03-01";
    const info = F.cycleInfo(s, at("2027-02-10"));
    assert.deepEqual([info.lengthDays, info.elapsedDays, info.daysLeft, info.rolloverDue], [28, 9, 19, false]);
    const mid = F.cycleInfo({ ...s, cycleStart: "2026-12-15", payday: "2027-01-15" }, at("2026-12-31"));
    assert.equal(mid.lengthDays, 31);
  });

  it("suggests the same day next month, moved back for short months", () => {
    assert.equal(F.suggestNextPayday("2026-11-30"), "2026-12-30");
    assert.equal(F.suggestNextPayday("2026-12-15"), "2027-01-15");
    assert.equal(F.suggestNextPayday("2027-01-31"), "2027-02-28");
    assert.equal(F.suggestNextPayday("2028-01-31"), "2028-02-29");
  });

  it("KI-16: days to payday are correct across a daylight-saving change (checked in a real US time zone)", () => {
    const code = `const f=require(${JSON.stringify(path.join(__dirname, "../src/finance.js"))});
      console.log(JSON.stringify([f.daysToPayday("2026-11-02", new Date(2026,10,1,10)), f.daysToPayday("2026-03-09", new Date(2026,2,8,1)), f.daysToPayday("2026-03-09", new Date(2026,2,8,23,30))]));`;
    const out = execFileSync(process.execPath, ["-e", code], { env: { ...process.env, TZ: "America/New_York" } }).toString().trim();
    assert.deepEqual(JSON.parse(out), [1, 1, 1], "DST ends 1 Nov 2026 and starts 8 Mar 2026 in New York");
  });

  it("rejects impossible dates in cycle arithmetic", () => {
    assert.equal(F.isISODate("2026-02-30"), false);
    assert.ok(Number.isNaN(F.daysBetween("2026-02-30", "2026-03-01")));
  });
});

describe("budget scoped to the current pay cycle (KI-09)", () => {
  it("spending from an earlier cycle no longer uses this cycle's allocation", () => {
    const s = plan(exp(4000, "food", "2026-10-20"), exp(1000, "food", "2026-11-05"));
    const t = F.computeTotals(s);
    assert.equal(t.spentByCategory.food, 1000);
    assert.equal(t.spent, 1000);
  });

  it("…but spending cash still includes it: cash is real money and never resets", () => {
    const s = plan(exp(4000, "food", "2026-10-20"), exp(1000, "food", "2026-11-05"));
    assert.equal(F.computeTotals(s).cash, 10000 - 4000 - 1000);
  });

  it("income, insights and savings fulfilment count only this cycle", () => {
    const s = plan(inc(20000, "2026-10-01"), save(3000, "m-shwari", "2026-10-25"), inc(30000, "2026-11-01"));
    const t = F.computeTotals(s);
    assert.equal(t.earned, 30000);
    assert.equal(t.savedByCategory.sav, 0, "October's transfer doesn't fulfil November's allocation");
    assert.equal(t.destinationBalances["m-shwari"], 3000, "…but it's still in M-Shwari");
  });

  it("a transaction dated on the cycle's first day belongs to the cycle", () => {
    assert.equal(F.computeTotals(plan(exp(500, "food", "2026-11-01"))).spentByCategory.food, 500);
  });

  it("after payday, until the user starts the new cycle, new spending still counts (conservative)", () => {
    const t = F.computeTotals(plan(exp(500, "food", "2026-12-03")));
    assert.equal(t.spentByCategory.food, 500);
  });

  it("without a cycle start (data from earlier versions) everything counts, exactly as before", () => {
    const s = plan(exp(4000, "food", "2026-10-20"), exp(1000, "food", "2026-11-05"));
    delete s.cycleStart;
    assert.equal(F.computeTotals(s).spentByCategory.food, 5000);
  });

  it("rollover is due on payday and after, not before", () => {
    const s = plan();
    assert.equal(F.cycleInfo(s, at("2026-11-30", 23)).rolloverDue, false);
    assert.equal(F.cycleInfo(s, at("2026-12-01", 0)).rolloverDue, true);
    assert.equal(F.cycleInfo(s, at("2026-12-09")).rolloverDue, true);
    assert.equal(F.cycleInfo({ ...s, payday: "" }, at("2026-12-09")).rolloverDue, false);
  });
});

describe("rollover: user-confirmed start of a new cycle (KI-09, KI-25)", () => {
  it("never deletes or changes a transaction", () => {
    const s = plan(...november());
    const before = JSON.stringify(s.transactions);
    const r = roll(s, "2026-12-01", "2027-01-01");
    assert.ok(r.ok);
    assert.equal(JSON.stringify(r.state.transactions), before);
    assert.equal(JSON.stringify(s.transactions), before, "input not mutated");
  });

  it("spending cash and savings balances are identical immediately before and after", () => {
    const s = plan(...november());
    const a = F.computeTotals(s), b = F.computeTotals(roll(s, "2026-12-01", "2027-01-01").state);
    assert.equal(b.cash, a.cash);
    assert.deepEqual(b.destinationBalances, a.destinationBalances);
  });

  it("allocations start again: every category is fully available, and leftover allocation money is released into unallocated", () => {
    const s = plan(...november());
    const after = F.computeTotals(roll(s, "2026-12-01", "2027-01-01").state);
    assert.deepEqual(after.spentByCategory, {});
    assert.equal(after.allocatedRemaining, 16000, "full allocations reserved again");
    assert.equal(after.unallocated, after.cash - 16000);
  });

  it("explains the money: closing cash = opening + all flows before the new start", () => {
    const s = plan(...november());
    const sum = F.cycleSummary(s, "2026-11-01", "2026-12-01");
    assert.equal(sum.closingCash, 10000 + 30000 - 6000 - 3500 - 1200 - 2000);
    assert.equal(sum.lengthDays, 30);
    assert.deepEqual([sum.earned, sum.spent, sum.savedNet], [30000, 10700, 2000]);
    const food = sum.categories.find(c => c.id === "food");
    assert.equal(food.left, 1500);
    assert.equal(sum.leftInAllocations, 0 + 1500 + 800 + 1000);
  });

  it("records the closed cycle with its dates and allocations", () => {
    const r = roll(plan(...november()), "2026-12-01", "2027-01-01");
    assert.deepEqual(r.state.cycles, [{ start: "2026-11-01", end: "2026-12-01", closedAt: at("2026-12-01", 9).toISOString(), budgets: { rent: 6000, food: 5000, fun: 2000, sav: 3000 } }]);
    assert.equal(r.state.cycleStart, "2026-12-01");
    assert.equal(r.state.payday, "2027-01-01");
  });

  it("history stays accurate: the closed cycle's figures equal what the cycle showed before rollover", () => {
    const s = plan(...november());
    const live = F.computeTotals(s);
    const r = roll(s, "2026-12-01", "2027-01-01").state;
    const c = r.cycles[0];
    const hist = F.cycleSummary(r, c.start, c.end, c.budgets);
    assert.deepEqual([hist.earned, hist.spent, hist.savedNet], [live.earned, live.spent, live.transferredToSavings - live.withdrawnFromSavings]);
  });

  it("entries already recorded on or after the new start move into the new cycle", () => {
    const s = plan(...november(), exp(300, "food", "2026-12-01"), exp(200, "food", "2026-12-02"));
    const t = F.computeTotals(roll(s, "2026-12-01", "2027-01-01").state);
    assert.equal(t.spentByCategory.food, 500);
  });

  it("optional: moving leftover to savings is recorded as a normal transfer dated the new start", () => {
    const s = plan(...november());
    const r = roll(s, "2026-12-01", "2027-01-01", { transfer: { amount: 4000, destinationId: "kcb-mpesa", id: "roll-1" } });
    const added = r.state.transactions.filter(t => !s.transactions.includes(t));
    assert.equal(added.length, 1);
    assert.deepEqual([added[0].type, added[0].date, added[0].amount], ["savings_transfer", "2026-12-01", 4000]);
    const t = F.computeTotals(r.state);
    assert.equal(t.destinationBalances["kcb-mpesa"], 4000);
    assert.equal(t.cash, F.computeTotals(s).cash - 4000);
    assert.equal(t.spent, 0, "not counted as spending");
  });

  it("supports being paid early: the new cycle can start before the scheduled payday", () => {
    const s = plan(...november(), exp(100, "food", "2026-11-28"));
    const r = F.startNewCycle(s, { start: "2026-11-28", nextPayday: "2026-12-28", now: at("2026-11-28") });
    assert.ok(r.ok, r.errors && r.errors.join());
    assert.equal(F.computeTotals(r.state).spentByCategory.food, 100);
    assert.equal(r.state.cycles[0].end, "2026-11-28");
  });

  it("missed several paydays: cycles are closed one at a time, each keeping its own figures", () => {
    const s = plan(...november(), exp(700, "food", "2026-12-10"), exp(900, "food", "2027-01-05"));
    const now = at("2027-01-20");
    const r1 = F.startNewCycle(s, { start: "2026-12-01", nextPayday: "2027-01-01", now });
    assert.ok(r1.ok);
    assert.equal(F.cycleInfo(r1.state, now).rolloverDue, true, "still due: January's payday has also passed");
    const r2 = F.startNewCycle(r1.state, { start: "2027-01-01", nextPayday: "2027-02-01", now });
    assert.ok(r2.ok);
    assert.equal(F.computeTotals(r2.state).spentByCategory.food, 900);
    const dec = r2.state.cycles[1];
    assert.equal(F.cycleSummary(r2.state, dec.start, dec.end, dec.budgets).spent, 700);
    assert.equal(F.cycleInfo(r2.state, now).rolloverDue, false);
  });

  it("refuses an unsafe or impossible rollover, changing nothing", () => {
    const s = plan(...november());
    const now = at("2026-12-01");
    const cases = [
      [{ ...s, payday: "" }, "2026-12-01", "2027-01-01", "Set your payday"],
      [s, "2026-11-01", "2027-01-01", "after the current one started"],
      [s, "2026-10-15", "2027-01-01", "after the current one started"],
      [s, "2026-12-05", "2027-01-01", "future"],
      [s, "2026-12-01", "2026-12-01", "after the new cycle starts"],
      [s, "2026-12-01", "2026-02-30", "next payday"],
      [s, "", "2027-01-01", "starts"]
    ];
    for (const [state, start, nextPayday, msg] of cases) {
      const r = F.startNewCycle(state, { start, nextPayday, now });
      assert.equal(r.ok, false, `${start} → ${nextPayday} was accepted`);
      assert.ok(r.errors.some(e => e.includes(msg)), r.errors.join(" | "));
    }
    const bad = F.startNewCycle(s, { start: "2026-12-01", nextPayday: "2027-01-01", now, transfer: { amount: 0, destinationId: "nowhere", id: "x" } });
    assert.equal(bad.ok, false);
    assert.equal(bad.errors.length, 2);
  });

  it("can't be applied twice by accident (the same start is refused the second time)", () => {
    const r1 = roll(plan(...november()), "2026-12-01", "2027-01-01");
    const r2 = roll(r1.state, "2026-12-01", "2027-01-01");
    assert.equal(r2.ok, false);
  });

  it("works for data from earlier versions with no cycle start (first cycle closes 'from the beginning')", () => {
    const s = plan(...november()); delete s.cycleStart;
    const r = roll(s, "2026-12-01", "2027-01-01");
    assert.ok(r.ok);
    assert.equal(r.state.cycles[0].start, "");
    assert.equal(F.cycleSummary(r.state, "", "2026-12-01").spent, 10700);
  });

  it("a rolled-over state passes the data checks and survives a verified save and reload", () => {
    const r = roll(plan(...november()), "2026-12-01", "2027-01-01", { transfer: { amount: 1000, destinationId: "m-shwari", id: "roll-2" } });
    const check = D.normalizeState(r.state);
    assert.ok(D.isClean(check), [...check.errors, ...check.rejected].join(" | "));
    const store = new FakeStorage();
    assert.ok(S.save(store, r.state).ok);
    const back = S.load(store, at("2026-12-02"));
    assert.equal(back.status, "ok");
    assert.deepEqual(back.state.cycles, r.state.cycles);
    assert.equal(back.state.cycleStart, "2026-12-01");
  });
});

describe("D-10 across pay cycles", () => {
  it("withdrawing last cycle's savings doesn't increase this cycle's reservation; the money is spendable", () => {
    const s = plan(save(3000, "m-shwari", "2026-10-15"), wd(1000, "m-shwari", "2026-11-10"));
    const t = F.computeTotals(s);
    const none = F.computeTotals(plan());
    assert.equal(t.savedByCategory.sav, 0);
    assert.equal(t.allocatedRemaining, none.allocatedRemaining);
    assert.equal(t.cash, 10000 - 3000 + 1000);
  });
});

describe("date-ordered savings balances (KI-24)", () => {
  const withSavings = (...txs) => plan(...txs);

  it("a withdrawal can't use money that only arrives later", () => {
    const s = withSavings(save(5000, "m-shwari", "2026-11-20"));
    assert.equal(F.availableToWithdraw(s, "m-shwari", "2026-11-10"), 0);
    assert.equal(F.availableToWithdraw(s, "m-shwari", "2026-11-20"), 5000);
    assert.equal(F.availableToWithdraw(s, "m-shwari", "2026-11-25"), 5000);
  });

  it("money in and out on the same day: in is counted first", () => {
    const s = withSavings(save(2000, "m-shwari", "2026-11-12"));
    assert.equal(F.availableToWithdraw(s, "m-shwari", "2026-11-12"), 2000);
  });

  it("an earlier withdrawal can't take money a later withdrawal depends on", () => {
    const s = withSavings(save(5000, "m-shwari", "2026-11-05"), wd(4000, "m-shwari", "2026-11-25"));
    assert.equal(F.balanceOn(s, "m-shwari", "2026-11-10"), 5000);
    assert.equal(F.availableToWithdraw(s, "m-shwari", "2026-11-10"), 1000);
  });

  it("the starting balance counts from the beginning", () => {
    const s = withSavings(wd(500, "m-shwari", "2026-11-03"));
    s.savingsDestinations[1].openingBalance = 2000;
    assert.equal(F.availableToWithdraw(s, "m-shwari", "2026-11-01"), 1500);
  });

  it("finds the first day a destination went below zero (out of order or overdrawn)", () => {
    const s = withSavings(wd(1000, "m-shwari", "2026-11-05"), save(3000, "m-shwari", "2026-11-09"), wd(500, "kcb-mpesa", "2026-11-02"));
    assert.deepEqual(F.savingsOrderIssues(s), [
      { destinationId: "kcb-mpesa", date: "2026-11-02", balance: -500 },
      { destinationId: "m-shwari", date: "2026-11-05", balance: -1000 }
    ]);
    assert.deepEqual(F.savingsOrderIssues(withSavings(save(3000, "m-shwari", "2026-11-05"), wd(1000, "m-shwari", "2026-11-09"))), []);
  });

  it("order issues are reported (kept, with a warning) when checking restored data", () => {
    const s = withSavings(wd(1000, "m-shwari", "2026-11-05"), save(3000, "m-shwari", "2026-11-09"));
    const r = D.normalizeState(s);
    assert.ok(D.isClean(r));
    assert.ok(r.warnings.some(w => w.includes("On 2026-11-05, M-Shwari would have held −KSh\u00A01,000")), r.warnings.join(" | "));
  });
});

describe("data model: pay-cycle fields", () => {
  it("keeps the cycle start and history through a backup round trip", () => {
    const r = roll(plan(...november()), "2026-12-01", "2027-01-01").state;
    const back = D.analyzeBackup(D.serializeBackup(r));
    assert.ok(D.isClean(back));
    assert.deepEqual(back.state, D.normalizeState(r).state);
    assert.equal(back.state.cycles.length, 1);
    assert.equal(back.summary.cycleStart, "2026-12-01");
  });

  it("an invalid cycle start is cleared (and listed), never guessed", () => {
    const s = plan(); s.cycleStart = "2026-02-30";
    const r = D.normalizeState(s);
    assert.equal(r.state.cycleStart, undefined);
    assert.ok(r.rejected.some(m => m.includes("pay cycle start")));
  });

  it("a damaged cycle-history record is left out (and listed); transactions are unaffected", () => {
    const s = roll(plan(...november()), "2026-12-01", "2027-01-01").state;
    s.cycles.push({ start: "2026-12-05", end: "2026-12-01", budgets: {} });
    const r = D.normalizeState(s);
    assert.equal(r.state.cycles.length, 1);
    assert.equal(r.state.transactions.length, 5);
    assert.ok(r.rejected.some(m => m.includes("Pay cycle record 2")));
  });

  it("warns when the cycle start is on or after payday", () => {
    const s = plan(); s.cycleStart = "2026-12-01";
    assert.ok(D.normalizeState(s).warnings.some(w => w.includes("on or after payday")));
  });

  it("data saved by v1.2.0 (no cycle fields) still loads unchanged (apart from the format number, v1.6)", () => {
    const s = plan(...november()); delete s.cycleStart;
    const r = D.normalizeState(JSON.parse(JSON.stringify({ ...s, version: 2 })));
    assert.ok(D.isClean(r));
    assert.equal(r.format, "pesaotas-v2");
    assert.deepEqual(r.state, { ...s, version: 3 });
  });
});
