# PesaOtas

A free, local-first personal budgeting assistant for everyday budgeting in
Kenya. It answers one question: **how much can I safely spend right now
without compromising my other commitments?**

> **Development branch `v1.6-dev` — v1.6.0 Phase 1 (currency foundation)
> complete, not yet released.** The live app is v1.5.0 (tag `v1.5.0-baseline`).
> See CHANGELOG `[1.6.0-dev]`.
>
> **v1.5.0 (Phase 5 complete).** Saved data and
> restores are protected (Phase 1); safe-to-spend and savings with KCB M-PESA
> and M-Shwari work (Phase 2); budgets follow your pay cycle (Phase 3);
> PesaOtas branding, blank onboarding, editing and a category manager are in
> place (Phase 4); PesaOtas installs as an app, works offline, updates safely,
> asks the browser to protect its data, lets you manage safety copies, and is
> ready for GitHub Pages (Phase 5).
> Known issues: [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md).

## Getting started

A new PesaOtas starts completely empty — nothing is filled in for you. A short
checklist on the Overview walks you through three steps:

1. **Set your money and payday** (Settings): what you have now, when this pay
   cycle started, and your next payday.
2. **Add budget categories** (Budget): add your own, or tap **Add common
   categories** for a starting list of names (each at KSh 0), then give each
   one an allocation.
3. **Record your first entry**: your salary, a purchase, or money you save.

## Currency

PesaOtas keeps each budget in one currency: Kenyan Shilling (KES, the
default), Ugandan Shilling (UGX), Tanzanian Shilling (TZS), Nigerian Naira
(NGN), South African Rand (ZAR), US Dollar (USD), British Pound (GBP) or Euro
(EUR). Choose it during setup, or later in **Settings → Currency**. Amounts are
whole units (no cents).

**PesaOtas never converts between currencies.** Changing the currency only
changes the label next to the same numbers. Once you've recorded amounts,
PesaOtas shows the current and new currency with your own figures, asks you to
confirm, and first saves a copy of your data in **Data safety → Before
currency change**. To undo, change the currency back (nothing is lost) or
restore that copy. Backups include the currency.

## Upgrading to v1.6

The first time you open v1.6, your data is moved to a new storage format.
PesaOtas first saves an exact copy of your v1.5.0 data (Settings → Data
safety), and nothing is converted or removed. PesaOtas v1.5.0 can't open the
new format, which stops it misreading your budget. If you ever need to go back,
download a **v1.5.0-compatible backup** first (Settings → Backup your data),
then follow [docs/ROLLBACK.md](docs/ROLLBACK.md).

If you have PesaOtas open in two tabs, a tab whose data was changed in the
other one says so and stops saving until you reload it, so it can never
overwrite newer data.

## Managing your entries and categories

- **Edit any entry** with the ✎ button in Transactions. The same checks apply
  as for a new entry, and every total is recalculated. You can also correct an
  old savings entry that was recorded as an expense by changing it to **Save**.
- **Categories** are managed in a dialog (Budget → Add category, or Edit on any
  category): name, type, allocation and, for Savings, the account it's saved
  to. Renaming keeps every transaction attached. A category with transactions
  can only be deleted once you choose where those transactions go — nothing is
  deleted.
- **Unsaved budget changes** stay on screen until you save or discard them.

## Insights

**Insights** shows where your money went, for the **last 30 days**, the **last 6
months** or **all time** (your choice is remembered on this device):

- **Total expenses**, **average daily spending**, your **largest spending
  category**, **income vs expenses**, **net cash movement** (how much your
  spending cash went up or down) and **potential spending leaks** (small
  purchases and uncategorised spending worth a look).
- Average daily spending is per calendar day, counted from the start of the
  period or your first record, whichever is later. Days without entries count as
  days with no spending, so the average is only as complete as your records.
- Each figure is compared with the previous period of the same length, but only
  when your records cover all of it. Otherwise it tells you when a comparison
  will be possible. It never guesses.
- Money moved to savings is not spending, and money taken out of savings is not
  income.
- Spending by category, a week-by-week or month-by-month history, and patterns
  such as unusually expensive months once you have three complete months of
  records.
- **Charts**: your spending over time (by day, week or month), income vs
  expenses by month, and spending by category. Choose a bar or a category (tap,
  click, or the arrow keys) to see its details and the entries behind it. Each
  chart has **Show as table** with the same figures. Partial weeks and months
  are labelled, and dates before your first record are shown as "no records
  yet", not as zero.

Insights only reads your records. It never changes them and nothing leaves your
device.

## Install it, use it offline, and updates

Open PesaOtas from its web address (see [Publishing](#option-3-publish-it-on-github-pages)),
then install it: Chrome or Edge on a computer show an install icon in the address
bar; on Android use the menu → **Install app**; on iPhone/iPad use Safari →
Share → **Add to Home Screen**. Once opened online, it also works offline.

When a new version is published, PesaOtas downloads it in the background and
shows **"A new version of PesaOtas is ready"** with **Update now** and **Later**.
Nothing changes until you choose Update now, and it waits while you have
unsaved changes. Updates only replace the app's files — your data is never
touched. If a download is interrupted, the current version keeps working and
PesaOtas tries again later.

## Keeping your data safe on this device

**Settings → Storage protection** shows whether your browser has agreed to keep
PesaOtas data even when the device is short of space (PesaOtas asks once, after
you first save something; you can ask again there), when you last downloaded a
backup, how much space PesaOtas uses, and whether it works offline. Even when
protected, browser data is lost if you clear it, use a private window, lose or
reset the device — or, on iPhone/iPad/Mac, if you use PesaOtas in Safari rather
than from the Home Screen and don't open it for 7 days of Safari use.
**Downloading backups is the only protection against all of these.**

**Settings → Data safety** lists the safety copies PesaOtas keeps. You can
download any of them, and delete ones you no longer need: PesaOtas explains
what deleting that copy means, asks you to tick a confirmation, and — if it's
the only copy on this device — asks you to download it first. Deleting a copy
never changes your current data, and PesaOtas never deletes a copy on its own.

## Accessibility

PesaOtas aims for text of at least 12px, WCAG AA colour contrast, touch targets
of at least 44px, labelled controls for screen readers, visible keyboard focus
and a "Skip to main content" link. It respects your device's reduced-motion
setting. What has and hasn't been tested (including real screen readers) is in
[docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md).

## How "safe to spend" works

**Safe to spend = flexible budget left + unallocated money**, never more than
your spending cash and never below zero. In other words: your cash minus
everything still set aside for bills, essentials, savings and other
commitments. Overspending or allocating more than you have lowers it. The
Overview explains the figure step by step. The daily guide divides it by the
days left until payday.

## Savings

Record money you move to **KCB M-PESA** or **M-Shwari** with **Save**, and money
you bring back with **Withdraw**. These are never counted as spending or
income. Each account's balance is tracked separately; set what they already
held under **Settings → Savings starting balances**. Link a Savings budget
category to an account (Budget screen) and your transfers fill that allocation
automatically. If you withdraw from that account, the withdrawn amount stops
counting towards the allocation. Everything is entered by hand: PesaOtas never
connects to these services or asks for PINs or passwords.

## Pay cycles and payday

Your budget runs from the start of your pay cycle until your next payday. Only
spending in the current cycle counts against your allocations; earlier
transactions stay in your history.

When payday arrives, PesaOtas asks you to **start your new pay cycle**. It never
does this on its own. You'll see a summary of the cycle that's ending, then:

- **Nothing is deleted.** Every transaction stays in your history.
- **Your spending cash carries over as it is.** It's real money, so it never resets.
- **Allocations start again** at their full amounts for the new cycle.
- **Money left in allocations is released** into your spending cash, and the new
  cycle's allocations are set aside from it.
- **Savings balances don't change.** You can choose to move some leftover to
  KCB M-PESA or M-Shwari as part of the step.

A copy of your data is kept in Data safety before the new cycle starts. Closed
cycles are listed under **Insights → Previous pay cycles**.

## Upgrading from PesaFlow

Open PesaOtas in the same browser you used for PesaFlow. Your data moves across
automatically the first time, and every total is checked. Your original
PesaFlow data is never changed or deleted, and a copy is kept: both can be
downloaded from **Settings & backup → Data safety**. Older PesaFlow backup
files can be restored too; PesaOtas checks and previews them first.

## Run it

### Option 1: open the file (simplest)
1. Extract the ZIP.
2. Open the project folder.
3. Double-click `index.html`.

Everything works this way except installing, offline use and update
prompts, which need a web address.

### Option 2: run a local web server (Windows)
Open Command Prompt in the project folder and run:

```bat
py -m http.server 8000
```

Then open `http://localhost:8000`. Press `Ctrl + C` to stop. If `py` is not
recognised, use `python -m http.server 8000`.

### Option 3: publish it on GitHub Pages
Free, no server needed, and your data still never leaves your device. Step by
step: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Development

### Requirements
- Any modern browser.
- [Node.js](https://nodejs.org/) 20 or newer, **only** for running tests.
  There are no packages to install.

### Run the tests
From the project folder:

```bat
npm test
```

or, without npm:

```bat
node --test
```

You should see `fail 0`. Any `todo` entries are known defects that are
documented, not yet fixed (see the testing policy in
[docs/DECISIONS.md](docs/DECISIONS.md), D-06).

### Preparing a release
After changing any app file, bump the version in `src/version.js` and
`package.json`, then run `npm run release`. It records a fingerprint of every
app file in `sw.js`, which is how browsers notice the update; `npm test` fails
if you forget. `npm run build-site` builds the publishable folder (`_site`)
with only the app files. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

### Project structure

```
index.html          App markup
styles.css          Styles (mobile breakpoints at 1100, 800 and 390px)
app.js              UI: rendering, forms, restore preview, recovery screens
src/version.js      The app version (shown in the app; used by releases)
src/currency.js     Supported currencies and amount formatting (D-17)
src/validation.js   Amounts, dates and IDs (pure, tested)
src/finance.js      Calculations: balances, safe-to-spend, savings, KSh format (pure, tested)
src/data-model.js   Schema v2, PesaFlow conversion, data/backup checks (pure, tested)
src/storage.js      Loading, migration, verified saving, safety copies (tested)
src/entries.js      Rules for adding/editing entries and managing categories (pure, tested)
src/insights.js     Insights: periods, totals, comparisons, patterns, chart data (pure, read-only, tested)
src/charts.js       Insights charts: SVG drawing only, no calculations (pure, tested)
sw.js               Service worker: offline copy and safe updates (D-14)
manifest.json       Install metadata
icons/              App icons (PNG; sources and how to regenerate in icons/src)
tools/              Release tooling: file list, sw.js fingerprints, site build
.github/workflows/  GitHub Pages deployment
tests/              node:test suite, neutral fixtures, fake browser storage
docs/DECISIONS.md   Approved product and architecture decisions
docs/KNOWN_ISSUES.md Known defects and the phase that fixes each
docs/ROADMAP.md     Phase plan
docs/DEPLOYMENT.md  Publishing on GitHub Pages, updates, rollback
docs/ROLLBACK.md    Going back to v1.5.0 safely (no history rewritten)
docs/ACCESSIBILITY.md What was tested, limits, manual checklist
CHANGELOG.md        Every meaningful change
```

### Rules for contributors
- All money logic goes in `src/` as pure functions, with tests.
- All reading and writing of saved data goes through `src/storage.js`, which
  enforces the safety rules in DECISIONS D-09. Never write to browser storage
  directly, and never write to the PesaFlow key.
- Whole units only, in the budget's own currency. Format amounts with
  `PesaCurrency.format` (or the app's `money()`); never write a currency
  symbol into the code.
- Plain `<script>` tags only — no build step, frameworks or paid services.
- When a file is added to the app, add it to `tools/release-files.js`. After
  any change to the app, bump the version and run `npm run release`.
- The app must never make network requests other than loading its own files
  (no analytics, fonts, CDNs or APIs); `npm test` checks this.
- Record every meaningful change in `CHANGELOG.md`.

## Privacy and backup

- Financial data is stored only in this browser's LocalStorage on this device.
  Clearing browser data, using private browsing, or switching browsers or
  devices means it is not there.
- No bank, M-Pesa or other account is connected, and no credentials, PINs or
  passwords are ever requested.
- Use **Settings & backup → Download backup** regularly and keep the file
  somewhere private. Backup files are excluded from the repository by
  `.gitignore`.
- Restoring a backup always shows a preview first and needs your confirmation.
  The data it replaces is kept under **Data safety**.
- **Restoring replaces everything.** A backup or safety copy is a snapshot of
  one moment. Restoring it — including the copy made just before a new pay
  cycle, a reset or a recovery — replaces *all* current data with that
  snapshot. Anything you recorded after the snapshot was made (transactions,
  savings entries, budget changes, a later pay cycle) will no longer be in the
  app. The preview tells you how many entries on this device are not in the
  file. PesaOtas keeps a copy of what it replaces, but **only the most recent
  one**, so download a backup first if you might need today's data again.
  There is no undo button.
- If saved data is ever damaged, PesaOtas sets it aside instead of replacing
  it, and asks you what to do. Nothing is saved until you choose.
- Safety copies use the same browser storage (about 5 MB in total), which is
  plenty for everyday use. You can delete ones you no longer need from Data
  safety (with confirmation; the only copy must be downloaded first).
- PesaOtas asks the browser to protect its data from automatic clean-up, but
  that never replaces backups (see "Keeping your data safe on this device").
- Publishing PesaOtas online (GitHub Pages) publishes only the app's files.
  Your records stay in your browser and are never uploaded.
- Anyone with access to your unlocked browser profile can open the app and its
  data.

## Disclaimer

PesaOtas is a budgeting aid, not financial advice or a banking application.
