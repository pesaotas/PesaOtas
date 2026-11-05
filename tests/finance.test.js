/**
 * Tests for src/finance.js.
 *
 * Policy (approved for Phase 0): these tests assert only CORRECT behaviour.
 * Known defects are NOT encoded as expected results; they are listed as
 * `todo` entries at the bottom, each linked to docs/KNOWN_ISSUES.md, and get
 * real tests in the phase that fixes them.
 *
 * Run: node --test      (or: npm test)
 */
"use strict";

// Pin the time zone so date tests behave the same on every machine.
// Must be set before any Date is created.
process.env.TZ = "Africa/Nairobi";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { computeTotals, daysToPayday } = require("../src/finance.js");
const { baseState, expense, income, withTx, deepFreeze } = require("./fixtures.js");

describe("computeTotals — core balances", () => {
  it("with no transactions: cash = opening, planned = sum of allocations", () => {
    const t = computeTotals(baseState());
    assert.equal(t.cash, 20000);
    assert.equal(t.spent, 0);
    assert.equal(t.earned, 0);
    assert.equal(t.planned, 19500);
    assert.equal(t.allocatedRemaining, 19500);
    assert.equal(t.unallocated, 500);
    assert.equal(t.overCount, 0);
    assert.deepEqual(t.spentByCategory, {});
  });

  it("an expense within budget lowers cash and that category's remaining allocation equally; unallocated is unchanged", () => {
    const t = computeTotals(withTx(expense(500, "food")));
    assert.equal(t.cash, 19500);
    assert.equal(t.spent, 500);
    assert.equal(t.allocatedRemaining, 19000);
    assert.equal(t.unallocated, 500);
    assert.equal(t.spentByCategory.food, 500);
  });

  it("income raises cash and unallocated by the same amount; allocations untouched", () => {
    const t = computeTotals(withTx(income(3000)));
    assert.equal(t.cash, 23000);
    assert.equal(t.earned, 3000);
    assert.equal(t.allocatedRemaining, 19500);
    assert.equal(t.unallocated, 3500);
  });

  it("income is never counted as spending in any category", () => {
    const t = computeTotals(withTx(income(3000, "food")));
    assert.equal(t.spent, 0);
    assert.equal(t.spentByCategory.food, undefined);
  });

  it("cash = opening + Σincome − Σexpenses for a mixed set", () => {
    const t = computeTotals(withTx(
      expense(1200, "food"), income(5000), expense(300, "transport"),
      expense(8000, "rent"), income(750), expense(45, "fun")
    ));
    assert.equal(t.earned, 5750);
    assert.equal(t.spent, 9545);
    assert.equal(t.cash, 20000 + 5750 - 9545);
  });

  it("several expenses in one category accumulate", () => {
    const t = computeTotals(withTx(expense(200, "food"), expense(350, "food"), expense(1, "food")));
    assert.equal(t.spentByCategory.food, 551);
  });

  it("results do not depend on transaction order", () => {
    const list = [expense(1200, "food"), income(5000), expense(300, "transport"), expense(2000, "fun")];
    const a = computeTotals(withTx(...list));
    const b = computeTotals(withTx(...[...list].reverse()));
    assert.deepEqual(a, b);
  });

  it("removing a transaction restores the exact previous totals", () => {
    const before = computeTotals(withTx(expense(1200, "food"), income(5000)));
    const after = computeTotals(withTx(expense(1200, "food"), income(5000), expense(999, "fun")));
    assert.notDeepEqual(before, after);
    const removed = withTx(expense(1200, "food"), income(5000));
    assert.deepEqual(computeTotals(removed), before);
  });

  it("changing the opening balance shifts cash and unallocated by the same amount and nothing else", () => {
    const s1 = withTx(expense(700, "food"));
    const s2 = withTx(expense(700, "food"));
    s2.openingBalance = 25000;
    const a = computeTotals(s1), b = computeTotals(s2);
    assert.equal(b.cash - a.cash, 5000);
    assert.equal(b.unallocated - a.unallocated, 5000);
    for (const k of ["spent", "earned", "allocatedRemaining", "planned", "overCount", "flexible"]) {
      assert.deepEqual(b[k], a[k], k);
    }
  });

  it("an empty plan (no categories, no transactions) is handled", () => {
    const t = computeTotals({ openingBalance: 0, categories: [], transactions: [] });
    assert.deepEqual(
      { cash: t.cash, planned: t.planned, unallocated: t.unallocated, flexible: t.flexible, overCount: t.overCount },
      { cash: 0, planned: 0, unallocated: 0, flexible: 0, overCount: 0 });
  });
});

describe("computeTotals — allocations are plans, not transactions", () => {
  it("changing an allocation never changes cash, spent or earned", () => {
    const s = withTx(expense(500, "food"), income(1000));
    const a = computeTotals(s);
    s.categories.find(c => c.id === "food").budget = 9000;
    const b = computeTotals(s);
    assert.equal(b.cash, a.cash);
    assert.equal(b.spent, a.spent);
    assert.equal(b.earned, a.earned);
    assert.equal(b.planned - a.planned, 4000);
    assert.equal(b.unallocated - a.unallocated, -4000);
  });

  it("adding a category with allocation X lowers unallocated by X and leaves cash alone", () => {
    const s = baseState();
    const a = computeTotals(s);
    s.categories.push({ id: "gym", name: "Gym", budget: 400, kind: "Flexible" });
    const b = computeTotals(s);
    assert.equal(b.cash, a.cash);
    assert.equal(b.unallocated, a.unallocated - 400);
  });

  it("overspending a category: its remaining allocation floors at 0 and the excess comes out of unallocated", () => {
    // Food budget 5,000; spend 6,000 → 1,000 over.
    const t = computeTotals(withTx(expense(6000, "food")));
    assert.equal(t.cash, 14000);
    assert.equal(t.allocatedRemaining, 19500 - 5000); // food contributes 0, not −1,000
    assert.equal(t.unallocated, 500 - 1000);
    assert.equal(t.overCount, 1);
  });

  it("spending exactly the allocation is not 'over'", () => {
    const t = computeTotals(withTx(expense(5000, "food")));
    assert.equal(t.overCount, 0);
    assert.equal(t.unallocated, 500);
  });

  it("an uncategorised expense lowers cash and unallocated by its full amount", () => {
    const t = computeTotals(withTx(expense(700, "other")));
    assert.equal(t.cash, 19300);
    assert.equal(t.allocatedRemaining, 19500);
    assert.equal(t.unallocated, -200);
    assert.equal(t.spentByCategory.other, 700);
  });

  it("an over-allocated plan reports a negative unallocated amount (the shortfall)", () => {
    const s = baseState();
    s.openingBalance = 10000;
    const t = computeTotals(s);
    assert.equal(t.unallocated, 10000 - 19500);
  });

  it("flexible remaining = unspent allocation of 'Flexible' categories only", () => {
    const base = computeTotals(baseState());
    assert.equal(base.flexible, 2500);
    const t = computeTotals(withTx(expense(600, "fun"), expense(4000, "food")));
    assert.equal(t.flexible, 1900);
  });

  it("an overspent flexible category contributes 0 to flexible remaining, never a negative", () => {
    const t = computeTotals(withTx(expense(2000, "fun")));
    assert.equal(t.flexible, 1000); // fun 0 + misc 1,000
  });
});

describe("computeTotals — determinism and integrity", () => {
  it("does not mutate its input", () => {
    const s = deepFreeze(withTx(expense(500, "food"), income(1000)));
    assert.doesNotThrow(() => computeTotals(s));
  });

  it("returns identical results for identical input", () => {
    const s = withTx(expense(500, "food"), income(1000), expense(250, "fun"));
    assert.deepEqual(computeTotals(s), computeTotals(structuredClone(s)));
  });

  it("whole-shilling inputs always produce whole-shilling outputs", () => {
    const t = computeTotals(withTx(expense(333, "food"), income(1001), expense(17, "misc")));
    for (const k of ["spent", "earned", "cash", "allocatedRemaining", "planned", "unallocated", "flexible"]) {
      assert.ok(Number.isInteger(t[k]), `${k} = ${t[k]}`);
    }
  });
});

describe("daysToPayday", () => {
  const at = (y, m, d, h = 10, min = 0) => new Date(y, m - 1, d, h, min);

  it("is 0 on payday itself", () => {
    assert.equal(daysToPayday("2026-11-30", at(2026, 11, 30)), 0);
  });

  it("is 1 the day before payday", () => {
    assert.equal(daysToPayday("2026-11-30", at(2026, 11, 29)), 1);
  });

  it("counts calendar days regardless of the time of day", () => {
    const early = daysToPayday("2026-12-01", at(2026, 11, 5, 0, 0));
    const late = daysToPayday("2026-12-01", at(2026, 11, 5, 23, 59));
    assert.equal(early, 26);
    assert.equal(late, 26);
  });

  it("crosses a month boundary correctly (30 Nov → 1 Dec)", () => {
    assert.equal(daysToPayday("2026-12-01", at(2026, 11, 30)), 1);
  });

  it("crosses a year boundary correctly (31 Dec → 1 Jan)", () => {
    assert.equal(daysToPayday("2027-01-01", at(2026, 12, 31)), 1);
  });

  it("handles leap years (28 Feb 2028 → 1 Mar 2028 is 2 days)", () => {
    assert.equal(daysToPayday("2028-03-01", at(2028, 2, 28)), 2);
  });

  it("never returns a negative number for a past payday", () => {
    assert.equal(daysToPayday("2026-11-01", at(2026, 11, 5)), 0);
  });

  it("does not mutate the Date it is given", () => {
    const now = at(2026, 11, 5, 15, 30);
    const copy = now.getTime();
    daysToPayday("2026-12-01", now);
    assert.equal(now.getTime(), copy);
  });
});

// ---------------------------------------------------------------------------
// Known defects — documented, deliberately NOT encoded. See docs/KNOWN_ISSUES.md.
// Each becomes a real test in the phase that fixes it.
// ---------------------------------------------------------------------------
describe("Known issues (fixed in later phases)", () => {
  it.todo("KI-01 [Phase 1] restoring a backup with a text opening balance must not inflate cash");
  it.todo("KI-02 [Phase 1] text amounts in a backup must never be string-concatenated into totals");
  it.todo("KI-03 [Phase 1] negative, zero or non-numeric amounts are rejected on entry and on restore");
  it.todo("KI-03 [Phase 1] duplicate transaction IDs on restore are detected and not double-counted");
  it.todo("KI-04 [Phase 1] a transaction with a missing or invalid date cannot break rendering");
  it.todo("KI-05 [Phase 1] unreadable saved data is quarantined, never silently overwritten");
  it.todo("KI-06 [Phase 2] safe-to-spend = flexible remaining + unallocated, capped at cash, never below 0");
  it.todo("KI-06 [Phase 2] daily guide = safe-to-spend ÷ days to payday, rounded down, no divide-by-zero");
  it.todo("KI-07 [Phase 2] category type comes from a fixed list; flexible total is not case-sensitive to user typing");
  it.todo("KI-08 [Phase 2] savings transfers/withdrawals change destination balances, not income/expense totals");
  it.todo("KI-09 [Phase 3] only transactions in the current pay cycle count against the budget");
  it.todo("KI-09 [Phase 3] pay-cycle length comes from real dates, not a fixed 30 days");
  it.todo("KI-16 [Phase 3] daysToPayday is correct across daylight-saving changes (non-Kenyan time zones)");
});
