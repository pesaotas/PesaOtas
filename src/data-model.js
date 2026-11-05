/**
 * PesaOtas data model — schema v2, conversion from PesaFlow v1, and checking
 * of any data before it is used, saved or restored. Pure: no DOM or storage.
 *
 * Browser: `window.PesaData` (load after validation.js and finance.js).
 * Node:    `require("./src/data-model.js")`.
 *
 * Every check produces a report so the user can see exactly what happens:
 *   errors    – the data cannot be used at all (nothing is changed)
 *   rejected  – items that would be LEFT OUT (data loss; never automatic)
 *   fixed     – lossless corrections, e.g. "2500" (text) → 2500
 *   warnings  – kept as-is but worth checking
 *   notes     – informational, e.g. default savings destinations added
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./validation.js"), require("./finance.js"));
  } else {
    root.PesaData = factory(root.PesaValidation, root.PesaFinance);
  }
})(typeof self !== "undefined" ? self : this, function (V, F) {
  "use strict";

  const SCHEMA_VERSION = 2;
  const APP_ID = "PesaOtas";
  const MAX_BACKUP_CHARS = 5000000; // ~5 MB, about LocalStorage's own limit
  const MAX_NOTE_LENGTH = 200;
  const SAVINGS_TYPES = new Set(["savings_transfer", "savings_withdrawal"]);

  /** Built-in savings destinations (decision D-04). Users may add others later. */
  const DEFAULT_DESTINATIONS = Object.freeze([
    Object.freeze({ id: "kcb-mpesa", name: "KCB M-PESA", openingBalance: 0, archived: false, builtIn: true }),
    Object.freeze({ id: "m-shwari", name: "M-Shwari", openingBalance: 0, archived: false, builtIn: true })
  ]);

  const isObject = (o) => o !== null && typeof o === "object" && !Array.isArray(o);
  const ksh = (n) => "KSh " + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const show = (v) => {
    const s = typeof v === "string" ? `"${v}"` : JSON.stringify(v);
    return s === undefined ? "nothing" : (s.length > 30 ? s.slice(0, 27) + "…" : s);
  };
  const defaultDestinations = () => DEFAULT_DESTINATIONS.map(d => ({ ...d }));

  /** An empty plan: no categories, no transactions, no payday yet. */
  function createBlankState() {
    return {
      app: APP_ID, version: SCHEMA_VERSION, currency: "KES",
      openingBalance: 0, payday: "",
      categories: [], transactions: [],
      savingsDestinations: defaultDestinations(),
      meta: {}
    };
  }

  function rowLabel(i, raw) {
    const bits = [];
    if (isObject(raw)) {
      if (typeof raw.date === "string" && raw.date) bits.push(raw.date.slice(0, 10));
      if (typeof raw.note === "string" && raw.note.trim()) bits.push(`"${raw.note.trim().slice(0, 30)}"`);
    }
    return `Transaction ${i + 1}${bits.length ? ` (${bits.join(", ")})` : ""}`;
  }

  /**
   * Check and normalise a PesaOtas v2 or PesaFlow v1 object into schema v2.
   * Never mutates `input`.
   *
   * @param {*} input  parsed JSON
   * @returns {{ok:boolean, format:string|null, state:object|null,
   *            errors:string[], rejected:string[], fixed:string[], warnings:string[], notes:string[]}}
   */
  function normalizeState(input) {
    const r = { ok: false, format: null, state: null, errors: [], rejected: [], fixed: [], warnings: [], notes: [] };

    if (!isObject(input)) {
      r.errors.push("This isn't PesaOtas or PesaFlow budget data.");
      return r;
    }
    if (input.version === SCHEMA_VERSION && input.app === APP_ID) r.format = "pesaotas-v2";
    else if (input.version === 1) r.format = "pesaflow-v1";
    else if (typeof input.version === "number" && input.version > SCHEMA_VERSION) {
      r.errors.push("This data was made by a newer version of PesaOtas. Update the app, then try again.");
      return r;
    } else {
      r.errors.push("This isn't a recognised PesaOtas or PesaFlow format (missing or unknown version).");
      return r;
    }

    // --- Settings -----------------------------------------------------------
    const opening = V.parseWholeShillings(input.openingBalance, { allowZero: true });
    let openingBalance = 0;
    if (!opening.ok) r.errors.push(`The opening balance ${opening.error} (found ${show(input.openingBalance)}).`);
    else {
      openingBalance = opening.value;
      if (opening.coerced) r.fixed.push(`Opening balance was stored as text ${show(input.openingBalance)}; read as ${ksh(opening.value)}.`);
    }

    let payday = "";
    if (input.payday === "" || input.payday === undefined || input.payday === null) payday = "";
    else if (V.isValidISODate(input.payday)) payday = input.payday;
    else r.rejected.push(`Payday ${show(input.payday)} is not a valid date and will be cleared — set it again in Settings.`);

    // --- Categories (problems here are fatal: transactions depend on them) ---
    const categories = [];
    const categoryIds = new Set();
    if (!Array.isArray(input.categories)) {
      r.errors.push("The budget categories are missing or damaged.");
    } else {
      input.categories.forEach((c, i) => {
        const where = `Budget category ${i + 1}`;
        if (!isObject(c)) { r.errors.push(`${where} is not a valid entry.`); return; }
        const name = V.cleanName(c.name, 60);
        const label = name ? `Budget category "${name}"` : where;
        if (!V.isSafeId(c.id)) { r.errors.push(`${label} has a missing or invalid ID.`); return; }
        if (categoryIds.has(c.id)) { r.errors.push(`${label} uses the same ID as another category ("${c.id}").`); return; }
        if (!name) { r.errors.push(`${where} has no usable name.`); return; }
        const budget = V.parseWholeShillings(c.budget, { allowZero: true });
        if (!budget.ok) { r.errors.push(`${label}: the allocation ${budget.error} (found ${show(c.budget)}).`); return; }
        if (budget.coerced) r.fixed.push(`${label}: allocation stored as text; read as ${ksh(budget.value)}.`);
        let kind = V.cleanName(c.kind, 20);
        if (!kind) { kind = "Other"; r.fixed.push(`${label}: missing category type set to "Other".`); }
        categoryIds.add(c.id);
        categories.push({ id: c.id, name, budget: budget.value, kind });
      });
    }

    // --- Transactions (problems reject the individual row) -------------------
    const transactions = [];
    const byId = new Map();
    if (!Array.isArray(input.transactions)) {
      r.errors.push("The transaction list is missing or damaged.");
    } else {
      input.transactions.forEach((t, i) => {
        const label = rowLabel(i, t);
        const reject = (why) => r.rejected.push(`${label} ${why} — it will be left out.`);
        if (!isObject(t)) return reject("is not a valid entry");

        if (SAVINGS_TYPES.has(t.type)) return reject("is a savings entry, which this version can't use yet");
        if (t.type !== "income" && t.type !== "expense") return reject(`has an unknown type ${show(t.type)}`);

        const amount = V.parseWholeShillings(t.amount);
        if (!amount.ok) return reject(`has an amount that ${amount.error} (found ${show(t.amount)})`);

        if (!V.isValidISODate(t.date)) return reject(`has ${t.date ? `an invalid date ${show(t.date)}` : "no date"}`);

        let id = t.id;
        if (id === undefined || id === null || id === "") {
          let n = i + 1;
          do { id = `restored-${n++}`; } while (byId.has(id));
          r.fixed.push(`${label} had no ID; one was assigned.`);
        } else if (!V.isSafeId(id)) return reject("has an invalid ID");

        let categoryId = t.categoryId;
        if (categoryId === undefined || categoryId === null || categoryId === "") {
          categoryId = "other";
          r.fixed.push(`${label} had no category; set to "Other".`);
        } else if (!V.isSafeId(categoryId)) return reject("has an invalid category");

        let note = "";
        if (typeof t.note === "string") note = t.note.trim();
        else if (typeof t.note === "number") { note = String(t.note); r.fixed.push(`${label}: description stored as a number; kept as text.`); }
        if (note.length > MAX_NOTE_LENGTH) {
          note = note.slice(0, MAX_NOTE_LENGTH);
          r.warnings.push(`${label}: description was longer than ${MAX_NOTE_LENGTH} characters and was shortened.`);
        }

        let createdAt = t.createdAt;
        if (typeof createdAt !== "number" || !Number.isFinite(createdAt) || createdAt < 0) {
          if (createdAt !== undefined) r.fixed.push(`${label}: invalid creation time reset (affects only same-day ordering).`);
          createdAt = 0;
        }

        if (amount.coerced) r.fixed.push(`${label}: amount stored as text ${show(t.amount)}; read as ${ksh(amount.value)}.`);

        const row = { id, type: t.type, amount: amount.value, categoryId, date: t.date, note, createdAt };
        const fingerprint = JSON.stringify([row.type, row.amount, row.categoryId, row.date, row.note, row.createdAt]);
        if (byId.has(id)) {
          const first = byId.get(id);
          if (first.fingerprint === fingerprint) {
            r.fixed.push(`${label} is an exact duplicate of transaction ${first.index + 1}; the copy was removed so it isn't counted twice.`);
          } else {
            reject(`shares an ID with transaction ${first.index + 1} but has different details`);
          }
          return;
        }
        byId.set(id, { index: i, fingerprint });
        if (categoryId !== "other" && !categoryIds.has(categoryId) && r.errors.length === 0 && Array.isArray(input.categories)) {
          r.warnings.push(`${label} refers to a budget category that doesn't exist; it will show as "Other".`);
        }
        transactions.push(row);
      });

      // Same details, different IDs: could be genuine (two KSh 50 fares in a day). Warn only.
      const groups = new Map();
      transactions.forEach(t => {
        const key = [t.type, t.amount, t.categoryId, t.date, t.note].join("|");
        groups.set(key, (groups.get(key) || 0) + 1);
      });
      for (const [key, count] of groups) {
        if (count > 1) {
          const [type, amount, , date, note] = key.split("|");
          r.warnings.push(`${count} ${type === "income" ? "income" : "expense"} entries look identical (${date}, ${ksh(Number(amount))}${note ? `, "${note.slice(0, 30)}"` : ""}). All are kept — check they aren't duplicates.`);
        }
      }
    }

    // --- Savings destinations (schema v2; KCB M-PESA and M-Shwari by default) ---
    let savingsDestinations;
    if (r.format === "pesaflow-v1" || input.savingsDestinations === undefined) {
      savingsDestinations = defaultDestinations();
      r.notes.push("Default savings destinations added: KCB M-PESA and M-Shwari (balance KSh 0 each).");
    } else if (!Array.isArray(input.savingsDestinations)) {
      r.errors.push("The savings destinations list is damaged.");
    } else {
      savingsDestinations = [];
      const ids = new Set();
      input.savingsDestinations.forEach((d, i) => {
        const where = `Savings destination ${i + 1}`;
        if (!isObject(d)) { r.errors.push(`${where} is not a valid entry.`); return; }
        const name = V.cleanName(d.name, 40);
        const label = name ? `Savings destination "${name}"` : where;
        if (!V.isSafeId(d.id) || ids.has(d.id)) { r.errors.push(`${label} has a missing, invalid or repeated ID.`); return; }
        if (!name) { r.errors.push(`${where} has no usable name.`); return; }
        const bal = V.parseWholeShillings(d.openingBalance === undefined ? 0 : d.openingBalance, { allowZero: true });
        if (!bal.ok) { r.errors.push(`${label}: the opening balance ${bal.error} (found ${show(d.openingBalance)}).`); return; }
        if (bal.coerced) r.fixed.push(`${label}: opening balance stored as text; read as ${ksh(bal.value)}.`);
        ids.add(d.id);
        savingsDestinations.push({ id: d.id, name, openingBalance: bal.value, archived: d.archived === true, builtIn: d.builtIn === true });
      });
    }

    if (r.errors.length) return r;

    const meta = {};
    if (isObject(input.meta)) {
      if (typeof input.meta.createdAt === "string") meta.createdAt = input.meta.createdAt;
      if (isObject(input.meta.migratedFrom) && typeof input.meta.migratedFrom.key === "string") {
        meta.migratedFrom = { key: input.meta.migratedFrom.key, migratedAt: String(input.meta.migratedFrom.migratedAt || "") };
      }
    }
    const state = {
      app: APP_ID, version: SCHEMA_VERSION, currency: "KES",
      openingBalance, payday, categories, transactions, savingsDestinations, meta
    };
    if (typeof input.month === "string" && /^\d{4}-\d{2}$/.test(input.month)) state.month = input.month;

    r.ok = true;
    r.state = state;
    return r;
  }

  /** True when a report can be applied with no loss and no user decision. */
  const isClean = (report) => report.ok && report.rejected.length === 0;

  /** Plain facts about a (valid) state, for previews. */
  function summarize(state) {
    const t = F.computeTotals(state);
    const dates = state.transactions.map(x => x.date).sort();
    return {
      openingBalance: state.openingBalance,
      payday: state.payday,
      categoryCount: state.categories.length,
      transactionCount: state.transactions.length,
      incomeCount: state.transactions.filter(x => x.type === "income").length,
      expenseCount: state.transactions.filter(x => x.type === "expense").length,
      incomeTotal: t.earned,
      expenseTotal: t.spent,
      cash: t.cash,
      firstDate: dates[0] || null,
      lastDate: dates[dates.length - 1] || null,
      destinations: state.savingsDestinations.filter(d => !d.archived).map(d => d.name)
    };
  }

  /**
   * Analyse the text of a backup file before anything is restored.
   * @param {string} text
   * @returns {ReturnType<typeof normalizeState> & {summary?: object}}
   */
  function analyzeBackup(text) {
    const empty = { ok: false, format: null, state: null, errors: [], rejected: [], fixed: [], warnings: [], notes: [] };
    if (typeof text !== "string" || !text.trim()) return { ...empty, errors: ["The file is empty."] };
    if (text.length > MAX_BACKUP_CHARS) return { ...empty, errors: ["The file is too large to be a PesaOtas backup."] };
    let parsed;
    try { parsed = JSON.parse(text); } catch {
      return { ...empty, errors: ["This file couldn't be read. It isn't a valid backup (or it has been damaged)."] };
    }
    const report = normalizeState(parsed);
    if (report.ok) report.summary = summarize(report.state);
    return report;
  }

  /** Text for a backup file. */
  const serializeBackup = (state) => JSON.stringify(state, null, 2);

  return Object.freeze({
    SCHEMA_VERSION, APP_ID, MAX_BACKUP_CHARS, DEFAULT_DESTINATIONS,
    createBlankState, normalizeState, isClean, summarize, analyzeBackup, serializeBackup
  });
});
