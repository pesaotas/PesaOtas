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
| `pesaflow.personal.v1` | Original PesaFlow data | **Never** |
| `pesaotas.data.v2` | Live PesaOtas data (schema v2) | Yes, verified on every save |
| `pesaotas.preserved.pesaflow-v1` | Copies of the original PesaFlow text, made before migrating | Added to only; identical copies not repeated |
| `pesaotas.quarantine` | Damaged data set aside, with date and reason | Added to only; identical copies not repeated |
| `pesaotas.pre-restore` | Data as it was before the last restore, recovery or reset | Replaced each time |

Rules (enforced in `src/storage.js`, covered by `tests/storage.test.js`):

1. The PesaFlow key is never modified or deleted.
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

## D-08 Phase gating — approved 2026-11-05

Each phase ends with a report (files changed, tests run, results, outstanding
issues) and requires approval before the next phase starts.
