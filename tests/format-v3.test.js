/**
 * Data format v3 (v1.6, decision D-16) and currency in the data (D-17):
 * v2 data is read and converted without loss, v3 carries a validated currency,
 * newer formats and unknown currencies are refused, and the v1.5.0-compatible
 * backup keeps every financial record.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const D = require("../src/data-model.js");
const C = require("../src/currency.js");
const { computeTotals } = require("../src/finance.js");
const { richState, financial } = require("./helpers/v15-data.js");

const v3 = (extra = {}) => ({ ...richState(), version: 3, ...extra });
const roundTrip = (s) => JSON.parse(JSON.stringify(s));

describe("format v3", () => {
  it("is the current format; v2 is the previous one", () => {
    assert.equal(D.SCHEMA_VERSION, 3);
    assert.equal(D.PREVIOUS_SCHEMA_VERSION, 2);
  });

  it("v1.5.0 data (v2) converts to v3 in KES, with every record and total unchanged", () => {
    const old = richState();
    const r = D.normalizeState(roundTrip(old));
    assert.ok(D.isClean(r));
    assert.equal(r.format, "pesaotas-v2");
    assert.equal(r.state.version, 3);
    assert.equal(r.state.currency, "KES");
    assert.deepEqual(financial(r.state), financial(old));
    assert.deepEqual(computeTotals(r.state), computeTotals(old));
  });

  it("v2 data is always KES, whatever it says (v1.5.0 only ever wrote KES)", () => {
    const r = D.normalizeState({ ...richState(), currency: "USD" });
    assert.equal(r.state.currency, "KES");
  });

  it("keeps the chosen currency for every supported code", () => {
    for (const code of C.CODES) {
      const r = D.normalizeState(v3({ currency: code }));
      assert.ok(D.isClean(r), code);
      assert.equal(r.format, "pesaotas-v3");
      assert.equal(r.state.currency, code);
    }
  });

  it("refuses v3 data with a missing or unsupported currency, rather than guessing", () => {
    for (const bad of [undefined, "", "kes", "JPY", 5, "KSh"]) {
      const s = v3(); if (bad === undefined) delete s.currency; else s.currency = bad;
      const r = D.normalizeState(s);
      assert.equal(r.ok, false, String(bad));
      assert.ok(r.errors[0].includes("doesn't support"), r.errors[0]);
    }
  });

  it("refuses data from a newer version", () => {
    const r = D.normalizeState(v3({ version: 4 }));
    assert.equal(r.ok, false);
    assert.ok(r.errors[0].includes("newer version"));
  });

  it("messages use the data's own currency", () => {
    const s = v3({ currency: "USD", openingBalance: "2500" });
    const r = D.normalizeState(s);
    assert.ok(r.fixed.some(m => m.includes("$2,500")), r.fixed.join(" | "));
  });

  it("keeps a valid currency history and drops unreadable entries with a warning", () => {
    const history = [{ from: "KES", to: "USD", changedAt: "2026-11-06T10:00:00.000Z" }, { from: "KES", to: "JPY", changedAt: "x" }, "junk"];
    const r = D.normalizeState(v3({ currency: "USD", meta: { onboarding: "done", currencyHistory: history } }));
    assert.ok(D.isClean(r));
    assert.deepEqual(r.state.meta.currencyHistory, [history[0]]);
    assert.ok(r.warnings.some(w => w.includes("2 currency-change records")));
  });

  it("keeps the upgrade note, and ignores v3-only notes in v2 data", () => {
    const note = { version: 2, upgradedAt: "2026-11-06T09:00:00.000Z" };
    assert.deepEqual(D.normalizeState(v3({ meta: { upgradedFrom: note } })).state.meta.upgradedFrom, note);
    const fromV2 = D.normalizeState({ ...richState(), meta: { upgradedFrom: note, currencyHistory: [{ from: "KES", to: "USD", changedAt: "x" }] } });
    assert.equal(fromV2.state.meta.upgradedFrom, undefined);
    assert.equal(fromV2.state.meta.currencyHistory, undefined);
  });

  it("a blank budget can start in any supported currency", () => {
    assert.equal(D.createBlankState().currency, "KES");
    assert.equal(D.createBlankState("TZS").currency, "TZS");
    assert.equal(D.createBlankState("JPY").currency, "KES");
  });

  it("backups carry the currency and restore it exactly", () => {
    const s = D.normalizeState(v3({ currency: "NGN" })).state;
    const r = D.analyzeBackup(D.serializeBackup(s));
    assert.ok(D.isClean(r));
    assert.equal(r.state.currency, "NGN");
    assert.equal(r.summary.currency, "NGN");
    assert.deepEqual(r.state, s);
  });
});

describe("v1.5.0-compatible backup", () => {
  const current = () => D.normalizeState(v3({ meta: { onboarding: "done", migratedFrom: { key: "pesaflow.personal.v1", migratedAt: "2026-09-01T07:00:00.000Z" }, upgradedFrom: { version: 2, upgradedAt: "2026-11-06T09:00:00.000Z" }, currencyHistory: [{ from: "USD", to: "KES", changedAt: "2026-11-06T10:00:00.000Z" }] } })).state;

  it("is format v2 in KES and keeps every financial record", () => {
    const s = current();
    const r = D.toV15Backup(s);
    assert.equal(r.ok, true);
    const file = JSON.parse(r.text);
    assert.equal(file.version, 2);
    assert.equal(file.currency, "KES");
    assert.equal(file.app, "PesaOtas");
    assert.deepEqual(financial(file), financial(s));
    assert.deepEqual(computeTotals(file), computeTotals(s));
  });

  it("is accepted by the v2 rules exactly as v1.5.0 checks a backup", () => {
    const r = D.analyzeBackup(D.toV15Backup(current()).text);
    assert.ok(D.isClean(r));
    assert.equal(r.format, "pesaotas-v2");
  });

  it("lists what it leaves out, and leaves out nothing financial", () => {
    const r = D.toV15Backup(current());
    assert.deepEqual(r.omitted, ["the record of currency changes", "the note of when this budget was upgraded to the v1.6 format"]);
    const file = JSON.parse(r.text);
    assert.deepEqual(Object.keys(file.meta).sort(), ["migratedFrom", "onboarding"]);
    const plain = D.toV15Backup(D.normalizeState(v3()).state);
    assert.deepEqual(plain.omitted, []);
  });

  it("is refused for any currency other than KES, because v1.5.0 would show it as KSh", () => {
    for (const code of C.CODES.filter(c => c !== "KES")) {
      const r = D.toV15Backup(D.normalizeState(v3({ currency: code })).state);
      assert.deepEqual(r, { ok: false, reason: "currency", currency: code });
    }
  });

  it("refuses invalid data", () => {
    assert.equal(D.toV15Backup({ nonsense: true }).ok, false);
  });
});
