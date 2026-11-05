/**
 * PesaOtas entries and categories — the rules for adding, editing and deleting
 * transactions and budget categories. Pure: returns new data and messages; never
 * touches the page or storage. The interface shows the messages and asks for
 * confirmation where needed, then saves through src/storage.js.
 *
 * Browser: `window.PesaEntries` (load after validation, finance, data-model).
 * Node:    `require("./src/entries.js")`.
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./validation.js"), require("./finance.js"), require("./data-model.js"));
  } else {
    root.PesaEntries = factory(root.PesaValidation, root.PesaFinance, root.PesaData);
  }
})(typeof self !== "undefined" ? self : this, function (V, F, D) {
  "use strict";

  const TYPES = ["expense", "income", "savings_transfer", "savings_withdrawal"];
  const SAVINGS = new Set(["savings_transfer", "savings_withdrawal"]);
  const MAX_NOTE = 200;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const RESERVED = new Set(D.RESERVED_CATEGORY_IDS);
  const OTHER = D.UNCATEGORISED_ID;

  /** "2026-11-05" → "5 Nov 2026" (deterministic, matches the app's dates). */
  const fmtDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
  const ksh = (n) => F.formatKSh(n);
  const destName = (state, id) => ((state.savingsDestinations || []).find(d => d.id === id) || {}).name || "Savings";

  /** Suggested category NAMES for a new user — every allocation starts at KSh 0. */
  const SUGGESTED_CATEGORIES = Object.freeze([
    { name: "Rent", kind: "Bills" },
    { name: "Food", kind: "Essential" },
    { name: "Transport", kind: "Essential" },
    { name: "Electricity & water", kind: "Bills" },
    { name: "Airtime & data", kind: "Essential" },
    { name: "Savings", kind: "Savings" },
    { name: "Eating out & fun", kind: "Flexible" },
    { name: "Miscellaneous", kind: "Flexible" }
  ].map(Object.freeze));

  /** The first destination whose balance would go below zero on some day, that wasn't already. */
  function newSavingsIssue(before, after) {
    const had = new Set(F.savingsOrderIssues(before).map(i => i.destinationId));
    return F.savingsOrderIssues(after).find(i => !had.has(i.destinationId)) || null;
  }

  // ---------------------------------------------------------------------------
  // Transactions
  // ---------------------------------------------------------------------------

  /**
   * Check a new or edited entry. The same rules apply to both.
   *
   * @param {object} state
   * @param {{type:string, amount:*, date:string, categoryId?:string, destinationId?:string, note?:string}} input
   * @param {{replacingId?:string, newId?:string, now:Date}} opts
   * @returns {{ok:false, errors:string[]} |
   *           {ok:true, entry:object, state:object, confirms:Array<{code:string,message:string}>}}
   *   `state` is the new state with the entry added or replaced in place.
   *   `confirms` must each be confirmed by the user before saving.
   */
  function validateEntry(state, input, opts) {
    const errors = [];
    const original = opts.replacingId ? state.transactions.find(t => t.id === opts.replacingId) : null;
    if (opts.replacingId && !original) return { ok: false, errors: ["That entry no longer exists."] };
    const base = original ? { ...state, transactions: state.transactions.filter(t => t !== original) } : state;

    const type = input.type;
    if (!TYPES.includes(type)) errors.push("Choose what kind of entry this is.");
    const amount = V.parseWholeShillings(input.amount);
    if (!amount.ok) errors.push(`Amount ${amount.error}.`);
    const date = input.date;
    if (!V.isValidISODate(date)) errors.push("Choose a valid date.");
    const note = typeof input.note === "string" ? input.note.trim().slice(0, MAX_NOTE) : "";
    if (errors.length) return { ok: false, errors };

    const id = original ? original.id : opts.newId;
    const createdAt = original ? original.createdAt : opts.now.getTime();
    let entry;
    if (SAVINGS.has(type)) {
      const destinationId = input.destinationId;
      const dest = (state.savingsDestinations || []).find(d => d.id === destinationId && !d.archived);
      if (!dest) return { ok: false, errors: ["Choose a savings destination."] };
      if (type === "savings_withdrawal") {
        const available = F.availableToWithdraw(base, destinationId, date);
        if (amount.value > available) {
          const held = F.balanceOn(base, destinationId, date);
          const later = available < held
            ? ` ${ksh(held - available)} of that is needed for withdrawals recorded later, so you can withdraw up to ${ksh(available)}.`
            : "";
          return { ok: false, errors: [`Not saved. ${dest.name} holds ${ksh(held)} on ${fmtDate(date)}.${later}`] };
        }
      }
      entry = { id, type, amount: amount.value, destinationId, date, note, createdAt };
    } else {
      const categoryId = input.categoryId;
      const valid = type === "income"
        ? D.INCOME_SOURCES.some(s => s.id === categoryId)
        : categoryId === OTHER || state.categories.some(c => c.id === categoryId);
      if (!valid) return { ok: false, errors: [type === "income" ? "Choose an income source." : "Choose a category."] };
      entry = { id, type, amount: amount.value, categoryId, date, note, createdAt };
    }
    if (!V.isSafeId(entry.id)) return { ok: false, errors: ["Couldn't create an ID for this entry. Try again."] };

    const next = {
      ...state,
      transactions: original
        ? state.transactions.map(t => (t === original ? entry : t))
        : [...state.transactions, entry]
    };

    // Changing or adding an entry must never leave a savings destination below zero on any day.
    const issue = newSavingsIssue(state, next);
    if (issue) {
      return { ok: false, errors: [`Not saved: ${destName(state, issue.destinationId)} would hold ${ksh(issue.balance)} on ${fmtDate(issue.date)}, because a withdrawal recorded later depends on this money. Change or delete that withdrawal first.`] };
    }

    const confirms = [];
    if (state.cycleStart && date < state.cycleStart && (!original || original.date !== date)) {
      confirms.push({ code: "backdated", message: `This date is before your current pay cycle (which started ${fmtDate(state.cycleStart)}). It will be saved in your history and will change your cash, but it won't count against this cycle's budget. Record it?` });
    }
    if (type === "savings_transfer") {
      const cash = F.computeTotals(base).cash;
      if (amount.value > Math.max(0, cash)) {
        confirms.push({ code: "over-cash", message: `This transfer of ${ksh(amount.value)} is more than your spending cash (${ksh(cash)}). Your spending cash would go below zero. Record it anyway?` });
      }
    }
    return { ok: true, entry, state: next, confirms };
  }

  /**
   * Check whether an entry can be deleted.
   * @returns {{ok:true, state:object} | {ok:false, error:string}}
   */
  function validateDelete(state, id) {
    const tx = state.transactions.find(t => t.id === id);
    if (!tx) return { ok: false, error: "That entry no longer exists." };
    const next = { ...state, transactions: state.transactions.filter(t => t !== tx) };
    const issue = newSavingsIssue(state, next);
    if (issue) {
      return { ok: false, error: `Can't delete this: ${destName(state, issue.destinationId)} would hold ${ksh(issue.balance)} on ${fmtDate(issue.date)}. Delete the later withdrawal first.` };
    }
    return { ok: true, state: next };
  }

  // ---------------------------------------------------------------------------
  // Categories
  // ---------------------------------------------------------------------------

  /** How a category is used, so the interface can protect it. */
  function categoryUsage(state, id) {
    const c = state.categories.find(x => x.id === id);
    const txs = state.transactions.filter(t => t.type === "expense" && t.categoryId === id);
    return {
      exists: !!c,
      transactionCount: txs.length,
      totalSpent: txs.reduce((a, t) => a + t.amount, 0),
      allocation: c ? c.budget : 0,
      linkedTo: c && c.destinationId ? c.destinationId : null
    };
  }

  /** A fresh category ID that is never reserved or already used (KI-21). */
  function newCategoryId(state, random) {
    const used = new Set(state.categories.map(c => c.id));
    let n = 0, id;
    do { id = `cat-${random}${n ? `-${n}` : ""}`; n++; } while (used.has(id) || RESERVED.has(id) || !V.isSafeId(id));
    return id;
  }

  /**
   * Check a new or edited category.
   * @param {object} state
   * @param {{name:*, kind:*, budget:*, destinationId?:string}} input
   * @param {{editingId?:string, newId?:string}} opts
   * @returns {{ok:false, errors:string[]} | {ok:true, category:object, state:object, notes:string[]}}
   */
  function validateCategory(state, input, opts) {
    const errors = [], notes = [];
    const original = opts.editingId ? state.categories.find(c => c.id === opts.editingId) : null;
    if (opts.editingId && !original) return { ok: false, errors: ["That category no longer exists."] };

    const name = V.cleanName(input.name, 40);
    if (!name) errors.push("Give the category a name (up to 40 characters).");
    else if (state.categories.some(c => c !== original && c.name.toLowerCase() === name.toLowerCase())) {
      errors.push(`You already have a category called "${name}".`);
    }
    const kind = D.canonicalType(input.kind);
    if (!kind) errors.push(`Choose a type: ${D.CATEGORY_TYPES.join(", ")}.`);
    const budget = V.parseWholeShillings(input.budget === "" || input.budget === undefined ? 0 : input.budget, { allowZero: true });
    if (!budget.ok) errors.push(`The allocation ${budget.error}.`);

    let destinationId = null;
    if (kind === "Savings" && input.destinationId) {
      const dest = (state.savingsDestinations || []).find(d => d.id === input.destinationId && !d.archived);
      const taken = state.categories.find(c => c !== original && c.destinationId === input.destinationId);
      if (!dest) errors.push("Choose a savings destination that exists.");
      else if (taken) errors.push(`"${taken.name}" is already linked to ${dest.name}. Only one category can be linked to each destination.`);
      else destinationId = dest.id;
    }
    if (original && original.destinationId && kind && kind !== "Savings") {
      notes.push(`The link to ${destName(state, original.destinationId)} will be removed, because only Savings categories can be linked.`);
    }
    if (original && original.kind !== kind && kind && (original.kind === "Flexible" || kind === "Flexible")) {
      notes.push(kind === "Flexible"
        ? "As a Flexible category, its unspent money will count towards safe to spend."
        : "It will no longer be Flexible, so its unspent money will be set aside instead of counting towards safe to spend.");
    }
    if (errors.length) return { ok: false, errors };

    const id = original ? original.id : opts.newId;
    if (!V.isSafeId(id) || RESERVED.has(id) || (!original && state.categories.some(c => c.id === id))) {
      return { ok: false, errors: ["Couldn't create an ID for this category. Try again."] };
    }
    const category = { id, name, budget: budget.value, kind };
    if (destinationId) category.destinationId = destinationId;
    const next = {
      ...state,
      categories: original ? state.categories.map(c => (c === original ? category : c)) : [...state.categories, category]
    };
    return { ok: true, category, state: next, notes };
  }

  /**
   * Delete a category. If any transactions use it, the user must choose where
   * they go (`moveTo`: another category's ID, or "other" for uncategorised).
   * Nothing is ever moved or removed silently.
   * @returns {{ok:false, errors:string[]} | {ok:true, state:object, moved:number, released:number}}
   */
  function deleteCategory(state, id, moveTo) {
    const usage = categoryUsage(state, id);
    if (!usage.exists) return { ok: false, errors: ["That category no longer exists."] };
    if (usage.transactionCount > 0) {
      const target = moveTo === OTHER || state.categories.some(c => c.id === moveTo && c.id !== id);
      if (!moveTo || !target) {
        return { ok: false, errors: [`Choose where this category's ${usage.transactionCount} transaction${usage.transactionCount === 1 ? "" : "s"} should go before deleting it.`] };
      }
    }
    const next = {
      ...state,
      categories: state.categories.filter(c => c.id !== id),
      transactions: usage.transactionCount
        ? state.transactions.map(t => (t.type === "expense" && t.categoryId === id ? { ...t, categoryId: moveTo } : t))
        : state.transactions
    };
    return { ok: true, state: next, moved: usage.transactionCount, released: usage.allocation };
  }

  /** Add the suggested category names (KSh 0 each) that the user doesn't already have. */
  function addSuggestedCategories(state, randomFor) {
    let next = state;
    let added = 0;
    SUGGESTED_CATEGORIES.forEach((s, i) => {
      if (next.categories.some(c => c.name.toLowerCase() === s.name.toLowerCase())) return;
      const r = validateCategory(next, { name: s.name, kind: s.kind, budget: 0 }, { newId: newCategoryId(next, randomFor(i)) });
      if (r.ok) { next = r.state; added++; }
    });
    return { state: next, added };
  }

  return Object.freeze({
    SUGGESTED_CATEGORIES,
    validateEntry, validateDelete,
    categoryUsage, newCategoryId, validateCategory, deleteCategory, addSuggestedCategories
  });
});
