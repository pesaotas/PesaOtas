# Changelog

All notable changes to PesaOtas (formerly PesaFlow) are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.1.0] — 2026-11-05 — Phase 1: data integrity

Fixes KI-01 to KI-05. No calculation was changed: `src/finance.js` is
untouched, and the everyday flow was re-checked in Chrome against the original
app (230 displayed values plus saved data: identical).

### Added
- `src/validation.js`: whole-shilling amounts (never rounded), real calendar
  dates, safe IDs.
- `src/data-model.js`: schema v2; conversion from PesaFlow v1; checking of any
  data or backup with a plain-language report of what will be left out,
  corrected automatically, worth checking, or added; preview summaries.
- `src/storage.js`: loading, idempotent PesaFlow migration, verified saving,
  and safety copies (rules in DECISIONS D-09).
- Schema v2 with savings destinations: **KCB M-PESA** and **M-Shwari** by
  default, with opening balances and room for custom destinations (D-04).
  No savings screens or calculations yet (Phase 2).
- Restore preview: shows what the backup contains, cash after restoring, what
  it replaces, and every problem found; requires explicit confirmation.
  Restores both PesaOtas and older PesaFlow backups.
- Recovery screen for damaged data: download it, recover the valid records,
  restore a backup, or start with an empty budget. Nothing is saved until the
  user chooses.
- One-time notice after migration; warnings when migration can't finish or the
  browser won't store data.
- Settings → **Data safety**: download the original PesaFlow data, the copy
  made before moving, quarantined damaged data, and data from before the last
  restore/recovery/reset.
- Tests: `tests/data-model.test.js`, `tests/storage.test.js`, helpers with a
  fake browser storage that simulates full, blocked and corrupted storage.
  100 tests: 93 pass, 0 fail, 7 todo (later phases).
- DECISIONS D-09 (storage, migration and recovery rules); KNOWN_ISSUES KI-19 to KI-22.

### Changed
- Data is saved under `pesaotas.data.v2` (schema v2). The PesaFlow key is
  migrated once and never modified or deleted (D-02 tightened).
- Every save is verified by reading it back; invalid data is never saved; if a
  save fails, the change is reverted on screen instead of appearing saved.
- Amount entry rejects decimals ("whole shillings") instead of rounding them;
  budget allocations, opening balance and payday are validated, and a budget
  save with one invalid value changes nothing.
- Reset to the demonstration budget now keeps a copy of the previous data.
- Backups download as `pesaotas-backup-<date>.json` in schema v2 (KI-22).
- A budget with no payday shows "— no payday set" instead of "NaN days".
- Transaction lists sort safely even if a record were malformed.
- `sw.js`: caches the new files; cache renamed `pesaflow-v1.1.0`.
- `package.json` version 1.1.0.

### Fixed
- KI-01, KI-02: text numbers in backups are read as numbers, never concatenated.
- KI-03: negative, zero, decimal, non-numeric and duplicate transactions are
  refused or removed (and listed) on entry and restore.
- KI-04: invalid or missing dates are refused; rendering can't be broken by one record.
- KI-05: damaged saved data is quarantined and left in place, never replaced
  by demonstration or blank data without the user's decision.

## [1.0.1] — 2026-11-05 — Phase 0: safety net

No change to what the user sees or to any calculation. Verified by driving the
original and updated app through the same 11-step script in Chrome and
comparing all 231 displayed values plus the saved data: identical.

### Added
- `src/finance.js`: pure, deterministic calculation module (`computeTotals`,
  `daysToPayday`). No DOM, storage or clock access; works as a plain script
  (`window.PesaFinance`) and in Node.
- `tests/finance.test.js` and `tests/fixtures.js`: 29 tests of correct
  behaviour using Node's built-in test runner (no dependencies), plus 13
  `todo` entries for known defects (see policy D-06).
- `package.json` with `npm test` (no dependencies).
- `docs/KNOWN_ISSUES.md` (18 issues, mapped to phases), `docs/DECISIONS.md`
  (approved decisions D-01–D-08, including safe-to-spend and the savings
  destinations design), `docs/ROADMAP.md`.
- `.gitignore`, including backup files so personal financial data is never
  committed to the repository.

### Changed
- `app.js`: `totals()` and `daysToPayday()` now delegate to `PesaFinance`
  (logic moved, not altered).
- `index.html`: loads `src/finance.js` before `app.js`.
- `sw.js`: caches `src/finance.js`; cache renamed to `pesaflow-v1.0.1` so
  installed copies pick up the new file.
- `README.md`: development and testing instructions, project structure, and
  status. The demo budget's personal details were removed from the README.

## [1.0.0] — PesaFlow v1.0 (baseline as received)

Dashboard, income/expense recording, budget categories and allocations,
flexible daily guide, payday countdown, transaction history, insights, JSON
backup/restore, basic offline support.
