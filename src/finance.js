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
 * allocations, safe-to-spend and the daily guide added in Phase 2 (v1.2.0);
 * pay cycles, rollover, calendar-day counting and date-ordered savings added
 * in Phase 3 (v1.3.0).
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
  const pad = (n) => String(n).padStart(2, "0");

  // ---------------------------------------------------------------------------
  // Calendar dates. Days are counted between calendar dates, never clock hours,
  // so daylight-saving changes cannot shift a count (fixes KI-16).
  // ---------------------------------------------------------------------------

  /** True for a real calendar date written YYYY-MM-DD. */
  function isISODate(iso) {
    if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }
  /** Sequential day number for a calendar date (NaN if not a date). */
  function dayNumber(iso) {
    if (!isISODate(iso)) return NaN;
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d) / MS_PER_DAY;
  }
  const fromDayNumber = (n) => { const d = new Date(n * MS_PER_DAY); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
  /** The local calendar date of a moment, as YYYY-MM-DD. */
  const localISO = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  /** Whole calendar days from one date to another (negative if `to` is earlier). */
  const daysBetween = (fromISO, toISO) => dayNumber(toISO) - dayNumber(fromISO);
  const addDays = (iso, n) => fromDayNumber(dayNumber(iso) + n);
  /** Same day `n` months later, moved back to the month's last day if needed (31 Jan → 28/29 Feb). */
  function addMonths(iso, n) {
    const [y, m, d] = iso.split("-").map(Number);
    const total = (m - 1) + n;
    const ty = y + Math.floor(total / 12), tm = ((total % 12) + 12) % 12;
    const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
    return `${ty}-${pad(tm + 1)}-${pad(Math.min(d, last))}`;
  }

  // ---------------------------------------------------------------------------
  // Totals
  // ---------------------------------------------------------------------------

  /**
   * Totals for a budget window.
   *   - Budget usage (spending, income, savings towards allocations, insights)
   *     counts only transactions dated in [start, end).
   *   - Spending cash and savings balances are real money: they count EVERY
   *     transaction dated before `end` (all of them when end is null). They are
   *     never reset by a new pay cycle.
   */
  function summarise(state, start, end) {
    const categories = state.categories;
    const destinations = Array.isArray(state.savingsDestinations) ? state.savingsDestinations : [];
    let spent = 0, earned = 0, transferredToSavings = 0, withdrawnFromSavings = 0;
    let cashFlow = 0;
    const spentByCategory = {};
    const transfersTo = {}, withdrawalsFrom = {};           // in the window
    const allTransfersTo = {}, allWithdrawalsFrom = {};     // all time (before end)
    for (const t of state.transactions) {
      if (end && !(t.date < end)) continue;
      const inWindow = !start || t.date >= start;
      if (t.type === "expense") {
        cashFlow -= t.amount;
        if (inWindow) { spent += t.amount; add(spentByCategory, t.categoryId, t.amount); }
      } else if (t.type === "income") {
        cashFlow += t.amount;
        if (inWindow) earned += t.amount;
      } else if (t.type === "savings_transfer") {
        cashFlow -= t.amount; add(allTransfersTo, t.destinationId, t.amount);
        if (inWindow) { transferredToSavings += t.amount; add(transfersTo, t.destinationId, t.amount); }
      } else if (t.type === "savings_withdrawal") {
        cashFlow += t.amount; add(allWithdrawalsFrom, t.destinationId, t.amount);
        if (inWindow) { withdrawnFromSavings += t.amount; add(withdrawalsFrom, t.destinationId, t.amount); }
      }
    }
    const cash = state.openingBalance + cashFlow;

    // Net savings towards a linked allocation in this window (D-10, Phase 3):
    // transfers minus withdrawals, never below zero.
    const savedByCategory = {};
    for (const c of categories) {
      if (isKind(c, "savings") && c.destinationId) {
        savedByCategory[c.id] = Math.max(0, (transfersTo[c.destinationId] || 0) - (withdrawalsFrom[c.destinationId] || 0));
      }
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
      destinationBalances[d.id] = (d.openingBalance || 0) + (allTransfersTo[d.id] || 0) - (allWithdrawalsFrom[d.id] || 0);
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
   * Summarise the CURRENT pay cycle. All amounts are whole KSh.
   *
   * Transaction types (decision D-04):
   *   income              +spending cash                      counted as income
   *   expense             −spending cash                      counted as spending
   *   savings_transfer    −spending cash, +destination        NOT income or spending
   *   savings_withdrawal  +spending cash, −destination        NOT income or spending
   * (Room is left for a future "savings_adjustment" type for interest and fees;
   *  it would change a destination balance only.)
   *
   * Pay cycle (Phase 3, D-12): budget usage counts transactions dated on or after
   * `state.cycleStart` (all of them when it is not set, as before). Spending cash
   * and savings balances always count every transaction.
   *
   * Linked savings allocations (D-04): transfers to the linked destination in this
   * cycle, minus withdrawals from it in this cycle (D-10), fulfil the allocation;
   * never below zero. The withdrawn money is back in cash and reserved once.
   *
   * Safe to spend (D-03):
   *   safeToSpend = clamp(flexible + unallocated, 0, max(0, cash))
   *
   * @param {object} state
   */
  function computeTotals(state) {
    return summarise(state, state.cycleStart || "", null);
  }

  /**
   * Figures for a closed (or closing) pay cycle [start, end): what was earned,
   * spent and saved in it, what each allocation had left, and the spending cash
   * held at its end (just before `end`).
   *
   * @param {object} state
   * @param {string} start  "" for "from the beginning"
   * @param {string} end    first day of the next cycle
   * @param {Object<string,number>} [budgets]  allocations used in that cycle (defaults to current)
   */
  function cycleSummary(state, start, end, budgets) {
    const cats = state.categories.map(c => ({ ...c, budget: budgets && budgets[c.id] !== undefined ? budgets[c.id] : c.budget }));
    const t = summarise({ ...state, categories: cats }, start, end);
    const categories = cats.map(c => {
      const spent = t.spentByCategory[c.id] || 0, saved = t.savedByCategory[c.id] || 0;
      return { id: c.id, name: c.name, kind: c.kind, budget: c.budget, spent, saved, left: c.budget - spent - saved };
    });
    return {
      start, end,
      lengthDays: start ? daysBetween(start, end) : null,
      earned: t.earned, spent: t.spent,
      savedNet: t.transferredToSavings - t.withdrawnFromSavings,
      transferredToSavings: t.transferredToSavings, withdrawnFromSavings: t.withdrawnFromSavings,
      closingCash: t.cash,
      planned: t.planned,
      leftInAllocations: categories.reduce((a, c) => a + Math.max(0, c.left), 0),
      overspent: categories.filter(c => c.spent > c.budget).map(c => ({ name: c.name, by: c.spent - c.budget })),
      uncategorisedSpent: t.uncategorisedSpent,
      categories
    };
  }

  /**
   * Where the current pay cycle stands today.
   * @param {object} state
   * @param {Date} now
   */
  function cycleInfo(state, now) {
    const today = localISO(now);
    const payday = isISODate(state.payday) ? state.payday : null;
    const start = isISODate(state.cycleStart) ? state.cycleStart : null;
    const lengthDays = start && payday && daysBetween(start, payday) > 0 ? daysBetween(start, payday) : null;
    return {
      today, start, payday,
      daysLeft: payday ? Math.max(0, daysBetween(today, payday)) : null,
      lengthDays,
      elapsedDays: start ? Math.max(0, daysBetween(start, today)) : null,
      rolloverDue: !!payday && today >= payday
    };
  }

  /** Suggested next payday: the same day next month (moved back for short months). */
  const suggestNextPayday = (fromISO) => addMonths(fromISO, 1);

  /**
   * Start a new pay cycle (rollover). Pure: returns a NEW state; never changes or
   * removes any transaction. The user must confirm this in the interface; it is
   * never done automatically.
   *
   *   - The closing cycle is recorded in `cycles` with its dates and allocations.
   *   - `cycleStart` becomes `start`; `payday` becomes `nextPayday`.
   *   - Spending cash and savings balances are unchanged (they are never reset).
   *   - Allocations start again: usage counts from `start`.
   *   - Optionally, a savings transfer dated `start` is added (explicit choice).
   *
   * @param {object} state
   * @param {{start:string, nextPayday:string, now:Date, transfer?:{amount:number,destinationId:string,id:string}}} o
   * @returns {{ok:true, state:object} | {ok:false, errors:string[]}}
   */
  function startNewCycle(state, o) {
    const errors = [];
    const today = localISO(o.now);
    if (!isISODate(state.payday)) errors.push("Set your payday before starting a new pay cycle.");
    if (!isISODate(o.start)) errors.push("Choose the date the new pay cycle starts.");
    else {
      if (state.cycleStart && o.start <= state.cycleStart) errors.push("The new cycle must start after the current one started.");
      if (o.start > today) errors.push("The new cycle can't start in the future.");
    }
    if (!isISODate(o.nextPayday)) errors.push("Choose your next payday.");
    else if (isISODate(o.start) && o.nextPayday <= o.start) errors.push("The next payday must be after the new cycle starts.");
    if (o.transfer) {
      const dest = (state.savingsDestinations || []).find(d => d.id === o.transfer.destinationId && !d.archived);
      if (!dest) errors.push("Choose a savings destination for the leftover money.");
      if (!Number.isInteger(o.transfer.amount) || o.transfer.amount <= 0) errors.push("The amount to save must be a whole number of shillings above zero.");
    }
    if (errors.length) return { ok: false, errors };

    const budgets = {};
    for (const c of state.categories) budgets[c.id] = c.budget;
    const record = { start: state.cycleStart || "", end: o.start, closedAt: o.now.toISOString(), budgets };
    const next = {
      ...state,
      cycleStart: o.start,
      payday: o.nextPayday,
      cycles: [...(state.cycles || []), record],
      transactions: [...state.transactions]
    };
    if (o.transfer) {
      next.transactions.push({
        id: o.transfer.id, type: "savings_transfer", amount: o.transfer.amount,
        destinationId: o.transfer.destinationId, date: o.start, note: "Leftover moved to savings at payday",
        createdAt: o.now.getTime()
      });
    }
    return { ok: true, state: next };
  }

  // ---------------------------------------------------------------------------
  // Date-ordered savings balances (fixes KI-24). Within one day, money in is
  // counted before money out.
  // ---------------------------------------------------------------------------
  function dailyNet(state, destinationId) {
    const net = new Map();
    for (const t of state.transactions) {
      if (t.destinationId !== destinationId) continue;
      if (t.type === "savings_transfer") net.set(t.date, (net.get(t.date) || 0) + t.amount);
      else if (t.type === "savings_withdrawal") net.set(t.date, (net.get(t.date) || 0) - t.amount);
    }
    return [...net.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }

  /**
   * The most that can be withdrawn from a destination on `date` without its
   * balance going below zero on that day or on any later day.
   */
  function availableToWithdraw(state, destinationId, date) {
    const dest = (state.savingsDestinations || []).find(d => d.id === destinationId);
    if (!dest) return 0;
    const days = dailyNet(state, destinationId);
    let running = dest.openingBalance || 0;
    let onDate = running;
    for (const [d, n] of days) { if (d <= date) onDate += n; }
    let lowest = onDate;
    for (const [d, n] of days) {
      running += n;
      if (d > date) lowest = Math.min(lowest, running);
    }
    return Math.max(0, lowest);
  }

  /** Balance of a destination at the end of `date` (all entries on or before it). */
  function balanceOn(state, destinationId, date) {
    const dest = (state.savingsDestinations || []).find(d => d.id === destinationId);
    if (!dest) return 0;
    return dailyNet(state, destinationId).reduce((sum, [d, n]) => (d <= date ? sum + n : sum), dest.openingBalance || 0);
  }

  /**
   * The first day each destination's balance went below zero, if any.
   * @returns {Array<{destinationId:string, date:string, balance:number}>}
   */
  function savingsOrderIssues(state) {
    const issues = [];
    for (const dest of state.savingsDestinations || []) {
      let running = dest.openingBalance || 0;
      for (const [d, n] of dailyNet(state, dest.id)) {
        running += n;
        if (running < 0) { issues.push({ destinationId: dest.id, date: d, balance: running }); break; }
      }
    }
    return issues;
  }

  /**
   * Suggested spending per day until payday (D-03): whole shillings, rounded down.
   * With 0 days the whole amount is returned; with no payday, null. (From Phase 3
   * the interface asks for a rollover instead of using the 0-day value, KI-25.)
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
   * Whole calendar days from today (local date of `now`) until payday. 0 on
   * payday and for any payday in the past; NaN with no payday.
   *
   * @param {string} paydayISO  "YYYY-MM-DD"
   * @param {Date} now          the current moment, supplied by the caller
   * @returns {number}
   */
  function daysToPayday(paydayISO, now) {
    return Math.max(0, daysBetween(localISO(now), paydayISO));
  }

  return Object.freeze({
    computeTotals, cycleSummary, cycleInfo, startNewCycle, suggestNextPayday,
    availableToWithdraw, balanceOn, savingsOrderIssues,
    daysToPayday, dailyGuide, formatKSh,
    isISODate, daysBetween, addDays, addMonths, localISO
  });
});
