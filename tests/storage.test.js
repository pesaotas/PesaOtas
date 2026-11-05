/**
 * Tests for src/storage.js: PesaFlow → PesaOtas migration (including repeat
 * launches and failures), corrupted storage, verified saving, and safety copies.
 */
"use strict";
process.env.TZ = "Africa/Nairobi";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/storage.js");
const D = require("../src/data-model.js");
const { computeTotals } = require("../src/finance.js");
const { FakeStorage } = require("./helpers/fake-storage.js");
const { legacyState, legacyRaw } = require("./helpers/legacy.js");

const { KEYS } = S;
const NOW = new Date("2026-11-05T19:30:00+03:00");
const LATER = new Date("2026-11-06T08:00:00+03:00");
const list = (store, key) => JSON.parse(store.getItem(key) || "[]");

describe("migration from PesaFlow", () => {
  it("moves the data, verifies it, and keeps every transaction and total identical", () => {
    const store = new FakeStorage({ [KEYS.legacy]: legacyRaw() });
    const res = S.load(store, NOW);
    assert.equal(res.status, "migrated");
    const { destinationBalances, ...after } = computeTotals(res.state);
    const { destinationBalances: _none, ...before } = computeTotals(legacyState());
    assert.deepEqual(after, before);
    assert.deepEqual(destinationBalances, { "kcb-mpesa": 0, "m-shwari": 0 });
    assert.deepEqual(res.state.transactions, legacyState().transactions);
    const saved = JSON.parse(store.getItem(KEYS.current));
    assert.deepEqual(saved, res.state);
    assert.equal(saved.version, 2);
    assert.deepEqual(saved.meta.migratedFrom, { key: KEYS.legacy, migratedAt: NOW.toISOString() });
  });

  it("includes KCB M-PESA and M-Shwari as savings destinations", () => {
    const store = new FakeStorage({ [KEYS.legacy]: legacyRaw() });
    const res = S.load(store, NOW);
    assert.deepEqual(res.state.savingsDestinations.map(d => d.name), ["KCB M-PESA", "M-Shwari"]);
  });

  it("never changes or deletes the original PesaFlow data", () => {
    const raw = legacyRaw();
    const store = new FakeStorage({ [KEYS.legacy]: raw });
    S.load(store, NOW);
    assert.equal(store.getItem(KEYS.legacy), raw);
    assert.ok(!store.writes.some(([k]) => k === KEYS.legacy), "the PesaFlow key was written to");
  });

  it("saves a preserved copy of the original text BEFORE writing PesaOtas data", () => {
    const raw = legacyRaw();
    const store = new FakeStorage({ [KEYS.legacy]: raw });
    S.load(store, NOW);
    const order = store.writes.map(([k]) => k);
    assert.ok(order.indexOf(KEYS.preserved) < order.indexOf(KEYS.current), `write order: ${order.join(", ")}`);
    const preserved = list(store, KEYS.preserved);
    assert.equal(preserved.length, 1);
    assert.equal(preserved[0].raw, raw);
    assert.equal(S.getRecoveryText(store, "preserved", 0), raw);
  });
});

describe("migration is idempotent (repeat launches)", () => {
  it("a second launch loads PesaOtas data and migrates nothing", () => {
    const store = new FakeStorage({ [KEYS.legacy]: legacyRaw() });
    const first = S.load(store, NOW);
    const afterFirst = store.snapshot();
    const writesAfterFirst = store.writes.length;
    const second = S.load(store, LATER);
    assert.equal(second.status, "ok");
    assert.deepEqual(second.state, first.state);
    assert.deepEqual(store.snapshot(), afterFirst, "storage changed on the second launch");
    assert.equal(store.writes.length, writesAfterFirst, "the second launch wrote something");
  });

  it("ten launches: still one copy of each transaction and one preserved snapshot", () => {
    const store = new FakeStorage({ [KEYS.legacy]: legacyRaw() });
    for (let i = 0; i < 10; i++) S.load(store, NOW);
    const saved = JSON.parse(store.getItem(KEYS.current));
    assert.equal(saved.transactions.length, 4);
    assert.equal(new Set(saved.transactions.map(t => t.id)).size, 4);
    assert.equal(list(store, KEYS.preserved).length, 1);
  });

  it("after the user adds a transaction, relaunching keeps it and never re-imports PesaFlow data", () => {
    const store = new FakeStorage({ [KEYS.legacy]: legacyRaw() });
    const { state } = S.load(store, NOW);
    state.transactions.push({ id: "new-1", type: "expense", amount: 250, categoryId: "food", date: "2026-11-06", note: "Tea", createdAt: 2 });
    assert.ok(S.save(store, state).ok);
    const again = S.load(store, LATER);
    assert.equal(again.status, "ok");
    assert.equal(again.state.transactions.length, 5);
    assert.equal(again.state.transactions.filter(t => t.id === "new-1").length, 1);
  });

  it("a failed migration leaves nothing half-written, and the next launch retries successfully", () => {
    const store = new FakeStorage({ [KEYS.legacy]: legacyRaw() });
    store.failWrites.add(KEYS.current);
    const failed = S.load(store, NOW);
    assert.equal(failed.status, "migration-failed");
    assert.equal(failed.reason, "storage-full");
    assert.equal(store.getItem(KEYS.current), null);
    assert.equal(store.getItem(KEYS.legacy), legacyRaw());
    store.failWrites.clear();
    const retry = S.load(store, LATER);
    assert.equal(retry.status, "migrated");
    assert.equal(list(store, KEYS.preserved).length, 1, "the preserved copy was duplicated on retry");
  });
});

describe("migration failures never lose data", () => {
  it("if the preserved copy can't be saved, migration does not proceed", () => {
    const store = new FakeStorage({ [KEYS.legacy]: legacyRaw() });
    store.failWrites.add(KEYS.preserved);
    const res = S.load(store, NOW);
    assert.equal(res.status, "migration-failed");
    assert.equal(res.reason, "preserve-failed");
    assert.equal(store.getItem(KEYS.current), null, "PesaOtas data was written without a preserved copy");
    assert.equal(store.getItem(KEYS.legacy), legacyRaw());
    assert.equal(res.state.transactions.length, 4, "the converted data is still available to view");
  });

  it("if the saved copy reads back differently, it is discarded and the original is untouched", () => {
    const store = new FakeStorage({ [KEYS.legacy]: legacyRaw() });
    store.corruptWrites.add(KEYS.current);
    const res = S.load(store, NOW);
    assert.equal(res.status, "migration-failed");
    assert.equal(res.reason, "readback-mismatch");
    assert.equal(store.getItem(KEYS.current), null);
    assert.equal(store.getItem(KEYS.legacy), legacyRaw());
  });

  it("PesaFlow data with problems is quarantined, not migrated, and the original is untouched", () => {
    const bad = legacyState();
    bad.transactions[0].amount = -5000;
    const raw = JSON.stringify(bad);
    const store = new FakeStorage({ [KEYS.legacy]: raw });
    const res = S.load(store, NOW);
    assert.equal(res.status, "corrupt");
    assert.equal(res.sourceKey, KEYS.legacy);
    assert.equal(res.report.state.transactions.length, 3, "the valid rows are offered for recovery");
    assert.equal(store.getItem(KEYS.current), null);
    assert.equal(store.getItem(KEYS.legacy), raw);
    assert.equal(list(store, KEYS.quarantine)[0].raw, raw);
    assert.equal(list(store, KEYS.preserved)[0].raw, raw);
  });

  it("text numbers in PesaFlow data (from an earlier bad restore) are converted, not concatenated", () => {
    const s = legacyState();
    s.openingBalance = "20000";
    s.transactions[0].amount = "500";
    const store = new FakeStorage({ [KEYS.legacy]: JSON.stringify(s) });
    const res = S.load(store, NOW);
    assert.equal(res.status, "migrated");
    assert.equal(computeTotals(res.state).cash, 20600);
    assert.ok(res.report.fixed.length >= 2);
  });

  it("browser storage that can't be read at all is reported, not replaced", () => {
    const store = new FakeStorage({ [KEYS.legacy]: legacyRaw() });
    store.blocked = true;
    assert.equal(S.load(store, NOW).status, "unavailable");
  });
});

describe("corrupted storage (KI-05)", () => {
  it("unreadable PesaOtas data is quarantined and left in place — never replaced with demo or blank data", () => {
    const raw = '{"app":"PesaOtas","version":2,"openingBal';
    const store = new FakeStorage({ [KEYS.current]: raw });
    const res = S.load(store, NOW);
    assert.equal(res.status, "corrupt");
    assert.equal(res.state, undefined, "no replacement state was supplied");
    assert.equal(res.quarantined, true);
    assert.equal(store.getItem(KEYS.current), raw, "the damaged data was overwritten");
    assert.equal(list(store, KEYS.quarantine)[0].raw, raw);
    assert.equal(S.getRecoveryText(store, "quarantine", 0), raw);
  });

  it("PesaOtas data with invalid rows offers the valid rows for recovery", () => {
    const good = D.normalizeState(legacyState()).state;
    good.transactions[1].date = "2026-02-30";
    const store = new FakeStorage({ [KEYS.current]: JSON.stringify(good) });
    const res = S.load(store, NOW);
    assert.equal(res.status, "corrupt");
    assert.equal(res.report.ok, true);
    assert.equal(res.report.state.transactions.length, 3);
    assert.equal(res.report.rejected.length, 1);
  });

  it("damaged PesaOtas data is NOT silently replaced by older PesaFlow data", () => {
    const store = new FakeStorage({ [KEYS.current]: "garbage", [KEYS.legacy]: legacyRaw() });
    const res = S.load(store, NOW);
    assert.equal(res.status, "corrupt");
    assert.equal(res.sourceKey, KEYS.current);
    assert.equal(store.getItem(KEYS.current), "garbage");
  });

  it("reopening with the same damaged data does not add duplicate quarantine copies", () => {
    const store = new FakeStorage({ [KEYS.current]: "garbage" });
    for (let i = 0; i < 5; i++) S.load(store, NOW);
    assert.equal(list(store, KEYS.quarantine).length, 1);
  });

  it("different damaged versions are each kept", () => {
    const store = new FakeStorage({ [KEYS.current]: "garbage-1" });
    S.load(store, NOW);
    store.map.set(KEYS.current, "garbage-2");
    S.load(store, LATER);
    assert.deepEqual(list(store, KEYS.quarantine).map(q => q.raw), ["garbage-1", "garbage-2"]);
  });

  it("if quarantine can't be written, that is reported and the data stays where it was", () => {
    const store = new FakeStorage({ [KEYS.current]: "garbage" });
    store.failWrites.add(KEYS.quarantine);
    const res = S.load(store, NOW);
    assert.equal(res.status, "corrupt");
    assert.equal(res.quarantined, false);
    assert.equal(store.getItem(KEYS.current), "garbage");
  });

  it("a damaged quarantine list is never overwritten", () => {
    const store = new FakeStorage({ [KEYS.current]: "garbage", [KEYS.quarantine]: "not-a-list" });
    const res = S.load(store, NOW);
    assert.equal(res.quarantined, false);
    assert.equal(store.getItem(KEYS.quarantine), "not-a-list");
    assert.deepEqual(S.listRecovery(store).damagedLists, [KEYS.quarantine]);
  });
});

describe("first launch", () => {
  it("with no saved data, reports 'new' and writes nothing", () => {
    const store = new FakeStorage();
    assert.equal(S.load(store, NOW).status, "new");
    assert.equal(store.writes.length, 0);
  });
});

describe("saving", () => {
  it("saves valid data and verifies it by reading it back", () => {
    const store = new FakeStorage();
    const state = D.createBlankState();
    const res = S.save(store, state);
    assert.ok(res.ok);
    assert.deepEqual(JSON.parse(store.getItem(KEYS.current)), state);
  });

  it("refuses to save invalid data, leaving the stored copy unchanged", () => {
    const store = new FakeStorage();
    const state = D.normalizeState(legacyState()).state;
    assert.ok(S.save(store, state).ok);
    const before = store.getItem(KEYS.current);
    state.transactions.push({ id: "bad", type: "expense", amount: -1, categoryId: "food", date: "2026-11-05", note: "", createdAt: 0 });
    const res = S.save(store, state);
    assert.equal(res.ok, false);
    assert.equal(res.reason, "invalid");
    assert.equal(store.getItem(KEYS.current), before);
  });

  it("reports a full or failing store instead of pretending to save", () => {
    const store = new FakeStorage();
    store.failWrites.add(KEYS.current);
    assert.deepEqual(S.save(store, D.createBlankState()), { ok: false, reason: "storage-full" });
    store.failWrites.clear();
    store.corruptWrites.add(KEYS.current);
    assert.equal(S.save(store, D.createBlankState()).reason, "readback-mismatch");
  });
});

describe("restore safety copy", () => {
  it("keeps a copy of current data before a restore replaces it", () => {
    const store = new FakeStorage();
    const state = D.normalizeState(legacyState()).state;
    S.save(store, state);
    const before = store.getItem(KEYS.current);
    assert.ok(S.keepPreRestoreCopy(store, NOW));
    S.save(store, D.createBlankState());
    assert.equal(S.getRecoveryText(store, "preRestore"), before);
    assert.equal(S.listRecovery(store).preRestore.savedAt, NOW.toISOString());
  });

  it("reports failure if the copy can't be made", () => {
    const store = new FakeStorage();
    S.save(store, D.createBlankState());
    store.failWrites.add(KEYS.preRestore);
    assert.equal(S.keepPreRestoreCopy(store, NOW), false);
  });
});

describe("recovery listing", () => {
  it("lists the original PesaFlow data, preserved copies and quarantine after migration and corruption", () => {
    const store = new FakeStorage({ [KEYS.legacy]: legacyRaw() });
    S.load(store, NOW);
    store.map.set(KEYS.current, "garbage");
    S.load(store, LATER);
    const r = S.listRecovery(store);
    assert.equal(r.legacyPresent, true);
    assert.equal(r.preserved.length, 1);
    assert.equal(r.quarantine.length, 1);
    assert.equal(S.getRecoveryText(store, "legacy"), legacyRaw());
  });
});
