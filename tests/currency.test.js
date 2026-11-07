/**
 * Currencies (v1.6, decision D-17): every supported currency is named and
 * formatted consistently, KES looks exactly as it did in v1.5.0, and nothing
 * is ever converted.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const C = require("../src/currency.js");
const { formatKSh } = require("../src/finance.js");

const NB = " "; // non-breaking space between a letter symbol and the digits

describe("supported currencies", () => {
  it("are exactly the eight approved for v1.6, with KES as the default", () => {
    assert.deepEqual([...C.CODES].sort(), ["EUR", "GBP", "KES", "NGN", "TZS", "UGX", "USD", "ZAR"]);
    assert.equal(C.DEFAULT_CURRENCY, "KES");
  });

  it("each has a name, symbol and the approved small-purchase threshold", () => {
    const expected = { KES: 500, UGX: 15000, TZS: 10000, NGN: 3000, ZAR: 100, USD: 5, GBP: 5, EUR: 5 };
    for (const code of C.CODES) {
      const c = C.info(code);
      assert.equal(c.code, code);
      assert.ok(c.name.length > 2 && c.symbol.length >= 1, code);
      assert.equal(c.smallPurchase, expected[code], code);
    }
  });

  it("recognises only supported codes (case-sensitive, no symbols or names)", () => {
    for (const code of C.CODES) assert.equal(C.isSupported(code), true);
    for (const bad of ["kes", "KSh", "$", "JPY", "", null, undefined, 1, "Kenyan Shilling", "__proto__", "toString"]) {
      assert.equal(C.isSupported(bad), false, String(bad));
    }
  });

  it("labels read naturally", () => {
    assert.equal(C.label("KES"), "Kenyan Shilling (KES)");
    assert.equal(C.label("USD"), "US Dollar (USD)");
    assert.equal(C.label("ZAR"), "South African Rand (ZAR)");
  });
});

describe("formatting", () => {
  const cases = {
    KES: [`KSh${NB}25,000`, `−KSh${NB}800`, `KSh${NB}0`],
    UGX: [`USh${NB}25,000`, `−USh${NB}800`, `USh${NB}0`],
    TZS: [`TSh${NB}25,000`, `−TSh${NB}800`, `TSh${NB}0`],
    NGN: ["₦25,000", "−₦800", "₦0"],
    ZAR: ["R25,000", "−R800", "R0"],
    USD: ["$25,000", "−$800", "$0"],
    GBP: ["£25,000", "−£800", "£0"],
    EUR: ["€25,000", "−€800", "€0"]
  };
  for (const [code, [pos, neg, zero]] of Object.entries(cases)) {
    it(`${code}: ${pos}, ${neg}, ${zero}`, () => {
      assert.equal(C.format(25000, code), pos);
      assert.equal(C.format(-800, code), neg);
      assert.equal(C.format(0, code), zero);
      assert.equal(C.format(1234567890, code), pos.replace("25,000", "1,234,567,890"));
    });
  }

  it("KES looks exactly as in v1.5.0, for every amount tried", () => {
    for (let v = -3000000; v <= 3000000; v += 997) assert.equal(C.format(v, "KES"), formatKSh(v), String(v));
    for (const v of [0, 1, 999, 1000, 999999, 1000000, 999.6, -0.4, "2500", null]) assert.equal(C.format(v, "KES"), formatKSh(v), String(v));
  });

  it("rounds to whole units and never converts", () => {
    assert.equal(C.format(999.6, "USD"), "$1,000");
    assert.equal(C.format(-0.4, "USD"), "$0");
    // The same number in every currency: only the label differs.
    const digits = C.CODES.map(c => C.format(54321, c).replace(/[^\d,]/g, ""));
    assert.ok(digits.every(d => d === "54,321"), digits.join(" "));
  });

  it("falls back to KES for an unknown or missing code instead of throwing", () => {
    assert.equal(C.format(500), `KSh${NB}500`);
    assert.equal(C.format(500, "XYZ"), `KSh${NB}500`);
    assert.equal(C.info("XYZ").code, "KES");
  });

  it("the table can't be changed at run time", () => {
    assert.throws(() => { "use strict"; C.CURRENCIES.KES.symbol = "X"; });
    assert.throws(() => { "use strict"; C.CURRENCIES.JPY = {}; });
    assert.equal(C.format(1, "KES"), `KSh${NB}1`);
  });
});
