/**
 * Persistence gate for alert review records (v1.6 Phase 4, D-16 and D-20).
 * Every storage path keeps the records with the same meaning: compared after
 * re-checking (deep equality of every record, every field, in order) — not
 * just as identical text. Includes the separate decision flow for unreadable
 * records and its safeguards. Fictional data only.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const D = require("../src/data-model.js");
const F = require("../src/finance.js");
const S = require("../src/storage.js");
const E = require("../src/entries.js");
const { FakeStorage } = require("./helpers/fake-storage.js");
const { richV15Raw, financial } = require("./helpers/v15-data.js");
const { legacyRaw } = require("./helpers/legacy.js");
const { sampleReviews, v3WithReviews, H } = require("./helpers/review-data.js");

const NOW = new Date("2026-11-06T10:00:00Z");
/** The records a stored text means, after re-checking it as the app would. */
const recordsIn = (raw) => {
  const r = D.normalizeState(JSON.parse(raw));
  return r.state && r.state.meta.alertReviews ? r.state.meta.alertReviews : [];
};
const EXPECTED = sampleReviews();
function savedStore(state = v3WithReviews()) {
  const store = new FakeStorage();
  const res = S.save(store, state);
  assert.ok(res.ok);
  return { store, raw: res.raw };
}
const listRaw = (store, key, i = -1) => { const l = JSON.parse(store.getItem(key)); return l.at(i).raw; };

describe("every path keeps the records with the same meaning", () => {
  it("save, then reload", () => {
    const { store } = savedStore();
    const loaded = S.load(store, NOW);
    assert.equal(loaded.status, "ok");
    assert.deepEqual(loaded.state.meta.alertReviews, EXPECTED);
    // Save the loaded data again (as the app does after any change), reload again.
    const again = S.save(store, loaded.state, { expectedRaw: loaded.raw });
    assert.ok(again.ok);
    assert.deepEqual(S.load(store, NOW).state.meta.alertReviews, EXPECTED);
  });

  it("backup, then restore (and the restored data saved and reloaded)", () => {
    const { store } = savedStore();
    const text = D.serializeBackup(S.load(store, NOW).state);
    const r = D.analyzeBackup(text);
    assert.ok(D.isClean(r));
    assert.deepEqual(r.state.meta.alertReviews, EXPECTED);
    const other = new FakeStorage();
    assert.ok(S.keepPreRestoreCopy(other, NOW));
    assert.ok(S.save(other, r.state).ok);
    assert.deepEqual(S.load(other, NOW).state.meta.alertReviews, EXPECTED);
  });

  it("the copy made before a restore, recovery, reset or new pay cycle", () => {
    const { store } = savedStore();
    assert.ok(S.keepPreRestoreCopy(store, NOW));
    assert.deepEqual(recordsIn(S.getRecoveryText(store, "preRestore")), EXPECTED);
  });

  it("a currency change: the current data and its 'Before currency change' copy", () => {
    const { store, raw } = savedStore();
    const loaded = S.load(store, NOW);
    assert.ok(S.keepPreCurrencyCopy(store, NOW, "KES", "USD"));
    const changed = { ...loaded.state, currency: "USD", meta: { ...loaded.state.meta, currencyHistory: [{ from: "KES", to: "USD", changedAt: NOW.toISOString() }] } };
    assert.ok(S.save(store, changed, { expectedRaw: raw }).ok);
    assert.deepEqual(S.load(store, NOW).state.meta.alertReviews, EXPECTED);
    const copy = S.getRecoveryText(store, "preCurrency", 0);
    assert.deepEqual(recordsIn(copy), EXPECTED);
    assert.ok(D.isClean(D.analyzeBackup(copy)), "the copy can be restored");
  });

  it("a new pay cycle (rollover), adding and editing an entry, and category changes", () => {
    const s = v3WithReviews();
    const rolled = F.startNewCycle(s, { start: "2026-11-06", nextPayday: "2026-12-06", now: NOW });
    assert.ok(rolled.ok);
    assert.deepEqual(D.normalizeState(rolled.state).state.meta.alertReviews, EXPECTED);
    const added = E.validateEntry(s, { type: "expense", amount: "250", categoryId: "food", date: "2026-11-06", note: "x" }, { newId: "n1", now: NOW });
    assert.ok(added.ok, JSON.stringify(added.errors));
    assert.deepEqual(D.normalizeState(added.state).state.meta.alertReviews, EXPECTED);
    const edited = E.validateEntry(s, { type: "expense", amount: "999", categoryId: "food", date: "2026-11-03", note: "y" }, { replacingId: "s3", now: NOW });
    assert.ok(edited.ok, JSON.stringify(edited.errors));
    assert.deepEqual(D.normalizeState(edited.state).state.meta.alertReviews, EXPECTED);
    const del = E.deleteCategory(s, "fun", "other");
    assert.ok(del.ok, JSON.stringify(del.errors));
    assert.deepEqual(D.normalizeState(del.state).state.meta.alertReviews, EXPECTED);
  });

  it("stale tab: a save from an out-of-date tab is refused; the newer records stay", () => {
    const { store, raw } = savedStore();
    const tabA = S.load(store, NOW);
    const newer = [...EXPECTED, { id: "unusual-bill:s3", rule: "unusual-bill", status: "reviewed", actedAt: "2026-11-06T10:00:00.000Z", fingerprint: H("9") }];
    assert.ok(S.save(store, { ...tabA.state, meta: { ...tabA.state.meta, alertReviews: newer } }, { expectedRaw: raw }).ok); // tab B
    const res = S.save(store, { ...tabA.state, meta: { ...tabA.state.meta, alertReviews: [] } }, { expectedRaw: tabA.raw }); // tab A
    assert.deepEqual(res, { ok: false, reason: "changed-elsewhere" });
    assert.deepEqual(S.load(store, NOW).state.meta.alertReviews, newer);
  });

  it("two versions — keep the v1.6 data: its records are kept", () => {
    const { store, raw } = savedStore();
    store.setItem(S.KEYS.v15, richV15Raw()); // an older version saved data under the old key
    const conflict = S.load(store, NOW);
    assert.equal(conflict.status, "older-version-conflict");
    const res = S.resolveOlderVersion(store, NOW, "keep-current", { currentRaw: conflict.raw, olderRaw: conflict.olderRaw });
    assert.ok(res.ok);
    assert.deepEqual(res.state.meta.alertReviews, EXPECTED);
    assert.deepEqual(S.load(store, NOW).state.meta.alertReviews, EXPECTED);
    assert.equal(store.getItem(S.KEYS.current), raw);
  });

  it("two versions — use the older data: it starts with none; the v1.6 data and its records are kept and restorable", () => {
    const { store } = savedStore();
    store.setItem(S.KEYS.v15, richV15Raw());
    const conflict = S.load(store, NOW);
    const res = S.resolveOlderVersion(store, NOW, "use-older", { currentRaw: conflict.raw, olderRaw: conflict.olderRaw });
    assert.ok(res.ok);
    assert.equal(res.state.meta.alertReviews, undefined);
    const kept = S.getRecoveryText(store, "olderVersion", 0);
    assert.deepEqual(recordsIn(kept), EXPECTED);
    assert.ok(D.isClean(D.analyzeBackup(kept)));
  });

  it("upgrade from v1.5.0 and migration from PesaFlow start with no records", () => {
    const up = new FakeStorage({ [S.KEYS.v15]: richV15Raw() });
    const u = S.load(up, NOW);
    assert.equal(u.status, "upgraded");
    assert.equal(u.state.meta.alertReviews, undefined);
    const pf = new FakeStorage({ [S.KEYS.legacy]: legacyRaw() });
    const m = S.load(pf, NOW);
    assert.equal(m.status, "migrated");
    assert.equal(m.state.meta.alertReviews, undefined);
  });

  it("erase and start empty: the new budget has none; the previous records are in the copy kept first", () => {
    const { store, raw } = savedStore();
    assert.ok(S.keepPreRestoreCopy(store, NOW));
    assert.ok(S.save(store, D.createBlankState("KES"), { expectedRaw: raw }).ok);
    assert.equal(S.load(store, NOW).state.meta.alertReviews, undefined);
    assert.deepEqual(recordsIn(S.getRecoveryText(store, "preRestore")), EXPECTED);
  });

  it("damaged data with records goes to quarantine whole; recovering keeps the readable records", () => {
    const bad = JSON.parse(JSON.stringify(v3WithReviews()));
    bad.transactions.push({ id: "broken", type: "expense", amount: "lots", date: "2026-11-06", categoryId: "food" });
    const store = new FakeStorage({ [S.KEYS.current]: JSON.stringify(bad), [S.KEYS.v15]: S.MOVED_MARKER });
    const res = S.load(store, NOW);
    assert.equal(res.status, "corrupt");
    assert.ok(res.quarantined);
    assert.deepEqual(recordsIn(S.getRecoveryText(store, "quarantine", 0).replace('"lots"', "1")), EXPECTED);
    assert.deepEqual(res.report.state.meta.alertReviews, EXPECTED, "the recoverable data keeps every record");
  });

  it("the v1.5.0-compatible backup leaves them out (listed), and the v1.6 data still has them", () => {
    const s = v3WithReviews();
    const out = D.toV15Backup(s);
    assert.ok(out.ok && out.omitted.some(o => /^alert review records \(6\)$/.test(o)));
    assert.deepEqual(financial(D.normalizeState(JSON.parse(out.text)).state), financial(s));
    assert.deepEqual(s.meta.alertReviews, EXPECTED);
  });
});

describe("unreadable records: the separate decision flow and its safeguards", () => {
  const withBadRecord = () => {
    const s = JSON.parse(JSON.stringify(v3WithReviews()));
    s.meta.alertReviews.push({ id: "unusual-bill:s7", rule: "unusual-bill", status: "reviewed", fingerprint: H("7") }); // no actedAt
    return JSON.stringify(s);
  };
  const store0 = (raw) => new FakeStorage({ [S.KEYS.current]: raw, [S.KEYS.v15]: S.MOVED_MARKER });

  it("loads as 'review-records-invalid': money data and readable records kept; the exact original copied and verified first; nothing else written", () => {
    const raw = withBadRecord();
    const store = store0(raw);
    const res = S.load(store, NOW);
    assert.equal(res.status, "review-records-invalid");
    assert.equal(res.copyVerified, true);
    assert.equal(res.raw, raw);
    assert.deepEqual(res.state.meta.alertReviews, EXPECTED);
    assert.equal(res.report.reviewIssues.length, 1);
    assert.equal(res.report.reviewIssues[0].id, "unusual-bill:s7");
    assert.equal(store.getItem(S.KEYS.current), raw, "the stored data is untouched");
    assert.equal(listRaw(store, S.KEYS.reviewRecords), raw, "the copy is the exact original text");
    assert.deepEqual(store.writes.map(([k]) => k), [S.KEYS.reviewRecords]);
  });

  it("reopening before deciding shows the same choice and never adds a second copy", () => {
    const raw = withBadRecord();
    const store = store0(raw);
    S.load(store, NOW); S.load(store, NOW); S.load(store, NOW);
    assert.equal(JSON.parse(store.getItem(S.KEYS.reviewRecords)).length, 1);
    assert.equal(S.load(store, NOW).status, "review-records-invalid");
  });

  it("if the copy can't be saved: copyVerified is false, nothing is changed, and continuing is refused", () => {
    const raw = withBadRecord();
    const store = store0(raw);
    store.failWrites.add(S.KEYS.reviewRecords);
    const res = S.load(store, NOW);
    assert.equal(res.status, "review-records-invalid");
    assert.equal(res.copyVerified, false);
    assert.equal(store.getItem(S.KEYS.current), raw);
    assert.deepEqual(S.continueWithoutInvalidReviews(store, res.state, raw), { ok: false, reason: "copy-missing" });
    assert.equal(store.getItem(S.KEYS.current), raw, "still untouched");
    // Try again after space is freed: the copy is made and verified.
    store.failWrites.delete(S.KEYS.reviewRecords);
    assert.equal(S.keepReviewRecordsCopy(store, NOW, raw), true);
  });

  it("a copy cut short (verification fails) also blocks continuing", () => {
    const raw = withBadRecord();
    const store = store0(raw);
    store.corruptWrites.add(S.KEYS.reviewRecords);
    const res = S.load(store, NOW);
    assert.equal(res.copyVerified, false);
    assert.equal(S.continueWithoutInvalidReviews(store, res.state, raw).ok, false);
  });

  it("a damaged copy list is never overwritten; continuing stays blocked", () => {
    const raw = withBadRecord();
    const store = store0(raw);
    store.setItem(S.KEYS.reviewRecords, "{damaged");
    const res = S.load(store, NOW);
    assert.equal(res.copyVerified, false);
    assert.equal(store.getItem(S.KEYS.reviewRecords), "{damaged");
    assert.equal(S.continueWithoutInvalidReviews(store, res.state, raw).reason, "copy-missing");
  });

  it("continuing writes only the budget, keeps the copy byte-for-byte, and the budget then opens normally", () => {
    const raw = withBadRecord();
    const store = store0(raw);
    const res = S.load(store, NOW);
    const copyBefore = store.getItem(S.KEYS.reviewRecords);
    store.writes.length = 0;
    const out = S.continueWithoutInvalidReviews(store, res.state, raw);
    assert.ok(out.ok);
    assert.deepEqual([...new Set(store.writes.map(([k]) => k))], [S.KEYS.current]);
    assert.equal(store.getItem(S.KEYS.reviewRecords), copyBefore, "the safety copy is unchanged");
    const after = S.load(store, NOW);
    assert.equal(after.status, "ok");
    assert.deepEqual(after.state.meta.alertReviews, EXPECTED, "every readable record kept");
    assert.deepEqual(financial(after.state), financial(res.state));
    // The copy can still be restored later: it shows the same problem again, never hidden.
    const again = D.analyzeBackup(S.getRecoveryText(store, "reviewRecords", 0));
    assert.equal(again.reviewIssues.length, 1);
  });

  it("continuing is refused if the copy was deleted or changed in the meantime", () => {
    const raw = withBadRecord();
    const store = store0(raw);
    const res = S.load(store, NOW);
    store.removeItem(S.KEYS.reviewRecords);
    assert.equal(S.continueWithoutInvalidReviews(store, res.state, raw).reason, "copy-missing");
    assert.equal(store.getItem(S.KEYS.current), raw);
  });

  it("continuing is refused if another tab changed the data meanwhile", () => {
    const raw = withBadRecord();
    const store = store0(raw);
    const res = S.load(store, NOW);
    store.setItem(S.KEYS.current, JSON.stringify(v3WithReviews()));
    assert.equal(S.continueWithoutInvalidReviews(store, res.state, raw).reason, "changed-elsewhere");
  });

  it("financial damage as well: the usual damaged-data recovery, with the review problems listed separately", () => {
    const s = JSON.parse(withBadRecord());
    s.transactions.push({ id: "broken", type: "expense", amount: -1, date: "2026-11-06", categoryId: "food" });
    const store = store0(JSON.stringify(s));
    const res = S.load(store, NOW);
    assert.equal(res.status, "corrupt");
    assert.equal(res.report.rejected.length, 1);
    assert.equal(res.report.reviewIssues.length, 1);
  });

  it("the copy appears in Data safety; while undecided, no safety copy can be deleted", () => {
    const raw = withBadRecord();
    const store = store0(raw);
    const res = S.load(store, NOW);
    const inv = S.recoveryInventory(store);
    const item = inv.items.find(i => i.kind === "reviewRecords");
    assert.ok(item);
    assert.equal(inv.currentSafe, false);
    assert.equal(S.deleteRecoveryItem(store, "reviewRecords", 0, raw, { acknowledgedOnlyCopy: true }).reason, "current-not-safe");
    // After continuing, the usual rules apply: it is the only copy, so deleting needs the user's acknowledgement.
    assert.ok(S.continueWithoutInvalidReviews(store, res.state, raw).ok);
    assert.equal(S.deleteRecoveryItem(store, "reviewRecords", 0, raw).reason, "only-copy");
  });
});
