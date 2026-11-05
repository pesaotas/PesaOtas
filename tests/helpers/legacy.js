/**
 * PesaFlow v1 data exactly as the original app saved it (same field names,
 * types and ID formats), with neutral example figures.
 */
"use strict";

function legacyState() {
  return {
    version: 1,
    month: "2026-11",
    openingBalance: 20000,
    payday: "2026-12-01",
    categories: [
      { id: "food", name: "Food", budget: 5000, kind: "Essential" },
      { id: "transport", name: "Transport", budget: 2000, kind: "Essential" },
      { id: "fun", name: "Fun", budget: 1500, kind: "Flexible" },
      { id: "emergency", name: "Emergency", budget: 2000, kind: "Savings" },
      { id: "cat-1762359000000", name: "Gym", budget: 1000, kind: "Flexible" }
    ],
    transactions: [
      { id: "6f1c2a4e-1111-4c1e-9a1b-000000000001", type: "expense", amount: 500, categoryId: "food", date: "2026-11-03", note: "Lunch", createdAt: 1762160000000 },
      { id: "6f1c2a4e-1111-4c1e-9a1b-000000000002", type: "income", amount: 3000, categoryId: "food", date: "2026-11-04", note: "Side job", createdAt: 1762250000000 },
      { id: "6f1c2a4e-1111-4c1e-9a1b-000000000003", type: "expense", amount: 700, categoryId: "other", date: "2026-11-05", note: "Gift", createdAt: 1762330000000 },
      { id: "1762340000000", type: "expense", amount: 1200, categoryId: "fun", date: "2026-11-05", note: "Movie", createdAt: 1762340000000 }
    ]
  };
}

const legacyRaw = () => JSON.stringify(legacyState());

module.exports = { legacyState, legacyRaw };
