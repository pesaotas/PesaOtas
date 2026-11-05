# Changelog

All notable changes to PesaOtas (formerly PesaFlow) are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.3.0] — 2026-11-05 — Phase 3: pay cycles and rollover

Fixes KI-09, KI-16, KI-24, KI-25 and applies the D-10 decision. All Phase 1
migration, backup, restore and recovery protections are unchanged
(`src/storage.js` and `src/validation.js` untouched) and were re-verified in
Chrome. No transaction is ever deleted or changed when a cycle starts.

### Added
- **Pay cycles** (D-12): budgets, insights and income/expense figures count the
  current cycle (`cycleStart` → payday). Spending cash and savings balances
  are never reset; they always count every transaction.
- **Real cycle lengths**: the progress bar shows "Day X of Y" from the actual
  start and payday (28–31 days, or any length), not an assumed 30.
- **User-confirmed rollover**: from payday a prompt appears; the rollover
  screen previews the ending cycle (income, spending, net savings, cash at the
  end, what's left in each allocation, overspends) and explains what happens
  before anything changes. Start date defaults to payday (earlier if paid
  early); next payday is suggested (same day next month, adjusted for short
  months). Optional: move part of the leftover to savings. A copy of the data
  is kept first. Missed paydays are closed one at a time.
- **Previous pay cycles** under Insights, computed live from transactions.
- **Settings**: "This pay cycle started on" (optional) and "Start a new pay
  cycle…"; the opening balance is explained.
- **Date-ordered savings** (KI-24): withdrawals limited by what the destination
  held on that date, protecting later withdrawals; delete and starting-balance
  guards use the same rule; restored files that break the order get a warning.
- "This pay cycle" filter in transaction history; pay cycle in the restore preview.
- Confirmation before recording an entry dated before the current cycle.
- `src/finance.js`: `cycleInfo`, `cycleSummary`, `startNewCycle` (pure),
  `suggestNextPayday`, `availableToWithdraw`, `balanceOn`,
  `savingsOrderIssues`, calendar-date helpers.
- `src/data-model.js`: validates and preserves `cycleStart` and `cycles`.
- `tests/pay-cycles.test.js` (38 tests, including a daylight-saving check run in
  a real US time zone). Total: 176 tests, 176 pass, 0 fail, 0 todo.
- DECISIONS D-12; D-10 rewritten as decided.

### Changed
- **D-10 (decided):** a withdrawal re-opens the linked savings allocation
  (allocate 5,000, transfer 5,000, withdraw 1,000 → 1,000 remaining). Net
  savings never go below zero. Safe-to-spend is unchanged by the withdrawal
  (no double reserving).
- On and after payday the daily guide asks for the new cycle instead of
  showing the whole amount (KI-25).
- `daysToPayday` counts calendar days (fixes KI-16).
- The demonstration budget now has a cycle start (1 Nov 2026).
- "Data safety" lists the copy made before a new pay cycle.
- `sw.js` cache `pesaflow-v1.3.0`; `package.json` version 1.3.0.

### Fixed
- KI-09: past cycles no longer use this cycle's allocations.
- KI-16, KI-24, KI-25 as above.

## [1.2.0] — 2026-11-05 — Phase 2: calculation correctness and savings

Fixes KI-06, 07, 08, 10, 11, 18. All migration, restore and recovery
protections from Phase 1 are unchanged and were re-verified in Chrome.

### Added
- **Safe to spend** (D-03) on the Overview: flexible budget left + unallocated
  money, never more than spending cash and never below zero. Replaces
  "Flexible budget left" in the stat cards; that figure now appears in the
  explanation.
- **Daily guide** = safe to spend ÷ days to payday, rounded down; the whole
  amount on payday; none when no payday is set.
- **"How is 'safe to spend' worked out?"**: a plain-language breakdown showing
  each part of the sum, the cash ceiling, and the daily pace.
- **Savings with KCB M-PESA and M-Shwari** (D-04): Save and Withdraw options in
  the entry form; separate balances; a "Your savings" card on the Overview;
  starting balances in Settings. Entries are manual only; no connection to any
  service and no PINs or passwords.
- **Linked savings allocations** (approved): a Savings category can be linked
  to one destination in the Budget screen; transfers fulfil the allocation
  (KSh 5,000 allocated, KSh 2,000 saved → KSh 3,000 left).
- **Limits** (approved): withdrawals above a destination's balance are blocked;
  transfers above spending cash need confirmation; deleting a transfer or
  lowering a starting balance can't leave a destination below zero.
- **Income sources** (Salary, Business, Side income, Gift received, Refund,
  Other income) instead of spending categories.
- "Savings moves" filter in transaction history; "Other / uncategorised" row in
  Insights; savings in the restore preview.
- `src/finance.js`: savings types, destination balances, linked fulfilment,
  `safeToSpend`, `uncategorisedSpent`, `dailyGuide()`, `formatKSh()`.
- `src/data-model.js`: savings entries and links (validated), fixed category
  types, income sources, warning when a destination would be below zero.
- `tests/savings-and-safe-to-spend.test.js` (33 tests) and 13 Phase 2 tests in
  `data-model.test.js`. Total: 139 tests, 136 pass, 0 fail, 3 todo (Phase 3).
- DECISIONS: D-04 details recorded; D-10 (withdrawals, awaiting confirmation);
  D-11 (category types, income sources). KNOWN_ISSUES KI-23 to KI-26.

### Changed
- Amounts display as "KSh 25,000" / "−KSh 800" (was "Ksh", "-Ksh").
- Category types come from a fixed list; adding a category with another type is
  refused with the list. Older data is read case-insensitively.
- Insights list spending only; linked savings categories are not shown as spending.
- Schema v2 extended additively: v1.1.0 data and backups remain valid.
- `sw.js` cache renamed `pesaflow-v1.2.0`; `package.json` version 1.2.0.

### Fixed
- KI-06: safe-to-spend and the daily guide now account for overspending and
  over-allocation (the Phase 0 example now shows KSh 0/day, not KSh 132/day).
- KI-07, KI-08, KI-10, KI-11, KI-18 as above.

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
