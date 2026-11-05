# PesaOtas

A free, local-first personal budgeting assistant for everyday budgeting in
Kenya. It answers one question: **how much can I safely spend right now
without compromising my other commitments?**

> **Status — v1.2.0 (Phase 2 complete).** PesaOtas is being developed from the
> PesaFlow v1.0 prototype in small, tested phases. Saved data and restores are
> protected (Phase 1); safe-to-spend and savings with KCB M-PESA and M-Shwari
> work (Phase 2). Not yet done: pay cycles (the budget doesn't reset at payday),
> and the PesaOtas name and blank onboarding. Known defects:
> [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md).

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
automatically. Everything is entered by hand: PesaOtas never connects to these
services or asks for PINs or passwords.

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

Everything works this way except offline/install features, which need a web
server.

### Option 2: run a local web server (Windows)
Open Command Prompt in the project folder and run:

```bat
py -m http.server 8000
```

Then open `http://localhost:8000`. Press `Ctrl + C` to stop. If `py` is not
recognised, use `python -m http.server 8000`.

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

You should see `fail 0`. The `todo` entries are known defects that are
documented, not yet fixed (see the testing policy in
[docs/DECISIONS.md](docs/DECISIONS.md), D-06).

### Project structure

```
index.html          App markup
styles.css          Styles (mobile breakpoints at 1100, 800 and 390px)
app.js              UI: rendering, forms, restore preview, recovery screens
src/validation.js   Amounts, dates and IDs (pure, tested)
src/finance.js      Calculations: balances, safe-to-spend, savings, KSh format (pure, tested)
src/data-model.js   Schema v2, PesaFlow conversion, data/backup checks (pure, tested)
src/storage.js      Loading, migration, verified saving, safety copies (tested)
sw.js               Service worker (offline cache)
manifest.json       Install metadata
tests/              node:test suite, neutral fixtures, fake browser storage
docs/DECISIONS.md   Approved product and architecture decisions
docs/KNOWN_ISSUES.md Known defects and the phase that fixes each
docs/ROADMAP.md     Phase plan
CHANGELOG.md        Every meaningful change
```

### Rules for contributors
- All money logic goes in `src/` as pure functions, with tests.
- All reading and writing of saved data goes through `src/storage.js`, which
  enforces the safety rules in DECISIONS D-09. Never write to browser storage
  directly, and never write to the PesaFlow key.
- Whole Kenyan shillings only; display as **KSh**.
- Plain `<script>` tags only — no build step, frameworks or paid services.
- When a file is added to the app, add it to `APP_FILES` in `sw.js` and bump
  `CACHE_NAME`.
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
- If saved data is ever damaged, PesaOtas sets it aside instead of replacing
  it, and asks you what to do. Nothing is saved until you choose.
- Safety copies use the same browser storage (about 5 MB in total), which is
  plenty for everyday use.
- Anyone with access to your unlocked browser profile can open the app and its
  data.

## Disclaimer

PesaOtas is a budgeting aid, not financial advice or a banking application.
