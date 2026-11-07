/**
 * PesaOtas storage — loading, upgrading, verified saving, and the safety
 * copies that make every change recoverable.
 *
 * The storage object is passed in (localStorage in the browser, a fake in
 * tests) and the current time is passed in, so behaviour is deterministic.
 *
 * Browser: `window.PesaStorage` (load after data-model.js).
 * Node:    `require("./src/storage.js")`.
 *
 * Where data lives (v1.6, decision D-16):
 *   pesaotas.data.v3   the budget, format v3 (v1.6 and later)
 *   pesaotas.data.v2   where v1.1–v1.5 kept the budget (format v2). After the
 *                      upgrade it holds a small "moved" marker, which v1.5.0
 *                      refuses to open ("made by a newer version"). Anything an
 *                      older version writes here later never touches v3 data:
 *                      it is detected, and the user chooses which data to keep.
 *
 * Safety rules (see docs/DECISIONS.md D-02, D-09, D-15, D-16):
 *   1. The original PesaFlow key is NEVER modified by this module, and is
 *      deleted only by deleteRecoveryItem() — an explicit user action, never
 *      automatically (D-15).
 *   2. Before migrating or upgrading, the original text is copied to a safety
 *      list and read back to confirm the copy.
 *   3. Migrated or upgraded data counts as saved only after it is written,
 *      read back, compared byte-for-byte, and re-validated.
 *   4. Migration and upgrade run only when needed, so reopening the app never
 *      repeats them or duplicates anything (idempotent).
 *   5. Damaged data is copied to quarantine and left where it was. Nothing is
 *      replaced until the user chooses a recovery option.
 *   6. Invalid data is never saved.
 *   7. A save can require that the stored data is exactly what this tab last
 *      read or wrote (`expectedRaw`), so a stale tab can't overwrite newer data.
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory(require("./data-model.js"));
  else root.PesaStorage = factory(root.PesaData);
})(typeof self !== "undefined" ? self : this, function (D) {
  "use strict";

  const KEYS = Object.freeze({
    current: "pesaotas.data.v3",
    v15: "pesaotas.data.v2",                        // v1.1–v1.5 data; after the upgrade, the "moved" marker
    legacy: "pesaflow.personal.v1",
    preserved: "pesaotas.preserved.pesaflow-v1",
    preUpgrade: "pesaotas.preserved.v1-5",           // v1.5.0-format data, copied before the upgrade
    olderVersion: "pesaotas.preserved.older-version",// data set aside when an older version saved after the upgrade
    preCurrency: "pesaotas.pre-currency",            // data copied before each currency change
    reviewRecords: "pesaotas.preserved.review-records", // data kept before setting aside unreadable alert review records (D-20)
    quarantine: "pesaotas.quarantine",
    preRestore: "pesaotas.pre-restore",
    device: "pesaotas.device" // device notes only (backup date, storage request) — never financial data
  });

  /**
   * Left under the v1.5 key after the upgrade. Version 3 makes v1.1–v1.5 refuse
   * it ("This data was made by a newer version of PesaOtas"), so they can't
   * open stale data or start re-migrating PesaFlow data.
   */
  const MOVED_MARKER = JSON.stringify({
    app: D.APP_ID, version: D.SCHEMA_VERSION, movedTo: KEYS.current,
    note: "PesaOtas 1.6 and later keep this budget in a newer format. Open it with PesaOtas 1.6 or later."
  });

  /** Safety copies kept as lists, by kind (see recoveryInventory). */
  const LIST_KEYS = Object.freeze({
    preserved: KEYS.preserved, preUpgrade: KEYS.preUpgrade, olderVersion: KEYS.olderVersion,
    preCurrency: KEYS.preCurrency, quarantine: KEYS.quarantine, reviewRecords: KEYS.reviewRecords
  });

  const parseJSON = (raw) => { try { return { ok: true, value: JSON.parse(raw) }; } catch { return { ok: false }; } };
  const readList = (storage, key) => {
    const raw = storage.getItem(key);
    if (raw === null) return [];
    const p = parseJSON(raw);
    return p.ok && Array.isArray(p.value) ? p.value : null; // null = the safety list itself is damaged
  };

  /** A marker write that was cut short (a partial write of our own marker, never user data). */
  const isTruncatedMarker = (raw) => typeof raw === "string" && raw.length < MOVED_MARKER.length && MOVED_MARKER.startsWith(raw);

  /** True for the "moved" marker (and only for it). */
  function isMovedMarker(raw) {
    if (typeof raw !== "string") return false;
    const p = parseJSON(raw);
    return p.ok && p.value !== null && typeof p.value === "object" && p.value.movedTo === KEYS.current &&
      p.value.version === D.SCHEMA_VERSION && !("transactions" in p.value);
  }

  /** Check text as stored data. @returns report or null if unreadable */
  const check = (raw) => { const p = parseJSON(raw); return p.ok ? D.normalizeState(p.value) : null; };
  const isV3 = (report) => !!(report && D.isClean(report) && report.format === "pesaotas-v3");

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
      const back = readList(storage, key);
      return Array.isArray(back) && back.some(s => s && s.raw === raw);
    } catch {
      return false;
    }
  }

  /** True when `raw` is held, exactly, in one of these safety lists. */
  function heldIn(storage, keys, raw) {
    try {
      return keys.some(k => { const l = readList(storage, k); return Array.isArray(l) && l.some(s => s && s.raw === raw); });
    } catch {
      return false;
    }
  }

  /** Put the "moved" marker under the v1.5 key and confirm it. */
  function writeMovedMarker(storage) {
    try {
      storage.setItem(KEYS.v15, MOVED_MARKER);
      return storage.getItem(KEYS.v15) === MOVED_MARKER;
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
   * Load PesaOtas data, upgrading or migrating older data the first time only.
   *
   * @param {Storage} storage
   * @param {Date} now
   * @returns {{status:string, ...}}
   *   ok               – state, raw: valid saved data (format v3)
   *   upgraded         – state, raw: v1.5.0 data upgraded to v3 and verified; copy kept
   *   migrated         – state, raw: PesaFlow data moved and verified
   *   new              – nothing saved yet (nothing is written)
   *   corrupt          – sourceKey, raw, report (may contain recoverable rows), quarantined:boolean
   *   migration-failed – PesaFlow move not completed; state in memory (read-only); original untouched
   *   upgrade-failed   – the v1.5 → v1.6 upgrade could not be completed (see upgrade()). state is
   *                      shown read-only; `stage`, `copySaved`, `originalIntact` say exactly what happened
   *   older-version-conflict – v3 data exists, but an older version of PesaOtas has since saved
   *                      different data under the v1.5 key. state, raw: the v3 data; olderRaw,
   *                      olderReport: the other data. Nothing is chosen automatically.
   *   unavailable      – browser storage can't be read at all
   */
  function load(storage, now) {
    let rawCurrent, rawOld, rawLegacy;
    try {
      rawCurrent = storage.getItem(KEYS.current);
      rawOld = storage.getItem(KEYS.v15);
      rawLegacy = storage.getItem(KEYS.legacy);
    } catch {
      return { status: "unavailable" };
    }

    if (rawCurrent !== null) {
      const report = check(rawCurrent);
      if (isV3(report)) {
        const ok = { status: "ok", state: report.state, raw: rawCurrent, report };
        if (rawOld === null || isMovedMarker(rawOld) || isTruncatedMarker(rawOld)) {
          if (!isMovedMarker(rawOld) && !writeMovedMarker(storage)) return markerFailed(ok);
          return ok;
        }
        // Old-format data that is already held, exactly, in a safety copy carries
        // nothing new (for example an upgrade interrupted just before the marker
        // was written): replace it with the marker.
        if (heldIn(storage, [KEYS.preUpgrade, KEYS.olderVersion, KEYS.quarantine], rawOld)) {
          return writeMovedMarker(storage) ? ok : markerFailed(ok);
        }
        return { status: "older-version-conflict", state: report.state, raw: rawCurrent, report, olderRaw: rawOld, olderReport: check(rawOld) };
      }
      // The money data is fine; only alert review records can't be read (D-20).
      // Keep the exact original first, then let the user decide. Nothing else is written.
      if (report && report.format === "pesaotas-v3" && D.onlyReviewIssues(report)) {
        return reviewRecordsInvalid(storage, now, rawCurrent, report);
      }
      // An upgrade interrupted mid-write can leave damaged v3 text while the
      // original v1.5 data is still in place (and safely copied). Set the damaged
      // text aside, then upgrade again from the original.
      if (rawOld !== null && !isMovedMarker(rawOld) && heldIn(storage, [KEYS.preUpgrade], rawOld)) {
        const setAside = addSnapshot(storage, KEYS.quarantine, rawCurrent,
          { quarantinedAt: now.toISOString(), sourceKey: KEYS.current, reason: "Incomplete upgrade to the v1.6 format" });
        let removed = false;
        if (setAside) { try { storage.removeItem(KEYS.current); removed = storage.getItem(KEYS.current) === null; } catch { removed = false; } }
        if (removed) return upgrade(storage, now, rawOld);
      }
      return corrupt(storage, now, KEYS.current, rawCurrent, report,
        report ? "PesaOtas data failed its checks" : "PesaOtas data could not be read");
    }

    if (rawOld !== null) {
      if (isMovedMarker(rawOld)) {
        return corrupt(storage, now, KEYS.v15, rawOld, {
          ok: false, format: null, state: null, rejected: [], fixed: [], warnings: [], notes: [],
          errors: ["This budget was upgraded to the v1.6 format, but that data is no longer in this browser."]
        }, "Upgraded data is missing");
      }
      return upgrade(storage, now, rawOld);
    }

    if (rawLegacy !== null) return migrate(storage, now, rawLegacy);

    return { status: "new" };
  }

  const markerFailed = (ok) => ({ ...ok, status: "upgrade-failed", stage: "marker", copySaved: true, originalIntact: true, dataUpgraded: true });

  /**
   * `review-records-invalid` (D-20): the budget and transactions passed every
   * check, but some alert review records can't be read. The exact stored text is
   * copied to its own safety list and verified BEFORE anything is offered; the
   * app stays read-only until the user decides. `copyVerified:false` means the
   * user can't continue (only Try again or Download the original).
   */
  function reviewRecordsInvalid(storage, now, raw, report) {
    const copyVerified = keepReviewRecordsCopy(storage, now, raw);
    return { status: "review-records-invalid", state: report.state, raw, report, copyVerified };
  }

  /** Copy the original text to the review-records safety list and confirm it. Never overwrites a damaged list. */
  function keepReviewRecordsCopy(storage, now, raw) {
    return addSnapshot(storage, KEYS.reviewRecords, raw, {
      savedAt: now.toISOString(), sourceKey: KEYS.current,
      reason: "Kept before setting aside alert review records that couldn't be read (your budget and transactions were not affected)"
    });
  }

  /**
   * "Continue without these records" (D-20). Refuses unless the verified copy
   * of the original still holds exactly `originalRaw`; then saves the checked
   * data (valid records only) through the normal verified, stale-tab-checked
   * save. The safety copy is never changed or deleted here.
   * @returns {{ok:true, state, raw} | {ok:false, reason:"copy-missing"|"changed-elsewhere"|string}}
   */
  function continueWithoutInvalidReviews(storage, state, originalRaw) {
    if (typeof originalRaw !== "string" || !heldIn(storage, [KEYS.reviewRecords], originalRaw)) return { ok: false, reason: "copy-missing" };
    return save(storage, state, { expectedRaw: originalRaw });
  }

  function corrupt(storage, now, sourceKey, raw, report, reason) {
    const quarantined = addSnapshot(storage, KEYS.quarantine, raw,
      { quarantinedAt: now.toISOString(), sourceKey, reason });
    return {
      status: "corrupt", sourceKey, raw, quarantined, reason,
      report: report || { ok: false, format: null, state: null, errors: ["The saved data couldn't be read at all."], rejected: [], fixed: [], warnings: [], notes: [] }
    };
  }

  /**
   * Upgrade v1.5.0 data (format v2, under the v1.5 key) to format v3 (D-16).
   *
   *   1. check the v1.5 data (damaged → the usual quarantine and recovery)
   *   2. copy the exact original text to `preUpgrade`, read it back
   *   3. write v3 data to the new key, read back, compare, re-check
   *   4. replace the original under the v1.5 key with the "moved" marker
   *
   * On failure the result is `upgrade-failed` and says exactly what happened:
   *   stage "copy"   – the copy couldn't be saved: nothing at all was changed
   *   stage "write"  – the copy IS saved; the v3 write failed. The original v1.5
   *                    data is still in place. `cleaned` says whether the failed
   *                    write was removed (if not, the next launch sets it aside and
   *                    retries automatically).
   *   stage "marker" – the copy IS saved and the v3 data IS written and verified;
   *                    only the marker failed. Retried at the next launch.
   * The app shows the data read-only until a later launch completes the upgrade.
   */
  function upgrade(storage, now, rawOld) {
    const report = check(rawOld);
    if (!report || !D.isClean(report) || report.format !== "pesaotas-v2") {
      return corrupt(storage, now, KEYS.v15, rawOld, report,
        !report ? "PesaOtas data could not be read" : report.format === "pesaotas-v2" || !report.ok ? "PesaOtas data failed its checks" : "Unexpected data under the v1.5 key");
    }
    const state = { ...report.state, meta: { ...report.state.meta, upgradedFrom: { version: D.PREVIOUS_SCHEMA_VERSION, upgradedAt: now.toISOString() } } };
    const failed = (extra) => ({ status: "upgrade-failed", state, report, originalRaw: rawOld, originalIntact: true, dataUpgraded: false, ...extra });

    // A damaged copy list (for example a write cut short last time) would block
    // the copy forever. Set its text aside in quarantine — never delete it — and
    // start a fresh list.
    try {
      if (readList(storage, KEYS.preUpgrade) === null) {
        const damaged = storage.getItem(KEYS.preUpgrade);
        const setAside = addSnapshot(storage, KEYS.quarantine, damaged,
          { quarantinedAt: now.toISOString(), sourceKey: KEYS.preUpgrade, reason: "Damaged list of v1.5.0-format copies" });
        if (!setAside) return failed({ stage: "copy", copySaved: false });
        storage.removeItem(KEYS.preUpgrade);
      }
    } catch {
      return failed({ stage: "copy", copySaved: false });
    }
    if (!addSnapshot(storage, KEYS.preUpgrade, rawOld, { savedAt: now.toISOString(), sourceKey: KEYS.v15, format: "v1.5.0 (format v2)" })) {
      return failed({ stage: "copy", copySaved: false });
    }
    const written = writeVerified(storage, KEYS.current, state);
    if (!written.ok) {
      let cleaned = false;
      try {
        if (storage.getItem(KEYS.current) !== null) storage.removeItem(KEYS.current);
        cleaned = storage.getItem(KEYS.current) === null;
      } catch { cleaned = false; }
      let originalIntact = false;
      try { originalIntact = storage.getItem(KEYS.v15) === rawOld; } catch { originalIntact = false; }
      return failed({ stage: "write", reason: written.reason, copySaved: true, cleaned, originalIntact });
    }
    if (!writeMovedMarker(storage)) {
      return { status: "upgrade-failed", stage: "marker", state: written.state, raw: written.serialized, report, originalRaw: rawOld, copySaved: true, originalIntact: true, dataUpgraded: true };
    }
    return { status: "upgraded", state: written.state, raw: written.serialized, report };
  }

  function migrate(storage, now, rawLegacy) {
    // Rule 2: preserve the original text first, and confirm the copy.
    const preserved = addSnapshot(storage, KEYS.preserved, rawLegacy,
      { preservedAt: now.toISOString(), sourceKey: KEYS.legacy });

    const report = check(rawLegacy);
    if (!report || !D.isClean(report)) {
      return corrupt(storage, now, KEYS.legacy, rawLegacy, report,
        report ? "PesaFlow data failed its checks" : "PesaFlow data could not be read");
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
    // Stop v1.1–v1.5 from migrating the PesaFlow data again if they're ever reopened.
    if (!writeMovedMarker(storage)) return markerFailed({ state: written.state, raw: written.serialized, report });
    return { status: "migrated", state: written.state, raw: written.serialized, report };
  }

  /**
   * Save the app's state. Refuses invalid data; verifies the write.
   *
   * options.expectedRaw: the stored text this tab last read or wrote (null if
   * none). If the stored data has changed since — another tab saved — nothing is
   * written and the result is {ok:false, reason:"changed-elsewhere"}.
   *
   * @returns {{ok:true, state:object, raw:string} | {ok:false, reason:string, report?:object}}
   */
  function save(storage, state, options) {
    if (options && options.expectedRaw !== undefined) {
      let stored;
      try { stored = storage.getItem(KEYS.current); } catch { return { ok: false, reason: "write-failed" }; }
      if (stored !== options.expectedRaw) return { ok: false, reason: "changed-elsewhere" };
    }
    const result = writeVerified(storage, KEYS.current, state);
    if (!result.ok) return result;
    // Keep older versions out (best effort; checked again at every launch).
    try { if (storage.getItem(KEYS.v15) === null) writeMovedMarker(storage); } catch { /* checked at next launch */ }
    return { ok: true, state: result.state, raw: result.serialized };
  }

  /**
   * Resolve `older-version-conflict` (D-16). Both sets of data are kept: the one
   * not chosen goes to the `olderVersion` safety list, confirmed before
   * anything else changes. Refuses if either has changed since it was shown.
   *
   * @param {"keep-current"|"use-older"} choice
   * @param {{currentRaw:string, olderRaw:string}} shown  the exact texts the user saw
   * @returns {{ok:true, state:object, raw:string} | {ok:false, reason:string}}
   */
  function resolveOlderVersion(storage, now, choice, shown) {
    let cur, old;
    try { cur = storage.getItem(KEYS.current); old = storage.getItem(KEYS.v15); } catch { return { ok: false, reason: "unreadable" }; }
    if (!shown || cur !== shown.currentRaw || old !== shown.olderRaw) return { ok: false, reason: "changed" };
    const at = now.toISOString();
    if (choice === "keep-current") {
      const report = check(cur);
      if (!isV3(report)) return { ok: false, reason: "invalid" };
      if (!addSnapshot(storage, KEYS.olderVersion, old, { savedAt: at, reason: "Saved by an older version of PesaOtas after this budget was upgraded (not chosen)" })) return { ok: false, reason: "copy-failed" };
      if (!writeMovedMarker(storage)) return { ok: false, reason: "marker-failed" };
      return { ok: true, state: report.state, raw: cur };
    }
    if (choice === "use-older") {
      const older = check(old);
      if (!older || !D.isClean(older) || older.format !== "pesaotas-v2") return { ok: false, reason: "older-invalid" };
      if (!addSnapshot(storage, KEYS.olderVersion, cur, { savedAt: at, reason: "Your v1.6 data, set aside when you chose the data saved by an older version" })) return { ok: false, reason: "copy-failed" };
      const state = { ...older.state, meta: { ...older.state.meta, upgradedFrom: { version: D.PREVIOUS_SCHEMA_VERSION, upgradedAt: at } } };
      const written = writeVerified(storage, KEYS.current, state);
      if (!written.ok) {
        // Put the v1.6 data back exactly as it was (it is also in the safety copy).
        try { storage.setItem(KEYS.current, cur); } catch { /* the safety copy holds it */ }
        return { ok: false, reason: written.reason };
      }
      if (!writeMovedMarker(storage)) return { ok: false, reason: "marker-failed" };
      return { ok: true, state: written.state, raw: written.serialized };
    }
    return { ok: false, reason: "invalid-choice" };
  }

  /**
   * Keep a copy of the current data before a currency change (D-17). Each
   * change keeps its own copy; none replaces another. Verified.
   * @returns {boolean}
   */
  function keepPreCurrencyCopy(storage, now, from, to) {
    try {
      const raw = storage.getItem(KEYS.current);
      if (raw === null) return false;
      return addSnapshot(storage, KEYS.preCurrency, raw, { savedAt: now.toISOString(), from, to });
    } catch {
      return false;
    }
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
   * @param {"legacy"|"preserved"|"preUpgrade"|"olderVersion"|"preCurrency"|"quarantine"|"preRestore"} kind
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
      const key = LIST_KEYS[kind];
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

  /** Every safety copy with its exact text, plus whether current data is safe. */
  function readItems(storage) {
    const items = [];
    const damagedLists = [];
    const legacy = storage.getItem(KEYS.legacy);
    if (legacy !== null) items.push({ kind: "legacy", index: 0, raw: legacy, info: {} });
    for (const kind of ["preserved", "preUpgrade", "olderVersion", "preCurrency", "quarantine", "reviewRecords"]) {
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
      currentSafe = isV3(report);
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
            from: it.info.from || null, to: it.info.to || null,
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
   * @param {"legacy"|"preserved"|"preUpgrade"|"olderVersion"|"preCurrency"|"quarantine"|"preRestore"} kind
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
  const DEVICE_FIELDS = { lastBackupAt: "string", persistAskedAt: "string", persistGranted: "boolean", insightsPeriod: "string" };

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
    recoveryInventory, deleteRecoveryItem, readDeviceInfo, updateDeviceInfo, storageUsage,
    MOVED_MARKER, isMovedMarker, resolveOlderVersion, keepPreCurrencyCopy,
    keepReviewRecordsCopy, continueWithoutInvalidReviews
  });
});
