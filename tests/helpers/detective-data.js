/**
 * Small fictional budgets for Expense Detective tests (D-20). No real records.
 */
"use strict";

const D = require("../../src/data-model.js");

let seq = 0;
/** An entry; `cat` is a category ID (or a deleted/unknown one), `dest` a savings destination. */
function tx(type, amount, date, extra = {}) {
  seq++;
  const base = { id: extra.id || `d${seq}`, type, amount, date, note: extra.note || "", createdAt: extra.createdAt || seq };
  if (type === "expense") return { ...base, categoryId: extra.cat || "food" };
  if (type === "income") return { ...base, categoryId: extra.cat || "inc-salary" };
  return { ...base, destinationId: extra.dest || "m-shwari" };
}
const ex = (amount, date, cat, extra = {}) => tx("expense", amount, date, { ...extra, cat });

const CATEGORIES = [
  { id: "power", name: "Electricity", budget: 2000, kind: "Bills" },
  { id: "rent", name: "Rent", budget: 15000, kind: "Bills" },
  { id: "food", name: "Groceries", budget: 17000, kind: "Essential" },
  { id: "transport", name: "Transport", budget: 3500, kind: "Essential" },
  { id: "fun", name: "Fun", budget: 2000, kind: "Flexible" },
  { id: "gift", name: "Gifts", budget: 0, kind: "Event" },
  { id: "emergency", name: "Emergency fund", budget: 3000, kind: "Savings", destinationId: "m-shwari" }
];

/** A clean v3 budget. */
function budget(transactions, opts = {}) {
  const r = D.normalizeState({
    app: "PesaOtas", version: 3, currency: opts.currency || "KES", openingBalance: 100000,
    payday: opts.payday === undefined ? "" : opts.payday,
    ...(opts.cycleStart ? { cycleStart: opts.cycleStart } : {}),
    categories: opts.categories || CATEGORIES,
    transactions,
    savingsDestinations: D.DEFAULT_DESTINATIONS.map(d => ({ ...d, openingBalance: 50000 })),
    meta: opts.meta || {}
  });
  if (!r.ok || r.rejected.length || r.reviewIssues.length) throw new Error("detective fixture not usable: " + JSON.stringify([r.errors, r.rejected, r.reviewIssues]));
  return r.state;
}

module.exports = { tx, ex, budget, CATEGORIES };
