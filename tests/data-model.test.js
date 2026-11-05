/**
 * Tests for src/validation.js and src/data-model.js: schema v2, conversion
 * from PesaFlow v1, and the checks applied to backups before restoring.
 */
"use strict";
process.env.TZ = "Africa/Nairobi";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const V = require("../src/validation.js");
const D = require("../src/data-model.js");
const { computeTotals } = require("../src/finance.js");
const { legacyState } = require("./helpers/legacy.js");

const backup = (obj) => JSON.stringify(obj);
const v2 = () => D.normalizeState(legacyState()).state;
const has = (list, text) => list.some(m => m.includes(text));

describe("validation: whole shillings", () => {
  const ok = (v, o) => V.parseWholeShillings(v, o);
  it("accepts positive whole numbers", () => assert.deepEqual(ok(2500), { ok: true, value: 2500, coerced: false }));
  it("accepts digit strings and flags them as converted", () => assert.deepEqual(ok(" 2500 "), { ok: true, value: 2500, coerced: true }));
  it("rejects zero for transactions but allows it for balances", () => {
    assert.equal(ok(0).ok, false);
    assert.equal(ok(0, { allowZero: true }).ok, true);
  });
  it("rejects negatives, decimals (never rounds), non-numbers and huge values", () => {
    for (const bad of [-1, "-5", 12.5, "12.50", "abc", "1,000", NaN, Infinity, null, undefined, "", true, {}, [], V.MAX_AMOUNT + 1]) {
      assert.equal(ok(bad, { allowZero: true }).ok, false, `accepted ${String(bad)}`);
    }
  });
});

describe("validation: dates and IDs", () => {
  it("accepts real calendar dates only", () => {
    for (const good of ["2026-11-05", "2028-02-29", "2026-12-31"]) assert.ok(V.isValidISODate(good), good);
    for (const bad of ["2026-02-30", "2027-02-29", "2026-13-01", "2026-00-10", "2026-11-5", "05/11/2026", "", null, 20261105, "1999-12-31", "2101-01-01"]) {
      assert.equal(V.isValidISODate(bad), false, String(bad));
    }
  });
  it("rejects IDs that could tamper with object prototypes, control characters and non-strings", () => {
    for (const bad of ["__proto__", "constructor", "prototype", "", "a\u0000b", 12, null, "x".repeat(81)]) assert.equal(V.isSafeId(bad), false, String(bad));
    for (const good of ["food", "cat-1762359000000", "6f1c2a4e-1111-4c1e-9a1b-000000000001", "other"]) assert.ok(V.isSafeId(good), good);
  });
});

describe("schema v2", () => {
  it("a blank state has no categories or transactions, no payday, and both default savings destinations", () => {
    const s = D.createBlankState();
    assert.equal(s.app, "PesaOtas");
    assert.equal(s.version, 2);
    assert.equal(s.currency, "KES");
    assert.deepEqual([s.openingBalance, s.payday, s.categories.length, s.transactions.length], [0, "", 0, 0]);
    assert.deepEqual(s.savingsDestinations.map(d => [d.id, d.name, d.openingBalance, d.builtIn]),
      [["kcb-mpesa", "KCB M-PESA", 0, true], ["m-shwari", "M-Shwari", 0, true]]);
    assert.ok(D.isClean(D.normalizeState(s)), "blank state passes its own checks");
  });

  it("supports savings opening balances and custom destinations", () => {
    const s = D.createBlankState();
    s.savingsDestinations[1].openingBalance = 15000;
    s.savingsDestinations.push({ id: "dest-sacco", name: "Stima Sacco", openingBalance: 40000, archived: false, builtIn: false });
    const r = D.normalizeState(s);
    assert.ok(D.isClean(r));
    assert.deepEqual(r.state.savingsDestinations.map(d => [d.name, d.openingBalance]),
      [["KCB M-PESA", 0], ["M-Shwari", 15000], ["Stima Sacco", 40000]]);
  });

  it("rejects negative, invalid or duplicate savings destinations", () => {
    for (const bad of [
      { id: "kcb-mpesa", name: "Again", openingBalance: 0 },
      { id: "x", name: "X", openingBalance: -100 },
      { id: "y", name: "", openingBalance: 0 },
      { id: "__proto__", name: "Z", openingBalance: 0 }
    ]) {
      const s = D.createBlankState();
      s.savingsDestinations.push(bad);
      assert.equal(D.normalizeState(s).ok, false, JSON.stringify(bad));
    }
  });

  it("does not mutate its input", () => {
    const input = legacyState();
    const before = JSON.stringify(input);
    D.normalizeState(input);
    assert.equal(JSON.stringify(input), before);
  });

  it("is idempotent: normalising a normalised state changes nothing", () => {
    const once = v2();
    const twice = D.normalizeState(once);
    assert.ok(D.isClean(twice));
    assert.deepEqual(twice.state, once);
  });
});

describe("conversion from PesaFlow v1", () => {
  it("converts cleanly, keeping every category and transaction exactly", () => {
    const legacy = legacyState();
    const r = D.normalizeState(legacy);
    assert.ok(D.isClean(r));
    assert.equal(r.format, "pesaflow-v1");
    assert.deepEqual(r.fixed, []);
    assert.deepEqual(r.state.categories, legacy.categories);
    assert.deepEqual(r.state.transactions, legacy.transactions);
    assert.equal(r.state.openingBalance, 20000);
    assert.equal(r.state.payday, "2026-12-01");
    assert.equal(r.state.month, "2026-11");
  });

  it("adds KCB M-PESA and M-Shwari as savings destinations", () => {
    const r = D.normalizeState(legacyState());
    assert.deepEqual(r.state.savingsDestinations.map(d => d.name), ["KCB M-PESA", "M-Shwari"]);
    assert.ok(has(r.notes, "KCB M-PESA and M-Shwari"));
  });

  it("produces identical totals before and after (approved calculations unchanged)", () => {
    const legacy = legacyState();
    const { destinationBalances, ...after } = computeTotals(D.normalizeState(legacy).state);
    const { destinationBalances: none, ...before } = computeTotals(legacy);
    assert.deepEqual(after, before);
    assert.deepEqual(none, {});
    assert.deepEqual(destinationBalances, { "kcb-mpesa": 0, "m-shwari": 0 }, "new destinations start at zero");
  });
});

describe("restore checks: unusable files are refused", () => {
  const refused = (text, message) => {
    const r = D.analyzeBackup(text);
    assert.equal(r.ok, false);
    assert.equal(r.state, null);
    if (message) assert.ok(has(r.errors, message), r.errors.join(" | "));
  };
  it("empty file", () => refused("   ", "empty"));
  it("not JSON", () => refused("{ this is not json", "couldn't be read"));
  it("JSON that isn't budget data", () => { refused("[1,2,3]"); refused('"hello"'); refused("null"); refused("{}", "recognised"); });
  it("a newer, unknown version", () => refused(backup({ ...v2(), version: 3 }), "newer version"));
  it("missing categories or transactions", () => {
    const a = legacyState(); delete a.categories; refused(backup(a), "categories");
    const b = legacyState(); b.transactions = "oops"; refused(backup(b), "transaction list");
  });
  it("invalid opening balance (negative, decimal, words)", () => {
    for (const v of [-100, 99.5, "lots"]) refused(backup({ ...legacyState(), openingBalance: v }), "opening balance");
  });
  it("damaged or duplicate budget categories", () => {
    const a = legacyState(); a.categories.push({ ...a.categories[0], name: "Food again" }); refused(backup(a), "same ID");
    const b = legacyState(); b.categories[0].budget = -5; refused(backup(b), "allocation");
    const c = legacyState(); c.categories[0].id = "__proto__"; refused(backup(c), "invalid ID");
  });
  it("files larger than 5 MB", () => refused("x".repeat(D.MAX_BACKUP_CHARS + 1), "too large"));
});

describe("restore checks: KI-01 and KI-02 (text numbers)", () => {
  it("KI-01: a text opening balance is read as a number, never concatenated", () => {
    const r = D.analyzeBackup(backup({ ...legacyState(), openingBalance: "20000" }));
    assert.ok(D.isClean(r));
    assert.equal(r.state.openingBalance, 20000);
    assert.equal(computeTotals(r.state).cash, 20000 + 3000 - 500 - 700 - 1200); // 20,600 — not 206,000
    assert.ok(has(r.fixed, "Opening balance was stored as text"));
  });

  it("KI-02: text amounts are read as numbers; totals stay numeric", () => {
    const s = legacyState();
    s.transactions[0].amount = "500";
    s.transactions[2].amount = "700";
    const r = D.analyzeBackup(backup(s));
    assert.ok(D.isClean(r));
    const t = computeTotals(r.state);
    assert.equal(typeof t.spent, "number");
    assert.equal(t.spent, 2400);
    assert.equal(r.fixed.filter(m => m.includes("amount stored as text")).length, 2);
  });
});

describe("restore checks: KI-03 (bad and duplicate transactions)", () => {
  const withRow = (row) => { const s = legacyState(); s.transactions.push(row); return D.analyzeBackup(backup(s)); };
  const row = (extra) => ({ id: "new-1", type: "expense", amount: 100, categoryId: "food", date: "2026-11-05", note: "x", createdAt: 1, ...extra });

  it("negative, zero, decimal and non-numeric amounts are left out and listed", () => {
    for (const amount of [-5000, 0, 12.5, "abc", null]) {
      const r = withRow(row({ amount }));
      assert.equal(r.ok, true);
      assert.equal(r.state.transactions.length, 4, `amount ${amount} was kept`);
      assert.equal(r.rejected.length, 1);
      assert.equal(D.isClean(r), false, "a lossy restore is never 'clean'");
    }
  });

  it("a negative expense can no longer raise cash", () => {
    const r = withRow(row({ amount: -5000 }));
    assert.equal(computeTotals(r.state).cash, computeTotals(legacyState()).cash);
  });

  it("unknown types, savings entries without a valid destination, and deferred adjustments are left out with a clear reason", () => {
    assert.ok(has(withRow(row({ type: "transfer" })).rejected, "unknown type"));
    assert.ok(has(withRow(row({ type: "savings_transfer" })).rejected, "savings destination that doesn't exist"));
    assert.ok(has(withRow(row({ type: "savings_withdrawal", destinationId: "nowhere" })).rejected, "savings destination that doesn't exist"));
    assert.ok(has(withRow(row({ type: "savings_adjustment", destinationId: "m-shwari" })).rejected, "can't use yet"));
  });

  it("an exact duplicate (same ID, same details) is removed so it isn't counted twice", () => {
    const s = legacyState();
    s.transactions.push({ ...s.transactions[0] });
    const r = D.analyzeBackup(backup(s));
    assert.ok(D.isClean(r), "removing an exact copy loses nothing");
    assert.equal(r.state.transactions.length, 4);
    assert.equal(computeTotals(r.state).spent, 2400);
    assert.ok(has(r.fixed, "exact duplicate"));
  });

  it("a conflicting duplicate (same ID, different details) keeps the first and lists the second", () => {
    const s = legacyState();
    s.transactions.push({ ...s.transactions[0], amount: 9999 });
    const r = D.analyzeBackup(backup(s));
    assert.equal(r.state.transactions.length, 4);
    assert.equal(r.state.transactions[0].amount, 500);
    assert.ok(has(r.rejected, "shares an ID"));
  });

  it("identical-looking entries with different IDs are kept, with a warning", () => {
    const s = legacyState();
    s.transactions.push({ ...s.transactions[0], id: "another-id" });
    const r = D.analyzeBackup(backup(s));
    assert.ok(D.isClean(r));
    assert.equal(r.state.transactions.length, 5);
    assert.ok(has(r.warnings, "look identical"));
  });

  it("a transaction pointing at a deleted category is kept, with a warning", () => {
    const r = withRow(row({ categoryId: "deleted-cat" }));
    assert.ok(D.isClean(r));
    assert.ok(has(r.warnings, "doesn't exist"));
  });

  it("unsafe IDs are left out", () => {
    assert.ok(has(withRow(row({ id: "__proto__" })).rejected, "invalid ID"));
    assert.ok(has(withRow(row({ categoryId: "__proto__" })).rejected, "invalid category"));
  });
});

describe("restore checks: KI-04 (dates)", () => {
  it("missing, impossible or wrongly formatted dates are left out", () => {
    for (const date of [undefined, "", "2026-02-30", "5/11/2026", 20261105]) {
      const s = legacyState();
      s.transactions[1].date = date;
      const r = D.analyzeBackup(backup(s));
      assert.equal(r.state.transactions.length, 3, `date ${date} was kept`);
      assert.ok(r.state.transactions.every(t => V.isValidISODate(t.date)));
    }
  });

  it("an invalid payday is cleared (listed), not kept", () => {
    const r = D.analyzeBackup(backup({ ...legacyState(), payday: "2026-02-30" }));
    assert.equal(r.state.payday, "");
    assert.ok(has(r.rejected, "Payday"));
  });
});

describe("restore checks: preview summary and round trip", () => {
  it("summarises what the backup contains", () => {
    const r = D.analyzeBackup(backup(legacyState()));
    assert.deepEqual(r.summary, {
      openingBalance: 20000, payday: "2026-12-01", categoryCount: 5, transactionCount: 4,
      incomeCount: 1, expenseCount: 3, savingsCount: 0, incomeTotal: 3000, expenseTotal: 2400, cash: 20600,
      totalSavings: 0, firstDate: "2026-11-03", lastDate: "2026-11-05", destinations: ["KCB M-PESA", "M-Shwari"]
    });
  });

  it("export → restore gives back identical data and identical totals", () => {
    const original = v2();
    original.savingsDestinations[0].openingBalance = 2500;
    const r = D.analyzeBackup(D.serializeBackup(original));
    assert.ok(D.isClean(r));
    assert.equal(r.format, "pesaotas-v2");
    assert.deepEqual(r.state, original);
    assert.deepEqual(computeTotals(r.state), computeTotals(original));
  });

  it("gives the same result every time for the same file", () => {
    const text = backup({ ...legacyState(), openingBalance: "20000" });
    assert.deepEqual(D.analyzeBackup(text), D.analyzeBackup(text));
  });
});

// ---------------------------------------------------------------------------
// Phase 2: savings entries, allocation links, category types, income sources
// ---------------------------------------------------------------------------
const withSavings = () => {
  const s = v2();
  s.categories.find(c => c.id === "emergency").destinationId = "m-shwari";
  s.savingsDestinations[1].openingBalance = 10000;
  s.transactions.push(
    { id: "s1", type: "savings_transfer", amount: 2000, destinationId: "m-shwari", date: "2026-11-05", note: "Monthly saving", createdAt: 5 },
    { id: "s2", type: "savings_withdrawal", amount: 500, destinationId: "kcb-mpesa", date: "2026-11-05", note: "", createdAt: 6 }
  );
  s.savingsDestinations[0].openingBalance = 1000;
  return s;
};

describe("Phase 2: savings entries in the data model", () => {
  it("accepts transfers and withdrawals with a valid destination, stored without a spending category", () => {
    const r = D.normalizeState(withSavings());
    assert.ok(D.isClean(r), [...r.errors, ...r.rejected].join(" | "));
    const s1 = r.state.transactions.find(t => t.id === "s1");
    assert.deepEqual(Object.keys(s1).sort(), ["amount", "createdAt", "date", "destinationId", "id", "note", "type"]);
  });

  it("keeps a Savings category's link to its destination", () => {
    const r = D.normalizeState(withSavings());
    assert.equal(r.state.categories.find(c => c.id === "emergency").destinationId, "m-shwari");
  });

  it("refuses a link on a non-Savings category, to a missing destination, or two categories on one destination", () => {
    const a = withSavings(); a.categories.find(c => c.id === "food").destinationId = "kcb-mpesa";
    assert.ok(has(D.normalizeState(a).errors, "not a Savings category"));
    const b = withSavings(); b.categories.find(c => c.id === "emergency").destinationId = "nowhere";
    assert.ok(has(D.normalizeState(b).errors, "doesn't exist"));
    const c = withSavings(); c.categories.push({ id: "second", name: "Second pot", budget: 100, kind: "Savings", destinationId: "m-shwari" });
    assert.ok(has(D.normalizeState(c).errors, "only one category"));
  });

  it("warns (but keeps the data) when withdrawals exceed what a destination ever held", () => {
    const s = withSavings();
    s.transactions.push({ id: "s3", type: "savings_withdrawal", amount: 5000, destinationId: "kcb-mpesa", date: "2026-11-05", note: "", createdAt: 7 });
    const r = D.normalizeState(s);
    assert.ok(D.isClean(r));
    assert.ok(has(r.warnings, "KCB M-PESA would show −KSh 4,500"), r.warnings.join(" | "));
  });

  it("an exact duplicate savings transfer is removed so it isn't counted twice", () => {
    const s = withSavings(); s.transactions.push({ ...s.transactions.find(t => t.id === "s1") });
    const r = D.normalizeState(s);
    assert.equal(r.state.transactions.filter(t => t.id === "s1").length, 1);
    assert.equal(computeTotals(r.state).destinationBalances["m-shwari"], 12000);
  });

  it("backup round trip keeps savings entries, links and balances exactly", () => {
    const original = D.normalizeState(withSavings()).state;
    const r = D.analyzeBackup(D.serializeBackup(original));
    assert.deepEqual(r.state, original);
    assert.equal(r.summary.savingsCount, 2);
    assert.equal(r.summary.totalSavings, 12000 + 500);
  });

  it("data saved by v1.1.0 (no savings yet) is still valid and loads unchanged", () => {
    const phase1 = v2();
    const r = D.normalizeState(JSON.parse(JSON.stringify(phase1)));
    assert.ok(D.isClean(r));
    assert.deepEqual(r.fixed, []);
    assert.deepEqual(r.state, phase1);
  });
});

describe("Phase 2: category types come from a fixed list (KI-07)", () => {
  const typeOf = (kind) => { const s = v2(); s.categories[0].kind = kind; const r = D.normalizeState(s); return [r.state.categories[0].kind, r.fixed]; };
  it("standard types are kept as written", () => {
    for (const t of D.CATEGORY_TYPES) assert.deepEqual(typeOf(t), [t, []]);
  });
  it("any capitalisation or spacing is read as the standard type and reported", () => {
    const [kind, fixed] = typeOf("  flexible ");
    assert.equal(kind, "Flexible");
    assert.ok(has(fixed, 'read as "Flexible"'));
  });
  it("non-standard or missing types become 'Other' and are reported", () => {
    assert.equal(typeOf("Fun")[0], "Other");
    assert.ok(has(typeOf("Fun")[1], "isn't one of the standard types"));
    assert.equal(typeOf(undefined)[0], "Other");
  });
});

describe("Phase 2: income sources (KI-10)", () => {
  it("offers a separate list of income sources", () => {
    assert.deepEqual(D.INCOME_SOURCES.map(s => s.name), ["Salary", "Business", "Side income", "Gift received", "Refund", "Other income"]);
  });
  it("income tagged with an income source, or with a category by older versions, is accepted without warnings", () => {
    const s = v2();
    s.transactions.push({ id: "i1", type: "income", amount: 50000, categoryId: "inc-salary", date: "2026-11-01", note: "Salary", createdAt: 9 });
    const r = D.normalizeState(s);
    assert.ok(D.isClean(r));
    assert.deepEqual(r.warnings, []);
  });
  it("income with no category is set to 'Other income'", () => {
    const s = v2(); delete s.transactions[1].categoryId;
    assert.equal(D.normalizeState(s).state.transactions[1].categoryId, "inc-other");
  });
});
