# Changelog

All notable changes to PesaOtas (formerly PesaFlow) are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
