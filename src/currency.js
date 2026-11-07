/**
 * PesaOtas currencies (v1.6, decision D-17).
 *
 * One currency per budget. Only the ISO 4217 code (e.g. "KES") is stored with
 * the data; everything here is how that code is named and displayed. There is
 * no exchange-rate conversion anywhere in PesaOtas: changing the currency only
 * changes the label shown next to the same numbers.
 *
 * Amounts are whole units in every currency (no cents) in v1.6.
 *
 * To add a currency later, add one entry to CURRENCIES (and a test). Nothing
 * else needs to change.
 *
 * Browser: `window.PesaCurrency`. Node: `require("./src/currency.js")`.
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PesaCurrency = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DEFAULT_CURRENCY = "KES";

  /**
   * symbol         what is shown before the amount
   * space          whether a space separates symbol and digits ("KSh 500", "$5")
   * smallPurchase  "small purchase" investigation threshold for Expense Detective
   *                (decision D-17): a hint that a pattern may be worth a look,
   *                never a judgement that the spending was unnecessary.
   */
  const CURRENCIES = Object.freeze({
    KES: Object.freeze({ code: "KES", name: "Kenyan Shilling", symbol: "KSh", space: true, smallPurchase: 500 }),
    UGX: Object.freeze({ code: "UGX", name: "Ugandan Shilling", symbol: "USh", space: true, smallPurchase: 15000 }),
    TZS: Object.freeze({ code: "TZS", name: "Tanzanian Shilling", symbol: "TSh", space: true, smallPurchase: 10000 }),
    NGN: Object.freeze({ code: "NGN", name: "Nigerian Naira", symbol: "₦", space: false, smallPurchase: 3000 }),
    ZAR: Object.freeze({ code: "ZAR", name: "South African Rand", symbol: "R", space: false, smallPurchase: 100 }),
    USD: Object.freeze({ code: "USD", name: "US Dollar", symbol: "$", space: false, smallPurchase: 5 }),
    GBP: Object.freeze({ code: "GBP", name: "British Pound", symbol: "£", space: false, smallPurchase: 5 }),
    EUR: Object.freeze({ code: "EUR", name: "Euro", symbol: "€", space: false, smallPurchase: 5 })
  });
  const CODES = Object.freeze(Object.keys(CURRENCIES));

  const isSupported = (code) => typeof code === "string" && Object.prototype.hasOwnProperty.call(CURRENCIES, code);

  /** Details of a currency; unknown codes fall back to the default (never throws). */
  const info = (code) => CURRENCIES[isSupported(code) ? code : DEFAULT_CURRENCY];

  /** "Kenyan Shilling (KES)" */
  const label = (code) => `${info(code).name} (${info(code).code})`;

  // Digit grouping comes from the built-in Intl.NumberFormat ("en": 1,234,567),
  // which every browser and Node formats the same way. The symbol comes from
  // the table above rather than the browser's locale data, because browsers
  // disagree on symbols (for example "Ksh" vs "KSh").
  let grouping = null;
  function digits(n) {
    if (!grouping) {
      try { grouping = new Intl.NumberFormat("en", { maximumFractionDigits: 0, useGrouping: true }); }
      catch { grouping = { format: (x) => String(x).replace(/\B(?=(\d{3})+(?!\d))/g, ",") }; }
    }
    return grouping.format(n);
  }

  /**
   * Format a whole amount, e.g. format(25000, "KES") → "KSh 25,000",
   * format(-800, "USD") → "−$800". Rounds to whole units.
   * @param {number} value
   * @param {string} [code]  ISO 4217 code; default KES
   */
  function format(value, code) {
    const c = info(code);
    const n = Math.round(Number(value) || 0);
    // A non-breaking space, so "KSh 25,000" never wraps across two lines (same as v1.5).
    return (n < 0 ? "−" : "") + c.symbol + (c.space ? "\u00A0" : "") + digits(Math.abs(n));
  }

  return Object.freeze({ DEFAULT_CURRENCY, CURRENCIES, CODES, isSupported, info, label, format });
});
