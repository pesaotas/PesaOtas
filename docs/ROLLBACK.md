# Going back to PesaOtas v1.5.0

This guide explains how to put the stable v1.5.0 back on your GitHub Pages
site if v1.6 ever needs to be withdrawn, **without deleting or rewriting any
Git history** and without losing anyone's data. Read it once before you
publish v1.6, and do step 0 then.

## The stable release

| | |
|---|---|
| Tag | `v1.5.0-baseline` |
| Commit | `4d8f130` ("Use Node 22 in the GitHub Pages workflow") |
| What it is | Exactly what was live on `main` before v1.6: the v1.5.0 app (tag `v1.5.0-phase5`, commit `94cfe50`) plus the Node 22 workflow change |
| v1.6 work | Branch `v1.6-dev`. It is never deleted or rewritten by anything in this guide |

**Never use** `git reset --hard`, `git push --force`, `git rebase` on `main`,
or delete a branch or tag to roll back. Every method below only adds to the
history.

## Step 0: before publishing v1.6 (once)

1. Push the stable tag so GitHub has it:

   ```bat
   git push origin v1.5.0-baseline
   ```

2. When you publish v1.6, merge it with a merge commit, so the whole release
   can be undone in one step later:

   ```bat
   git checkout main
   git merge --no-ff v1.6-dev -m "Release PesaOtas v1.6.0"
   ```

3. Download a backup from the live v1.5.0 app first (Settings → Download
   backup), as a personal safety net.

## What happens to people's data

- When someone first opens v1.6, their data is upgraded to a new storage
  format (v3). v1.6 first saves an exact copy of the v1.5.0 data ("Your data
  before upgrading to v1.6 (v1.5.0 format)" in Settings → Data safety), then
  the upgraded data, then a small marker under the old storage key.
- v1.5.0 **refuses** upgraded data. It doesn't show it under the wrong currency
  or quietly drop fields. It shows its recovery screen ("This data was made by a
  newer version of PesaOtas") and changes nothing until the person chooses.
- So, before a rollback, everyone who wants to keep what they recorded in v1.6
  should download a **v1.5.0-compatible backup** (Settings → Backup your data →
  "Download a v1.5.0-compatible backup").
  - It contains every amount, transaction, category, savings account and pay
    cycle.
  - It leaves out only information that v1.6 alone records, none of it
    financial:
    - the record of currency changes (`meta.currencyHistory`);
    - the note of when the budget was upgraded to the v1.6 format
      (`meta.upgradedFrom`).

    When Expense Detective arrives (v1.6 Phase 4), alert review marks
    (`meta.alertReviews`) will be left out too, and added to this list. When
    you download the file, the app lists exactly what was left out.
  - It is available only for budgets in Kenyan shillings (KES), because v1.5.0
    shows every amount as KSh. A budget in another currency must first be
    changed back to KES (Settings → Currency; nothing is converted) or use the
    copy made before the upgrade.

## Method A (recommended): deploy the stable tag, leave `main` as it is

No commits, no Git commands beyond step 0.

1. **Allow the tag to deploy (once).** On GitHub: repository → **Settings → Environments → github-pages → Deployment branches and tags → Add deployment branch or tag rule** → Ref type **Tag**, pattern `v1.5.0-baseline`.
   Without this rule GitHub refuses the deployment with a message that the tag "is not allowed to deploy to github-pages due to environment protection rules". Nothing is published in that case and the live site is unchanged.
2. **Deploy.** Repository → **Actions → Deploy to GitHub Pages → Run workflow** → under "Use workflow from" choose **Tags → v1.5.0-baseline** → **Run workflow**. The workflow runs the v1.5.0 tests and publishes only the v1.5.0 app files.
3. **Check it** (see "Verify" below).
4. **While rolled back, don't push to `main`.** Every push to `main` publishes `main` (v1.6) again. To return to v1.6 deliberately, run the workflow from the branch **main** instead.

## Method B: undo the release on `main` with a revert commit

Use this if you want `main` itself to say "rolled back". It adds a commit; it
removes nothing from the history.

```bat
git checkout main
git pull
git log --oneline --merges -5
git revert -m 1 <the "Release PesaOtas v1.6.0" merge commit>
git push
```

- `git log` finds the merge commit; copy its short id into the `git revert` line.
- `git revert -m 1` makes the files match the stable release again.
- `git push` makes the workflow publish it automatically.

Check that the app files now match the stable tag (no output means identical):

```bat
git diff v1.5.0-baseline -- index.html styles.css app.js manifest.json sw.js src icons
```

To return to v1.6 later, revert the revert commit (`git revert <its id>`) and push.

## What each person sees after a rollback

1. An open v1.6 page shows "A new version of PesaOtas is ready". This is
   v1.5.0 arriving. Choosing **Update now** loads v1.5.0.
2. v1.5.0 shows **"Your saved budget data needs attention … This data was made
   by a newer version of PesaOtas."** This is expected; nothing has been deleted.
3. Choose **Restore from a backup file**, pick the v1.5.0-compatible backup, check
   the preview and confirm.
   - Don't choose **Start with an empty budget**. It would replace the upgraded
     data under the old key. A copy is still kept, but restoring is the right
     path.
   - With no v1.5.0-compatible backup, the copy made before the upgrade (format
     v1.5.0) can be restored the same way after downloading it from Data safety.
     It doesn't include anything recorded in v1.6.
4. The v1.6 data itself stays in the browser, untouched by v1.5.0.

## Returning to v1.6 after a rollback

Publish `main` again: Method A, run the workflow from **main**; Method B,
revert the revert. When people open v1.6:

- If they changed nothing in v1.5.0, v1.6 simply carries on.
- If they recorded anything in v1.5.0, v1.6 shows **"Two versions of your
  budget were found"** with both summaries side by side. They choose which to
  keep; the other is kept in full in Settings → Data safety. Choosing **Use the
  data saved by the older version** keeps everything entered during the
  rollback.

## Verify

- [ ] The Actions run is green and the site opens.
- [ ] On a phone or computer that used v1.6: accept the update, restore the
      v1.5.0-compatible backup, and check that balances, transactions, savings
      accounts, categories and pay-cycle history match.
- [ ] The sidebar (desktop) shows `PesaOtas v1.5.0`.
- [ ] Settings → Storage protection says *Works offline: Ready (version 1.5.0)*.

## What was tested

- In a browser, against the real v1.5.0 app:
  - the full data path of a rollback and return (v1.6 → v1.5.0 → v1.6);
  - v1.5.0 refusing upgraded data;
  - restoring the v1.5.0-compatible backup in v1.5.0, with every balance,
    transaction, savings account, category and pay cycle identical;
  - the "two versions" choice on returning.
- Not tested: the GitHub steps themselves (the environment tag rule and running
  the workflow from a tag), because I have no access to your GitHub account.
  They are standard GitHub features; if a run fails, nothing is published and
  the live site stays as it was.
