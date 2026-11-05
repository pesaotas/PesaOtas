/**
 * PesaOtas storage — loading, PesaFlow migration, verified saving, and the
 * safety copies that make every change recoverable.
 *
 * The storage object is passed in (localStorage in the browser, a fake in
 * tests) and the current time is passed in, so behaviour is deterministic.
 *
 * Browser: `window.PesaStorage` (load after data-model.js).
 * Node:    `require("./src/storage.js")`.
 *
 * Safety rules (see docs/DECISIONS.md D-02 and D-09):
 *   1. The original PesaFlow key is NEVER modified or deleted by this module.
 *   2. Before migrating, the raw PesaFlow text is copied to a preserved key and
 *      read back to confirm the copy.
 *   3. Migrated data counts as saved only after it is written, read back,
 *      compared byte-for-byte, and re-validated.
 *   4. Migration runs only when no PesaOtas data exists, so reopening the app
 *      never migrates or duplicates again (idempotent).
 *   5. Damaged data is copied to quarantine and left where it was. Nothing is
 *      replaced until the user chooses a recovery option.
 *   6. Invalid data is never saved.
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory(require("./data-model.js"));
  else root.PesaStorage = factory(root.PesaData);
})(typeof self !== "undefined" ? self : this, function (D) {
  "use strict";

  const KEYS = Object.freeze({
    current: "pesaotas.data.v2",
    legacy: "pesaflow.personal.v1",
    preserved: "pesaotas.preserved.pesaflow-v1",
    quarantine: "pesaotas.quarantine",
    preRestore: "pesaotas.pre-restore"
  });

  const parseJSON = (raw) => { try { return { ok: true, value: JSON.parse(raw) }; } catch { return { ok: false }; } };
  const readList = (storage, key) => {
    const raw = storage.getItem(key);
    if (raw === null) return [];
    const p = parseJSON(raw);
    return p.ok && Array.isArray(p.value) ? p.value : null; // null = the safety list itself is damaged
  };

  /**
   * Add `raw` to a list of {raw, ...info} snapshots stored under `key`,
   * unless an identical snapshot is already there. Verifies by reading back.
   * @returns {boolean} true when the snapshot is confirmed stored
   */
  function addSnapshot(storage, key, raw, info) {
    try {
      const list = readList(storage, key);
      if (list === null) return false; // never overwrite a damaged safety list
      if (!list.some(s => s && s.raw === raw)) {
        list.push({ ...info, raw });
        storage.setItem(key, JSON.stringify(list));
      }
      const check = readList(storage, key);
      return Array.isArray(check) && check.some(s => s && s.raw === raw);
    } catch {
      return false;
    }
  }

  /**
   * Write a valid state and prove it was stored correctly.
   * @returns {{ok:true, state:object, serialized:string} | {ok:false, reason:string, report?:object}}
   */
  function writeVerified(storage, key, state) {
    const report = D.normalizeState(state);
    if (!D.isClean(report)) return { ok: false, reason: "invalid", report };
    const serialized = JSON.stringify(report.state);
    try {
      storage.setItem(key, serialized);
      const back = storage.getItem(key);
      if (back !== serialized) return { ok: false, reason: "readback-mismatch" };
      const recheck = D.normalizeState(JSON.parse(back));
      if (!D.isClean(recheck)) return { ok: false, reason: "readback-invalid" };
    } catch (e) {
      return { ok: false, reason: e && e.name === "QuotaExceededError" ? "storage-full" : "write-failed" };
    }
    return { ok: true, state: report.state, serialized };
  }

  /**
   * Load PesaOtas data, migrating from PesaFlow the first time only.
   *
   * @param {Storage} storage
   * @param {Date} now
   * @returns {{status:"ok"|"migrated"|"new"|"corrupt"|"migration-failed"|"unavailable", ...}}
   *   ok               – state: valid saved PesaOtas data
   *   migrated         – state: PesaFlow data moved and verified; report: what was checked
   *   new              – nothing saved yet (nothing is written)
   *   corrupt          – sourceKey, raw, report (may contain recoverable rows), quarantined:boolean
   *   migration-failed – reason; state: converted copy in memory (read-only); original untouched
   *   unavailable      – browser storage can't be read at all
   */
  function load(storage, now) {
    let rawCurrent, rawLegacy;
    try {
      rawCurrent = storage.getItem(KEYS.current);
      rawLegacy = storage.getItem(KEYS.legacy);
    } catch {
      return { status: "unavailable" };
    }

    // PesaOtas data exists: use it. Legacy data is ignored from now on (idempotent).
    if (rawCurrent !== null) {
      const parsed = parseJSON(rawCurrent);
      const report = parsed.ok ? D.normalizeState(parsed.value) : null;
      if (report && D.isClean(report) && report.format === "pesaotas-v2") {
        return { status: "ok", state: report.state, report };
      }
      return corrupt(storage, now, KEYS.current, rawCurrent, report,
        parsed.ok ? "PesaOtas data failed its checks" : "PesaOtas data could not be read");
    }

    if (rawLegacy !== null) return migrate(storage, now, rawLegacy);

    return { status: "new" };
  }

  function corrupt(storage, now, sourceKey, raw, report, reason) {
    const quarantined = addSnapshot(storage, KEYS.quarantine, raw,
      { quarantinedAt: now.toISOString(), sourceKey, reason });
    return {
      status: "corrupt", sourceKey, raw, quarantined, reason,
      report: report || { ok: false, format: null, state: null, errors: ["The saved data couldn't be read at all."], rejected: [], fixed: [], warnings: [], notes: [] }
    };
  }

  function migrate(storage, now, rawLegacy) {
    // Rule 2: preserve the original text first, and confirm the copy.
    const preserved = addSnapshot(storage, KEYS.preserved, rawLegacy,
      { preservedAt: now.toISOString(), sourceKey: KEYS.legacy });

    const parsed = parseJSON(rawLegacy);
    const report = parsed.ok ? D.normalizeState(parsed.value) : null;
    if (!report || !D.isClean(report)) {
      return corrupt(storage, now, KEYS.legacy, rawLegacy, report,
        parsed.ok ? "PesaFlow data failed its checks" : "PesaFlow data could not be read");
    }
    if (report.format !== "pesaflow-v1") {
      return corrupt(storage, now, KEYS.legacy, rawLegacy, report, "Unexpected data under the PesaFlow key");
    }

    const state = { ...report.state, meta: { ...report.state.meta, migratedFrom: { key: KEYS.legacy, migratedAt: now.toISOString() } } };
    if (!preserved) return { status: "migration-failed", reason: "preserve-failed", state, report };

    const written = writeVerified(storage, KEYS.current, state);
    if (!written.ok) {
      // Remove only what this attempt wrote, so the next launch retries cleanly.
      try { storage.removeItem(KEYS.current); } catch { /* nothing more we can do */ }
      return { status: "migration-failed", reason: written.reason, state, report };
    }
    return { status: "migrated", state: written.state, report };
  }

  /**
   * Save the app's state. Refuses invalid data; verifies the write.
   * @returns {{ok:true, state:object} | {ok:false, reason:string, report?:object}}
   */
  function save(storage, state) {
    const result = writeVerified(storage, KEYS.current, state);
    return result.ok ? { ok: true, state: result.state } : result;
  }

  /**
   * Keep a copy of the data currently stored, before a restore or recovery
   * replaces it. Keeps the most recent copy only.
   * @returns {boolean} true if there was nothing to keep, or the copy is confirmed
   */
  function keepPreRestoreCopy(storage, now) {
    try {
      const raw = storage.getItem(KEYS.current);
      if (raw === null) return true;
      const entry = JSON.stringify({ savedAt: now.toISOString(), raw });
      storage.setItem(KEYS.preRestore, entry);
      return storage.getItem(KEYS.preRestore) === entry;
    } catch {
      return false;
    }
  }

  /** Everything recoverable on this device, for the Data safety screen. */
  function listRecovery(storage) {
    const out = { preserved: [], quarantine: [], preRestore: null, legacyPresent: false, damagedLists: [] };
    try {
      out.legacyPresent = storage.getItem(KEYS.legacy) !== null;
      const p = readList(storage, KEYS.preserved);
      if (p === null) out.damagedLists.push(KEYS.preserved);
      else out.preserved = p.map((s, i) => ({ index: i, preservedAt: s.preservedAt, size: (s.raw || "").length }));
      const q = readList(storage, KEYS.quarantine);
      if (q === null) out.damagedLists.push(KEYS.quarantine);
      else out.quarantine = q.map((s, i) => ({ index: i, quarantinedAt: s.quarantinedAt, sourceKey: s.sourceKey, reason: s.reason, size: (s.raw || "").length }));
      const pr = storage.getItem(KEYS.preRestore);
      if (pr !== null) {
        const v = parseJSON(pr);
        out.preRestore = v.ok && v.value ? { savedAt: v.value.savedAt, size: (v.value.raw || "").length } : null;
      }
    } catch { /* storage unreadable: return what we have */ }
    return out;
  }

  /**
   * The exact original text of a recoverable item, for download.
   * @param {"legacy"|"preserved"|"quarantine"|"preRestore"} kind
   * @param {number} [index]
   * @returns {string|null}
   */
  function getRecoveryText(storage, kind, index) {
    try {
      if (kind === "legacy") return storage.getItem(KEYS.legacy);
      if (kind === "preRestore") {
        const v = parseJSON(storage.getItem(KEYS.preRestore));
        return v.ok && v.value ? v.value.raw : null;
      }
      const key = kind === "preserved" ? KEYS.preserved : kind === "quarantine" ? KEYS.quarantine : null;
      if (!key) return null;
      const list = readList(storage, key);
      return list && list[index] ? list[index].raw : null;
    } catch {
      return null;
    }
  }

  return Object.freeze({ KEYS, load, save, keepPreRestoreCopy, listRecovery, getRecoveryText });
});
