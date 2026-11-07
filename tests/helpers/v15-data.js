/**
 * Fictional data in the exact form PesaOtas v1.5.0 saved it (format v2): a
 * budget with income, spending, savings transfers to both accounts, a
 * withdrawal, a closed pay cycle and a PesaFlow migration note. Used by the
 * v1.6 upgrade, compatibility and preservation tests. No real records.
 */
"use strict";

const D = require("../../src/data-model.js");

function richState() {
  const input = {
    app: "PesaOtas", version: 2, currency: "KES",
    openingBalance: 20000, payday: "2026-11-30", cycleStart: "2026-11-01",
    cycles: [{ start: "2026-10-01", end: "2026-11-01", closedAt: "2026-11-01T06:00:00.000Z", budgets: { rent: 8000, food: 5000, fun: 1500 } }],
    categories: [
      { id: "rent", name: "Rent", budget: 8000, kind: "Bills" },
      { id: "food", name: "Food", budget: 5000, kind: "Essential" },
      { id: "fun", name: "Fun", budget: 1500, kind: "Flexible" },
      { id: "emergency", name: "Emergency fund", budget: 3000, kind: "Savings", destinationId: "m-shwari" }
    ],
    transactions: [
      { id: "s1", type: "income", amount: 60000, categoryId: "inc-salary", date: "2026-10-01", note: "Fictional salary", createdAt: 1 },
      { id: "s2", type: "expense", amount: 8000, categoryId: "rent", date: "2026-10-02", note: "Fictional rent", createdAt: 2 },
      { id: "s3", type: "expense", amount: 1200, categoryId: "food", date: "2026-11-03", note: "Fictional groceries", createdAt: 3 },
      { id: "s4", type: "savings_transfer", amount: 3000, destinationId: "m-shwari", categoryId: "emergency", date: "2026-11-04", note: "", createdAt: 4 },
      { id: "s5", type: "savings_withdrawal", amount: 500, destinationId: "m-shwari", date: "2026-11-05", note: "", createdAt: 5 },
      { id: "s6", type: "savings_transfer", amount: 700, destinationId: "kcb-mpesa", date: "2026-11-05", note: "", createdAt: 6 },
      { id: "s7", type: "expense", amount: 450, categoryId: "fun", date: "2026-11-06", note: "Fictional cinema", createdAt: 7 },
      { id: "s8", type: "expense", amount: 300, categoryId: "other", date: "2026-11-06", note: "", createdAt: 8 }
    ],
    savingsDestinations: [
      { id: "kcb-mpesa", name: "KCB M-PESA", openingBalance: 0, archived: false, builtIn: true },
      { id: "m-shwari", name: "M-Shwari", openingBalance: 1000, archived: false, builtIn: true }
    ],
    meta: { onboarding: "done", migratedFrom: { key: "pesaflow.personal.v1", migratedAt: "2026-09-01T07:00:00.000Z" } }
  };
  const r = D.normalizeState(input);
  if (!D.isClean(r)) throw new Error("fixture not clean: " + JSON.stringify([r.errors, r.rejected]));
  // v1.5.0 stored JSON.stringify(normalised state) with version 2.
  return { ...r.state, version: 2 };
}

/** The exact text v1.5.0 would have stored for richState(). */
const richV15Raw = () => JSON.stringify(richState());

/** Every financial record, for "nothing lost, nothing duplicated" checks. */
const financial = (s) => ({
  openingBalance: s.openingBalance, payday: s.payday, cycleStart: s.cycleStart || "", cycles: s.cycles || [],
  categories: s.categories, transactions: s.transactions, savingsDestinations: s.savingsDestinations
});

module.exports = { richState, richV15Raw, financial };
