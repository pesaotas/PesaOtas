# Known issues

Defects found during the Phase 0 assessment of PesaFlow v1.0 and in later
phases. Each one was reproduced by running the code (not inferred from reading
it) unless marked otherwise. Tests for the **corrected** behaviour are added in
the phase that fixes each issue; until then they appear as `todo` entries in
`tests/finance.test.js`.

Severity: **Critical** = can corrupt or lose financial data · **High** = shows
misleading money figures · **Medium** = wrong or awkward but not misleading ·
**Low** = edge case.

## Open

| ID | Severity | Issue | Fix phase |
|---|---|---|---|
| KI-17 | Medium | Service worker is cache-first with a manually versioned cache: deployed fixes may not reach installed users unless the cache name is bumped. Only an SVG icon is provided, so installing on some Android/iOS devices is unreliable. *(Found by code reading.)* | 5 |
| KI-19 | Low | Safety copies (original PesaFlow data, preserved copy, quarantine, pre-restore copy) share the browser's ~5 MB storage with live data, and there is no way yet to delete old copies once the user is satisfied. Typical use (a few thousand transactions) is well within the limit. *(Found in Phase 1.)* | 5 |
| KI-20 | Low | If an old PesaFlow copy (e.g. another tab still open) keeps saving to the PesaFlow key after migration, PesaOtas ignores those later changes — by design, so data is never imported twice. The original key is preserved and downloadable from Data safety. *(Found in Phase 1, by design.)* | — |
| KI-22 | Low | Backups are now saved in PesaOtas format (schema v2). The old PesaFlow app cannot restore them; PesaOtas restores both formats. *(Consequence of Phase 1.)* | — |
| KI-23 | Low | Savings recorded as an *expense* before Phase 2 (the only option then) stay as expenses and still count as spending. PesaOtas does not reinterpret past records. *Since v1.4.0 the user can edit such an entry and change it to Save* (tested). *(Phase 2, by design.)* | — |
| KI-26 | Low | Custom savings destinations and archiving are supported by the data and calculations, but there is no screen to add them yet. *(By instruction: "in future".)* | — |
| KI-27 | Low | Accessibility was verified by an in-house automated audit (text size, WCAG AA contrast, accessible names, 44px touch targets, focus, overflow) in Chrome, but not with a third-party checker (axe-core could not be installed in the build environment) or with real screen readers (TalkBack, VoiceOver, NVDA). *(Found in Phase 4.)* | 5 |
| KI-28 | Low | Moving a deleted category's transactions to another category also changes how they appear in the category breakdown of earlier pay cycles. Totals (income, spending, savings, cash) are unaffected. *(Phase 4, by design: the user chooses the destination.)* | — |
| KI-29 | Low | There is no edit history: an edited transaction keeps its ID and original order, but its previous values are not kept (only in a backup). *(Phase 4, by design.)* | — |

## Fixed

| ID | Severity | Issue | Fixed in | How it is tested |
|---|---|---|---|---|
| KI-01 | Critical | Restoring a backup whose `openingBalance` was text (e.g. `"25000"`) string-concatenated: cash showed **250,000** instead of 25,000. | 1.1.0 (Phase 1) | `data-model.test.js` "KI-01"; browser check of the restore preview and dashboard |
| KI-02 | Critical | Text transaction amounts in a backup were concatenated into totals. | 1.1.0 (Phase 1) | `data-model.test.js` "KI-02"; `storage.test.js` text numbers during migration |
| KI-03 | Critical | Restore accepted negative, zero and duplicate transactions; a −5,000 expense raised cash. Entry form rounded decimals silently. | 1.1.0 (Phase 1) | `data-model.test.js` "KI-03" (7 tests); browser checks of entry and restore |
| KI-04 | High | A transaction with a missing date stopped the page rendering. Invalid dates are now refused everywhere, and sorting tolerates bad records. | 1.1.0 (Phase 1) | `data-model.test.js` "KI-04" |
| KI-05 | Critical | Unreadable saved data was silently replaced by the demo budget and overwritten on the next save. It is now quarantined, left in place, and the user chooses a recovery option. | 1.1.0 (Phase 1) | `storage.test.js` "corrupted storage" (7 tests); browser checks |
| KI-06 | High | Flexible budget and the daily guide ignored overspending and over-allocation (KSh 132/day shown while KSh 12,500 short). Replaced by safe-to-spend (D-03) with an on-screen explanation. | 1.2.0 (Phase 2) | `savings-and-safe-to-spend.test.js` (10 safe-to-spend tests incl. 500 random budgets; KI-06 reproduction now 0) |
| KI-07 | Medium | Category type was free, case-sensitive text; "flexible" was excluded from the flexible total. Now a fixed list, read case-insensitively. | 1.2.0 (Phase 2) | `data-model.test.js` "category types"; `savings-and-safe-to-spend.test.js` "category types"; browser check |
| KI-08 | High | Savings could only be recorded as spending; no destinations or balances. Now Save / Withdraw entries with KCB M-PESA and M-Shwari balances, never counted as income or spending. | 1.2.0 (Phase 2) | `savings-and-safe-to-spend.test.js` (13 savings tests); `data-model.test.js` Phase 2; browser checks |
| KI-10 | Medium | Income was tagged with spending categories. Now recorded against income sources. | 1.2.0 (Phase 2) | `data-model.test.js` "income sources"; browser check |
| KI-11 | Medium | Uncategorised spending was missing from insights. Now shown as "Other / uncategorised". | 1.2.0 (Phase 2) | `savings-and-safe-to-spend.test.js` "uncategorised"; browser check |
| KI-18 | Low | Amounts showed "Ksh". Now "KSh", formatted the same on every device. | 1.2.0 (Phase 2) | `savings-and-safe-to-spend.test.js` "KSh display" |
| KI-09 | High | No pay cycles: everything ever recorded counted against the budget; nothing reset at payday; progress assumed 30 days. Now budgets are scoped to the current pay cycle with real lengths, and a new cycle starts only when the user confirms it. | 1.3.0 (Phase 3) | `pay-cycles.test.js` (scoping, real lengths, 14 rollover tests); browser checks |
| KI-16 | Low | Days to payday were off by one across daylight-saving changes. Days are now counted between calendar dates. | 1.3.0 (Phase 3) | `pay-cycles.test.js` "KI-16" (run in a real US time zone) |
| KI-24 | Low | Savings balances ignored date order, so a withdrawal could be dated before the transfer that funded it. Withdrawals are now limited by what the destination held on that date, protecting later withdrawals. | 1.3.0 (Phase 3) | `pay-cycles.test.js` "date-ordered savings"; browser checks |
| KI-25 | Low | After payday the daily guide showed the whole safe-to-spend amount. It now asks the user to start the new pay cycle. | 1.3.0 (Phase 3) | browser checks; `pay-cycles.test.js` "rollover is due on payday" |
| KI-12 | Medium | Unsaved Budget edits were lost when the screen re-rendered. Drafts now survive any re-render, are flagged "Not saved yet", and can be saved or discarded; leaving the page warns. | 1.4.0 (Phase 4) | browser checks (KI-12) |
| KI-13 | Medium | Demonstration data and a personal note were hard-coded; Reset restored the demo. New users now start empty with a setup checklist; "Erase and start empty" replaces Reset. | 1.4.0 (Phase 4) | `entries-and-categories.test.js` "blank onboarding"; browser checks |
| KI-14 | Medium | Transactions couldn't be edited; categories could only be added via `prompt()`. Now: edit any entry with full validation; a category manager adds, renames, retypes, links and deletes (with protection for used categories). | 1.4.0 (Phase 4) | `entries-and-categories.test.js` (30 tests); browser checks |
| KI-15 | Medium | Mobile readability and accessibility. Now ≥ 12px text, WCAG AA contrast, 44px touch targets, labelled controls, `aria-current`, hidden decorative icons, visible focus, skip link, toast above the navigation, warnings at the top. Also fixed three pre-existing layout bugs found by the audit (navigation labels squeezed to 19px; entry form spilling past its card on desktop; two fonts that were never loaded). | 1.4.0 (Phase 4) | browser audit on every screen and dialog at 320/375 px and desktop |
| KI-21 | Low | A category with the ID `other` could clash with uncategorised spending. `other` and the income-source IDs are now reserved: new IDs can never use them, and data using one is refused rather than guessed. | 1.4.0 (Phase 4) | `entries-and-categories.test.js` "reserved category IDs"; browser checks |
