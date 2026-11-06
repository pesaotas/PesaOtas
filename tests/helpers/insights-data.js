/**
 * Fictional, deterministic budget history for Insights tests and screenshots:
 * 1 Sep 2025 – 6 Nov 2026 with salary, rent, electricity, weekly groceries,
 * small daily fares, uncategorised snacks, savings transfers, one withdrawal,
 * and an unusually expensive December. No real records.
 */
"use strict";

const D = require("../../src/data-model.js");
const F = require("../../src/finance.js");

function insightsState({ currency = "KES", from = "2025-09-01", to = "2026-11-06" } = {}) {
  const tx = [];
  let n = 0;
  const add = (type, amount, date, extra) => tx.push({ id: `h${++n}`, type, amount, date, note: "", createdAt: n, ...extra });
  for (let d = from; d <= to; d = F.addDays(d, 1)) {
    const [, m, day] = d.split("-").map(Number);
    const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (day === 1) {
      add("income", 60000, d, { categoryId: "inc-salary", note: "Fictional salary" });
      add("expense", 15000, d, { categoryId: "rent", note: "Fictional rent" });
      add("savings_transfer", 3000, d, { destinationId: "m-shwari", categoryId: "emergency" });
    }
    if (day === 10) add("expense", m === 12 ? 2700 : 2000, d, { categoryId: "power", note: "Fictional KPLC" });
    if (dow === 6) add("expense", m === 12 ? 9000 : 4000, d, { categoryId: "food", note: "Fictional groceries" });
    if (dow >= 1 && dow <= 5) add("expense", 150, d, { categoryId: "transport", note: "Fictional fare" });
    if (dow === 3) add("expense", 120, d, { categoryId: "other", note: "" });
    if (m === 12 && day === 20) add("expense", 12000, d, { categoryId: "fun", note: "Fictional holiday trip" });
  }
  if ("2026-03-15" >= from && "2026-03-15" <= to) add("savings_withdrawal", 5000, "2026-03-15", { destinationId: "m-shwari" });
  const input = {
    app: "PesaOtas", version: 3, currency, openingBalance: 30000, payday: "2026-11-30", cycleStart: "2026-11-01",
    categories: [
      { id: "rent", name: "Rent", budget: 15000, kind: "Bills" },
      { id: "power", name: "Electricity", budget: 2000, kind: "Bills" },
      { id: "food", name: "Groceries", budget: 17000, kind: "Essential" },
      { id: "transport", name: "Transport", budget: 3500, kind: "Essential" },
      { id: "fun", name: "Fun", budget: 2000, kind: "Flexible" },
      { id: "emergency", name: "Emergency fund", budget: 3000, kind: "Savings", destinationId: "m-shwari" }
    ],
    transactions: tx,
    savingsDestinations: [
      { id: "kcb-mpesa", name: "KCB M-PESA", openingBalance: 0, archived: false, builtIn: true },
      { id: "m-shwari", name: "M-Shwari", openingBalance: 0, archived: false, builtIn: true }
    ],
    meta: { onboarding: "done" }
  };
  const r = D.normalizeState(input);
  if (!D.isClean(r)) throw new Error("insights fixture not clean: " + JSON.stringify([r.errors, r.rejected]));
  return r.state;
}

module.exports = { insightsState };
