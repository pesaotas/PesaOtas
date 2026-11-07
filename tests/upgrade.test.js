/**
 * The v1.5 → v1.6 upgrade and the storage-format safeguard (decision D-16),
 * with fictional data only.
 *
 *  - The upgrade copies the original first, writes and verifies v3 data, then
 *    leaves a "moved" marker that v1.5.0 refuses to open.
 *  - A failure at any step (including partial writes) loses nothing, says
 *    exactly what happened, and completes safely at a later launch.
 *  - Data saved later by an older version never replaces v1.6 data: the user
 *    chooses, and the other data is kept.
 *  - A stale tab can't overwrite newer data.
 *  - Currency changes keep their own verified copies.
 */
"use strict";
process.env.TZ = "Africa/Nairobi";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/storage.js");
const D = require("../src/data-model.js");
const { computeTotals } = require("../src/finance.js");
const { FakeStorage } = require("./helpers/fake-storage.js");
const { legacyRaw } = require("./helpers/legacy.js");
const { richState, richV15Raw, financial } = require("./helpers/v15-data.js");

const { KEYS, MOVED_MARKER } = S;
const NOW = new Date("2026-11-06T09:00:00+03:00");
const LATER = new Date("2026-11-07T09:00:00+03:00");
const list = (store, key) => JSON.parse(store.getItem(key) || "[]");
const v15Store = (extra = {}) => new FakeStorage({ [KEYS.v15]: richV15Raw(), ...extra });
const without = (snap, ...keys) => { const c = { ...snap }; keys.forEach(k => delete c[k]); return c; };
const ids = (s) => s.transactions.map(t => t.id);

function assertSameFinances(a, b) {
  assert.deepEqual(financial(a), financial(b));
  assert.deepEqual(computeTotals(a), computeTotals(b));
  assert.equal(new Set(ids(a)).size, ids(a).length, "no duplicated transactions");
}

describe("upgrading v1.5.0 data", () => {
  it("copies the original, writes verified v3 data, then leaves the moved marker", () => {
    const store = v15Store({ [KEYS.legacy]: legacyRaw(), [KEYS.preRestore]: JSON.stringify({ savedAt: "x", raw: "{}" }) });
    const before = store.snapshot();
    const r = S.load(store, NOW);
    assert.equal(r.status, "upgraded");
    // 1. the exact original, copied first
    assert.deepEqual(list(store, KEYS.preUpgrade).map(c => c.raw), [richV15Raw()]);
    assert.equal(list(store, KEYS.preUpgrade)[0].savedAt, NOW.toISOString());
    // 2. v3 data with every record unchanged
    const saved = JSON.parse(store.getItem(KEYS.current));
    assert.equal(saved.version, 3);
    assert.equal(saved.currency, "KES");
    assert.deepEqual(saved.meta.upgradedFrom, { version: 2, upgradedAt: NOW.toISOString() });
    assertSameFinances(saved, richState());
    assert.deepEqual(r.state, saved);
    assert.equal(r.raw, store.getItem(KEYS.current));
    // 3. the marker, which v1.5.0 refuses ("made by a newer version": its version is above 2)
    assert.equal(store.getItem(KEYS.v15), MOVED_MARKER);
    assert.ok(JSON.parse(MOVED_MARKER).version > D.PREVIOUS_SCHEMA_VERSION);
    // Order: copy → data → marker, and nothing else touched.
    assert.deepEqual(store.writes.map(w => w[0]), [KEYS.preUpgrade, KEYS.current, KEYS.v15]);
    assert.deepEqual(without(store.snapshot(), KEYS.preUpgrade, KEYS.current, KEYS.v15), without(before, KEYS.v15));
  });

  it("happens once: later launches change nothing and copy nothing again", () => {
    const store = v15Store();
    S.load(store, NOW);
    const after = store.snapshot(); const writes = store.writes.length;
    for (let i = 0; i < 3; i++) assert.equal(S.load(store, LATER).status, "ok");
    assert.deepEqual(store.snapshot(), after);
    assert.equal(store.writes.length, writes);
  });

  it("moves PesaFlow data straight to v3, leaves the original untouched, and blocks re-migration by v1.5.0", () => {
    const store = new FakeStorage({ [KEYS.legacy]: legacyRaw() });
    const r = S.load(store, NOW);
    assert.equal(r.status, "migrated");
    assert.equal(JSON.parse(store.getItem(KEYS.current)).version, 3);
    assert.equal(store.getItem(KEYS.legacy), legacyRaw());
    assert.equal(store.getItem(KEYS.v15), MOVED_MARKER);
  });

  it("a new user: nothing is written until the first save, which also leaves the marker", () => {
    const store = new FakeStorage();
    assert.equal(S.load(store, NOW).status, "new");
    assert.deepEqual(store.snapshot(), {});
    assert.ok(S.save(store, D.createBlankState("UGX"), { expectedRaw: null }).ok);
    assert.equal(store.getItem(KEYS.v15), MOVED_MARKER);
    assert.equal(S.load(store, NOW).state.currency, "UGX");
  });

  it("damaged v1.5.0 data goes through the usual recovery, and recovering doesn't cause a false 'two versions' warning", () => {
    const store = new FakeStorage({ [KEYS.v15]: "{damaged" });
    const r = S.load(store, NOW);
    assert.equal(r.status, "corrupt");
    assert.equal(r.sourceKey, KEYS.v15);
    assert.equal(store.getItem(KEYS.current), null);
    assert.ok(S.save(store, D.createBlankState(), { expectedRaw: null }).ok); // e.g. "Start with an empty budget"
    assert.equal(S.load(store, LATER).status, "ok");
    assert.equal(store.getItem(KEYS.v15), MOVED_MARKER);
    assert.ok(list(store, KEYS.quarantine).some(q => q.raw === "{damaged"), "the damaged data is still kept");
  });

  it("missing upgraded data is reported, not replaced by older data", () => {
    const store = new FakeStorage({ [KEYS.v15]: MOVED_MARKER, [KEYS.legacy]: legacyRaw() });
    const r = S.load(store, NOW);
    assert.equal(r.status, "corrupt");
    assert.ok(r.report.errors[0].includes("no longer in this browser"));
    assert.equal(store.getItem(KEYS.current), null, "the old PesaFlow data is not migrated in its place");
  });
});

describe("upgrade failures, step by step", () => {
  it("step 1 (copy) fails: nothing at all is changed, the data is shown read-only, and it completes later", () => {
    const store = v15Store();
    const before = store.snapshot();
    store.failWrites.add(KEYS.preUpgrade);
    const r = S.load(store, NOW);
    assert.equal(r.status, "upgrade-failed");
    assert.equal(r.stage, "copy");
    assert.equal(r.copySaved, false);
    assert.equal(r.originalIntact, true);
    assert.equal(r.originalRaw, richV15Raw());
    assertSameFinances(r.state, richState());
    assert.deepEqual(store.snapshot(), before);
    store.failWrites.clear();
    assert.equal(S.load(store, LATER).status, "upgraded");
  });

  it("step 1 partial write (damaged copy list): the original is untouched; next time the damaged list is set aside, not deleted", () => {
    const store = v15Store();
    store.corruptWrites.add(KEYS.preUpgrade);
    const r = S.load(store, NOW);
    assert.equal(r.status, "upgrade-failed");
    assert.equal(r.stage, "copy");
    const damaged = store.getItem(KEYS.preUpgrade);
    assert.notEqual(damaged, null);
    assert.equal(store.getItem(KEYS.v15), richV15Raw());
    assert.equal(store.getItem(KEYS.current), null);
    store.corruptWrites.clear();
    assert.equal(S.load(store, LATER).status, "upgraded");
    assert.ok(list(store, KEYS.quarantine).some(q => q.raw === damaged && q.sourceKey === KEYS.preUpgrade));
    assert.deepEqual(list(store, KEYS.preUpgrade).map(c => c.raw), [richV15Raw()]);
  });

  it("step 1 with a damaged copy list that can't be set aside: stops, leaving the list and the original untouched", () => {
    const store = v15Store({ [KEYS.preUpgrade]: "[{damaged" });
    store.failWrites.add(KEYS.quarantine);
    const r = S.load(store, NOW);
    assert.equal(r.status, "upgrade-failed");
    assert.equal(r.stage, "copy");
    assert.equal(store.getItem(KEYS.preUpgrade), "[{damaged");
    assert.equal(store.getItem(KEYS.v15), richV15Raw());
    assert.equal(store.getItem(KEYS.current), null);
  });

  it("step 2 (write v3) fails: the copy IS saved, the original is still in place, nothing half-written remains", () => {
    const store = v15Store();
    store.failWrites.add(KEYS.current);
    const r = S.load(store, NOW);
    assert.equal(r.status, "upgrade-failed");
    assert.equal(r.stage, "write");
    assert.equal(r.reason, "storage-full");
    assert.equal(r.copySaved, true);
    assert.equal(r.cleaned, true);
    assert.equal(r.originalIntact, true);
    assert.equal(store.getItem(KEYS.current), null);
    assert.equal(store.getItem(KEYS.v15), richV15Raw());
    assert.deepEqual(list(store, KEYS.preUpgrade).map(c => c.raw), [richV15Raw()]);
    store.failWrites.clear();
    assert.equal(S.load(store, LATER).status, "upgraded");
    assert.equal(list(store, KEYS.preUpgrade).length, 1, "the copy is not duplicated by the retry");
  });

  it("step 2 partial write: the truncated v3 text is removed and the original kept", () => {
    const store = v15Store();
    store.corruptWrites.add(KEYS.current);
    const r = S.load(store, NOW);
    assert.equal(r.stage, "write");
    assert.equal(r.reason, "readback-mismatch");
    assert.equal(r.cleaned, true);
    assert.equal(store.getItem(KEYS.current), null);
    assert.equal(store.getItem(KEYS.v15), richV15Raw());
  });

  it("step 2 partial write that can't be removed: the next launch sets it aside and finishes the upgrade", () => {
    const store = v15Store();
    store.corruptWrites.add(KEYS.current);
    store.failRemoves.add(KEYS.current);
    const r = S.load(store, NOW);
    assert.equal(r.stage, "write");
    assert.equal(r.cleaned, false);
    const partial = store.getItem(KEYS.current);
    assert.notEqual(partial, null);
    store.corruptWrites.clear(); store.failRemoves.clear();
    const again = S.load(store, LATER);
    assert.equal(again.status, "upgraded");
    assertSameFinances(again.state, richState());
    assert.ok(list(store, KEYS.quarantine).some(q => q.raw === partial), "the partial text is kept, not deleted");
  });

  it("step 3 (marker) fails: data IS upgraded and saved; read-only until the next launch completes the step", () => {
    const store = v15Store();
    store.failWrites.add(KEYS.v15);
    const r = S.load(store, NOW);
    assert.equal(r.status, "upgrade-failed");
    assert.equal(r.stage, "marker");
    assert.equal(r.dataUpgraded, true);
    assertSameFinances(JSON.parse(store.getItem(KEYS.current)), richState());
    assert.equal(store.getItem(KEYS.v15), richV15Raw());
    store.failWrites.clear();
    const again = S.load(store, LATER);
    assert.equal(again.status, "ok", "the original is held in the copy, so this is not a conflict");
    assert.equal(store.getItem(KEYS.v15), MOVED_MARKER);
  });

  it("step 3 partial write: a cut-short marker is recognised as our own, not as older-version data", () => {
    const store = v15Store();
    store.corruptWrites.add(KEYS.v15);
    assert.equal(S.load(store, NOW).stage, "marker");
    assert.notEqual(store.getItem(KEYS.v15), MOVED_MARKER);
    store.corruptWrites.clear();
    assert.equal(S.load(store, LATER).status, "ok");
    assert.equal(store.getItem(KEYS.v15), MOVED_MARKER);
  });

  it("storage that can't be read at all: nothing is attempted", () => {
    const store = v15Store();
    store.blocked = true;
    assert.equal(S.load(store, NOW).status, "unavailable");
    store.blocked = false;
    assert.deepEqual(store.writes, []);
  });

  it("whatever fails, no financial record is ever lost or duplicated", () => {
    const failures = [
      [KEYS.preUpgrade, "failWrites"], [KEYS.preUpgrade, "corruptWrites"], [KEYS.current, "failWrites"],
      [KEYS.current, "corruptWrites"], [KEYS.v15, "failWrites"], [KEYS.v15, "corruptWrites"], [KEYS.quarantine, "failWrites"]
    ];
    for (const [key, mode] of failures) {
      const store = v15Store();
      store[mode].add(key);
      S.load(store, NOW);
      store[mode].clear();
      const r = S.load(store, LATER);
      assert.ok(["ok", "upgraded"].includes(r.status), `${mode} ${key}: ${r.status}`);
      assertSameFinances(r.state, richState());
    }
  });
});

describe("data saved by an older version after the upgrade", () => {
  // A v1.5.0 tab that was still open saves its (older) copy plus a new entry.
  function olderTabSaves(store) {
    const s = richState();
    s.transactions.push({ id: "old-tab", type: "expense", amount: 99, categoryId: "food", date: "2026-11-07", note: "Fictional entry from an old tab", createdAt: 99 });
    const text = JSON.stringify(s);
    store.setItem(KEYS.v15, text);
    return text;
  }
  function upgradedThenEdited() {
    const store = v15Store();
    const r = S.load(store, NOW);
    const s = JSON.parse(JSON.stringify(r.state));
    s.transactions.push({ id: "new-tab", type: "expense", amount: 55, categoryId: "fun", date: "2026-11-07", note: "Fictional entry in v1.6", createdAt: 100 });
    const saved = S.save(store, s, { expectedRaw: r.raw });
    assert.ok(saved.ok);
    return { store, v16Raw: saved.raw };
  }

  it("never replaces the v1.6 data; the next launch asks which to keep, writing nothing", () => {
    const { store, v16Raw } = upgradedThenEdited();
    const olderRaw = olderTabSaves(store);
    const writes = store.writes.length;
    const r = S.load(store, LATER);
    assert.equal(r.status, "older-version-conflict");
    assert.equal(store.getItem(KEYS.current), v16Raw);
    assert.equal(r.raw, v16Raw);
    assert.equal(r.olderRaw, olderRaw);
    assert.ok(D.isClean(r.olderReport));
    assert.equal(store.writes.length, writes, "loading wrote nothing");
    assert.ok(ids(r.state).includes("new-tab") && ids(r.olderReport.state).includes("old-tab"));
  });

  it("keep the v1.6 data: the older data is kept in full and the marker restored", () => {
    const { store, v16Raw } = upgradedThenEdited();
    const olderRaw = olderTabSaves(store);
    const r = S.resolveOlderVersion(store, LATER, "keep-current", { currentRaw: v16Raw, olderRaw });
    assert.equal(r.ok, true);
    assert.equal(store.getItem(KEYS.current), v16Raw);
    assert.ok(list(store, KEYS.olderVersion).some(c => c.raw === olderRaw));
    assert.equal(store.getItem(KEYS.v15), MOVED_MARKER);
    assert.equal(S.load(store, LATER).status, "ok");
  });

  it("use the older data: it is upgraded, and the v1.6 data is kept in full", () => {
    const { store, v16Raw } = upgradedThenEdited();
    const olderRaw = olderTabSaves(store);
    const r = S.resolveOlderVersion(store, LATER, "use-older", { currentRaw: v16Raw, olderRaw });
    assert.equal(r.ok, true);
    const now = JSON.parse(store.getItem(KEYS.current));
    assert.equal(now.version, 3);
    assertSameFinances(now, JSON.parse(olderRaw));
    assert.ok(list(store, KEYS.olderVersion).some(c => c.raw === v16Raw));
    assert.equal(store.getItem(KEYS.v15), MOVED_MARKER);
    assert.equal(S.load(store, LATER).status, "ok");
  });

  it("refuses if either set of data changed since it was shown", () => {
    const { store, v16Raw } = upgradedThenEdited();
    const olderRaw = olderTabSaves(store);
    const before = store.snapshot();
    for (const shown of [{ currentRaw: v16Raw, olderRaw: "other" }, { currentRaw: "other", olderRaw }, undefined]) {
      assert.deepEqual(S.resolveOlderVersion(store, LATER, "keep-current", shown), { ok: false, reason: "changed" });
    }
    assert.deepEqual(store.snapshot(), before);
  });

  it("if the safety copy can't be saved, nothing changes", () => {
    const { store, v16Raw } = upgradedThenEdited();
    const olderRaw = olderTabSaves(store);
    const before = store.snapshot();
    store.failWrites.add(KEYS.olderVersion);
    for (const choice of ["keep-current", "use-older"]) {
      assert.deepEqual(S.resolveOlderVersion(store, LATER, choice, { currentRaw: v16Raw, olderRaw }), { ok: false, reason: "copy-failed" });
    }
    assert.deepEqual(store.snapshot(), before);
  });

  it("if writing the older data fails, the v1.6 data is put back exactly (and is also in the safety copy)", () => {
    const { store, v16Raw } = upgradedThenEdited();
    const olderRaw = olderTabSaves(store);
    // Only the first write to the data key is cut short; putting the data back succeeds.
    const setItem = store.setItem.bind(store);
    let cut = false;
    store.setItem = (k, v) => { if (k === KEYS.current && !cut) { cut = true; return setItem(k, String(v).slice(0, 40)); } return setItem(k, v); };
    const r = S.resolveOlderVersion(store, LATER, "use-older", { currentRaw: v16Raw, olderRaw });
    assert.equal(r.ok, false);
    assert.equal(store.getItem(KEYS.current), v16Raw);
    assert.ok(list(store, KEYS.olderVersion).some(c => c.raw === v16Raw));
    assert.equal(store.getItem(KEYS.v15), olderRaw, "the older data is still there too");
  });

  it("damaged older data can't be chosen, but is kept when the v1.6 data is kept", () => {
    const { store, v16Raw } = upgradedThenEdited();
    store.setItem(KEYS.v15, "{half-written");
    const r = S.load(store, LATER);
    assert.equal(r.status, "older-version-conflict");
    assert.equal(r.olderReport, null);
    assert.deepEqual(S.resolveOlderVersion(store, LATER, "use-older", { currentRaw: v16Raw, olderRaw: "{half-written" }), { ok: false, reason: "older-invalid" });
    assert.ok(S.resolveOlderVersion(store, LATER, "keep-current", { currentRaw: v16Raw, olderRaw: "{half-written" }).ok);
    assert.ok(list(store, KEYS.olderVersion).some(c => c.raw === "{half-written"));
  });

  it("restoring the pre-upgrade copy in v1.5.0 with no new entries isn't a conflict (nothing new to keep)", () => {
    const store = v15Store();
    S.load(store, NOW);
    store.setItem(KEYS.v15, richV15Raw()); // v1.5.0 restored exactly the copy made before the upgrade
    assert.equal(S.load(store, LATER).status, "ok");
    assert.equal(store.getItem(KEYS.v15), MOVED_MARKER);
  });
});

describe("stale tabs can't overwrite newer data", () => {
  it("a save is refused when the stored data changed since this tab read it", () => {
    const store = v15Store();
    const tabA = S.load(store, NOW);
    const tabB = S.load(store, NOW);
    const a = JSON.parse(JSON.stringify(tabA.state)); a.openingBalance = 25000;
    const savedA = S.save(store, a, { expectedRaw: tabA.raw });
    assert.ok(savedA.ok);
    const b = JSON.parse(JSON.stringify(tabB.state)); b.openingBalance = 1;
    assert.deepEqual(S.save(store, b, { expectedRaw: tabB.raw }), { ok: false, reason: "changed-elsewhere" });
    assert.equal(store.getItem(KEYS.current), savedA.raw);
    // After reloading, tab B can save again.
    const reloaded = S.load(store, NOW);
    assert.ok(S.save(store, { ...reloaded.state, openingBalance: 2 }, { expectedRaw: reloaded.raw }).ok);
  });

  it("a tab that started empty can't overwrite data another tab created", () => {
    const store = new FakeStorage();
    assert.ok(S.save(store, D.createBlankState("USD"), { expectedRaw: null }).ok);
    assert.deepEqual(S.save(store, D.createBlankState("KES"), { expectedRaw: null }), { ok: false, reason: "changed-elsewhere" });
    assert.equal(JSON.parse(store.getItem(KEYS.current)).currency, "USD");
  });

  it("saving never touches data an older version wrote under the v1.5 key", () => {
    const store = v15Store();
    const r = S.load(store, NOW);
    store.setItem(KEYS.v15, "older data");
    assert.ok(S.save(store, r.state, { expectedRaw: r.raw }).ok);
    assert.equal(store.getItem(KEYS.v15), "older data");
  });
});

describe("currency changes keep their own copies", () => {
  it("each change keeps a verified copy with from/to, never replacing another copy", () => {
    const store = v15Store();
    const r = S.load(store, NOW);
    store.setItem(KEYS.preRestore, JSON.stringify({ savedAt: "x", raw: "earlier restore" }));
    const pre = store.getItem(KEYS.preRestore);
    assert.ok(S.keepPreCurrencyCopy(store, NOW, "KES", "USD"));
    const first = store.getItem(KEYS.current);
    const usd = S.save(store, { ...r.state, currency: "USD" }, { expectedRaw: r.raw });
    assert.ok(S.keepPreCurrencyCopy(store, LATER, "USD", "KES"));
    const copies = list(store, KEYS.preCurrency);
    assert.deepEqual(copies.map(c => [c.from, c.to]), [["KES", "USD"], ["USD", "KES"]]);
    assert.equal(copies[0].raw, first);
    assert.equal(copies[1].raw, usd.raw);
    assert.equal(store.getItem(KEYS.preRestore), pre, "the pre-restore copy is untouched");
    const inv = S.recoveryInventory(store);
    assert.deepEqual(inv.items.filter(i => i.kind === "preCurrency").map(i => [i.from, i.to]), [["KES", "USD"], ["USD", "KES"]]);
  });

  it("reports failure when the copy can't be saved or there is nothing to copy", () => {
    const store = v15Store();
    S.load(store, NOW);
    store.failWrites.add(KEYS.preCurrency);
    assert.equal(S.keepPreCurrencyCopy(store, NOW, "KES", "USD"), false);
    assert.equal(S.keepPreCurrencyCopy(new FakeStorage(), NOW, "KES", "USD"), false);
  });

  it("copies can be restored (they read as valid backups) and follow the usual deletion rules", () => {
    const store = v15Store();
    S.load(store, NOW);
    S.keepPreCurrencyCopy(store, NOW, "KES", "USD");
    const raw = S.getRecoveryText(store, "preCurrency", 0);
    const report = D.analyzeBackup(raw);
    assert.ok(D.isClean(report));
    assert.equal(report.state.currency, "KES");
    assert.deepEqual(S.deleteRecoveryItem(store, "preCurrency", 0, raw), { ok: true }, "an identical copy (the current data) exists");
  });
});

describe("nothing lost or duplicated across upgrade, currency change, backup, restore and going back", () => {
  it("every financial record survives every step", () => {
    const store = v15Store();
    const up = S.load(store, NOW);
    assertSameFinances(up.state, richState());
    // relabel to USD and back: numbers never change
    assert.ok(S.keepPreCurrencyCopy(store, NOW, "KES", "USD"));
    const usd = S.save(store, { ...up.state, currency: "USD" }, { expectedRaw: up.raw });
    assertSameFinances(usd.state, richState());
    const kes = S.save(store, { ...usd.state, currency: "KES" }, { expectedRaw: usd.raw });
    assertSameFinances(kes.state, richState());
    // backup → restore
    const restored = D.analyzeBackup(D.serializeBackup(kes.state));
    assert.ok(D.isClean(restored));
    assert.ok(S.keepPreRestoreCopy(store, NOW));
    const back = S.save(store, restored.state, { expectedRaw: kes.raw });
    assertSameFinances(back.state, richState());
    // going back to v1.5.0
    const file = D.toV15Backup(back.state);
    assert.ok(file.ok);
    assertSameFinances(JSON.parse(file.text), richState());
    // and upgrading that again
    const again = D.normalizeState(JSON.parse(file.text));
    assertSameFinances(again.state, richState());
  });
});
