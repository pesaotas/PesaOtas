/**
 * Alert review records in format v3 (v1.6 Phase 4, decision D-20): what is kept,
 * what is reported, and that nothing is ever dropped silently. Fictional data.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const D = require("../src/data-model.js");
const { richState } = require("./helpers/v15-data.js");
const { sampleReviews, v3WithReviews, H } = require("./helpers/review-data.js");

const v3 = (alertReviews, extra = {}) => ({ ...richState(), version: 3, currency: "KES", meta: { onboarding: "done", alertReviews }, ...extra });
const without = (o, k) => { const c = { ...o }; delete c[k]; return c; };
const good = () => ({ id: "unusual-bill:s2", rule: "unusual-bill", status: "reviewed", actedAt: "2026-11-05T08:00:00.000Z", fingerprint: H("a") });

describe("valid records are kept exactly", () => {
  it("every field, every record, in order — including rules, statuses and fields this version doesn't know", () => {
    const r = D.normalizeState(v3(sampleReviews()));
    assert.ok(D.isClean(r));
    assert.deepEqual(r.reviewIssues, []);
    assert.deepEqual(r.state.meta.alertReviews, sampleReviews());
    assert.deepEqual(Object.keys(r.state.meta.alertReviews[5]), Object.keys(sampleReviews()[5]), "field order kept");
  });

  it("are a copy: changing the input afterwards doesn't change the result", () => {
    const input = v3(sampleReviews());
    const r = D.normalizeState(input);
    input.meta.alertReviews[5].extra.nested.deeper.push(4);
    assert.deepEqual(r.state.meta.alertReviews[5].extra.nested.deeper, [1, 2, 3]);
  });

  it("checking the result again gives the same records (stable round trip)", () => {
    const once = D.normalizeState(v3(sampleReviews())).state;
    const twice = D.normalizeState(JSON.parse(JSON.stringify(once)));
    assert.ok(D.isClean(twice));
    assert.deepEqual(twice.state.meta.alertReviews, once.meta.alertReviews);
  });

  it("an empty list means no records", () => {
    const r = D.normalizeState(v3([]));
    assert.ok(D.isClean(r));
    assert.equal(r.state.meta.alertReviews, undefined);
  });

  it("accepts fingerprints of 8 to 64 hex characters, and any lower-case status or rule name", () => {
    const recs = [
      { ...good(), id: "unusual-bill:a", fingerprint: "0123abcd" },
      { ...good(), id: "unusual-bill:b", fingerprint: "f".repeat(64) },
      { ...good(), id: "x-y:c", rule: "x-y", status: "on-hold" }
    ];
    const r = D.normalizeState(v3(recs));
    assert.ok(D.isClean(r));
    assert.equal(r.state.meta.alertReviews.length, 3);
  });

  it("an identical duplicate (even with fields in another order) is removed, and that is reported", () => {
    const dup = { fingerprint: H("a"), actedAt: "2026-11-05T08:00:00.000Z", status: "reviewed", rule: "unusual-bill", id: "unusual-bill:s2" };
    const r = D.normalizeState(v3([good(), dup]));
    assert.ok(D.isClean(r));
    assert.equal(r.state.meta.alertReviews.length, 1);
    assert.ok(r.fixed.some(f => /record 2 was an exact copy of record 1/.test(f)));
  });
});

describe("unreadable records are reported, never dropped silently", () => {
  const cases = [
    ["a record that isn't an object", ["nope"], "not-a-record"],
    ["a record that is a list", [[1, 2]], "not-a-record"],
    ["a missing ID", [without(good(), "id")], "id"],
    ["an ID without a rule prefix", [{ ...good(), id: "s2" }], "id"],
    ["an ID with spaces", [{ ...good(), id: "unusual-bill:s 2" }], "id"],
    ["an upper-case rule", [{ ...good(), rule: "Unusual" }], "rule"],
    ["a missing status", [without(good(), "status")], "status"],
    ["a status with spaces", [{ ...good(), status: "re viewed" }], "status"],
    ["a missing date", [without(good(), "actedAt")], "actedAt"],
    ["a date without a time", [{ ...good(), actedAt: "2026-11-05" }], "actedAt"],
    ["an impossible date", [{ ...good(), actedAt: "2026-13-45T99:00:00Z" }], "actedAt"],
    ["a too-long date", [{ ...good(), actedAt: "2026-11-05T08:00:00.000Z" + " ".repeat(30) }], "actedAt"],
    ["a non-hex fingerprint", [{ ...good(), fingerprint: "xyz12345" }], "fingerprint"],
    ["a too-short fingerprint", [{ ...good(), fingerprint: "abc" }], "fingerprint"],
    ["small purchases without a basis", [{ ...good(), id: "small-purchases:2026-11-01", rule: "small-purchases" }], "basis"],
    ["small purchases with a negative total", [{ ...good(), id: "small-purchases:2026-11-01", rule: "small-purchases", basis: { count: 1, total: -1, frame: H("d") } }], "basis"],
    ["uncategorised with repeated entry hashes", [{ ...good(), id: "uncategorised:2026-11-01", rule: "uncategorised", basis: { entryHashes: [H("1"), H("1")] } }], "basis"],
    ["uncategorised with more than 2,000 entries", [{ ...good(), id: "uncategorised:2026-11-01", rule: "uncategorised", basis: { entryHashes: Array.from({ length: 2001 }, (_, i) => i.toString(16).padStart(16, "0")) } }], "basis"],
    ["pace with a fractional gap", [{ ...good(), id: "spending-pace:2026-11-01:food", rule: "spending-pace", basis: { gapPoints: 2.5, frame: H("0") } }], "basis"],
    ["data nested too deeply", [{ ...good(), extra: { a: { b: { c: { d: 1 } } } } }], "unsupported-data"],
    ["a record over 64 KB", [{ ...good(), extra: "x".repeat(70000) }], "too-large"],
    ["two different records with one ID", [good(), { ...good(), status: "dismissed" }], "duplicate-id"]
  ];
  for (const [name, recs, reason] of cases) {
    it(`${name}: reported as "${reason}", the valid records kept, the money data untouched`, () => {
      const r = D.normalizeState(v3(recs));
      assert.equal(r.ok, true);
      assert.equal(D.isClean(r), false, "must not be saved without a decision");
      assert.equal(D.onlyReviewIssues(r), true);
      assert.deepEqual(r.rejected, [], "review problems are never listed as financial problems");
      assert.equal(r.reviewIssues.length, 1);
      assert.equal(r.reviewIssues[0].reason, reason);
      assert.match(r.reviewIssues[0].text, /^Alert review record \d+/);
      assert.equal(r.state.meta.alertReviews ? r.state.meta.alertReviews.length : 0, recs.length - 1);
      assert.deepEqual(r.state.transactions, D.normalizeState(v3([])).state.transactions);
    });
  }

  it("a list that isn't a list: one issue, nothing kept, nothing silently lost", () => {
    for (const bad of [{ a: 1 }, "x", 5, null]) {
      const r = D.normalizeState(v3(bad));
      assert.equal(D.isClean(r), false);
      assert.equal(r.reviewIssues.length, 1);
      assert.equal(r.reviewIssues[0].reason, "not-a-list");
      assert.equal(r.state.meta.alertReviews, undefined);
    }
  });

  it("each issue says which record, its ID, rule and status where readable, and why", () => {
    const r = D.normalizeState(v3([good(), { ...good(), id: "unusual-bill:s9", actedAt: "soon" }]));
    assert.deepEqual(r.reviewIssues[0], { index: 2, id: "unusual-bill:s9", rule: "unusual-bill", status: "reviewed", reason: "actedAt",
      text: 'Alert review record 2 ("unusual-bill:s9") has a missing or invalid date it was marked.' });
  });

  it("financial problems and review problems are reported separately", () => {
    const input = v3([{ ...good(), status: 5 }]);
    input.transactions = [...input.transactions, { id: "bad", type: "expense", amount: -5, date: "2026-11-01", categoryId: "food" }];
    const r = D.normalizeState(input);
    assert.equal(r.rejected.length, 1);
    assert.equal(r.reviewIssues.length, 1);
    assert.equal(D.onlyReviewIssues(r), false, "financial damage takes priority");
    assert.equal(D.isClean(r), false);
  });
});

describe("older formats can't hold review records", () => {
  it("v2 and PesaFlow data with review records: not used, and a visible note says so; nothing else changes", () => {
    const v2 = { ...richState(), meta: { onboarding: "done", alertReviews: sampleReviews() } };
    const r = D.normalizeState(v2);
    assert.ok(D.isClean(r));
    assert.equal(r.state.meta.alertReviews, undefined);
    assert.ok(r.notes.some(n => /alert review records, which only the v1\.6 format can hold/.test(n)));
    assert.deepEqual(r.reviewIssues, []);
    const pf = D.normalizeState({ version: 1, openingBalance: 0, categories: [], transactions: [], meta: { alertReviews: [] } });
    assert.ok(pf.ok && pf.notes.some(n => /alert review records/.test(n)));
  });

  it("isClean is unchanged for data without review records (v2, PesaFlow, v3)", () => {
    assert.ok(D.isClean(D.normalizeState(richState())));
    assert.ok(D.isClean(D.normalizeState({ ...richState(), version: 3, currency: "KES" })));
  });
});

describe("backups and previews", () => {
  it("a backup carries the records and restores them exactly", () => {
    const s = v3WithReviews();
    const r = D.analyzeBackup(D.serializeBackup(s));
    assert.ok(D.isClean(r));
    assert.deepEqual(r.state.meta.alertReviews, s.meta.alertReviews);
    assert.equal(r.summary.alertReviewCount, sampleReviews().length);
  });

  it("the preview counts only readable records, and lists unreadable ones separately", () => {
    const text = JSON.stringify(v3([good(), { ...good(), id: "unusual-bill:zz", fingerprint: "nothex!" }]));
    const r = D.analyzeBackup(text);
    assert.equal(r.summary.alertReviewCount, 1);
    assert.equal(r.reviewIssues.length, 1);
    assert.equal(D.isClean(r), false);
  });

  it("the v1.5.0-compatible backup leaves the records out, says so, and keeps every financial record", () => {
    const s = v3WithReviews();
    const out = D.toV15Backup(s);
    assert.ok(out.ok);
    assert.ok(out.omitted.includes(`alert review records (${sampleReviews().length})`));
    const back = JSON.parse(out.text);
    assert.equal(back.version, 2);
    assert.equal(back.meta.alertReviews, undefined);
    assert.deepEqual(back.transactions, s.transactions);
    assert.deepEqual(D.toV15Backup({ ...s, meta: { onboarding: "done" } }).omitted, []);
  });
});
