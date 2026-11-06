/**
 * The Insights period preference (D-18): a per-device setting kept in
 * `pesaotas.device`, never in the budget data, backups or safety copies.
 * Fictional data only.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/storage.js");
const D = require("../src/data-model.js");
const I = require("../src/insights.js");
const { FakeStorage } = require("./helpers/fake-storage.js");
const { insightsState } = require("./helpers/insights-data.js");

const NOW = new Date("2026-11-06T10:00:00Z");
const TODAY = "2026-11-06";

/** A device with a saved v1.6 budget, as the app leaves it after the first save. */
function savedDevice() {
  const store = new FakeStorage();
  const state = insightsState();
  assert.ok(S.save(store, state).ok);
  return { store, state };
}
/** The period the app starts with, exactly as app.js chooses it. */
const startupPeriod = (store) => I.resolvePeriod(S.readDeviceInfo(store).insightsPeriod);
/** Every stored key except the device notes, with its exact text. */
const financialKeys = (store) => Object.fromEntries(Object.entries(store.snapshot()).filter(([k]) => k !== S.KEYS.device));

test("Insights period preference", async (t) => {
  await t.test("choosing a period saves it in the device notes only", () => {
    const { store } = savedDevice();
    const before = financialKeys(store);
    assert.ok(S.updateDeviceInfo(store, { insightsPeriod: "6m" }));
    assert.equal(JSON.parse(store.getItem(S.KEYS.device)).insightsPeriod, "6m");
    assert.deepEqual(financialKeys(store), before, "no other key was written or changed");
    assert.deepEqual(store.writes.slice(-1).map(([k]) => k), [S.KEYS.device]);
  });

  await t.test("restarting the app restores the chosen period", () => {
    const { store } = savedDevice();
    for (const p of ["6m", "all", "30d"]) {
      S.updateDeviceInfo(store, { insightsPeriod: p });
      const reopened = new FakeStorage(store.snapshot()); // a fresh start on the same device
      assert.equal(startupPeriod(reopened), p);
      assert.ok(S.load(reopened, NOW).state, "the budget still loads normally");
    }
  });

  await t.test("other device notes are kept when the period changes, and the period survives their updates", () => {
    const { store } = savedDevice();
    S.updateDeviceInfo(store, { lastBackupAt: "2026-11-01T08:00:00.000Z", persistGranted: true });
    S.updateDeviceInfo(store, { insightsPeriod: "all" });
    S.updateDeviceInfo(store, { lastBackupAt: "2026-11-06T09:00:00.000Z" });
    assert.deepEqual(S.readDeviceInfo(store), { lastBackupAt: "2026-11-06T09:00:00.000Z", persistGranted: true, insightsPeriod: "all" });
  });

  await t.test("with no saved preference the default is Last 30 days", () => {
    assert.equal(I.DEFAULT_PERIOD, "30d");
    assert.equal(I.PERIODS[I.DEFAULT_PERIOD].label, "Last 30 days");
    assert.equal(startupPeriod(new FakeStorage()), "30d");
    assert.equal(startupPeriod(savedDevice().store), "30d");
  });

  await t.test("invalid, unsupported or damaged saved values fall back to Last 30 days", () => {
    const cases = [
      JSON.stringify({ insightsPeriod: "90d" }),
      JSON.stringify({ insightsPeriod: "" }),
      JSON.stringify({ insightsPeriod: "ALL" }),
      JSON.stringify({ insightsPeriod: "toString" }),   // an inherited property name, not a period
      JSON.stringify({ insightsPeriod: "__proto__" }),
      JSON.stringify({ insightsPeriod: "constructor" }),
      JSON.stringify({ insightsPeriod: 6 }),
      JSON.stringify({ insightsPeriod: null }),
      JSON.stringify({ insightsPeriod: ["6m"] }),
      JSON.stringify(["6m"]),
      "{not json",
      "null"
    ];
    for (const raw of cases) {
      const store = new FakeStorage({ [S.KEYS.device]: raw });
      assert.equal(startupPeriod(store), "30d", raw);
      // …and the figures use Last 30 days too, never a half-recognised period.
      assert.equal(I.periodRange(insightsState(), startupPeriod(store), TODAY).label, "Last 30 days");
    }
    for (const v of ["toString", "__proto__", "hasOwnProperty", 42, undefined, null, {}]) {
      assert.equal(I.resolvePeriod(v), "30d", String(v));
      assert.equal(I.periodRange(insightsState(), v, TODAY).id, "30d", String(v));
    }
    for (const p of ["30d", "6m", "all"]) assert.equal(I.resolvePeriod(p), p);
  });

  await t.test("a value of the wrong type is never saved", () => {
    const store = new FakeStorage();
    S.updateDeviceInfo(store, { insightsPeriod: 6 });
    S.updateDeviceInfo(store, { insightsPeriod: { id: "6m" } });
    assert.equal(S.readDeviceInfo(store).insightsPeriod, undefined);
  });

  await t.test("when storage is blocked, choosing a period fails quietly and the default is used", () => {
    const store = new FakeStorage();
    store.blocked = true;
    assert.equal(S.updateDeviceInfo(store, { insightsPeriod: "6m" }), false);
    assert.equal(startupPeriod(store), "30d");
  });

  await t.test("changing the period never changes transactions, balances, categories, budgets or other records", () => {
    const { store, state } = savedDevice();
    const raw = store.getItem(S.KEYS.current);
    const before = financialKeys(store);
    const figures = {};
    for (const p of ["30d", "6m", "all", "30d"]) {
      S.updateDeviceInfo(store, { insightsPeriod: p });
      figures[p] = I.summary(state, startupPeriod(store), TODAY); // what the screen shows
    }
    assert.equal(store.getItem(S.KEYS.current), raw, "the saved budget is byte-for-byte unchanged");
    assert.deepEqual(financialKeys(store), before, "no safety copy, marker or other key changed");
    const loaded = S.load(store, NOW).state;
    assert.deepEqual(loaded, D.normalizeState(JSON.parse(raw)).state);
    assert.equal(loaded.transactions.length, state.transactions.length);
    assert.deepEqual(loaded.categories, state.categories);
    assert.equal(loaded.openingBalance, state.openingBalance);
    assert.deepEqual(loaded.savingsDestinations, state.savingsDestinations);
  });

  await t.test("the preference is not in an ordinary backup, nor in the v1.5.0-compatible backup", () => {
    const { store, state } = savedDevice();
    S.updateDeviceInfo(store, { insightsPeriod: "all" });
    const loaded = S.load(store, NOW).state;
    const backup = D.serializeBackup(loaded);
    assert.doesNotMatch(backup, /insightsPeriod/);
    assert.equal(backup, D.serializeBackup(state), "the backup is the same whichever period is chosen");
    const v15 = D.toV15Backup(loaded);
    assert.ok(v15.ok);
    assert.doesNotMatch(v15.text, /insightsPeriod/);
    // Restoring that backup on another device brings no period with it.
    const other = new FakeStorage();
    assert.ok(S.save(other, D.analyzeBackup(backup).state).ok);
    assert.equal(startupPeriod(other), "30d");
  });

  await t.test("the preference is not in any safety copy (before restore, before currency change)", () => {
    const { store } = savedDevice();
    S.updateDeviceInfo(store, { insightsPeriod: "6m" });
    assert.ok(S.keepPreRestoreCopy(store, NOW));
    assert.ok(S.keepPreCurrencyCopy(store, NOW, "KES", "USD"));
    const copies = Object.entries(store.snapshot()).filter(([k]) => k !== S.KEYS.device && k !== S.KEYS.current && k !== S.KEYS.v15);
    assert.ok(copies.some(([k]) => k === S.KEYS.preRestore) && copies.some(([k]) => k === S.KEYS.preCurrency));
    for (const [k, v] of copies) assert.doesNotMatch(v, /insightsPeriod/, k);
    for (const [k, v] of Object.entries(store.snapshot())) if (k !== S.KEYS.device) assert.doesNotMatch(v, /insightsPeriod/, k);
  });

  await t.test("the preference is not part of the data format and leaves the v1.6 safeguards unchanged", () => {
    // Not a field of the budget: a blank budget and every normalised budget lack it.
    assert.ok(!("insightsPeriod" in D.createBlankState("KES")));
    assert.ok(!("insightsPeriod" in insightsState()));
    assert.ok(!Object.values(S.KEYS).some(k => /insight/i.test(k)), "no new storage key");
    assert.equal(S.KEYS.device, "pesaotas.device");
    // A budget file claiming to carry a period doesn't bring it into the budget.
    const withField = { ...JSON.parse(D.serializeBackup(insightsState())), insightsPeriod: "6m" };
    const r = D.normalizeState(withField);
    assert.ok(r.state && !("insightsPeriod" in r.state));
    // The format-v3 safeguards behave the same with a preference saved: version,
    // storage key, and the "moved" marker left for v1.5.0.
    const { store } = savedDevice();
    store.setItem(S.KEYS.v15, S.MOVED_MARKER);
    S.updateDeviceInfo(store, { insightsPeriod: "all" });
    const loaded = S.load(store, NOW);
    assert.equal(loaded.state.version, D.SCHEMA_VERSION);
    assert.equal(D.SCHEMA_VERSION, 3);
    assert.ok(S.isMovedMarker(store.getItem(S.KEYS.v15)));
    assert.equal(JSON.parse(store.getItem(S.KEYS.current)).version, 3);
    // The device notes are never read as a budget: damaged notes don't affect loading.
    const damaged = new FakeStorage(store.snapshot());
    damaged.setItem(S.KEYS.device, "{not json");
    assert.deepEqual(S.load(damaged, NOW).state, loaded.state);
  });
});
