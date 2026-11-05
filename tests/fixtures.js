/**
 * Test fixtures. These are neutral example figures owned by the tests — they
 * are deliberately independent of the app's starter/demo data, which will be
 * removed in Phase 4.
 *
 * Reference budget:
 *   opening balance 20,000
 *   allocations     Rent 8,000 (Bills) · Food 5,000 (Essential)
 *                   Transport 2,000 (Essential) · Fun 1,500 (Flexible)
 *                   Misc 1,000 (Flexible) · Emergency 2,000 (Savings)
 *   planned 19,500  → unallocated 500, flexible 2,500
 */
"use strict";

function baseState() {
  return {
    openingBalance: 20000,
    payday: "2026-11-30",
    categories: [
      { id: "rent", name: "Rent", budget: 8000, kind: "Bills" },
      { id: "food", name: "Food", budget: 5000, kind: "Essential" },
      { id: "transport", name: "Transport", budget: 2000, kind: "Essential" },
      { id: "fun", name: "Fun", budget: 1500, kind: "Flexible" },
      { id: "misc", name: "Misc", budget: 1000, kind: "Flexible" },
      { id: "emergency", name: "Emergency", budget: 2000, kind: "Savings" }
    ],
    transactions: []
  };
}

let seq = 0;
function tx(type, amount, categoryId, extra = {}) {
  seq += 1;
  return { id: `t${seq}`, type, amount, categoryId, date: "2026-11-05", note: "", createdAt: seq, ...extra };
}
const expense = (amount, categoryId, extra) => tx("expense", amount, categoryId, extra);
const income = (amount, categoryId = "income", extra) => tx("income", amount, categoryId, extra);

function withTx(...transactions) {
  const s = baseState();
  s.transactions.push(...transactions);
  return s;
}

function deepFreeze(o) {
  Object.values(o).forEach(v => { if (v && typeof v === "object") deepFreeze(v); });
  return Object.freeze(o);
}

module.exports = { baseState, expense, income, withTx, deepFreeze };
