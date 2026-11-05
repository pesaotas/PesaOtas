/**
 * PesaOtas finance core — pure, deterministic calculations.
 *
 * Rules for this module:
 *   - No DOM access, no storage access, no network access.
 *   - No reading of the current time: callers pass "now" in explicitly.
 *   - Inputs are never mutated.
 *
 * Loading:
 *   - Browser: included with a plain <script> tag (works when index.html is
 *     opened directly from disk). Exposes `window.PesaFinance`.
 *   - Node (tests): `require("./src/finance.js")`.
 *
 * History: extracted unchanged from app.js in Phase 0; savings, linked
 * allocations, safe-to-spend and the daily guide added in Phase 2 (v1.2.0).
 * Remaining known defects: docs/KNOWN_ISSUES.md.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.PesaFinance = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MS_PER_DAY = 86400000;
  const isKind = (c, kind) => String(c.kind || "").trim().toLowerCase() === kind;
  const add = (map, key, amount) => { map[key] = (map[key] || 0) + amount; };

  /**
   * Summarise a budget state. All amounts are whole KSh.
   *
   * Transaction types (decision D-04):
   *   income              +spending cash                      counted as income
   *   expense             −spending cash                      counted as spending
   *   savings_transfer    −spending cash, +destination        NOT income or spending
   *   savings_withdrawal  +spending cash, −destination        NOT income or spending
   * (Room is left for a future "savings_adjustment" type for interest and fees;
   *  it would change a destination balance only.)
   *
   * Linked savings allocations (D-04, approved Phase 2): a Savings category with
   * `destinationId` is fulfilled by transfers to that destination, so the same
   * money is never reserved twice. Withdrawals return money to available
   * spending cash and do not re-open the allocation (D-10).
   *
   * Safe to spend (D-03):
   *   safeToSpend = clamp(flexible + unallocated, 0, max(0, cash))
   *
   * @param {object} state
   * @returns {{
   *   spent:number, earned:number,            // expenses / income only
   *   transferredToSavings:number, withdrawnFromSavings:number,
   *   cash:number,                            // spending cash
   *   spentByCategory:Object<string,number>,  // expenses only
   *   savedByCategory:Object<string,number>,  // transfers fulfilling linked Savings categories
   *   allocatedRemaining:number,              // still reserved, never < 0 per category
   *   planned:number, unallocated:number, overCount:number,
   *   flexible:number,                        // unspent allocation of Flexible categories
   *   uncategorisedSpent:number,              // expenses not in any existing category
   *   destinationBalances:Object<string,number>, totalSavings:number,
   *   safeToSpend:number
   * }}
   */
  function computeTotals(state) {
    const categories = state.categories;
    const destinations = Array.isArray(state.savingsDestinations) ? state.savingsDestinations : [];
    let spent = 0, earned = 0, transferredToSavings = 0, withdrawnFromSavings = 0;
    const spentByCategory = {};
    const transfersTo = {};
    const withdrawalsFrom = {};
    for (const t of state.transactions) {
      if (t.type === "expense") { spent += t.amount; add(spentByCategory, t.categoryId, t.amount); }
      else if (t.type === "income") earned += t.amount;
      else if (t.type === "savings_transfer") { transferredToSavings += t.amount; add(transfersTo, t.destinationId, t.amount); }
      else if (t.type === "savings_withdrawal") { withdrawnFromSavings += t.amount; add(withdrawalsFrom, t.destinationId, t.amount); }
    }
    const cash = state.openingBalance + earned - spent - transferredToSavings + withdrawnFromSavings;

    const savedByCategory = {};
    for (const c of categories) {
      if (isKind(c, "savings") && c.destinationId) savedByCategory[c.id] = transfersTo[c.destinationId] || 0;
    }
    const used = (c) => (spentByCategory[c.id] || 0) + (savedByCategory[c.id] || 0);
    const allocatedRemaining = categories.reduce((sum, c) => sum + Math.max(0, c.budget - used(c)), 0);
    const planned = categories.reduce((sum, c) => sum + c.budget, 0);
    const unallocated = cash - allocatedRemaining;
    const overCount = categories.filter(c => (spentByCategory[c.id] || 0) > c.budget).length;
    const flexible = categories
      .filter(c => isKind(c, "flexible"))
      .reduce((sum, c) => sum + Math.max(0, c.budget - (spentByCategory[c.id] || 0)), 0);

    const known = new Set(categories.map(c => c.id));
    const uncategorisedSpent = Object.keys(spentByCategory)
      .filter(id => !known.has(id))
      .reduce((sum, id) => sum + spentByCategory[id], 0);

    const destinationBalances = {};
    for (const d of destinations) {
      destinationBalances[d.id] = (d.openingBalance || 0) + (transfersTo[d.id] || 0) - (withdrawalsFrom[d.id] || 0);
    }
    const totalSavings = Object.values(destinationBalances).reduce((a, b) => a + b, 0);

    // flexible + unallocated equals cash minus what non-flexible categories still
    // reserve, so it can never exceed cash; the cap is kept as a guard (D-03).
    const safeToSpend = Math.min(Math.max(0, flexible + unallocated), Math.max(0, cash));

    return {
      spent, earned, transferredToSavings, withdrawnFromSavings, cash,
      spentByCategory, savedByCategory, allocatedRemaining, planned, unallocated, overCount, flexible,
      uncategorisedSpent, destinationBalances, totalSavings, safeToSpend
    };
  }

  /**
   * Suggested spending per day until payday (D-03): whole shillings, rounded down.
   * On payday (0 days) the whole amount is available. With no payday set, null.
   *
   * @param {number} safeToSpend
   * @param {number} days  from daysToPayday
   * @returns {number|null}
   */
  function dailyGuide(safeToSpend, days) {
    if (typeof days !== "number" || !Number.isFinite(days) || days < 0) return null;
    if (days === 0) return safeToSpend;
    return Math.floor(safeToSpend / days);
  }

  /**
   * Format whole shillings for display: "KSh 25,000", "−KSh 800".
   * Deterministic (does not depend on the browser's locale data).
   * @param {number} value
   */
  function formatKSh(value) {
    const n = Math.round(Number(value) || 0);
    const digits = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (n < 0 ? "−" : "") + "KSh " + digits;
  }

  /**
   * Whole days from the start of `now`'s calendar day (local time) until
   * payday. Returns 0 on payday and for any payday in the past.
   *
   * @param {string} paydayISO  "YYYY-MM-DD"
   * @param {Date} now          the current moment, supplied by the caller
   * @returns {number}
   */
  function daysToPayday(paydayISO, now) {
    const today = new Date(now.getTime());
    today.setHours(0, 0, 0, 0);
    const payday = new Date(`${paydayISO}T00:00:00`);
    return Math.max(0, Math.ceil((payday - today) / MS_PER_DAY));
  }

  return Object.freeze({ computeTotals, daysToPayday, dailyGuide, formatKSh });
});
