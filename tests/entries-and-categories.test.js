/**
 * Phase 4: editing transactions and managing categories (src/entries.js), and
 * reserved category IDs (KI-21).
 */
"use strict";
process.env.TZ = "Africa/Nairobi";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const E = require("../src/entries.js");
const F = require("../src/finance.js");
const D = require("../src/data-model.js");

const NOW = new Date("2026-11-20T10:00:00+03:00");
let n = 0;
const t = (type, amount, date, extra) => ({ id: `t${++n}`, type, amount, date, note: "", createdAt: n, ...extra });

/** Cycle 1 Nov → 1 Dec; opening 10,000; Food 5,000 · Fun 2,000 (Flexible) · Savings 3,000 → M-Shwari. */
function plan(...transactions) {
  return {
    app: "PesaOtas", version: 2, currency: "KES", openingBalance: 10000, payday: "2026-12-01", cycleStart: "2026-11-01",
    categories: [
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
const edit = (state, id, input) => E.validateEntry(state, input, { replacingId: id, now: NOW });
const add = (state, input) => E.validateEntry(state, input, { newId: "new-1", now: NOW });

describe("editing a transaction", () => {
  it("replaces it in place, keeping its ID and original order, and every figure recalculates", () => {
    const a = t("expense", 1000, "2026-11-05", { categoryId: "food" });
    const b = t("expense", 500, "2026-11-06", { categoryId: "fun" });
    const s = plan(a, b);
    const r = edit(s, a.id, { type: "expense", amount: "1500", date: "2026-11-07", categoryId: "fun", note: "Corrected" });
    assert.ok(r.ok, r.errors && r.errors.join());
    assert.deepEqual(r.state.transactions.map(x => x.id), [a.id, b.id]);
    assert.equal(r.entry.createdAt, a.createdAt);
    const before = F.computeTotals(s), after = F.computeTotals(r.state);
    assert.equal(after.cash, before.cash - 500);
    assert.equal(after.spentByCategory.food, undefined);
    assert.equal(after.spentByCategory.fun, 2000);
    assert.equal(after.flexible, 0);
    assert.equal(r.state.transactions.length, 2, "edit never duplicates");
  });

  it("does not change the input state", () => {
    const a = t("expense", 1000, "2026-11-05", { categoryId: "food" });
    const s = plan(a);
    const snapshot = JSON.stringify(s);
    edit(s, a.id, { type: "expense", amount: 2000, date: "2026-11-05", categoryId: "food" });
    assert.equal(JSON.stringify(s), snapshot);
  });

  it("applies the same validation as a new entry", () => {
    const a = t("expense", 1000, "2026-11-05", { categoryId: "food" });
    const s = plan(a);
    assert.ok(edit(s, a.id, { type: "expense", amount: "-5", date: "2026-11-05", categoryId: "food" }).errors[0].includes("cannot be negative"));
    assert.ok(edit(s, a.id, { type: "expense", amount: "12.5", date: "2026-11-05", categoryId: "food" }).errors[0].includes("whole amount (no decimals)"));
    assert.ok(edit(s, a.id, { type: "expense", amount: 100, date: "2026-02-30", categoryId: "food" }).errors[0].includes("valid date"));
    assert.ok(edit(s, a.id, { type: "expense", amount: 100, date: "2026-11-05", categoryId: "nope" }).errors[0].includes("Choose a category"));
    assert.ok(edit(s, a.id, { type: "income", amount: 100, date: "2026-11-05", categoryId: "food" }).errors[0].includes("income source"));
    assert.ok(edit(s, "missing", { type: "expense", amount: 100, date: "2026-11-05", categoryId: "food" }).errors[0].includes("no longer exists"));
  });

  it("can change the type (an expense recorded by mistake becomes income)", () => {
    const a = t("expense", 3000, "2026-11-05", { categoryId: "food" });
    const r = edit(plan(a), a.id, { type: "income", amount: 3000, date: "2026-11-05", categoryId: "inc-salary" });
    assert.ok(r.ok);
    const after = F.computeTotals(r.state);
    assert.deepEqual([after.spent, after.earned, after.cash], [0, 3000, 13000]);
  });

  it("can correct an old savings-as-expense entry into a Save (KI-23 path)", () => {
    const a = t("expense", 2000, "2026-11-05", { categoryId: "sav" });
    const r = edit(plan(a), a.id, { type: "savings_transfer", amount: 2000, date: "2026-11-05", destinationId: "m-shwari" });
    assert.ok(r.ok);
    const after = F.computeTotals(r.state);
    assert.deepEqual([after.spent, after.savedByCategory.sav, after.destinationBalances["m-shwari"]], [0, 2000, 2000]);
    assert.equal(r.entry.categoryId, undefined);
  });

  it("editing a withdrawal checks the limit as if the original weren't there", () => {
    const save = t("savings_transfer", 3000, "2026-11-05", { destinationId: "m-shwari" });
    const w = t("savings_withdrawal", 1000, "2026-11-10", { destinationId: "m-shwari" });
    const s = plan(save, w);
    assert.ok(edit(s, w.id, { type: "savings_withdrawal", amount: 3000, date: "2026-11-10", destinationId: "m-shwari" }).ok, "can raise to the full 3,000");
    const tooMuch = edit(s, w.id, { type: "savings_withdrawal", amount: 3001, date: "2026-11-10", destinationId: "m-shwari" });
    assert.equal(tooMuch.errors[0], "Not saved. M-Shwari holds KSh 3,000 on 10 Nov 2026.");
    const tooEarly = edit(s, w.id, { type: "savings_withdrawal", amount: 1000, date: "2026-11-04", destinationId: "m-shwari" });
    assert.ok(tooEarly.errors[0].includes("holds KSh 0 on 4 Nov 2026"));
  });

  it("shrinking, moving or retyping a transfer is refused if a later withdrawal depends on it", () => {
    const save = t("savings_transfer", 3000, "2026-11-05", { destinationId: "m-shwari" });
    const w = t("savings_withdrawal", 2500, "2026-11-10", { destinationId: "m-shwari" });
    const s = plan(save, w);
    for (const change of [
      { amount: 2000 }, { date: "2026-11-12" }, { destinationId: "kcb-mpesa" }, { type: "expense", categoryId: "food" }
    ]) {
      const r = edit(s, save.id, { type: "savings_transfer", amount: 3000, date: "2026-11-05", destinationId: "m-shwari", ...change });
      assert.equal(r.ok, false, JSON.stringify(change));
      assert.ok(r.errors[0].includes("a withdrawal recorded later depends on this money"), r.errors[0]);
    }
    assert.ok(edit(s, save.id, { type: "savings_transfer", amount: 2500, date: "2026-11-05", destinationId: "m-shwari" }).ok, "2,500 still covers it");
  });

  it("asks for confirmation when moving an entry before the current pay cycle", () => {
    const a = t("expense", 1000, "2026-11-05", { categoryId: "food" });
    const r = edit(plan(a), a.id, { type: "expense", amount: 1000, date: "2026-10-30", categoryId: "food" });
    assert.deepEqual(r.confirms.map(c => c.code), ["backdated"]);
    const same = edit(plan({ ...a, date: "2026-10-30" }), a.id, { type: "expense", amount: 900, date: "2026-10-30", categoryId: "food" });
    assert.deepEqual(same.confirms, [], "no repeated question when the old date is kept");
  });

  it("asks for confirmation for a transfer larger than spending cash (excluding the entry being edited)", () => {
    const save = t("savings_transfer", 9000, "2026-11-05", { destinationId: "kcb-mpesa" });
    const s = plan(save);
    assert.deepEqual(edit(s, save.id, { type: "savings_transfer", amount: 10000, date: "2026-11-05", destinationId: "kcb-mpesa" }).confirms, []);
    assert.deepEqual(edit(s, save.id, { type: "savings_transfer", amount: 10001, date: "2026-11-05", destinationId: "kcb-mpesa" }).confirms.map(c => c.code), ["over-cash"]);
  });

  it("a new entry gets the new ID and the current time; the same rules apply", () => {
    const r = add(plan(), { type: "expense", amount: 250, date: "2026-11-20", categoryId: "other", note: "  Gift  " });
    assert.ok(r.ok);
    assert.deepEqual([r.entry.id, r.entry.createdAt, r.entry.note], ["new-1", NOW.getTime(), "Gift"]);
  });

  it("edited data still passes every data check (stays saveable)", () => {
    const a = t("expense", 1000, "2026-11-05", { categoryId: "food" });
    const r = edit(plan(a), a.id, { type: "income", amount: 4000, date: "2026-11-06", categoryId: "inc-side" });
    assert.ok(D.isClean(D.normalizeState(r.state)));
  });
});

describe("deleting a transaction", () => {
  it("is refused when a later withdrawal depends on the transfer, allowed otherwise", () => {
    const save = t("savings_transfer", 3000, "2026-11-05", { destinationId: "m-shwari" });
    const w = t("savings_withdrawal", 1000, "2026-11-10", { destinationId: "m-shwari" });
    const s = plan(save, w);
    const r = E.validateDelete(s, save.id);
    assert.equal(r.ok, false);
    assert.ok(r.error.includes("on 10 Nov 2026. Delete the later withdrawal first."));
    assert.ok(E.validateDelete(s, w.id).ok);
    assert.equal(E.validateDelete(s, "nope").ok, false);
  });
});

describe("category management", () => {
  const cat = (state, input, editingId) => E.validateCategory(state, input, editingId ? { editingId } : { newId: "cat-x" });

  it("adds a category with a validated name, type and allocation", () => {
    const r = cat(plan(), { name: " Rent ", kind: "bills", budget: "6000" });
    assert.ok(r.ok);
    assert.deepEqual(r.category, { id: "cat-x", name: "Rent", budget: 6000, kind: "Bills" });
  });

  it("refuses empty or duplicate names, unknown types and invalid amounts", () => {
    assert.ok(cat(plan(), { name: "  ", kind: "Bills", budget: 0 }).errors[0].includes("name"));
    assert.ok(cat(plan(), { name: "food", kind: "Bills", budget: 0 }).errors[0].includes('already have a category called "food"'));
    assert.ok(cat(plan(), { name: "X", kind: "Fun", budget: 0 }).errors[0].includes("Choose a type"));
    assert.ok(cat(plan(), { name: "X", kind: "Bills", budget: "-1" }).errors[0].includes("cannot be negative"));
    assert.ok(cat(plan(), { name: "X".repeat(41), kind: "Bills", budget: 0 }).errors[0].includes("up to 40"));
  });

  it("renaming keeps the same ID, so every transaction stays attached", () => {
    const a = t("expense", 700, "2026-11-05", { categoryId: "food" });
    const s = plan(a);
    const r = cat(s, { name: "Groceries", kind: "Essential", budget: 5000 }, "food");
    assert.ok(r.ok);
    assert.equal(r.category.id, "food");
    assert.equal(F.computeTotals(r.state).spentByCategory.food, 700);
    assert.equal(r.state.categories[0].name, "Groceries", "stays in the same position");
  });

  it("changing a linked Savings category to another type removes the link, and says so", () => {
    const r = cat(plan(), { name: "Savings", kind: "Personal", budget: 3000, destinationId: "m-shwari" }, "sav");
    assert.ok(r.ok);
    assert.equal(r.category.destinationId, undefined);
    assert.ok(r.notes.some(x => x.includes("link to M-Shwari will be removed")));
  });

  it("explains when a type change affects safe to spend", () => {
    const r = cat(plan(), { name: "Fun", kind: "Essential", budget: 2000 }, "fun");
    assert.ok(r.notes.some(x => x.includes("no longer be Flexible")));
  });

  it("only one category per savings destination", () => {
    const r = cat(plan(), { name: "Pot 2", kind: "Savings", budget: 100, destinationId: "m-shwari" });
    assert.ok(r.errors[0].includes('"Savings" is already linked to M-Shwari'));
    assert.ok(cat(plan(), { name: "Pot 2", kind: "Savings", budget: 100, destinationId: "kcb-mpesa" }).ok);
  });

  it("describes how a category is used", () => {
    const s = plan(t("expense", 700, "2026-11-05", { categoryId: "food" }), t("expense", 300, "2026-10-05", { categoryId: "food" }));
    assert.deepEqual(E.categoryUsage(s, "food"), { exists: true, transactionCount: 2, totalSpent: 1000, allocation: 5000, linkedTo: null });
    assert.equal(E.categoryUsage(s, "sav").linkedTo, "m-shwari");
  });

  it("a category with transactions can't be deleted until the user chooses where they go", () => {
    const s = plan(t("expense", 700, "2026-11-05", { categoryId: "food" }));
    for (const moveTo of [undefined, "", "food", "missing"]) {
      const r = E.deleteCategory(s, "food", moveTo);
      assert.equal(r.ok, false, String(moveTo));
      assert.ok(r.errors[0].includes("Choose where this category's 1 transaction should go"));
    }
  });

  it("deleting moves its transactions to the chosen category; nothing is lost; cash unchanged", () => {
    const a = t("expense", 700, "2026-11-05", { categoryId: "food" });
    const s = plan(a, t("income", 5000, "2026-11-01", { categoryId: "inc-salary" }));
    const r = E.deleteCategory(s, "food", "fun");
    assert.ok(r.ok);
    assert.equal(r.moved, 1);
    assert.equal(r.released, 5000);
    assert.equal(r.state.transactions.length, 2);
    assert.equal(r.state.transactions[0].categoryId, "fun");
    assert.equal(r.state.transactions[0].id, a.id);
    assert.equal(F.computeTotals(r.state).cash, F.computeTotals(s).cash);
  });

  it("deleting can move transactions to 'Other / uncategorised'", () => {
    const r = E.deleteCategory(plan(t("expense", 700, "2026-11-05", { categoryId: "food" })), "food", "other");
    assert.ok(r.ok);
    assert.equal(F.computeTotals(r.state).uncategorisedSpent, 700);
  });

  it("an unused category is deleted directly and its allocation released into unallocated money", () => {
    const s = plan();
    const r = E.deleteCategory(s, "fun");
    assert.ok(r.ok);
    assert.equal(F.computeTotals(r.state).unallocated - F.computeTotals(s).unallocated, 2000);
  });

  it("deleting a linked Savings category keeps its transfers and M-Shwari balance", () => {
    const s = plan(t("savings_transfer", 1500, "2026-11-05", { destinationId: "m-shwari" }));
    const r = E.deleteCategory(s, "sav");
    assert.ok(r.ok);
    assert.equal(r.state.transactions.length, 1);
    assert.equal(F.computeTotals(r.state).destinationBalances["m-shwari"], 1500);
  });

  it("suggested categories are names only (KSh 0), added only if missing", () => {
    const empty = { ...plan(), categories: [] };
    const r = E.addSuggestedCategories(empty, i => `s${i}`);
    assert.equal(r.added, E.SUGGESTED_CATEGORIES.length);
    assert.ok(r.state.categories.every(c => c.budget === 0));
    assert.equal(r.state.transactions.length, 0);
    const again = E.addSuggestedCategories(r.state, i => `t${i}`);
    assert.equal(again.added, 0);
    assert.ok(D.isClean(D.normalizeState(r.state)));
  });
});

describe("reserved category IDs (KI-21)", () => {
  it("new category IDs are never 'other', an income source ID, or one already used", () => {
    const s = plan();
    s.categories.push({ id: "cat-abc", name: "Taken", budget: 0, kind: "Other" });
    assert.equal(E.newCategoryId(s, "abc"), "cat-abc-1");
    for (const id of D.RESERVED_CATEGORY_IDS) assert.notEqual(E.newCategoryId(s, "zz"), id);
    assert.equal(E.validateCategory(s, { name: "Sneaky", kind: "Other", budget: 0 }, { newId: "other" }).ok, false);
    assert.equal(E.validateCategory(s, { name: "Sneaky", kind: "Other", budget: 0 }, { newId: "inc-salary" }).ok, false);
  });

  it("data or a backup with a category using a reserved ID is refused, never silently renamed", () => {
    for (const id of ["other", "inc-salary"]) {
      const s = plan(); s.categories.push({ id, name: "Clash", budget: 100, kind: "Other" });
      const r = D.normalizeState(s);
      assert.equal(r.ok, false, id);
      assert.ok(r.errors.some(e => e.includes(`reserved ID "${id}"`)));
    }
  });
});

describe("blank onboarding (Phase 4)", () => {
  it("a new, empty PesaOtas has no categories, transactions, balances or payday, and shows the setup checklist", () => {
    const s = D.createBlankState();
    assert.deepEqual([s.categories.length, s.transactions.length, s.openingBalance, s.payday], [0, 0, 0, ""]);
    assert.equal(s.meta.onboarding, "active");
  });

  it("the checklist state survives saving and restoring; anything else is dropped", () => {
    for (const v of ["active", "done"]) {
      const s = D.createBlankState(); s.meta.onboarding = v;
      assert.equal(D.normalizeState(s).state.meta.onboarding, v);
    }
    const bad = D.createBlankState(); bad.meta.onboarding = "<script>";
    assert.equal(D.normalizeState(bad).state.meta.onboarding, undefined);
  });

  it("existing data without the field never gets the checklist", () => {
    const s = plan();
    assert.equal(D.normalizeState(s).state.meta.onboarding, undefined);
  });
});
