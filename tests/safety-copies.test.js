/**
 * Managing safety copies and device notes (Phase 5, decision D-15).
 * Nothing is ever deleted automatically; a deletion needs the exact copy the
 * user saw, healthy current data, and — for the only copy on this device —
 * confirmation that it was downloaded first. Other data is never touched.
 */
"use strict";
process.env.TZ = "Africa/Nairobi";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/storage.js");
const D = require("../src/data-model.js");
const { FakeStorage } = require("./helpers/fake-storage.js");
const { legacyRaw } = require("./helpers/legacy.js");
const fixtures = require("./fixtures.js");
const { expense } = fixtures;
// A valid PesaOtas (schema v2) state built from the neutral fixture.
const baseState = () => ({ ...fixtures.baseState(), version: 2, app: D.APP_ID });

const { KEYS } = S;
const NOW = new Date("2026-11-05T19:30:00+03:00");
const raw = (store, kind, i = 0) => S.getRecoveryText(store, kind, i);
const find = (inv, kind, i = 0) => inv.items.find(x => x.kind === kind && x.index === i);
const without = (snap, key) => { const c = { ...snap }; delete c[key]; return c; };

function migratedStore() {
  const store = new FakeStorage({ [KEYS.legacy]: legacyRaw() });
  assert.equal(S.load(store, NOW).status, "migrated");
  return store;
}
function savedStore(extra = {}) {
  const store = new FakeStorage(extra);
  assert.ok(S.save(store, baseState()).ok);
  return store;
}
const quarantineEntry = (text, at) => ({ quarantinedAt: at, sourceKey: KEYS.current, reason: "test", raw: text });

describe("listing safety copies", () => {
  it("counts identical copies, so the PesaFlow original and its preserved copy back each other up", () => {
    const store = migratedStore();
    const inv = S.recoveryInventory(store);
    assert.equal(inv.currentSafe, true);
    assert.deepEqual(inv.items.map(i => [i.kind, i.copies, i.onlyCopy]), [["legacy", 1, false], ["preserved", 1, false]]);
    assert.equal(find(inv, "preserved").at, NOW.toISOString());
    assert.equal(find(inv, "legacy").size, legacyRaw().length);
  });

  it("counts the current data as a copy when a safety copy is identical to it", () => {
    const store = savedStore();
    assert.ok(S.keepPreRestoreCopy(store, NOW));
    assert.equal(find(S.recoveryInventory(store), "preRestore").copies, 1);
    assert.ok(S.save(store, { ...baseState(), transactions: [expense(100, "food")] }).ok);
    assert.equal(find(S.recoveryInventory(store), "preRestore").onlyCopy, true);
  });

  it("reports damaged lists and unreadable storage without throwing", () => {
    const store = savedStore({ [KEYS.quarantine]: "{not json" });
    assert.deepEqual(S.recoveryInventory(store).damagedLists, [KEYS.quarantine]);
    store.blocked = true;
    assert.deepEqual(S.recoveryInventory(store).items, []);
    assert.equal(S.recoveryInventory(store).currentSafe, false);
  });
});

describe("deleting a safety copy", () => {
  it("deletes a copy that has an identical twin, touching nothing else", () => {
    const store = migratedStore();
    const before = store.snapshot();
    const result = S.deleteRecoveryItem(store, "preserved", 0, raw(store, "preserved"));
    assert.deepEqual(result, { ok: true });
    assert.equal(store.getItem(KEYS.preserved), null, "an emptied list is removed");
    assert.deepEqual(store.snapshot(), without(before, KEYS.preserved));
  });

  it("won't delete the only copy unless the user has downloaded it first", () => {
    const store = migratedStore();
    S.deleteRecoveryItem(store, "preserved", 0, raw(store, "preserved"));
    assert.equal(find(S.recoveryInventory(store), "legacy").onlyCopy, true);
    const before = store.snapshot();
    for (const opts of [undefined, {}, { acknowledgedOnlyCopy: "yes" }, { acknowledgedOnlyCopy: false }]) {
      assert.deepEqual(S.deleteRecoveryItem(store, "legacy", 0, legacyRaw(), opts), { ok: false, reason: "only-copy" });
    }
    assert.deepEqual(store.snapshot(), before);
    assert.deepEqual(S.deleteRecoveryItem(store, "legacy", 0, legacyRaw(), { acknowledgedOnlyCopy: true }), { ok: true });
    assert.equal(store.getItem(KEYS.legacy), null);
    assert.deepEqual(store.snapshot(), without(before, KEYS.legacy));
  });

  it("keeps the migrated data and never migrates again after the PesaFlow data is deleted", () => {
    const store = migratedStore();
    const current = store.getItem(KEYS.current);
    S.deleteRecoveryItem(store, "preserved", 0, raw(store, "preserved"));
    S.deleteRecoveryItem(store, "legacy", 0, legacyRaw(), { acknowledgedOnlyCopy: true });
    const again = S.load(store, NOW);
    assert.equal(again.status, "ok");
    assert.equal(store.getItem(KEYS.current), current);
    assert.equal(store.getItem(KEYS.preserved), null, "nothing re-created");
  });

  it("refuses when the copy isn't the one the user was shown (for example another tab changed the list)", () => {
    const store = savedStore({ [KEYS.quarantine]: JSON.stringify([quarantineEntry("first", "a"), quarantineEntry("second", "b")]) });
    const before = store.snapshot();
    assert.deepEqual(S.deleteRecoveryItem(store, "quarantine", 0, "second", { acknowledgedOnlyCopy: true }), { ok: false, reason: "changed" });
    assert.deepEqual(S.deleteRecoveryItem(store, "quarantine", 0, undefined, { acknowledgedOnlyCopy: true }), { ok: false, reason: "changed" });
    assert.deepEqual(S.deleteRecoveryItem(store, "quarantine", 5, "first", { acknowledgedOnlyCopy: true }), { ok: false, reason: "missing" });
    assert.deepEqual(S.deleteRecoveryItem(store, "current", 0, store.getItem(KEYS.current), { acknowledgedOnlyCopy: true }), { ok: false, reason: "missing" });
    assert.deepEqual(store.snapshot(), before);
  });

  it("removes just the chosen entry from a list, keeping the others exactly", () => {
    const list = [quarantineEntry("first", "a"), quarantineEntry("second", "b"), quarantineEntry("third", "c")];
    const store = savedStore({ [KEYS.quarantine]: JSON.stringify(list) });
    assert.ok(S.deleteRecoveryItem(store, "quarantine", 1, "second", { acknowledgedOnlyCopy: true }).ok);
    assert.deepEqual(JSON.parse(store.getItem(KEYS.quarantine)), [list[0], list[2]]);
  });

  it("keeps every copy while the current data is missing or damaged — they may be all that's left", () => {
    const qList = JSON.stringify([quarantineEntry("old data", "a")]);
    for (const current of [undefined, "{broken", JSON.stringify({ version: 2, nonsense: true })]) {
      const store = new FakeStorage({ [KEYS.quarantine]: qList, [KEYS.legacy]: legacyRaw() });
      if (current !== undefined) store.setItem(KEYS.current, current);
      const before = store.snapshot();
      assert.equal(S.recoveryInventory(store).currentSafe, false);
      assert.deepEqual(S.deleteRecoveryItem(store, "quarantine", 0, "old data", { acknowledgedOnlyCopy: true }), { ok: false, reason: "current-not-safe" });
      assert.deepEqual(S.deleteRecoveryItem(store, "legacy", 0, legacyRaw(), { acknowledgedOnlyCopy: true }), { ok: false, reason: "current-not-safe" });
      assert.deepEqual(store.snapshot(), before);
    }
  });

  it("leaves a damaged safety list untouched", () => {
    const store = savedStore({ [KEYS.preserved]: "[{broken", [KEYS.preRestore]: "{broken" });
    assert.deepEqual(S.deleteRecoveryItem(store, "preserved", 0, "x", { acknowledgedOnlyCopy: true }), { ok: false, reason: "damaged-list" });
    assert.deepEqual(S.deleteRecoveryItem(store, "preRestore", 0, "x", { acknowledgedOnlyCopy: true }), { ok: false, reason: "damaged-list" });
    assert.equal(store.getItem(KEYS.preserved), "[{broken");
    assert.equal(store.getItem(KEYS.preRestore), "{broken");
  });

  it("reports a failed write and leaves the list as it was", () => {
    const list = [quarantineEntry("first", "a"), quarantineEntry("second", "b")];
    const store = savedStore({ [KEYS.quarantine]: JSON.stringify(list) });
    store.failWrites.add(KEYS.quarantine);
    assert.deepEqual(S.deleteRecoveryItem(store, "quarantine", 0, "first", { acknowledgedOnlyCopy: true }), { ok: false, reason: "write-failed" });
    assert.deepEqual(JSON.parse(store.getItem(KEYS.quarantine)), list);
    store.failWrites.clear();
    store.corruptWrites.add(KEYS.quarantine);
    assert.deepEqual(S.deleteRecoveryItem(store, "quarantine", 0, "first", { acknowledgedOnlyCopy: true }), { ok: false, reason: "write-failed" });
  });

  it("deletes the pre-restore copy", () => {
    const store = savedStore();
    S.keepPreRestoreCopy(store, NOW);
    assert.ok(S.save(store, { ...baseState(), transactions: [expense(100, "food")] }).ok);
    const current = store.getItem(KEYS.current);
    assert.ok(S.deleteRecoveryItem(store, "preRestore", 0, raw(store, "preRestore"), { acknowledgedOnlyCopy: true }).ok);
    assert.equal(store.getItem(KEYS.preRestore), null);
    assert.equal(store.getItem(KEYS.current), current);
  });

  it("is never called by loading, saving or migrating", () => {
    const store = migratedStore();
    for (let i = 0; i < 3; i++) { S.load(store, NOW); S.save(store, S.load(store, NOW).state); }
    assert.equal(store.getItem(KEYS.legacy), legacyRaw());
    assert.equal(S.recoveryInventory(store).items.length, 2);
  });
});

describe("device notes and space used", () => {
  it("stores only the known non-financial fields, with the right types", () => {
    const store = savedStore();
    const current = store.getItem(KEYS.current);
    assert.ok(S.updateDeviceInfo(store, { lastBackupAt: "2026-11-05T10:00:00.000Z", persistGranted: true, balance: 5000, persistAskedAt: 7 }));
    assert.deepEqual(S.readDeviceInfo(store), { lastBackupAt: "2026-11-05T10:00:00.000Z", persistGranted: true });
    assert.ok(S.updateDeviceInfo(store, { persistAskedAt: "2026-11-05T11:00:00.000Z" }));
    assert.deepEqual(Object.keys(S.readDeviceInfo(store)).sort(), ["lastBackupAt", "persistAskedAt", "persistGranted"]);
    assert.equal(store.getItem(KEYS.current), current);
  });

  it("ignores damaged notes and reports failures", () => {
    const store = new FakeStorage({ [KEYS.device]: "{bad" });
    assert.deepEqual(S.readDeviceInfo(store), {});
    store.failWrites.add(KEYS.device);
    assert.equal(S.updateDeviceInfo(store, { lastBackupAt: "x" }), false);
    store.blocked = true;
    assert.deepEqual(S.readDeviceInfo(store), {});
  });

  it("doesn't affect loading, and isn't part of backups or safety copies", () => {
    const store = new FakeStorage();
    S.updateDeviceInfo(store, { lastBackupAt: "2026-11-05T10:00:00.000Z" });
    assert.equal(S.load(store, NOW).status, "new");
    assert.ok(S.save(store, baseState()).ok);
    assert.doesNotMatch(D.serializeBackup(S.load(store, NOW).state), /lastBackupAt/);
    assert.deepEqual(S.recoveryInventory(store).items, []);
  });

  it("measures what PesaOtas keeps in browser storage", () => {
    const store = migratedStore();
    store.setItem("someone-else", "x".repeat(10000));
    const usage = S.storageUsage(store);
    const keys = [KEYS.current, KEYS.v15, KEYS.legacy, KEYS.preserved]; // v15 holds the "moved" marker (v1.6)
    const expected = keys.reduce((n, k) => n + k.length + store.getItem(k).length, 0);
    assert.equal(usage.total, expected);
    assert.deepEqual(Object.keys(usage.byKey).sort(), keys.sort());
  });
});
