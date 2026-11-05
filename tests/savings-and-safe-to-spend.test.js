/**
 * Phase 2 calculations: safe-to-spend (D-03), daily guide, savings transfers
 * and withdrawals (D-04), linked savings allocations, uncategorised spending,
 * category-type matching and KSh formatting.
 */
"use strict";
process.env.TZ = "Africa/Nairobi";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { computeTotals, dailyGuide, formatKSh } = require("../src/finance.js");
const { baseState, expense, income } = require("./fixtures.js");

// Reference budget from fixtures: opening 20,000; planned 19,500 (Flexible: fun 1,500 + misc 1,000).
// Baseline: cash 20,000 · reserved 19,500 · unallocated 500 · flexible 2,500 · safe to spend 3,000.

let n = 0;
const transfer = (amount, destinationId, extra = {}) =>
  ({ id: `s${++n}`, type: "savings_transfer", amount, destinationId, date: "2026-11-05", note: "", createdAt: n, ...extra });
const withdrawal = (amount, destinationId, extra = {}) =>
  ({ id: `w${++n}`, type: "savings_withdrawal", amount, destinationId, date: "2026-11-05", note: "", createdAt: n, ...extra });

/** Budget with savings: the "emergency" Savings category (2,000) linked to M-Shwari; M-Shwari starts at 10,000. */
function savingsState(...transactions) {
  const s = baseState();
  s.savingsDestinations = [
    { id: "kcb-mpesa", name: "KCB M-PESA", openingBalance: 0, archived: false, builtIn: true },
    { id: "m-shwari", name: "M-Shwari", openingBalance: 10000, archived: false, builtIn: true }
  ];
  s.categories.find(c => c.id === "emergency").destinationId = "m-shwari";
  s.transactions.push(...transactions);
  return s;
}

/** Your example: KSh 5,000 allocated to savings, linked to M-Shwari. */
function exampleState(...transactions) {
  const s = savingsState(...transactions);
  s.categories.find(c => c.id === "emergency").budget = 5000;
  s.openingBalance = 23000; // keeps unallocated at 500
  return s;
}

describe("safe to spend (D-03, fixes KI-06)", () => {
  it("baseline: flexible left 2,500 + unallocated 500 = 3,000", () => {
    const t = computeTotals(baseState());
    assert.equal(t.flexible, 2500);
    assert.equal(t.unallocated, 500);
    assert.equal(t.safeToSpend, 3000);
  });

  it("spending from a flexible category lowers safe-to-spend by the same amount", () => {
    const s = baseState(); s.transactions.push(expense(600, "fun"));
    assert.equal(computeTotals(s).safeToSpend, 2400);
  });

  it("spending within an essential's allocation does not change safe-to-spend (that money was already set aside)", () => {
    const s = baseState(); s.transactions.push(expense(500, "food"));
    assert.equal(computeTotals(s).safeToSpend, 3000);
  });

  it("overspending an essential reduces safe-to-spend by the overspend", () => {
    const s = baseState(); s.transactions.push(expense(6000, "food")); // food 5,000 → 1,000 over
    const t = computeTotals(s);
    assert.equal(t.flexible, 2500, "flexible left alone does not see the overspend");
    assert.equal(t.unallocated, -500);
    assert.equal(t.safeToSpend, 2000);
  });

  it("over-allocation (plan short) gives 0 — never a positive amount the user doesn't have", () => {
    const s = baseState(); s.openingBalance = 10000; // 9,500 short
    const t = computeTotals(s);
    assert.equal(t.unallocated, -9500);
    assert.equal(t.safeToSpend, 0);
  });

  it("is never below zero, even when spending cash is negative", () => {
    const s = baseState(); s.openingBalance = 0; s.categories = []; s.transactions.push(expense(500, "other"));
    const t = computeTotals(s);
    assert.equal(t.cash, -500);
    assert.equal(t.safeToSpend, 0);
  });

  it("income raises safe-to-spend by the full amount (it arrives unallocated)", () => {
    const s = baseState(); s.transactions.push(income(4000));
    assert.equal(computeTotals(s).safeToSpend, 7000);
  });

  it("uncategorised spending reduces safe-to-spend", () => {
    const s = baseState(); s.transactions.push(expense(700, "other"));
    assert.equal(computeTotals(s).safeToSpend, 2300);
  });

  it("KI-06 reproduction: the Phase 0 scenario that showed KSh 132/day while KSh 12,500 short now shows 0", () => {
    const s = baseState(); s.openingBalance = 7000; // 12,500 short of the 19,500 plan
    const t = computeTotals(s);
    assert.equal(t.unallocated, -12500);
    assert.equal(t.safeToSpend, 0);
    assert.equal(dailyGuide(t.safeToSpend, 25), 0);
  });

  it("always lies between 0 and actual cash, and equals cash minus what non-flexible categories still reserve (500 random budgets)", () => {
    let seed = 12345;
    const rnd = (max) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % (max + 1); };
    const kinds = ["Essential", "Bills", "Flexible", "Savings", "Personal", "Other"];
    for (let i = 0; i < 500; i++) {
      const s = { openingBalance: rnd(50000), categories: [], transactions: [], savingsDestinations: [{ id: "d1", name: "D1", openingBalance: rnd(5000) }] };
      const cats = 1 + rnd(6);
      for (let c = 0; c < cats; c++) s.categories.push({ id: `c${c}`, name: `C${c}`, budget: rnd(10000), kind: kinds[rnd(kinds.length - 1)], ...(c === 0 ? { destinationId: "d1" } : {}) });
      const txs = rnd(12);
      for (let k = 0; k < txs; k++) {
        const type = ["expense", "income", "savings_transfer", "savings_withdrawal"][rnd(3)];
        const amount = 1 + rnd(8000);
        s.transactions.push(type.startsWith("savings") ? { type, amount, destinationId: "d1" } : { type, amount, categoryId: rnd(4) === 0 ? "other" : `c${rnd(cats - 1)}` });
      }
      const t = computeTotals(s);
      assert.ok(Number.isInteger(t.safeToSpend));
      assert.ok(t.safeToSpend >= 0, `negative at case ${i}`);
      assert.ok(t.safeToSpend <= Math.max(0, t.cash), `above cash at case ${i}`);
      const used = (c) => (t.spentByCategory[c.id] || 0) + (t.savedByCategory[c.id] || 0);
      const nonFlexReserved = s.categories.filter(c => c.kind !== "Flexible").reduce((a, c) => a + Math.max(0, c.budget - used(c)), 0);
      assert.equal(t.safeToSpend, Math.max(0, Math.min(t.cash, t.cash - nonFlexReserved)), `identity at case ${i}`);
    }
  });
});

describe("daily guide (D-03)", () => {
  it("divides safe-to-spend by days to payday, rounded down to whole shillings", () => {
    assert.equal(dailyGuide(3000, 25), 120);
    assert.equal(dailyGuide(3001, 25), 120);
    assert.equal(dailyGuide(99, 100), 0);
  });
  it("on payday (0 days) the whole amount is available — no division by zero", () => {
    assert.equal(dailyGuide(3000, 0), 3000);
  });
  it("with no payday set, there is no guide (null)", () => {
    assert.equal(dailyGuide(3000, NaN), null);
    assert.equal(dailyGuide(3000, undefined), null);
  });
  it("is 0 when there is nothing safe to spend", () => assert.equal(dailyGuide(0, 12), 0));
});

describe("savings transfers and withdrawals (D-04, fixes KI-08)", () => {
  it("YOUR EXAMPLE: allocate KSh 5,000 to savings, transfer KSh 2,000 to M-Shwari → KSh 3,000 of the allocation remains", () => {
    const before = computeTotals(exampleState());
    const after = computeTotals(exampleState(transfer(2000, "m-shwari")));
    const savingsCat = exampleState().categories.find(c => c.id === "emergency");
    assert.equal(savingsCat.budget - after.savedByCategory.emergency, 3000);
    assert.equal(before.allocatedRemaining - after.allocatedRemaining, 2000);
  });

  it("…and the transferred money is not reserved twice: unallocated and safe-to-spend are unchanged", () => {
    const before = computeTotals(exampleState());
    const after = computeTotals(exampleState(transfer(2000, "m-shwari")));
    assert.equal(after.cash, before.cash - 2000);
    assert.equal(after.unallocated, before.unallocated);
    assert.equal(after.safeToSpend, before.safeToSpend);
  });

  it("a transfer moves money from spending cash to the destination", () => {
    const t = computeTotals(savingsState(transfer(2000, "m-shwari")));
    assert.equal(t.cash, 18000);
    assert.equal(t.destinationBalances["m-shwari"], 12000);
    assert.equal(t.destinationBalances["kcb-mpesa"], 0);
    assert.equal(t.totalSavings, 12000);
  });

  it("transfers and withdrawals NEVER count as income or spending", () => {
    const t = computeTotals(savingsState(transfer(2000, "m-shwari"), withdrawal(500, "m-shwari"), transfer(300, "kcb-mpesa")));
    assert.equal(t.earned, 0);
    assert.equal(t.spent, 0);
    assert.deepEqual(t.spentByCategory, {});
    assert.equal(t.transferredToSavings, 2300);
    assert.equal(t.withdrawnFromSavings, 500);
    assert.equal(t.overCount, 0);
  });

  it("a withdrawal returns money to spending cash and lowers the destination", () => {
    const t = computeTotals(savingsState(withdrawal(1500, "m-shwari")));
    assert.equal(t.cash, 21500);
    assert.equal(t.destinationBalances["m-shwari"], 8500);
  });

  it("D-10 (decided Phase 3): YOUR EXAMPLE — allocate 5,000, transfer 5,000, withdraw 1,000 → net 4,000 saved, 1,000 of the allocation remaining", () => {
    const back = computeTotals(exampleState(transfer(5000, "m-shwari"), withdrawal(1000, "m-shwari")));
    assert.equal(back.savedByCategory.emergency, 4000);
    assert.equal(5000 - back.savedByCategory.emergency, 1000);
  });

  it("D-10: the withdrawal does not double-reserve — the 1,000 is back in cash and reserved once, so safe-to-spend is unchanged", () => {
    const saved = computeTotals(exampleState(transfer(5000, "m-shwari")));
    const back = computeTotals(exampleState(transfer(5000, "m-shwari"), withdrawal(1000, "m-shwari")));
    assert.equal(back.cash - saved.cash, 1000, "cash rises by the withdrawal");
    assert.equal(back.allocatedRemaining - saved.allocatedRemaining, 1000, "allocation re-opens by the same amount");
    assert.equal(back.unallocated, saved.unallocated);
    assert.equal(back.safeToSpend, saved.safeToSpend);
  });

  it("D-10: net savings towards an allocation never go below zero (withdrawing older savings doesn't inflate the reservation)", () => {
    const t = computeTotals(exampleState(transfer(1000, "m-shwari"), withdrawal(3000, "m-shwari")));
    assert.equal(t.savedByCategory.emergency, 0);
    const none = computeTotals(exampleState());
    assert.equal(t.allocatedRemaining, none.allocatedRemaining, "reservation is at most the full allocation");
    assert.equal(t.safeToSpend - none.safeToSpend, 2000, "the net 2,000 withdrawn is spendable");
  });

  it("KCB M-PESA and M-Shwari are tracked separately", () => {
    const t = computeTotals(savingsState(transfer(700, "kcb-mpesa"), transfer(300, "m-shwari"), withdrawal(200, "kcb-mpesa")));
    assert.equal(t.destinationBalances["kcb-mpesa"], 500);
    assert.equal(t.destinationBalances["m-shwari"], 10300);
    assert.equal(t.totalSavings, 10800);
  });

  it("a transfer to an unlinked destination comes out of unallocated money", () => {
    const before = computeTotals(savingsState());
    const after = computeTotals(savingsState(transfer(400, "kcb-mpesa")));
    assert.equal(after.allocatedRemaining, before.allocatedRemaining);
    assert.equal(after.unallocated, before.unallocated - 400);
    assert.equal(after.safeToSpend, before.safeToSpend - 400);
  });

  it("saving more than the allocation: allocation fully met, the extra comes from unallocated, and it is not 'over budget'", () => {
    const t = computeTotals(exampleState(transfer(6000, "m-shwari")));
    assert.equal(t.savedByCategory.emergency, 6000);
    assert.equal(t.overCount, 0);
    assert.equal(t.unallocated, 500 - 1000);
  });

  it("an unlinked Savings category is not fulfilled by transfers (no guessing)", () => {
    const s = savingsState(transfer(2000, "m-shwari"));
    delete s.categories.find(c => c.id === "emergency").destinationId;
    const t = computeTotals(s);
    assert.equal(t.savedByCategory.emergency, undefined);
  });

  it("older data that recorded savings as an expense still counts as an expense (nothing silently reinterpreted)", () => {
    const s = savingsState(expense(1000, "emergency"));
    const t = computeTotals(s);
    assert.equal(t.spent, 1000);
    assert.equal(t.cash, 19000);
  });

  it("custom destinations work exactly like the built-in ones", () => {
    const s = savingsState(transfer(2500, "sacco"));
    s.savingsDestinations.push({ id: "sacco", name: "Sacco", openingBalance: 40000, archived: false, builtIn: false });
    assert.equal(computeTotals(s).destinationBalances.sacco, 42500);
  });

  it("results do not depend on the order of transactions", () => {
    const list = [transfer(2000, "m-shwari"), expense(600, "fun"), withdrawal(500, "m-shwari"), income(3000), transfer(100, "kcb-mpesa")];
    assert.deepEqual(computeTotals(savingsState(...list)), computeTotals(savingsState(...[...list].reverse())));
  });
});

describe("uncategorised spending (fixes KI-11)", () => {
  it("adds up expenses marked 'Other' and expenses whose category no longer exists", () => {
    const s = baseState();
    s.transactions.push(expense(700, "other"), expense(300, "deleted-category"), expense(200, "food"));
    const t = computeTotals(s);
    assert.equal(t.uncategorisedSpent, 1000);
    assert.equal(t.unallocated, 500 - 1000);
  });
});

describe("category types (fixes KI-07 in calculations)", () => {
  it("'flexible' typed in any case counts as Flexible", () => {
    const s = baseState();
    s.categories.find(c => c.id === "misc").kind = "flexible";
    s.categories.find(c => c.id === "fun").kind = " FLEXIBLE ";
    assert.equal(computeTotals(s).flexible, 2500);
  });
});

describe("KSh display (fixes KI-18)", () => {
  it("formats as 'KSh' with thousands separators and a proper minus sign", () => {
    assert.equal(formatKSh(25000), "KSh 25,000");
    assert.equal(formatKSh(0), "KSh 0");
    assert.equal(formatKSh(1234567), "KSh 1,234,567");
    assert.equal(formatKSh(-800), "−KSh 800");
    assert.equal(formatKSh(999.6), "KSh 1,000");
  });
});
