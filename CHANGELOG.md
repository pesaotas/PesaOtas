# Changelog

All notable changes to PesaOtas (formerly PesaFlow) are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.6.0-dev] — Unreleased — v1.6 Phases 1–4: currency foundation, storage-format safeguard, Insights foundation, Insights charts, Expense Detective

Work in progress on branch `v1.6-dev`; not published. `main` and the live
v1.5.0 are unchanged (stable tag `v1.5.0-baseline`, commit `4d8f130`).
Calculations are unchanged (`src/finance.js` untouched).

### Phase 4 — Expense Detective (D-20)
- **Added — Expense Detective in Insights**, for this pay cycle (or this month
  without one): unusual bills, unusually large expenses, small purchases (an
  alert only with at least 10 making up at least 10% of spending; otherwise an
  observation), uncategorised spending (with **Edit** through the existing
  form), and spending pace (Over allocation shown as information). Every alert
  explains its figures and the entries behind it; "What Expense Detective
  checked" says where more history is needed.
- **Alert review**: Mark as reviewed, Dismiss, Move back to To review. Saved as
  `meta.alertReviews` in format v3; an alert comes back only when its evidence
  changes materially, never because time passes.
- **Review records are never dropped silently**: kept exactly (including fields
  from future versions); unreadable ones open a separate decision ("Your budget
  and transactions are fine") after a verified copy of the original is kept in
  the new Data safety list; restore previews count and list them separately.
- **Changed**: `src/storage.js` (approved, additive): the
  `review-records-invalid` load status, the review-records safety list, and
  `continueWithoutInvalidReviews`. `src/data-model.js`: the review-record rules,
  `reviewIssues`, a stricter `isClean`, the restore-preview count, and the
  v1.5.0-compatible backup now lists "alert review records (N)" as left out
  (the note under its button says so). Erase wording mentions review records.
- **Not built**: repeated-bill alerts (U3, deferred) and an Overview shortcut.
- **Not changed**: every calculation (`src/finance.js`, `src/insights.js` and
  `src/charts.js` untouched), Phase 2 and 3 Insights, and the restore and
  recovery wording when no review records are involved.
- Tests: `alert-reviews-format.test.js` (36), `alert-reviews-persistence.test.js`
  (22, the D-16 gate), `detective.test.js` (39, including the unknown-fields
  regression test); one existing assertion updated for the new summary field.
  **517 tests, 517 pass** (after the final-gate fixes). Planted faults caught: 8 of 8 (format), 6 of 6
  (persistence), 21 of 21 (rules). Phase 4 browser suite: 84 checks (74 before the final-gate fixes) at the site
  root and at `/PesaOtas/`, including the real v1.5.0.
- Known issues KI-40 (earlier development builds would drop review records),
  KI-41 (pace vs Budget screen with future-dated entries) and KI-42 (pace
  reappearance rounding).
- **Final-gate fixes** (independent review; no D-20 decision changed):
  alerts for entries or categories whose IDs contain spaces, `&`, `/` or
  accents can now be reviewed (such IDs are hashed inside the alert ID; IDs
  that already worked are unchanged); the review-records dialog says what to do
  when the safety list itself is damaged; a backup downloaded while that
  decision is pending says it leaves the unreadable records out; restore
  previews count the review records they replace; the pace table no longer says
  "On pace" when it's too early or the amount is small; card element IDs can't
  clash. One more regression test (`detective.test.js`, 40).

### Phase 3 — Insights charts (D-19)
- **Added — three charts in Insights**, following the selected period:
  spending trend (by day, Monday–Sunday week or month), income vs expenses by
  month (months cut to the period and labelled partial; Last 30 days shows e.g.
  8–31 Oct and 1–6 Nov), and spending by category (donut: up to six categories
  shown separately; more than six → five plus `Other categories (N)`).
- Choose a bar or category by click, tap, arrow keys, Home/End or
  Previous/Next; a details panel shows the figures and a read-only list of the
  entries behind it (newest first, 25 at a time, with the count and total).
  "Show as table" gives the same figures for every chart.
- Missing history (hatched), partly covered bars (dashed) and covered days with
  no spending (zero marker) are drawn differently; partial weeks and months cut
  by the period are labelled separately from coverage.
- Empty, future-only and no-spending states; a chart that can't be drawn says
  so and opens its table.
- `src/charts.js` (SVG only, no calculations) is part of the release and the
  offline copy. No chart library or new dependency.
- **Not changed**: every existing Insights section, the Transactions screen,
  balances and calculations (`src/finance.js`), the data format
  (`src/data-model.js`), storage, backups and safety copies. Charts never save
  anything.
- Tests: `insights-charts.test.js` (30) and `charts.test.js` (18); 11 of 11 and
  10 of 10 deliberate faults caught. **419 tests, 419 pass.** Browser suite for
  Phase 3: 134 checks from the site root and from `/PesaOtas/`.
- 20,000 fictional entries: preparing every chart for All time takes about 95 ms.

### Phase 2 — Insights foundation (D-18)
- **Added — new Insights screen** (`src/insights.js`, read-only):
  - Period choice: Last 30 days (default), Last 6 months, All time. Remembered
    on this device only (`pesaotas.device`), never in the budget data.
  - Six cards, each with a label, figure, explanation and (where fair) a
    comparison with the previous period of the same length: total expenses,
    average daily spending, largest spending category, income vs expenses, net
    cash movement, potential spending leaks.
  - Where your money went (spending by category with shares), a weekly or
    monthly history table (cards on phones), and patterns (unusually high
    months, categories every month, biggest category changes) once there are at
    least 3 complete months.
  - Clear empty, partial and not-enough-data states: how many days are covered,
    from when records are needed for a comparison, and how many complete months
    are needed for patterns. Future-dated entries are left out and counted.
  - Amounts and the small-purchase threshold follow the budget's currency.
- **Changed**: the old Insights screen (all-time totals, a transaction count,
  category spending against plan, and a fixed tip) is replaced. Spending against
  plan remains on the Budget screen; *Previous pay cycles* remains on Insights.
- **Not changed**: balances, safe-to-spend and every other calculation
  (`src/finance.js` untouched); the data format (`src/data-model.js` untouched);
  `src/storage.js` only lists the new device preference.
- Tests: `insights.test.js` (47, including 14 for the average's denominator)
  with the fictional fixture `tests/helpers/insights-data.js`, and
  `insights-preference.test.js` (12) for the period preference (saved, restored, default, invalid values, never in the
  budget data, backups or safety copies). **371 tests, 371 pass.** Mutation
  check: 18 of 18 deliberate faults in the Insights calculations, 6 of 6 in the
  average's denominator and 5 of 5 in the preference handling are caught.
- Clarified during review (D-18 wording approved): average daily spending is
  divided by calendar days of covered history (from the later of the period's
  start and the first record, through today), never by the number of dates with
  entries; the previous period uses the same rule (`coveredDaysBetween`). The
  screen now says "calendar days", shows the dates used, and explains that days
  without entries count as no recorded spending. The figures themselves are
  unchanged.
- Fixed during review: a saved period such as `"toString"` (an inherited name)
  was not rejected; every unsupported value now falls back to Last 30 days
  (`PesaInsights.resolvePeriod`).
- Known issues KI-37 (date format inconsistency, Phase 5) and KI-38 (leaks
  include routine small spending, by design).

### Phase 1 — Added
- **Currencies** (D-17): KES (default), UGX, TZS, NGN, ZAR, USD, GBP, EUR
  (`src/currency.js`). Chosen during setup or in Settings → Currency. Every
  amount, label, message, preview and backup uses the budget's currency. Whole
  units only; never converted.
- **Protected currency change**: shows both currencies with your own figures,
  states there is no conversion, offers a backup, needs a ticked confirmation,
  saves a verified "Before currency change" copy first (its own list), and
  records the change. Undo by changing back or restoring the copy.
- **Storage format v3** (D-16) under a new key, with a verified upgrade from
  v1.5.0 (copy → write → marker), exact failure reporting at every step,
  read-only mode with *Try again* / *Download your data*, and automatic
  completion at a later launch.
- **Old-version protection**: v1.5.0 refuses v1.6 data (tested with the real
  v1.5.0). Data an older version saves later never replaces v1.6 data: v1.6
  shows both and you choose; the other is kept.
- **Stale-tab protection**: saves are refused if another tab changed the data;
  the tab says so and stops saving until reloaded.
- **v1.5.0-compatible backup** (Settings → Backup), KES budgets only. Keeps
  every financial record; leaves out the v1.6-only metadata
  `meta.currencyHistory` and `meta.upgradedFrom` (listed when downloaded).
  *Since Phase 4 it also leaves out `meta.alertReviews` (see Phase 4 above and
  KI-36), so it omits exactly these three fields.*
  Alert review marks (`meta.alertReviews`) are **not** part of format v3 yet:
  their support is deferred to Phase 4 and must be in place and tested before
  alerts are introduced (DECISIONS D-16).
- Data safety: new copy types (before upgrading, two versions, before currency
  change) and a **Restore…** button on every copy (preview first).
- `docs/ROLLBACK.md`; DECISIONS D-16, D-17.
- Tests: `currency.test.js` (16), `format-v3.test.js` (16), `upgrade.test.js`
  (31, including a failure at every upgrade step and partial writes),
  fictional fixture `tests/helpers/v15-data.js`. **312 tests, 312 pass.**
  Mutation check: 15 of 15 deliberate faults in the new safeguards are caught.

### Phase 1 — Changed
- Amount error text no longer mentions shillings: "must be a whole amount (no
  decimals)".
- Warnings show amounts with a non-breaking space, like every other amount.
- Version label `1.6.0-dev`; release tooling accepts pre-release labels.
- The note under *Download a v1.5.0-compatible backup* now lists exactly what the
  file leaves out (KI-36).

## [1.5.0] — 2026-11-06 — Phase 5: installable app, safe updates, storage protection, GitHub Pages

Fixes KI-17 and KI-19; KI-27 partly (see below). No change to the approved
calculations or data checks (`src/finance.js`, `src/validation.js`,
`src/data-model.js` and `src/entries.js` unchanged). Every Phase 1 protection is
intact; `src/storage.js` only gained new functions. Existing users' data —
including the original PesaFlow data and every safety copy — is byte-for-byte
unchanged by the upgrade from v1.4.0 (tested in Chrome).

### Added
- **Installable app**: PNG icons (192 and 512 px, normal and maskable, a 180 px
  Apple touch icon and a 32 px favicon) with sources in `icons/src`; complete
  manifest (`id`, `scope`, `lang`, separate `any` and `maskable` icons);
  Apple home-screen tags. Chrome reports no installability errors when served
  from a `/PesaOtas/` subpath.
- **Safe updates** (D-14, KI-17): new `sw.js`. Each release lists every app file
  with a SHA-256 fingerprint (`npm run release`, `tools/stamp-sw.js`); a new
  version installs into its own cache, reuses unchanged files, downloads
  changed ones with revalidation and checks each fingerprint. A failed or
  interrupted update (offline, server error, half-finished deployment) is
  discarded and the current version keeps working. A ready version waits for
  **Update now** (blocked while there are unsaved budget changes, an entry being
  edited or a dialog open); other tabs are asked to reload; a message confirms
  the data is unchanged. Update checks on launch, on return to the app and
  hourly. Only older PesaOtas app caches are ever removed. v1.0–v1.4 workers
  are replaced automatically once (those versions have no update prompt).
- **Storage protection** (D-15): asks the browser once, after the first save, to
  keep PesaOtas data (`navigator.storage.persist()`); Settings → Storage
  protection shows the result (with a button to ask again), the last backup
  date, space used and offline status, and explains how browser data can still
  be lost (clearing data, private windows, lost devices, Safari's 7-day rule).
- **Managing safety copies** (D-15, KI-19): Data safety shows each copy's size
  and whether it is the only one on this device, with **Delete…**. Each deletion
  explains its consequences for that type of copy and needs a ticked
  confirmation; the only copy must be downloaded first; deleting is unavailable
  while the current data needs recovery. `src/storage.js`: `recoveryInventory`,
  `deleteRecoveryItem` (verified, refuses if the copy changed in another tab),
  `readDeviceInfo`, `updateDeviceInfo`, `storageUsage`; new key
  `pesaotas.device` (device notes only, never financial data, not in backups).
- **GitHub Pages**: `.github/workflows/pages.yml` (checks fingerprints, runs the
  tests, publishes only the app files via `tools/build-site.js`);
  `docs/DEPLOYMENT.md` (repository setup, publishing, verification, updates,
  rollback, privacy).
- `src/version.js` (version shown in the sidebar and used by releases);
  `npm run release`, `check-release`, `build-site`; `.gitattributes`
  (consistent line endings).
- Tests: `tests/release.test.js` (14), `tests/service-worker.test.js` (12, the
  real `sw.js` against simulated caches and network),
  `tests/safety-copies.test.js` (17). Total: **249 tests, 249 pass, 0 fail,
  0 todo.** Mutation check: 16 of 17 deliberate faults in the new safety and
  update rules are caught; the 17th (removing the HTTP-status check) is still
  caught by the fingerprint check, so behaviour is unchanged.
- Browser suite (Chrome 153, served like GitHub Pages under `/PesaOtas/`): 130
  checks pass — upgrade from v1.4.0 with data, update prompt and guards, two
  tabs, interrupted updates and recovery, offline use, installability, privacy,
  storage protection, safety-copy deletion, keyboard and accessibility on every
  screen and dialog at desktop and phone sizes, `file://` use. The Phase 1–4
  suites (229 checks) still pass.
- `docs/ACCESSIBILITY.md`: what is tested, what isn't, manual checklist.

### Changed
- DECISIONS D-09 rule 1: the original PesaFlow data is still never modified or
  deleted automatically, but the user may now delete it under the D-15 rules.
- `.gitignore` also excludes every safety-copy download (`pesaotas-*.json`,
  `pesaflow-*.json`) and `_site/`.
- Sidebar version comes from `src/version.js`.

### Fixed
- Date fields showed no focus ring when Tab reached the calendar button inside
  them (found by the new keyboard test).

### Known limitations
- KI-27 (partly open): no real screen-reader testing and no third-party checker
  (axe-core can't be installed here; Chrome 153 dropped its DevTools contrast
  audit). KI-30: installation not verified on real Android/iPhone devices or in
  Edge, Safari, Firefox. KI-31: browser storage is shared by every project on
  the same `username.github.io` address. KI-32: offline use needs one online
  visit; no offline copy when opened from disk.

## [1.4.0] — 2026-11-06 — Phase 4: PesaOtas branding and user experience

Fixes KI-12, 13, 14, 15, 21. No change to the approved safe-to-spend, savings or
pay-cycle calculations (`src/finance.js` unchanged), and every Phase 1
protection is intact (`src/storage.js` and `src/validation.js` unchanged).
Existing users' data loads byte-for-byte unchanged.

### Added
- **Blank onboarding** (D-13): a new user starts empty, with a three-step
  setup checklist and an optional "Add common categories" (names only, KSh 0).
- **Edit transactions**: Edit on every entry loads it into the form; same
  rules as new entries; ID and order preserved; every figure recalculated.
- **Category manager**: a dialog to add, rename, change type, set allocation,
  link a Savings category, and delete. Deleting a used category requires
  choosing where its transactions go; nothing is deleted.
- **Budget drafts** (KI-12): unsaved changes survive re-renders, are flagged,
  and can be saved or discarded; leaving the page warns.
- `src/entries.js`: pure rules for entries and categories (validateEntry,
  validateDelete, validateCategory, deleteCategory, categoryUsage,
  newCategoryId, addSuggestedCategories).
- `tests/entries-and-categories.test.js` (30 tests). Total: 206 tests, 206 pass,
  0 fail, 0 todo.
- Restore preview counts entries on the device that the file doesn't contain;
  README, DECISIONS (D-09 rule 9) and the Data safety card explain that
  restoring any copy — including the pre-rollover copy — replaces everything,
  and that only the most recent replaced copy is kept.
- DECISIONS D-13; KNOWN_ISSUES KI-27 to KI-29.

### Changed
- **Rebranded to PesaOtas** everywhere users see it (title, sidebar, footer,
  messages, reset text, privacy note, manifest). Historical PesaFlow
  references kept where they describe the old data (D-13).
- **Reset** is now "Erase and start empty" (keeps a Data safety copy).
- **Reserved category IDs** (KI-21): `other` and income-source IDs.
- **Mobile and accessibility** (KI-15): text at least 12px; WCAG AA contrast
  (secondary text, icons, amounts, entry-type options, footer); 44px touch
  targets; short mobile navigation labels ("Activity", "Budget", "Settings")
  with full accessible names; `aria-current`; decorative icons hidden; labelled
  edit/delete buttons; visible focus; skip link; focus moves to the screen
  heading; toast above the bottom navigation; over-budget warning at the top;
  16px form fields on phones; reduced motion respected.
- The four entry types sit in a 2×2 grid on every screen size.
- `sw.js` cache renamed `pesaotas-v1.4.0` and caches `src/entries.js`;
  `package.json` 1.4.0; manifest name PesaOtas.

### Removed
- The hard-coded demonstration budget, the personal note about rent and a
  gown, and fabricated placeholder figures.
- Browser `prompt()` boxes for categories.

### Fixed
- KI-12, KI-13, KI-14, KI-15, KI-21 as above.
- Pre-existing layout bugs found by the Phase 4 audit: an original rule squeezed
  navigation labels to 19px (text clipped on phones, oversized on desktop);
  the entry form spilled past its card on desktop (since Phase 2); two
  original rules named fonts that were never loaded, so text fell back to a
  serif.

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
