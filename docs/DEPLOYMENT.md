# Publishing PesaOtas on GitHub Pages

PesaOtas is a static website: a few HTML, CSS, JavaScript and image files. It
has no server, database or account, and costs nothing to host on GitHub Pages.
Everything a person records stays in their own browser. **Publishing the app
never publishes anyone's financial data**, because that data never leaves the
device it was entered on.

The published address will look like `https://<your-username>.github.io/PesaOtas/`.
Every path in the app is relative, so it works from that sub-folder (or any
other) without changes.

## 1. Before you start

- A free GitHub account.
- [Node.js](https://nodejs.org/) 20 or newer on your computer (only to run the
  tests and prepare releases; nothing is installed from the internet).
- Git, or GitHub Desktop.

> **Free GitHub Pages needs a public repository.** Anyone can read the code.
> That's fine: the code contains no personal data. Never commit a backup file
> (see "Keeping personal data out of the repository" below).

## 2. Create the repository

1. On GitHub, choose **New repository**. Name it `PesaOtas` (the name becomes
   part of the address). Make it **Public**. Don't add a README or licence
   (the project already has them).
2. In the project folder on your computer:

   ```bat
   git remote add origin https://github.com/<your-username>/PesaOtas.git
   git branch -M main
   git push -u origin main --tags
   ```

## 3. Turn on publishing (recommended: GitHub Actions)

1. On GitHub, open the repository → **Settings** → **Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. That's all. The workflow in `.github/workflows/pages.yml` runs on every push
   to `main` (and can be run by hand from the **Actions** tab → *Deploy to
   GitHub Pages* → **Run workflow**). It:
   - checks the release fingerprints are current (`npm run check-release`),
   - runs every test (`npm test`) — a failing test stops the deployment,
   - builds `_site` with **only** the app files (`npm run build-site`),
   - publishes `_site`.

The first deployment takes a minute or two. The address appears on the
**Settings → Pages** screen and in the workflow run.

### Alternative: publish from a branch (no Actions)

Settings → Pages → Source: **Deploy from a branch**, branch `main`, folder
`/ (root)`. This works, but publishes the **whole repository** — tests, docs and
tools as well as the app (still no personal data, because backups are
git-ignored). The Actions route above publishes only the app, so prefer it.

## 4. Check the published app

Open the address in a private/incognito window first (so nothing from an
earlier visit is involved), then in your normal browser:

- [ ] The Overview opens, and **Settings → Storage protection** says *Works
      offline: Ready (version 1.6.0)* (the version you published) after a few
      seconds (reload once if it says "Not ready yet").
- [ ] The sidebar (desktop) shows that version, e.g. `PesaOtas v1.6.0`.
- [ ] **Install**: Chrome or Edge on a computer shows an install icon in the
      address bar; on Android, the menu offers **Install app** or **Add to Home
      screen**; on iPhone/iPad use Safari → Share → **Add to Home Screen**.
      The installed app opens in its own window with the PesaOtas icon.
- [ ] **Offline**: turn on airplane mode (or disconnect), then open the
      installed app or the address. It opens with your data.
- [ ] Add a test entry, download a backup, delete the test entry.
- [ ] Optional, in Chrome: DevTools → **Application** → *Manifest* (no errors)
      and *Service workers* (one worker, "activated and is running").

## 5. Publishing an update

1. Make and test your changes. **Bump the version** in `src/version.js` and in
   `package.json` (they must match), and add a `CHANGELOG.md` entry.
2. Run:

   ```bat
   npm run release
   npm test
   ```

   `npm run release` writes a fingerprint of every app file into `sw.js`. If
   you forget it, `npm test` (and the deployment) fails with "sw.js is out of
   date" — nothing broken can be published.
3. Commit and push to `main`. The workflow publishes it.

**What people see:** the next time they open PesaOtas (or within an hour if it's
already open), their browser downloads the changed files in the background and
checks every one against its fingerprint. Then a bar says *"A new version of
PesaOtas is ready"* with **Update now** and **Later**. Nothing changes until they
choose Update now, and they can't while they have unsaved changes. Their data
is never touched: updates only replace the app's files.

If a download is interrupted — or GitHub is still part-way through publishing
and serving a mix of old and new files — the new version is discarded, the
current version keeps working (online and offline), and the browser tries again
later.

**People upgrading from v1.0–v1.4** have no update bar yet, so v1.5 takes over
by itself the first time; they see it on their next launch, data unchanged.

### Rolling back

To go back from v1.6 to the stable v1.5.0 without rewriting any history, follow [ROLLBACK.md](ROLLBACK.md). For a rollback within one major version:

Revert the bad commit (`git revert <commit>`), bump the version again (for
example 1.5.1 → 1.5.2 — browsers only move forward), run `npm run release`,
commit and push. People are offered the fixed version as a normal update.

## 6. Keeping personal data out of the repository

- `.gitignore` excludes every file name PesaOtas downloads
  (`pesaotas-*.json`, `pesaflow-*.json`, anything with "backup" in the name)
  and the `_site` build folder. Keep backups **outside** the project folder
  anyway.
- `npm test` fails if any JSON file other than `manifest.json` and
  `package.json` is tracked by Git.
- The published site contains only the files listed in
  `tools/release-files.js`; the build refuses to run into a folder that
  contains anything else.
- The app makes no network requests except loading its own files: no
  analytics, fonts, CDNs or APIs (checked by `tests/release.test.js` and the
  browser tests).

## 7. Good to know

- **Each browser keeps its own data.** Data entered in Chrome on a phone isn't
  in Safari on the same phone, or on a laptop. Use **Download backup** and
  **Restore from backup** to move it.
- **Browser storage belongs to the whole `<your-username>.github.io` address.**
  All your GitHub Pages projects share it, so another of your own projects there
  could read PesaOtas data. If you publish other projects, consider a custom
  domain for PesaOtas (Settings → Pages → Custom domain), which gives it its own
  storage. If you ever move PesaOtas to a different address, people's data does
  **not** follow; they must download a backup at the old address and restore it
  at the new one.
- **Opening `index.html` directly from disk** still works for everyday use, but
  without offline support, installation or update prompts (browsers only allow
  those on a web address).
- The workflow uses GitHub's official actions (`actions/checkout`,
  `setup-node`, `configure-pages`, `upload-pages-artifact`, `deploy-pages`).
  GitHub occasionally releases new major versions; update the version numbers
  in `pages.yml` if a run warns that one is deprecated.

## 8. Before publishing v1.6.0: testing on your own phones

Testing on real phones is required before v1.6.0 is published (DECISIONS D-22).
The release candidate comes as two ZIP files of built sites:
`pesaotas-v1.6.0-rc.1-site.zip` (the candidate) and `pesaotas-v1.5.0-site.zip`
(the current live version, for the upgrade rehearsal). Use **fictional data
only** in these test copies.

**First, on each phone, download a backup from the live app** (Settings →
Download backup) and keep it somewhere safe.

**Why a computer is involved.** Installing, offline use and update prompts only
work on a secure address: `https://…` or `http://localhost`. A phone opening
your computer's Wi-Fi address (`http://192.168…`) gets neither, so the steps
below use a USB cable for Android. The live site already is `https`.

### Android (Chrome), with a USB cable

1. On the phone, turn on **Developer options → USB debugging**, then connect it
   to the computer.
2. On the computer, open Chrome at `chrome://inspect/#devices`, choose **Port
   forwarding**, and add port `8000` → `localhost:8000`.
3. Extract `pesaotas-v1.5.0-site.zip` into a folder, open Command Prompt there
   and run `py -m http.server 8000`.
4. On the phone, open Chrome at `http://localhost:8000`. Set up a small
   fictional budget, add a few entries, and install the app (menu → **Install
   app**).
5. Stop the server (`Ctrl + C`). Extract `pesaotas-v1.6.0-rc.1-site.zip` into a
   **different** folder and run the same command there.

Then check, on the phone:

- [ ] Opening the installed app shows **"A new version of PesaOtas is ready"**;
      **Update now** works.
- [ ] Every figure is the same as before the update, and **Settings → Data
      safety** lists the copy of your v1.5.0 data.
- [ ] The sidebar footer (or Settings) shows version 1.6.0, and the app
      header shows the new green logo.
- [ ] Close the app fully and reopen it. Chrome offers the new icon (a prompt,
      or a suggestion in Chrome's ⋮ menu); after accepting, the home-screen
      icon shows the green logo. Chrome may take a short while to offer it.
- [ ] With airplane mode on, the installed app opens with your data.
- [ ] Insights and Expense Detective open, and the charts fit the screen.

### iPhone (Safari)

Safari allows installing and offline use only on an `https` address, so the
candidate can't be installed on an iPhone from your computer. On the same Wi-Fi,
run `py -m http.server 8000 --bind 0.0.0.0` in the candidate folder and open
`http://<your computer's address>:8000` on the iPhone to check:

- [ ] Every screen opens and reads correctly; nothing scrolls sideways.
- [ ] The screen-reader and large-text checks below.

Installing from the Home Screen and offline use on iPhone can then be checked
either straight after publishing (with your backup downloaded and
[ROLLBACK.md](ROLLBACK.md) ready), or before publishing on a temporary `https`
test site. A test site is itself a publication, so it needs your decision.

### Screen reader and large text (one phone is enough)

- [ ] **TalkBack** (Android) or **VoiceOver** (iPhone): the Overview is read in
      order; adding an entry can be done and is announced; on Insights, an
      Expense Detective alert can be opened and **Mark as reviewed** is
      announced. More checks: [ACCESSIBILITY.md](ACCESSIBILITY.md).
- [ ] The phone's **largest text size**, and 200% zoom in a desktop browser:
      Overview and Insights stay readable, nothing is cut off, nothing scrolls
      sideways.

Note anything that looks wrong, with a screenshot if you can. A problem found
here is fixed in a new candidate (`rc.2`) and every check runs again.

## 9. Publishing v1.6.0 (only after your approval)

Do these steps yourself, in order, only after you have approved the candidate.
Nothing here is done by the release candidate work.

1. Check the candidate: the approved release candidate is rc.2, commit
   `d087657` (rc.1, `3f4ed6c`, was superseded). `git status` must show a
   clean working tree on `v1.6-dev`.
2. Do Step 0 of [ROLLBACK.md](ROLLBACK.md): push the stable tag
   (`git push origin v1.5.0-baseline`) and download a backup from the live app.
3. Merge with a merge commit, so the release can be undone in one step:

   ```bat
   git checkout main
   git merge --no-ff d087657 -m "Release PesaOtas v1.6.0"
   git diff --stat d087657 main
   ```

   The last command must print nothing: `main` then holds exactly the candidate.
4. `git push origin main`. The workflow tests, builds and publishes it.
5. Run the checks in section 4 with version 1.6.0, accept the update on your
   own devices, and finish any iPhone checks left from section 8.
6. If anything is wrong, follow [ROLLBACK.md](ROLLBACK.md).

`v1.6.0-rc.1` stays a local tag and is never pushed. The `v1.6.0` release tag
marks the approved commit `d087657`; `main`'s merge commit holds exactly the
same files.

