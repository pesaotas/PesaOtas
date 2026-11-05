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

**To confirm before Phase 2 is built:**

1. *Linking budget allocations to transfers.* Proposed: a Savings-type budget
   category can be linked to a destination, and transfers to it fulfil that
   allocation. Without this, a transfer lowers cash while its allocation stays
   reserved, so the money would be held back twice.
2. *Limits.* Proposed: block a withdrawal larger than the destination's
   balance; warn (but allow) a transfer larger than spending cash.
3. *Interest and fees* (e.g. M-Shwari interest). Proposed: a later
   "adjustment" entry per destination; not in the first savings release.

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

## D-08 Phase gating — approved 2026-11-05

Each phase ends with a report (files changed, tests run, results, outstanding
issues) and requires approval before the next phase starts.
