# Roadmap

Each phase is small, tested and approved before the next begins (see
[DECISIONS.md](DECISIONS.md) D-08). Issue IDs refer to
[KNOWN_ISSUES.md](KNOWN_ISSUES.md).

| Phase | Goal | Fixes | Status |
|---|---|---|---|
| 0 | Safety net: version control, zero-dependency test runner, calculations extracted into `src/finance.js` with no behaviour change, documentation | — | **Done (v1.0.1)** |
| 1 | Data integrity: validation module; schema v2 (incl. savings destinations) with migration from PesaFlow; hardened restore (validate → preview → de-duplicate → confirm); quarantine unreadable data | KI-01–05 | **Done (v1.1.0)** |
| 2 | Calculation correctness: safe-to-spend (D-03) explained in the UI; savings transfers and withdrawals with KCB M-PESA and M-Shwari (D-04); separate income categories; fixed category types; visible uncategorised spending; KSh display | KI-06–08, 10, 11, 18 | **Done (v1.2.0)** |
| 3 | Pay cycles: budget scoped to the current cycle; real cycle length; confirmed rollover at payday; date-ordered savings balances | KI-09, 16, 24, 25 | **Done (v1.3.0)** |
| 4 | Rebrand to PesaOtas and UX: blank onboarding; edit transactions; category manager; keep unsaved budget edits; accessibility and mobile readability | KI-12–15, 21 | **Done (v1.4.0)** |
| 5 | PWA and deployment: safe update strategy, PNG icons, storage-persistence request and limitation notice, managing safety copies, GitHub Pages | KI-17, 19, 27 (partly) | **Done (v1.5.0)** — awaiting review |

## v1.6.0 (in progress on branch `v1.6-dev`)

| Phase | Goal | Status |
|---|---|---|
| 0 | Audit and upgrade plan | **Approved** |
| 1 | Currency foundation and storage-format safeguard (D-16, D-17) | **Approved** |
| 2 | Insights foundation: periods, aggregations, KPI cards, empty states (D-18) | **Done**, awaiting review |
| 3 | Charts: spending trend, income vs expenses, category donut, drill-down | Not started |
| 4 | Expense Detective: unusual bills, small and uncategorised spending, spending pace, alert review. **First** add and test `meta.alertReviews` in format v3 (D-16) | Not started |
| 5 | Logo (approved recolour) and app-wide UI/UX refinement | Not started |
| 6 | Final QA and v1.6.0 release candidate | Not started |

Future versions (not before the core is reliable): voice entry, M-Pesa
statement import with user approval, recurring bills, savings goals,
challenges, anomaly detection, monthly reports.
