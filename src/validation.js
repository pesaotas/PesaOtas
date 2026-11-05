/**
 * PesaOtas validation primitives — pure functions, no DOM or storage.
 *
 * Browser: `window.PesaValidation`. Node: `require("./src/validation.js")`.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PesaValidation = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** Largest amount accepted anywhere (KSh 1 billion). Guards against typos and overflow. */
  const MAX_AMOUNT = 1000000000;
  const MIN_YEAR = 2000;
  const MAX_YEAR = 2100;
  const MAX_ID_LENGTH = 80;
  /** Keys that could tamper with JavaScript object prototypes if used as IDs. */
  const RESERVED_IDS = new Set(["__proto__", "constructor", "prototype"]);

  /**
   * Parse a whole-shilling amount.
   *
   * Accepts a finite integer number, or a string of plain digits (e.g. "2500"),
   * which is converted and flagged `coerced: true` so callers can report it.
   * Never rounds: 12.5 is rejected rather than silently changed.
   *
   * @param {*} value
   * @param {{allowZero?: boolean}} [options]  allowZero: accept 0 (balances), default false (transactions)
   * @returns {{ok:true, value:number, coerced:boolean} | {ok:false, error:string}}
   */
  function parseWholeShillings(value, options = {}) {
    const allowZero = options.allowZero === true;
    let n = value;
    let coerced = false;
    if (typeof value === "string") {
      const s = value.trim();
      if (!/^-?\d+$/.test(s)) {
        return { ok: false, error: /^-?\d*\.\d+$/.test(s) ? "must be whole shillings (no cents)" : "is not a number" };
      }
      n = Number(s);
      coerced = true;
    } else if (typeof value !== "number" || !Number.isFinite(value)) {
      return { ok: false, error: value === undefined || value === null || value === "" ? "is missing" : "is not a number" };
    }
    if (!Number.isInteger(n)) return { ok: false, error: "must be whole shillings (no cents)" };
    if (n < 0) return { ok: false, error: "cannot be negative" };
    if (n === 0 && !allowZero) return { ok: false, error: "must be more than zero" };
    if (n > MAX_AMOUNT) return { ok: false, error: "is unrealistically large" };
    return { ok: true, value: n, coerced };
  }

  /**
   * True only for a real calendar date written as YYYY-MM-DD (e.g. rejects 2026-02-30).
   * @param {*} value
   */
  function isValidISODate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [y, m, d] = value.split("-").map(Number);
    if (y < MIN_YEAR || y > MAX_YEAR || m < 1 || m > 12 || d < 1) return false;
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return d <= daysInMonth;
  }

  /**
   * True for an identifier safe to use as an object key: a non-empty string
   * without control characters, not a reserved prototype key.
   * @param {*} value
   */
  function isSafeId(value) {
    return typeof value === "string"
      && value.length > 0
      && value.length <= MAX_ID_LENGTH
      && !RESERVED_IDS.has(value)
      && !/[\u0000-\u001f\u007f]/.test(value);
  }

  /**
   * A trimmed display name, or null if not a usable non-empty string.
   * @param {*} value
   * @param {number} maxLength
   */
  function cleanName(value, maxLength) {
    if (typeof value !== "string") return null;
    const s = value.trim();
    return s.length > 0 && s.length <= maxLength ? s : null;
  }

  return Object.freeze({
    MAX_AMOUNT, MIN_YEAR, MAX_YEAR, MAX_ID_LENGTH,
    parseWholeShillings, isValidISODate, isSafeId, cleanName
  });
});
