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
 * Phase 0 note: these functions were extracted from app.js WITHOUT changing
 * their behaviour. Known defects (e.g. no input validation, safe-to-spend
 * ignoring overspending) are listed in docs/KNOWN_ISSUES.md and will be fixed
 * in later phases with their own tests.
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

  /**
   * Summarise a budget state.
   *
   * @param {object} state
   * @param {number} state.openingBalance  Whole KSh held at the start of the plan.
   * @param {Array<{id:string,budget:number,kind:string}>} state.categories
   * @param {Array<{type:"income"|"expense",amount:number,categoryId:string}>} state.transactions
   * @returns {{
   *   spent:number,             // sum of recorded expenses
   *   earned:number,            // sum of recorded income
   *   cash:number,              // opening + earned - spent (actual money held)
   *   spentByCategory:Object<string,number>,
   *   allocatedRemaining:number,// sum of unspent allocation per category (never < 0 per category)
   *   planned:number,           // sum of all category allocations
   *   unallocated:number,       // cash - allocatedRemaining (negative = plan is short)
   *   overCount:number,         // categories whose spending exceeds their allocation
   *   flexible:number           // unspent allocation in "Flexible" categories only
   * }}
   */
  function computeTotals(state) {
    const expenses = state.transactions.filter(t => t.type === "expense");
    const income = state.transactions.filter(t => t.type === "income");
    const spent = expenses.reduce((sum, t) => sum + t.amount, 0);
    const earned = income.reduce((sum, t) => sum + t.amount, 0);
    const cash = state.openingBalance + earned - spent;
    const spentByCategory = {};
    expenses.forEach(t => {
      spentByCategory[t.categoryId] = (spentByCategory[t.categoryId] || 0) + t.amount;
    });
    const allocatedRemaining = state.categories.reduce(
      (sum, c) => sum + Math.max(0, c.budget - (spentByCategory[c.id] || 0)), 0);
    const planned = state.categories.reduce((sum, c) => sum + c.budget, 0);
    const unallocated = cash - allocatedRemaining;
    const overCount = state.categories.filter(c => (spentByCategory[c.id] || 0) > c.budget).length;
    const flexible = state.categories
      .filter(c => c.kind === "Flexible")
      .reduce((sum, c) => sum + Math.max(0, c.budget - (spentByCategory[c.id] || 0)), 0);
    return { spent, earned, cash, spentByCategory, allocatedRemaining, planned, unallocated, overCount, flexible };
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

  return Object.freeze({ computeTotals, daysToPayday });
});
