# Product and architecture decisions

Approved decisions that later phases must follow. Each entry records what was
decided, and where relevant, the rule the code must satisfy. Change an entry
only with the product owner's approval, and note the change in the CHANGELOG.

## D-01 Evolve the existing codebase — approved 2026-11-05

PesaFlow v1.0 is evolved in small, tested phases rather than rewritten. Working
features are never removed silently.

## D-02 Blank onboarding; PesaFlow data is always migrated — approved 2026-11-05

- The starter budget (graduation, gown, jacket fund, etc.) is demonstration
  data, not real records. Nothing personal is hard-coded in the app.
- A new user starts with a clean, blank onboarding.
- Data saved under the old PesaFlow key (`pesaflow.personal.v1`) is migrated
  to PesaOtas automatically. The migration code is kept permanently.
- *Tightened 2026-11-05 (Phase 1 approval):* the PesaFlow key is **never**
  modified or deleted automatically, even after a verified migration. Any
  future removal must be an explicit user action. See D-09.

## D-03 Safe-to-spend definition — approved 2026-11-05

```
safeToSpend = clamp( flexibleRemaining + unallocated , 0 , spendingCash )
dailyGuide  = floor( safeToSpend ÷ daysToPayday )   (whole amount on payday)
```

- `flexibleRemaining`: unspent allocation in Flexible categories.
- `unallocated`: spending cash minus everything still reserved. It is negative
  when the plan is short, which correctly reduces safe-to-spend after
  overspending or over-allocation.
- Upcoming commitments are protected because unspent allocations for bills,
  essentials and savings are reserved and therefore excluded. Recurring bills
  (a future feature) will feed into the same reserved amount.
- The interface must explain the figure in plain words, showing the parts of
  the sum (e.g. "Flexible left 2,500 + unallocated −800 = 1,700").
- *Implemented in Phase 2 (v1.2.0)* in `src/finance.js` (`computeTotals().safeToSpend`,
  `dailyGuide`) and explained on the Overview ("How is 'safe to spend' worked out?").
  Note: flexible + unallocated always equals spending cash minus what non-flexible
  categories still reserve, so it can never exceed cash; the cap is kept as a
  guard. With no payday set there is no daily guide.
- *Phase 3 (v1.3.0):* "days to payday" counts calendar days in the current pay
  cycle. On and after payday the interface asks the user to start the new
  cycle instead of showing a daily guide (KI-25); see D-12.

## D-04 Savings are internal transfers to named destinations — approved 2026-11-05

Savings are never ordinary spending or income.

**Destinations**

- Defaults from the beginning: **KCB M-PESA** and **M-Shwari**.
- Users can add their own (e.g. a bank account, a SACCO) and archive them.
  No user is assumed to save in one place.
- Each destination has a name and an optional opening balance.
- V1 is manual only: no integration with these services, and no account
  numbers, credentials, PINs or passwords are requested or stored.

**Transaction types**

| Type | Spending cash | Destination balance | Income/expense totals and insights |
|---|---|---|---|
| `income` | + amount | — | counted as income |
| `expense` | − amount | — | counted as spending |
| `savings_transfer` (into a destination) | − amount | + amount | **not counted** |
| `savings_withdrawal` (back to spending) | + amount | − amount | **not counted** |

**Equations**

```
spendingCash       = opening + Σincome − Σexpense − Σtransfers + Σwithdrawals
destinationBalance = destinationOpening + Σtransfers(to it) − Σwithdrawals(from it)
totalSavings       = Σ destinationBalance            (shown separately from spending cash)
```

**Data model (done in Phase 1, v1.1.0):** schema v2 stores
`savingsDestinations: [{ id, name, openingBalance, archived, builtIn }]`.
KCB M-PESA (`kcb-mpesa`) and M-Shwari (`m-shwari`) are created by default with
`builtIn: true`; custom destinations use their own IDs with `builtIn: false`.
Opening balances are whole shillings ≥ 0. Savings transaction types are
reserved: Phase 1 refuses them in restored files rather than mis-counting them.
Calculations and UI follow in Phase 2.

**Details approved 2026-11-05 (Phase 2 approval), implemented in v1.2.0:**

1. *Linking — approved.* A Savings-type category can be linked to one
   destination (`categories[].destinationId`); at most one category per
   destination. Transfers to that destination fulfil the allocation, so the
   money is never reserved twice. Example: allocate KSh 5,000, transfer
   KSh 2,000 to M-Shwari → KSh 3,000 of the allocation remains. Saving more than
   the allocation is not "over budget"; the extra comes out of unallocated money.
2. *Limits — approved.* A withdrawal larger than the destination's recorded
   balance is blocked. A transfer larger than spending cash shows a warning and
   needs confirmation. Deleting a transfer that would leave a destination below
   zero is blocked, as is a starting balance that would do so.
3. *Interest and fees — deferred.* Not implemented. Room is left: the type
   `savings_adjustment` is reserved (refused for now in restored files), and a
   destination balance is a simple sum, so adjustments can be added to it later.

Custom destinations are supported by the data model and calculations; the
screen for adding them is not built yet (requested "in future").

## D-05 Plain JavaScript scripts, no build step — approved 2026-11-05

- Plain `<script>` tags, so the app keeps working when `index.html` is opened
  directly from disk. No ES modules, bundler or framework.
- Pure logic lives in `src/` using a small wrapper that exposes a browser
  global (e.g. `window.PesaFinance`) and also works with Node's `require` for
  tests.

## D-06 Testing policy — approved 2026-11-05

- Tests use Node's built-in `node:test`: zero dependencies.
- Tests assert **correct** behaviour only. Known defects are never encoded as
  expected results; they are listed in `docs/KNOWN_ISSUES.md` and as `todo`
  tests, and get real tests in the phase that fixes them.
- Test fixtures are neutral examples owned by the tests, not the app's demo data.

## D-07 Product constraints — approved 2026-11-05

- Kenyan Shillings, displayed as **KSh**, by default; calculations in whole shillings.
- Mobile-first, readable, accessible to people with limited financial literacy.
- Local-first; no paid APIs, subscriptions or dependencies; no data sent to third parties.
- Preserve the existing design language (deep forest green, rounded cards, clear hierarchy).
- No new features ahead of reliable core calculations.

## D-09 Storage, migration and recovery safety — approved 2026-11-05 (Phase 1)

Browser storage keys:

| Key | Holds | Written by PesaOtas? |
|---|---|---|
| `pesaflow.personal.v1` | Original PesaFlow data | **Never** written; deleted only when the user chooses to (D-15) |
| `pesaotas.data.v3` | Live PesaOtas data (format v3, v1.6 and later, D-16) | Yes, verified on every save; refused if another tab changed it |
| `pesaotas.data.v2` | v1.1–v1.5 data (format v2). After the upgrade: a small "moved" marker that v1.5.0 refuses to open (D-16) | Marker only; data an older version writes here is never overwritten without the user choosing |
| `pesaotas.preserved.v1-5` | Exact copies of v1.5.0-format data, made before the upgrade (D-16) | Added to only; identical copies not repeated |
| `pesaotas.preserved.older-version` | The data not chosen when two versions were found (D-16) | Added to only |
| `pesaotas.pre-currency` | Data as it was before each currency change (D-17) | Added to only; never replaces another copy |
| `pesaotas.preserved.pesaflow-v1` | Copies of the original PesaFlow text, made before migrating | Added to only; identical copies not repeated |
| `pesaotas.quarantine` | Damaged data set aside, with date and reason | Added to only; identical copies not repeated |
| `pesaotas.pre-restore` | Data as it was before the last restore, recovery or reset | Replaced each time |
| `pesaotas.device` | Device notes only: last backup date, storage-protection request (D-15). Never financial data, not in backups | Yes |

Rules (enforced in `src/storage.js`, covered by `tests/storage.test.js`):

1. The PesaFlow key is never modified, and never deleted automatically.
   *Amended 2026-11-06 (Phase 5, D-15):* the user may delete it — like any
   safety copy — from Data safety, after a confirmation that explains the
   consequences, and only by downloading it first when it is the only copy.
2. Before migrating, the original text is copied to the preserved key and read
   back. If that fails, migration does not happen.
3. Migrated data counts as saved only after it is written, read back,
   compared byte-for-byte and re-checked. Otherwise the attempt is removed and
   retried at the next launch; the original is untouched.
4. Migration runs only when no PesaOtas data exists, so it never repeats or
   duplicates data. Damaged PesaOtas data never falls back to older PesaFlow data.
5. Migration is automatic only when it is lossless. If anything would be left
   out, the data goes to recovery and the user decides.
6. Damaged data is quarantined and left where it is; nothing is saved until the
   user chooses: recover the valid records, restore a backup, or start empty.
   If quarantine fails, the user must download the damaged data first.
7. Invalid data is never saved. A failed save reverts the change on screen.
8. Restores always show a preview (contents, what is left out, what is
   corrected) and need explicit confirmation; the replaced data is kept as the
   pre-restore copy.
9. *Clarified 2026-11-05 (Phase 3 approval):* a restore replaces **all**
   current data with the snapshot. Restoring the copy made before a new pay
   cycle (or a reset, recovery or earlier restore) removes everything recorded
   after that copy — transactions, savings entries, budget and cycle changes.
   Only the most recent replaced copy is kept (`pesaotas.pre-restore` is a
   single slot), so the user should download a backup first. The preview counts
   the entries on the device that the file does not contain. No undo feature is
   provided (by decision).

## D-10 A withdrawal re-opens the linked savings allocation — decided 2026-11-05 (Phase 3 approval), implemented v1.3.0

*Supersedes the Phase 2 proposal (withdrawals did not re-open the allocation).*

Net savings towards a linked allocation = transfers to the destination minus
withdrawals from it, within the current pay cycle, never below zero.

Example: allocate 5,000; transfer 5,000 to M-Shwari (allocation met); withdraw
1,000 → net saved 4,000, **1,000 of the allocation remaining**.

No double reserving: the withdrawn 1,000 returns to spending cash and the
allocation reserves 1,000 again — the same money, counted once. Unallocated
money and safe-to-spend are therefore unchanged by the withdrawal. If more is
withdrawn than was saved this cycle (e.g. older savings), net savings stop at
zero, so the reservation never exceeds the allocation and the extra withdrawn
money is spendable. Covered by `savings-and-safe-to-spend.test.js` (D-10 tests)
and `pay-cycles.test.js` ("D-10 across pay cycles").

## D-11 Fixed category types and income sources — Phase 2 (v1.2.0)

- Category types come from a fixed list: Essential, Bills, Savings, Flexible,
  Personal, Event, Other (fixes KI-07). Only Flexible money counts towards
  safe-to-spend; the rest are commitments. Older data is read case-insensitively
  ("flexible" → Flexible); a non-standard type becomes Other, which is how it
  was already treated.
- Income is recorded against an income source — Salary, Business, Side income,
  Gift received, Refund, Other income — never a spending category (fixes KI-10).
  Older income entries tagged with a spending category are left unchanged in
  storage and simply shown as "Income".
- Schema v2 is extended additively (no version bump): data and backups from
  v1.1.0 remain valid.

## D-12 Pay cycles and rollover — approved 2026-11-05 (Phase 3), implemented v1.3.0

**What a pay cycle is.** The current cycle runs from `cycleStart` up to (not
including) `payday`. Closed cycles are listed in `cycles`:
`[{ start, end, closedAt, budgets }]`. Both fields are additive to schema v2;
data without them behaves exactly as before (everything counts).

**What is scoped to the cycle** (only transactions dated on or after `cycleStart`):
spending per category, savings towards linked allocations (D-10), income and
expense figures, insights, and therefore safe-to-spend and the daily guide.

**What is never reset:** spending cash and savings balances. They are real
money, always worked out from the opening balance plus *every* transaction.
Rollover never copies or rewrites a balance, so it cannot drift, and correcting
an old transaction still updates cash correctly.

**Opening balance** (Settings) is the money held when recording began. It does
not change at rollover; each cycle's starting cash is simply the cash held on
its first day.

**Cycle lengths** are real calendar days between the start and payday (28–31,
or any length), never an assumed 30. Day counts use calendar dates, immune to
daylight saving (KI-16).

**Rollover is never automatic.** From payday onwards the Overview shows "Payday
has arrived" and the daily guide is replaced by a prompt (KI-25). Until the
user confirms, the old cycle keeps counting, including new entries
(conservative). The rollover screen shows the ending cycle (income, spending,
net savings, cash at the end, money left in each allocation, overspends) and
explains, before anything changes:

1. Nothing is deleted; every transaction stays in the history.
2. Spending cash carries over as it is.
3. Allocations start again at their full amounts (editable in Budget).
4. Money left in allocations is released into spending cash; the new cycle's
   allocations are reserved from it. Until salary is recorded the plan may show
   as short.
5. Savings balances are untouched.
6. Optional: move part of the leftover to a savings destination, recorded as a
   normal Save dated the new cycle's first day.

The user chooses the start date (payday by default; earlier if paid early) and
the next payday (suggested: same day next month, moved back for short months).
A copy of the data is kept first (Data safety), and the change goes through the
same verified save as every other change (D-09). Missed paydays are closed one
cycle at a time. Starting the same cycle twice is refused.

**History** for closed cycles is computed live from transactions plus the stored
dates and allocations, so it stays correct if an old entry is corrected.

**Backdated entries** before the current cycle ask for confirmation: they change
cash (and that cycle's history) but not the current budget.

**Date-ordered savings (KI-24).** A withdrawal may not exceed what the
destination held on its date, nor use money that later withdrawals depend on.
Within one day, money in is counted before money out. Deleting a transfer or
lowering a starting balance is refused if it would leave any day below zero.
Restored data that breaks the order is kept, with a warning.

## D-13 PesaOtas user experience rules — approved 2026-11-05 (Phase 4), implemented v1.4.0

**Name.** Everything users see says PesaOtas. "PesaFlow" remains only where it
is history: the `pesaflow.personal.v1` storage key (never touched, D-09), the
migration notice ("your PesaFlow data has moved"), "older PesaFlow backup" in
the restore preview, and the Data safety copies of the original data.

**Blank onboarding.** A user with no PesaOtas and no PesaFlow data starts
empty: no categories, transactions, balances or payday, and nothing is written
until they act. A setup checklist (`meta.onboarding: "active"`) guides three
steps and disappears when they are done or hidden. "Add common categories"
adds names only, each at KSh 0. Data without the field (all existing users)
never shows the checklist. "Erase and start empty" replaces the old reset; it
keeps a Data safety copy first.

**Editing entries.** New and edited entries go through one set of rules
(`src/entries.js` `validateEntry`): an edit keeps the entry's ID and original
order; withdrawal limits are worked out as if the original entry weren't
there; a change is refused if it would leave a savings destination below zero
on any day; moving an entry before the current cycle, or a transfer above
spending cash, asks for confirmation. There is no edit history (KI-29).

**Categories.** Managed in a dialog (no `prompt()`): name (unique, up to 40
characters), type from the fixed list, allocation, and — for Savings — one
linked destination. Rename keeps the ID, so transactions stay attached.
Changing a linked Savings category to another type removes the link, and the
dialog says so. Deleting shows how the category is used; one with transactions
can't be deleted until the user chooses where they go (another category or
"Other / uncategorised"). Its allocation is released, and the confirmation
states any change to safe to spend. No transaction is ever deleted.

**Reserved IDs (KI-21).** `other` (uncategorised) and the income-source IDs can
never be category IDs. New IDs are generated as `cat-…`. Data or a backup with
a category using a reserved ID is refused rather than guessed.

**Budget drafts (KI-12).** Unsaved allocation and link changes are kept in
memory until saved or discarded, survive any re-render, are visibly flagged,
and leaving the page warns.

**Accessibility targets.** Text at least 12px (16px in form fields on phones),
WCAG AA contrast (4.5:1), touch targets at least 44px, every control named for
screen readers, `aria-current` on the active screen, decorative icons hidden,
visible keyboard focus, a skip link, focus moved to the screen heading on
navigation, the toast above the bottom navigation, reduced motion respected.

## D-14 App updates — approved 2026-11-06 (Phase 5), implemented v1.5.0

Fixes KI-17. Updates replace the app's own files only; they never read, change
or remove saved data (a service worker cannot reach `localStorage`).

- **Fingerprinted release.** `npm run release` writes the version, a build ID
  and a SHA-256 fingerprint of every app file into `sw.js`
  (`tools/stamp-sw.js`; file list in `tools/release-files.js`). Any change to
  any file changes `sw.js`, which is how browsers find a new version. `npm test`
  fails if the fingerprints are out of date, so a forgotten bump can't ship.
  Text files are fingerprinted with CRLF read as LF and any byte-order mark
  ignored, so editing on Windows can't break updates.
- **Verified, all-or-nothing install.** Each version installs into its own
  cache (`pesaotas-shell-<version>-<build>`). Unchanged files are copied from the
  current cache; changed files are downloaded with HTTP revalidation and must
  match their fingerprint. Any failure — offline, a server error, or a
  half-finished deployment still serving old files — deletes only the
  incomplete new cache; the running version keeps working online and offline,
  and the browser tries again later.
- **The user decides when to switch.** A complete new version waits. The app
  shows "A new version of PesaOtas is ready" with **Update now** and **Later**.
  Update now is unavailable while there are unsaved budget changes, an entry
  being edited, or a dialog open. After switching, the page reloads and says
  the data is unchanged. Other open tabs are asked to reload rather than
  reloaded. The app checks for updates when it is opened, when it comes back to
  the foreground, and hourly while open.
- **One-time takeover from v1.0–v1.4.** Those versions have no update prompt, so
  when v1.5 replaces their worker it takes over by itself; the user sees v1.5 on
  the next launch.
- **Cleanup.** After a switch, only older PesaOtas app caches are deleted
  (`pesaotas-shell-*`, and `pesaflow-v*` / `pesaotas-v*` from v1.0–v1.4). Any
  other cache on the site is left alone.
- **Serving.** The app's files come from the cache (works offline). Opening the
  site folder or `index.html` (with or without a query) gives the app; other
  addresses within the app's folder fall back to it when offline. Requests to
  other sites or other folders are never handled.
- Opening `index.html` directly from disk still works; offline support and
  updates need a web address (http/https).

## D-15 Storage protection and safety copies — approved 2026-11-06 (Phase 5), implemented v1.5.0

Fixes KI-19.

- **Persistent storage.** After the first successful save (never on page
  load), PesaOtas asks the browser once to keep its data
  (`navigator.storage.persist()`), and records that it asked in
  `pesaotas.device`. Settings → Storage protection shows the answer, offers a
  button to ask again when not protected, and shows the last backup date
  (recorded on this device when a backup is downloaded), the space used, and
  whether the app works offline. Browsers decide by themselves (Chrome silently,
  by how the site is used; Firefox asks the user), so "not protected" is normal.
- **Backups remain essential.** The card explains that data is still lost when
  browser data is cleared, in private windows, with a lost or reset device, or
  in Safari when PesaOtas is used in the browser rather than from the Home
  Screen and not opened for 7 days of Safari use.
- **Managing safety copies.** Data safety lists every copy with its date, size,
  and whether it is the only copy on this device, with **Download** and
  **Delete…**. Deleting:
  - is never automatic, and needs a dialog that explains the consequences for
    that kind of copy and a ticked confirmation;
  - for the only copy on this device (no identical safety copy or current data),
    is possible only after downloading it in the same dialog;
  - is refused while the current data is missing, damaged, unsaved or awaiting
    recovery, because the copies may be all that's left;
  - names the exact copy the user saw; if another tab changed the list,
    nothing is deleted;
  - is verified by reading back, and never touches any other copy or the current
    data (`deleteRecoveryItem` in `src/storage.js`, covered by
    `tests/safety-copies.test.js`).
- Deleting the original PesaFlow data is allowed under these rules (D-09 rule 1
  as amended). PesaOtas never migrates or re-creates it afterwards.

## D-16 Storage format v3 and the compatibility safeguard — approved 2026-11-06 (v1.6 Phase 0), implemented v1.6.0 Phase 1

v1.5.0 ignores fields it doesn't know and always assumes KES, so it would show
a non-KES budget as KSh and quietly drop v1.6 fields on its next save. To stop
that, v1.6 uses a new storage format (v3) that v1.5.0 refuses.

- **Format v3** adds `currency` (D-17), `meta.currencyHistory` and
  `meta.upgradedFrom`. Format v2 (v1.1–v1.5 data and backups) and PesaFlow v1
  are still read and converted. Newer formats are refused.
- **Done in v1.6 Phase 4 (D-20)**, as required below: `meta.alertReviews` is part of
  format v3, the v1.5.0-compatible backup lists it as left out, and every path
  listed in point 3 is tested. *Original text:* **Deferred to Phase 4: `meta.alertReviews`** (the reviewed/dismissed marks
  for Expense Detective alerts, approved in Phase 0 decision 6). It is **not**
  part of the format yet: Phase 1 doesn't read, validate or keep it, and today
  any `meta` field the format doesn't know is dropped when data is checked. No
  data contains it yet, so nothing can be lost now. Before any code writes alert
  marks, Phase 4 must:
  1. add `meta.alertReviews` to the v3 rules in `src/data-model.js`, keeping
     every valid entry and reporting (never silently dropping) any unreadable
     one;
  2. add it to the v1.5.0-compatible backup's `omitted` list ("alert review
     marks"), because v1.5.0 can't hold it;
  3. prove with automated tests that the marks survive, unchanged: saving and
     reloading; backup and restore; restoring any safety copy; a currency
     change and its "Before currency change" copy; the stale-tab check; both
     choices of the "two versions" decision (keeping the v1.6 data keeps its
     marks; choosing older-version data starts with none, and the v1.6 data
     with its marks is kept in Data safety); and the v2 → v3 upgrade (v2 data
     has no marks, so it starts with none).
  Phase 4 alerts must not be introduced until these pass. Because v1.6.0 is
  released only after Phase 6, no published v3 data will lack this support; the
  field is an addition within format v3, so no new format version is needed.
- **New key.** v3 data lives under `pesaotas.data.v3`; the old key
  `pesaotas.data.v2` keeps a "moved" marker (version 3). *Changed during Phase 1
  from the Phase 0 plan, which kept the data under the old key:* testing showed
  that a v1.5.0 tab left open would otherwise overwrite v1.6 data with its own
  older copy, and v1.5.0's code can't be changed to prevent that. With a separate
  key, an older tab can only write under the old key; v1.6 detects it and never
  lets it replace v1.6 data.
- **The upgrade** (first v1.6 launch): check the v2 data → copy it exactly to
  `pesaotas.preserved.v1-5` and read it back → write v3 and verify it → write
  the marker. A failure at any step is reported exactly (`upgrade-failed` with
  the stage: copy, write or marker), loses nothing, shows the data read-only
  with **Try again** and **Download your data**, and completes at a later launch
  (an interrupted write is set aside in quarantine, never deleted; a damaged copy
  list is set aside rather than overwritten). Reopening never repeats it.
- **Two versions.** If v3 data exists and an older version has since saved
  different data under the old key (an open old tab, or after a rollback), v1.6
  shows both and the user chooses: keep the v1.6 data, or use the older data
  (upgraded). The other is kept in full in `pesaotas.preserved.older-version`
  first. Old-key data that exactly matches a safety copy carries nothing new and
  is simply replaced by the marker.
- **Stale tabs.** Every save checks that the stored data is exactly what this
  tab last read or wrote; if not, nothing is written and the tab stops saving
  until it is reloaded. Tabs are also told at once when another tab changes the
  data.
- **Going back to v1.5.0** uses a *v1.5.0-compatible backup* (format v2, KES only)
  or the pre-upgrade copy. The backup keeps every financial record and the
  `meta` fields v1.5.0 understands (`onboarding`, `createdAt`, `migratedFrom`).
  It leaves out exactly the v1.6-only metadata: `meta.currencyHistory` (the
  record of currency changes) and `meta.upgradedFrom` (when the budget was
  upgraded to format v3), and `meta.alertReviews` (alert review records, since
  Phase 4). `toV15Backup()` reports what it left out, and the app lists it when
  the file is downloaded. Procedure: [ROLLBACK.md](ROLLBACK.md). The stable release is tag
  `v1.5.0-baseline` (commit `4d8f130`).

## D-17 Currency — approved 2026-11-06 (v1.6 Phase 0), implemented v1.6.0 Phase 1

- One currency per budget: KES (default), UGX, TZS, NGN, ZAR, USD, GBP, EUR, in
  `src/currency.js` (adding one is a one-line change). Only the ISO code is
  stored. Display: grouping via `Intl.NumberFormat("en")`, symbols from the
  table (browsers disagree on symbols). KES looks exactly as in v1.5.0.
- **Whole units only** in v1.6 for every currency (no cents). Decimal support
  would need its own data migration in a later release.
- **No conversion, ever.** Changing the currency relabels the same numbers.
  With nothing recorded yet (onboarding), the choice applies at once. Otherwise
  a dialog shows the current and new currency with the user's own figures,
  states that no exchange-rate conversion takes place, offers a backup download,
  and needs a ticked confirmation. A verified copy is saved first in its own
  list (`pesaotas.pre-currency`), never replacing any other copy; if it can't be
  saved, nothing changes. The change is recorded in `meta.currencyHistory`. To
  undo: change back (lossless) or restore that copy.
- Backups carry the currency; restoring a backup in another currency says so
  in the preview and brings that currency back.
- Small-purchase investigation thresholds per currency (used by Insights'
  potential spending leaks, D-18, and by Expense Detective, Phase 4): KES 500, UGX 15,000, TZS 10,000, NGN 3,000, ZAR 100, USD/GBP/EUR 5.
  They are prompts to look, never judgements.

## D-18 Insights foundation — approved 2026-11-06 (v1.6 Phase 2), implemented v1.6.0 Phase 2

Insights is read-only analysis of recorded transactions (`src/insights.js`).
It never changes data, never saves anything to the budget, and sends nothing
anywhere. Calculations of balances and safe-to-spend (`src/finance.js`) are
unchanged; Insights only adds up recorded entries.

- **Periods**: Last 30 days (default), Last 6 months, All time. Every period
  ends today and includes today. Last 30 days = today and the 29 days before;
  Last 6 months = the day after the same date six months ago, to today; All
  time = from the first record. Entries dated after today are left out and
  counted ("1 entry dated after today isn't included").
- **What counts**: only *expense* entries are spending and only *income*
  entries are income. A savings transfer is never spending and a withdrawal is
  never income (D-04). **Net cash movement** = income − expenses − moved to
  savings + taken from savings, which equals the change in spending cash over
  the period (tested against `computeTotals`).
- **Fair comparisons only**: each figure is compared with the previous period of
  exactly the same length (the previous 30 days; the 6 months before), and only
  when the records cover **all** of that previous period. Otherwise the card
  says there is no comparison yet and from which date records would be needed.
  All time has no comparison. A change under 1% is given as an amount, not
  "0%"; a change from zero is given as an amount, never as a percentage.
- **Average daily spending and partial coverage** (wording approved 2026-11-06
  in the Phase 2 review): Where records begin part-way through a selected
  period, average daily spending is calculated using the calendar days from the
  later of the selected period's start date and the first recorded transaction
  date, through today inclusive. Days without recorded transactions within this
  coverage are treated as days with no recorded spending. The interface must
  explain the coverage period and number of days used.
  - When records cover the whole period, this is the period's full number of
    calendar days. The number of distinct dates that have entries is never used.
  - The first recorded transaction of any type (income, expense, savings
    transfer or withdrawal) starts the covered history; entries dated after
    today are ignored. With no covered history there is no daily average.
  - The previous period's average follows the same rule, ending on the previous
    period's last day. A comparison exists only when records cover that whole
    previous period, so there it is the previous period's full length.
  - Implemented once, in `PesaInsights.coveredDaysBetween`, which also gives
    the covered days of each row of the history table.
  - **Assumption:** PesaOtas treats the period from the first recorded
    transaction onward as covered history. It cannot independently determine
    whether missing entries represent days with no spending or transactions
    that were never recorded.
- **KPI cards** (each with a label, the figure, a plain explanation and, where
  fair, a comparison): total expenses; average daily spending; largest spending
  category (with its share); income vs expenses (share of income spent, or "no
  income recorded"); net cash movement; potential spending leaks.
- **Potential spending leaks** = expenses at or below the currency's
  small-purchase threshold (D-17: KES 500, UGX 15,000, TZS 10,000, NGN 3,000,
  ZAR 100, USD/GBP/EUR 5) plus expenses with no current category. An entry that
  is both is counted once. They are described as "worth a look", never as
  waste: everyday fares and small essentials are included by design.
- **Categories**: spending per category with its share; entries whose category
  no longer exists are grouped as "Other / uncategorised". Category changes are
  listed only when the comparison is fair.
- **History table**: weeks (Monday–Sunday) for Last 30 days, calendar months
  otherwise; weeks or months only partly inside the period, or only partly
  covered by records, are marked as partial.
- **Patterns** (Last 6 months and All time only), from **complete** calendar
  months fully covered by records, and only with at least **3** of them:
  months above **125%** of the median complete month ("unusually high", with
  the evidence), categories with spending in **every** complete month (with a
  monthly average), and up to **3** biggest category increases and decreases
  when the comparison is fair. With less data the screen says how many complete
  months are needed and how many there are. Thresholds live in
  `PesaInsights.SETTINGS`.
- **Period preference**: the chosen period is a device preference
  (`pesaotas.device` → `insightsPeriod`), not budget data: it isn't in backups,
  doesn't mark the budget as changed and is never shared between devices.
- The previous Insights screen (all-time totals, a transaction count, category
  spending against plan, and a fixed tip) is replaced. Spending against each
  category's plan remains on the Budget screen; previous pay cycles remain on
  Insights.

## D-19 Insights charts — plan approved 2026-11-06 (v1.6 Phase 3), implemented v1.6.0 Phase 3

Three read-only charts in Insights, following the selected period (D-18). Data
is prepared in `src/insights.js` (built on the tested `series` and
`categoryBreakdown`); `src/charts.js` only turns those figures into SVG; the
interface (`app.js`) chooses, formats and shows them. No charting library,
external service or new dependency. Nothing in the charts saves anything.

- **Spending trend**: one bar per day (Last 30 days), Monday–Sunday week (Last
  6 months) or calendar month (All time). The bars add up to total expenses.
- **Income vs expenses**: a pair of bars per calendar month, income left and
  expenses right. Months are cut to the period's dates: Last 30 days shows the
  two months it overlaps (for example 8–31 Oct and 1–6 Nov), each labelled as a
  partial month and never presented as a whole month's total; other periods cut
  only their edge months. Savings transfers and withdrawals are neither (D-04).
- **Spending by category (donut)**: largest first, ties alphabetical. Five or
  fewer categories: all shown separately. Exactly six: all six shown
  separately. More than six: the five largest, then the rest grouped as
  `Other categories (N)` (N is 2 or more). `Other / uncategorised` is an ordinary
  category: shown separately when it is among those shown, otherwise one of
  the grouped categories. Slices are drawn at their true size.
- **Period clipping and coverage are separate** (owner safeguard). A bar cut
  short by the period's start or end (`clipped`; `soFar` when it ends today) is
  labelled with its actual dates and "partial week/month". Coverage (D-18) is a
  separate state: *no history* (before the first record; hatched), *partly
  covered* (records begin inside the bar; lighter fill, dashed outline),
  *no spending recorded* (covered, nothing spent; a zero marker) and *spending*.
  A clipped bar is never called partly covered for that reason alone.
- **Selection and details**: each chart is one keyboard control (arrow keys,
  Home, End) with Previous/Next buttons (44px) and click or tap selection
  (nearest bar). The latest day/week/month and the largest category are
  selected by default; selection resets when the period changes. A details
  panel replaces hover-only tooltips; mouse hover adds a light highlight and the
  browser's own tooltip. Selections are announced politely.
- **Drill-through (read-only)**: a trend bar lists that day's, week's or
  month's expenses; a category lists its expenses in the period; `Other
  categories (N)` lists its categories (amount, share, entries) and their
  expenses. Newest first (the Transactions screen's order), 25 at a time with
  "Show 25 more", always with the count and total of the whole selection; never
  entries dated after today. No edit or delete actions; the Transactions screen
  is unchanged (no new filters).
- **Tables**: each chart has "Show as table" with the same figures and the same
  grouping, including partial-period and coverage notes and the categories inside
  the group.
- **Drawing**: SVG drawn at the chart area's measured width (no viewBox scaling),
  so text is never below 12px; redrawn on resize; never drawn while Insights is
  hidden. Bars at most 24px wide with 4px rounded tops; crowded labels are
  thinned, not shrunk. If a chart can't be drawn, the card says so and opens
  its table. Empty, future-only and no-spending periods say what's missing.
- **Colours** (checked with a colour-blindness validator, light background):
  spending/expenses `#d76c59` and income `#2a78d6` pass every check;
  categories use `#2a78d6`, `#eb6834`, `#1baf7a`, `#eda100`, `#e87ba4`,
  `#008300` in order, which pass for neighbouring slices including the last
  next to the first. Three of these are below 3:1 contrast against white, so
  every slice is also named in the legend, with its amount, and in the table.
  Colour is never the only signal: hatching, zero markers, dashed outlines,
  fixed positions and text carry the same meaning. Category colours follow the
  slice's rank in the current chart (six colours can't each belong to one
  category permanently).
- **Performance**: with 20,000 fictional entries, preparing every chart for All
  time takes about 95 ms in Node (measured; no optimisation needed).
- **Not included** (owner decisions): cross-filtering, configurable
  dashboards, cross-chart drill-down, Sankey diagrams. Richer desktop
  analytics is recorded as a future enhancement in the roadmap.

## D-20 Expense Detective — specification approved 2026-11-06 (v1.6 Phase 4), implemented v1.6.0 Phase 4

Deterministic, explainable, local-only rules (`src/detective.js`, pure and
read-only). No AI or machine learning, no network, no new dependency. Nothing
is categorised, edited, deleted, reviewed or dismissed automatically.
*Final-gate clarifications (2026-11-06, no decision changed):* alert-ID
encoding for unusual IDs, the exact format limits, and the duplicate-record
note are spelled out below; the pace table says "Too early to judge" or
"Ahead, small amount so far" instead of "On pace" when those are the facts (an
alert still needs every condition below).

**Windows** (inclusive; entries dated after today are never used):
- *S* — this pay cycle to today (cycle start on or before today), otherwise this
  calendar month to today: small purchases, uncategorised spending, the label.
- *C* — S start minus 30 days, to today: which entries can raise single-entry
  alerts.
- *R1* — for a bill dated *d*: the same series from 12 months before *d* to the
  day before. *R2* — for an expense dated *d*: the same category, *d*−180 days
  to *d*−1. *P* — pay cycle start to today (pace needs a pay cycle; with none,
  the Budget screen counts all-time use, so a month-based pace would contradict
  it).

**Rules** (thresholds in `PesaDetective.SETTINGS`; currency small-purchase
amounts from D-17):
- *Unusual bill (U1)*: Bills-type category; series = category + normalised note
  (lower case, digits removed, non-letters → spaces, collapsed). **A blank
  normalised note is never grouped.** Needs ≥ 3 earlier entries (strictly
  earlier dates) in ≥ 3 different months within R1. Typical = median of the
  latest ≤ 6. Flagged when amount > 125% of typical (exactly 125% is not) **and**
  amount − typical ≥ the threshold. With typical KSh 2,000: 2,499 and 2,500 not
  flagged, 2,501 flagged. Only higher amounts.
- *Unusually large expense (U2)*: non-Bills, categorised. Needs ≥ 5 earlier
  expenses in R2. Flagged when amount ≥ 3 × their median **and** amount − median
  ≥ the threshold.
- *Repeated bills (U3)*: **deferred** — several entries in a month aren't enough
  evidence of duplication.
- *Small purchases*: expenses ≤ the threshold in S (figures from
  `PesaInsights.leakSummary`, so they match the KPI card), with share,
  average, top 3 categories, and the previous equal window when fully covered.
  An **alert** only with ≥ 10 purchases **and** ≥ 10% of spending; otherwise an
  **observation** (no review buttons, not counted as "to review").
- *Uncategorised spending*: expenses in S whose category isn't a current one;
  an alert from one entry. **Edit** opens the existing edit form; the user saves.
- *Spending pace*: L = cycle length (cycle start to payday), e = days elapsed
  including today; spending to date from `cycleSummary(start, today+1)`.
  Eligible: Essential, Flexible, Personal, Event, Other with an allocation > 0
  (Bills and Savings excluded). *Ahead of pace* (alert) when spending is below
  the allocation, e ≥ 3, spending ≥ the threshold, and the share used is ≥ 25
  percentage points above the share of the cycle gone. Spending at or over the
  allocation is the informational status **Over allocation** (the Overview already
  warns). No forecasts. Entries dated after today are left out (the Budget
  screen includes them; the card says so when it matters).
- A "What Expense Detective checked" panel explains every rule's result,
  including where evidence was insufficient.

**Review records — `meta.alertReviews`** (format v3, an addition; D-16):
`{id, rule, status, actedAt, fingerprint, basis?, …}`. Statuses: New (no record),
`reviewed`, `dismissed`; "Move back to To review" removes the record (the user's
action). IDs: `unusual-bill:<txId>`, `large-expense:<txId>`,
`small-purchases:<S start>`, `uncategorised:<S start>`,
`spending-pace:<cycle start>:<categoryId>`. An entry or category ID made only
of letters, digits and `: _ . -` (at most 120 characters) is used as it is; any
other ID (spaces, `&`, `/`, accents — all allowed for entries and categories)
is written as `_h` + its 64-bit hash, so every alert can be reviewed. Alert IDs
are never parsed back. `basis`: small purchases
`{count, total, frame}`, uncategorised `{entryHashes}` (≤ 2,000; above that the
alert can't be reviewed, with a message), pace `{gapPoints, frame}`.
- **Forward compatibility:** records are kept exactly — unknown rules, statuses
  and fields (plain JSON, ≤ 4 levels, ≤ 64 KB per record), in order. A status
  this version doesn't know shows the alert under To review, unchanged until the
  user acts. Updating a status keeps every existing field.
- **Format limits checked** (records outside them are unreadable, not
  changed): `id` = a rule name, `:`, then 1–200 of `A–Z a–z 0–9 : _ . -`;
  `rule` = 2–40 of lower-case letters, digits and `-`, starting with a letter;
  `status` = 2–24 of lower-case letters and `-`; `actedAt` = an ISO date-time
  (with `T`) of at most 40 characters; `fingerprint` = 8–64 lower-case hex
  characters; `basis` as above; uncategorised `entryHashes` ≤ 2,000.
- **Validation:** unreadable records are reported in `reviewIssues`, never in
  the financial `rejected` list, and make the data "not clean" so they can't be
  saved away silently. An exact duplicate is removed with a note; a conflicting
  one is an issue. Removing an exact duplicate loses nothing (the remaining copy
  is identical); the note is shown in restore and recovery previews, while an
  ordinary load drops the identical copy without a message. Older formats ignore the field with a visible note.
- **Separate decision flow (Option A; additive `storage.js` change):** when the
  only problem is review records, `load()` returns `review-records-invalid` after
  copying the exact original to `pesaotas.preserved.review-records` and
  verifying it. The app opens read-only: "Your budget and transactions are
  fine", each record listed, **Continue without these records** (only with a
  verified copy; re-checks the copy, then a normal verified, stale-tab-checked
  save; the copy is never changed or deleted), **Try again** (when the copy
  failed), **Download the original data**, **Not now**. Financial damage takes
  priority (the usual recovery, review problems listed separately). Restore
  previews count readable records and list unreadable ones separately.
- **Privacy:** records are locally stored metadata. This version writes only IDs,
  rule and status names, action times, hex hashes and whole numbers — never
  notes, descriptions or other personal text. Fields from future versions are
  kept but no guarantee is made about their content. Records travel only in the
  user's own backups and safety copies; the v1.5.0-compatible backup leaves them
  out and says so. No pruning.

**Fingerprints and reappearance:** 64-bit FNV-1a over the actual evidence —
each transaction's ID, amount, date and category reference, plus the rule's
settings — used **only to notice change; not a security or privacy mechanism**.
U1: the bill and every series entry in R1, the typical amount, thresholds. U2:
the expense and every entry in R2, the median, thresholds. Uncategorised: every
entry (also hashed one by one). Small purchases and pace: every entry counted,
plus a separate *frame* (window, currency, threshold, allocation, cycle dates).
A reviewed or dismissed alert reappears ("Changed since you reviewed it on …")
only on material change: U1/U2 any evidence change; uncategorised a new entry or
a changed amount, date or category reference of one still uncategorised
(categorising or deleting doesn't); small purchases a frame change or growth to
≥ 125% and by ≥ the threshold; pace a frame change or a gap ≥ 25 points larger.
Time alone never brings an alert back; a new pay cycle or month is a new subject.

**Interface:** Insights only, after the KPI cards, with its own window label
("…not the period chosen above"); To review / Reviewed / Dismissed; review
buttons save through the normal save, are disabled with the reason when saving
is blocked, are announced, and move focus to the next card. No Overview shortcut.

**Performance:** 20,000 fictional entries — about 108 ms for every rule (Node).

## D-21 Logo and interface refinement — v1.6 Phase 5 (implemented, awaiting review)

Presentation only. No calculation, storage format, migration, backup or
restore behaviour, Expense Detective rule or currency handling changed.

- **Logo: approved recolour, Option 2** (confirmed by the owner 2026-11-06,
  from the Phase 0 options sheet): the owner's mark, traced from the supplied
  design with its geometry unchanged, in brand green `#147D62` with a white
  arrow line on forest `#102C25`. Used for the app icon (`icon.svg`), favicon,
  installable-app icons (normal, maskable with the mark inside the 40% safe
  circle, and Apple touch), the desktop sidebar and the phone header. No
  redesign: only colours, position and size. The decorative "PO" circle, which
  looked like a profile button but wasn't one, is replaced by the logo on phones.
- **Dates (KI-37):** written by the app, never by the browser: "6 Nov 2026",
  "6 November 2026", "Friday, 6 November 2026", and safety-copy times as
  "6 Nov 2026, 10:05" in the device's local time. Short months are fixed
  ("Sep", never "Sept"), matching Insights and Expense Detective.
- **Long dashes:** not used as joiners in messages; rewritten case by case as a
  full stop, colon, comma or brackets. Kept where they are the right mark: the
  page title and installed app name ("PesaOtas — Personal Finance"). En dashes
  in date ranges ("1 – 6 Nov") are kept. Placeholders are words ("Not set",
  "Not available"), which screen readers read sensibly.
- **Consistency:** section headings no longer repeat the page title; the
  saved-on-device pill says "Saved" on phones; singular and plural wording for
  over-budget categories; a blank payday card says "Not set" instead of a long
  dash and no longer repeats itself; spacing fixes (over-budget warning, the
  safe-to-spend explainer, Settings cards, Expense Detective disclosures,
  setup checklist alignment).
- **Transaction history** shows the newest 50 entries, then "Show 50 more"
  (focus moves to the first newly shown entry). Display only: totals,
  filters and every other screen still use every entry.
- **KI-39 (category donut colours): investigated, not changed.** Substantiated
  in a narrow case: colours follow slice rank, so a category can change colour
  between periods (in the test data "Other / uncategorised" is pink in Last 30
  days and green in All time). Names, amounts and the table always identify
  slices. Fixing it would change D-19's approved colour rule, so it is left for
  the owner's decision. *Proposal:* keep "Other / uncategorised" and the grouped
  "Other categories" slice in a fixed neutral grey, and give named categories
  colours by their rank over all time, so a category keeps its colour when the
  period changes (still at most six colours on screen).
- **Fixed while auditing:** a 17px sideways scroll on the blank Overview at
  320px (the currency list in the setup checklist), and the chart legend's
  hatch pattern ID appearing more than once on the page.

## D-08 Phase gating — approved 2026-11-05

Each phase ends with a report (files changed, tests run, results, outstanding
issues) and requires approval before the next phase starts.
