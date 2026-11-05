# PesaOtas

A free, local-first personal budgeting assistant for everyday budgeting in
Kenya. It answers one question: **how much can I safely spend right now
without compromising my other commitments?**

> **Status — v1.0.1 (Phase 0 complete).** PesaOtas is being developed from the
> PesaFlow v1.0 prototype in small, tested phases. The interface still shows the
> PesaFlow name and demonstration data; both change in later phases. Known
> defects are listed in [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md). Do not
> rely on the safe-spending figures or on restoring backups from other sources
> until Phases 1–2 are complete.

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
app.js              UI: rendering, forms, storage, backup/restore
src/finance.js      Pure financial calculations (tested; no DOM/storage)
sw.js               Service worker (offline cache)
manifest.json       Install metadata
tests/              node:test suite and neutral fixtures
docs/DECISIONS.md   Approved product and architecture decisions
docs/KNOWN_ISSUES.md Known defects and the phase that fixes each
docs/ROADMAP.md     Phase plan
CHANGELOG.md        Every meaningful change
```

### Rules for contributors
- All money logic goes in `src/` as pure functions, with tests.
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
- Anyone with access to your unlocked browser profile can open the app and its
  data.

## Disclaimer

PesaOtas is a budgeting aid, not financial advice or a banking application.
