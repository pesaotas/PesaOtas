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
| 5 | PWA and deployment: safe update strategy, PNG icons, storage-persistence request and limitation notice, managing safety copies, GitHub Pages | KI-17, 19, 27 (partly) | **Done (v1.5.0)** — released; live on GitHub Pages |

## v1.6.0 (release candidate on branch `v1.6-dev`; not released)

| Phase | Goal | Status |
|---|---|---|
| 0 | Audit and upgrade plan | **Approved** |
| 1 | Currency foundation and storage-format safeguard (D-16, D-17) | **Approved** |
| 2 | Insights foundation: periods, aggregations, KPI cards, empty states (D-18) | **Approved** (commit `e388317`) |
| 3 | Charts: spending trend, income vs expenses, category donut, read-only drill-through (D-19) | **Approved** (commit `e31151d`, tag `v1.6.0-phase3-dev`) |
| 4 | Expense Detective: unusual bills and large expenses, small purchases, uncategorised spending, spending pace, alert review. **First** add and test `meta.alertReviews` in format v3 (D-16) | **Approved** (commit `bd6b1c5`; D-20) |
| 5 | Logo (approved recolour, Option 2) and app-wide UI/UX refinement | **Approved** (commit `0b4bb5d`; D-21) |
| 6 | Final QA and v1.6.0 release candidate (D-22) | **Release candidate `v1.6.0-rc.1` ready, awaiting owner approval** (phone checks required before publishing) |

Future versions (not before the core is reliable): voice entry, M-Pesa
statement import with user approval, recurring bills, savings goals,
challenges, anomaly detection, monthly reports.

### Future enhancement (not part of v1.6.0): richer desktop analytics

Recorded at the owner's request during v1.6 Phase 3 planning; not a v1.6.0
commitment and not scheduled. Possible scope: cross-filtering between charts,
advanced drill-down, configurable dashboard layouts, additional analytical
filters, and more sophisticated desktop visualisations.
