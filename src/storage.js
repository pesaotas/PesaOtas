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
 *   1. The original PesaFlow key is NEVER modified by this module, and is
 *      deleted only by deleteRecoveryItem() — an explicit user action, never
 *      automatically (D-15).
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
    preRestore: "pesaotas.pre-restore",
    device: "pesaotas.device" // device notes only (backup date, storage request) — never financial data
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

  // ---------------------------------------------------------------------------
  // Managing safety copies (decision D-15). Nothing here runs automatically:
  // deleteRecoveryItem() is called only after the user confirms in the app.
  // ---------------------------------------------------------------------------
  const LIST_KEYS = { preserved: KEYS.preserved, quarantine: KEYS.quarantine };

  /** Every safety copy with its exact text, plus whether current data is safe. */
  function readItems(storage) {
    const items = [];
    const damagedLists = [];
    const legacy = storage.getItem(KEYS.legacy);
    if (legacy !== null) items.push({ kind: "legacy", index: 0, raw: legacy, info: {} });
    for (const kind of ["preserved", "quarantine"]) {
      const list = readList(storage, LIST_KEYS[kind]);
      if (list === null) { damagedLists.push(LIST_KEYS[kind]); continue; }
      list.forEach((s, i) => {
        if (s && typeof s.raw === "string") items.push({ kind, index: i, raw: s.raw, info: s });
      });
    }
    const pr = storage.getItem(KEYS.preRestore);
    if (pr !== null) {
      const v = parseJSON(pr);
      if (v.ok && v.value && typeof v.value.raw === "string") items.push({ kind: "preRestore", index: 0, raw: v.value.raw, info: v.value });
      else damagedLists.push(KEYS.preRestore);
    }
    const current = storage.getItem(KEYS.current);
    let currentSafe = false;
    if (current !== null) {
      const parsed = parseJSON(current);
      const report = parsed.ok ? D.normalizeState(parsed.value) : null;
      currentSafe = !!(report && D.isClean(report) && report.format === "pesaotas-v2");
    }
    return { items, damagedLists, current, currentSafe };
  }
  const otherCopies = (all, item) =>
    all.items.filter(o => o !== item && o.raw === item.raw).length + (all.current === item.raw ? 1 : 0);

  /**
   * Safety copies for the management screen.
   * `copies` counts other places on this device holding exactly the same text
   * (other safety copies, or the current data). `onlyCopy` = no other copy.
   * @returns {{items:Array<{kind,index,at,reason,sourceKey,size,copies,onlyCopy}>, damagedLists:string[], currentSafe:boolean}}
   */
  function recoveryInventory(storage) {
    try {
      const all = readItems(storage);
      return {
        items: all.items.map(it => {
          const copies = otherCopies(all, it);
          return {
            kind: it.kind, index: it.index,
            at: it.info.preservedAt || it.info.quarantinedAt || it.info.savedAt || null,
            reason: it.info.reason || null, sourceKey: it.info.sourceKey || null,
            size: it.raw.length, copies, onlyCopy: copies === 0
          };
        }),
        damagedLists: all.damagedLists, currentSafe: all.currentSafe
      };
    } catch {
      return { items: [], damagedLists: [], currentSafe: false, unreadable: true };
    }
  }

  /**
   * Permanently delete one safety copy, after the user has confirmed.
   *
   * Refuses (nothing is changed) when:
   *  - "current-not-safe": the current PesaOtas data is missing or fails its
   *    checks, so the safety copies may be all that's left;
   *  - "damaged-list": the list holding it is itself damaged;
   *  - "missing" / "changed": it is no longer there, or its text differs from
   *    `expectedRaw` (for example another tab changed the list);
   *  - "only-copy": no other copy exists on this device and the user hasn't
   *    confirmed they have downloaded it (`acknowledgedOnlyCopy`).
   * The deletion is read back and verified; other copies are never touched.
   *
   * @param {"legacy"|"preserved"|"quarantine"|"preRestore"} kind
   * @returns {{ok:true} | {ok:false, reason:string}}
   */
  function deleteRecoveryItem(storage, kind, index, expectedRaw, options) {
    const acknowledged = !!(options && options.acknowledgedOnlyCopy === true);
    let all;
    try { all = readItems(storage); } catch { return { ok: false, reason: "unreadable" }; }
    if (!all.currentSafe) return { ok: false, reason: "current-not-safe" };
    const listKey = LIST_KEYS[kind];
    if ((listKey && all.damagedLists.includes(listKey)) || (kind === "preRestore" && all.damagedLists.includes(KEYS.preRestore))) {
      return { ok: false, reason: "damaged-list" };
    }
    const item = all.items.find(it => it.kind === kind && it.index === index);
    if (!item) return { ok: false, reason: "missing" };
    if (typeof expectedRaw !== "string" || item.raw !== expectedRaw) return { ok: false, reason: "changed" };
    if (otherCopies(all, item) === 0 && !acknowledged) return { ok: false, reason: "only-copy" };
    try {
      if (kind === "legacy" || kind === "preRestore") {
        const key = kind === "legacy" ? KEYS.legacy : KEYS.preRestore;
        storage.removeItem(key);
        if (storage.getItem(key) !== null) return { ok: false, reason: "write-failed" };
      } else {
        const list = readList(storage, listKey);
        const next = list.filter((_, i) => i !== index);
        if (next.length) storage.setItem(listKey, JSON.stringify(next)); else storage.removeItem(listKey);
        const back = readList(storage, listKey);
        if (!back || JSON.stringify(back) !== JSON.stringify(next)) return { ok: false, reason: "write-failed" };
      }
    } catch {
      return { ok: false, reason: "write-failed" };
    }
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // Device notes and space used (Storage protection card). Not financial data,
  // not part of backups.
  // ---------------------------------------------------------------------------
  const DEVICE_FIELDS = { lastBackupAt: "string", persistAskedAt: "string", persistGranted: "boolean" };

  function readDeviceInfo(storage) {
    try {
      const v = parseJSON(storage.getItem(KEYS.device));
      const out = {};
      if (v.ok && v.value && typeof v.value === "object") {
        for (const [k, t] of Object.entries(DEVICE_FIELDS)) if (typeof v.value[k] === t) out[k] = v.value[k];
      }
      return out;
    } catch {
      return {};
    }
  }
  /** Merge allowed fields into the device notes. @returns {boolean} confirmed */
  function updateDeviceInfo(storage, patch) {
    try {
      const next = readDeviceInfo(storage);
      for (const [k, t] of Object.entries(DEVICE_FIELDS)) if (patch && typeof patch[k] === t) next[k] = patch[k];
      const text = JSON.stringify(next);
      storage.setItem(KEYS.device, text);
      return storage.getItem(KEYS.device) === text;
    } catch {
      return false;
    }
  }
  /** Characters PesaOtas keeps in browser storage, in total and per key. */
  function storageUsage(storage) {
    const byKey = {};
    let total = 0;
    try {
      for (const key of Object.values(KEYS)) {
        const v = storage.getItem(key);
        if (v !== null) { byKey[key] = key.length + v.length; total += byKey[key]; }
      }
    } catch { /* report what was readable */ }
    return { total, byKey };
  }

  return Object.freeze({
    KEYS, load, save, keepPreRestoreCopy, listRecovery, getRecoveryText,
    recoveryInventory, deleteRecoveryItem, readDeviceInfo, updateDeviceInfo, storageUsage
  });
});
