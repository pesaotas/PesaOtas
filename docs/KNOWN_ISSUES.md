# Known issues

Defects found during the Phase 0 assessment of PesaFlow v1.0. Each one was
reproduced by running the code (not inferred from reading it) unless marked
otherwise. Tests for the **corrected** behaviour are added in the phase that
fixes each issue; until then they appear as `todo` entries in
`tests/finance.test.js`.

Severity: **Critical** = can corrupt or lose financial data · **High** = shows
misleading money figures · **Medium** = wrong or awkward but not misleading ·
**Low** = edge case.

| ID | Severity | Issue | Fix phase |
|---|---|---|---|
| KI-01 | Critical | Restoring a backup whose `openingBalance` is text (e.g. `"25000"`) passes validation, then string-concatenates: cash shows **250,000** instead of 25,000. | 1 |
| KI-02 | Critical | Text transaction amounts in a backup are concatenated into totals (spent becomes `"0500"`, then `"0500300"`…). | 1 |
| KI-03 | Critical | Restore accepts negative, zero and duplicate transactions. A −5,000 expense *raises* cash by 5,000; a duplicated entry is counted twice. | 1 |
| KI-04 | High | A transaction with a missing date throws in the sort (`localeCompare` of undefined) and stops the page rendering. | 1 |
| KI-05 | Critical | If saved data is unreadable or has an unexpected shape, the app silently loads the demo budget and overwrites the user's data on the next save. | 1 |
| KI-06 | High | "Flexible budget left" and the daily guide ignore overspending and over-allocation. Reproduced in the UI: with the plan **KSh 12,500 short**, the daily guide still shows **KSh 132/day**. | 2 |
| KI-07 | Medium | Category type is free text and case-sensitive: a category typed as "flexible" is silently excluded from the flexible total. | 2 |
| KI-08 | High | Money moved into savings can only be recorded as an expense, so insights report saving as spending. No savings destinations or balances exist. | 2 |
| KI-09 | High | No pay-cycle model: all transactions ever recorded count against the current budget; nothing resets at payday; once payday passes the countdown stays at 0; the payday progress bar assumes a 30-day cycle. | 3 |
| KI-10 | Medium | Income is tagged with expense categories (a salary appears under "Food"). | 2 |
| KI-11 | Medium | "Other / uncategorised" spending reduces unallocated money but never appears in insights. | 2 |
| KI-12 | Medium | Unsaved edits on the Budget screen are discarded whenever anything re-renders (e.g. saving a transaction). *(Found by code reading.)* | 4 |
| KI-13 | Medium | Demonstration data is hard-coded: starter categories in `app.js`, figures and a personal note in `index.html`, and "Reset" restores the demo instead of a blank start. | 4 |
| KI-14 | Medium | Transactions cannot be edited; categories can only be added (via browser `prompt()`), not renamed or deleted. | 4 |
| KI-15 | Medium | Accessibility/readability on mobile: 9–10px nav and button text; glyph icons are read aloud by screen readers; no `aria-current` on navigation; the toast covers the "Settings & backup" nav item; the over-allocation warning appears at the very bottom of the overview. | 4 |
| KI-16 | Low | `daysToPayday` is off by one across a daylight-saving change (e.g. US time zones in November). Kenya has no DST, so Kenyan users are unaffected. | 3 |
| KI-17 | Medium | Service worker is cache-first with a manually versioned cache: deployed fixes may not reach installed users unless the cache name is bumped. Only an SVG icon is provided, so installing on some Android/iOS devices is unreliable. *(Found by code reading.)* | 5 |
| KI-18 | Low | Amounts display as "Ksh" (the browser's `en-KE` currency format) rather than the required "KSh". | 2 |
