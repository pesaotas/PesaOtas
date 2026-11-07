/**
 * Fictional alert review records (v1.6 Phase 4, D-20) and a v3 budget that
 * carries them. Includes a rule, a status and fields this version doesn't
 * know, to prove they are kept exactly. No real records.
 */
"use strict";

const D = require("../../src/data-model.js");
const { richState } = require("./v15-data.js");

const H = (c) => c.repeat(16).slice(0, 16); // a 16-hex fingerprint made of one repeated character

function sampleReviews() {
  return [
    { id: "unusual-bill:s2", rule: "unusual-bill", status: "reviewed", actedAt: "2026-11-05T08:00:00.000Z", fingerprint: H("a") },
    { id: "large-expense:s7", rule: "large-expense", status: "dismissed", actedAt: "2026-11-06T09:30:00.000Z", fingerprint: H("b") },
    { id: "small-purchases:2026-11-01", rule: "small-purchases", status: "reviewed", actedAt: "2026-11-06T09:31:00.000Z", fingerprint: H("c"),
      basis: { count: 12, total: 2400, frame: H("d") } },
    { id: "uncategorised:2026-11-01", rule: "uncategorised", status: "dismissed", actedAt: "2026-11-06T09:32:00.000Z", fingerprint: H("e"),
      basis: { entryHashes: [H("1"), H("2")] } },
    { id: "spending-pace:2026-11-01:food", rule: "spending-pace", status: "reviewed", actedAt: "2026-11-06T09:33:00.000Z", fingerprint: H("f"),
      basis: { gapPoints: 31, frame: H("0") } },
    // Written by a hypothetical newer version: unknown rule, status and fields — kept exactly.
    { id: "future-rule:x-1", rule: "future-rule", status: "snoozed", actedAt: "2027-01-02T03:04:05.000Z", fingerprint: "0123456789abcdef0123456789abcdef",
      basis: { anything: ["goes", 1, true, null] }, snoozeUntil: "2027-02-01", extra: { nested: { deeper: [1, 2, 3] } } }
  ];
}

/** A clean v3 budget (the v1.5 fixture, upgraded) with the sample review records. */
function v3WithReviews(reviews = sampleReviews()) {
  const r = D.normalizeState({ ...richState(), version: 3, currency: "KES", meta: { ...richState().meta, alertReviews: reviews } });
  if (!D.isClean(r)) throw new Error("review fixture not clean: " + JSON.stringify([r.errors, r.rejected, r.reviewIssues]));
  return r.state;
}

module.exports = { sampleReviews, v3WithReviews, H };
