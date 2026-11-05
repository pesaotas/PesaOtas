# Roadmap

Each phase is small, tested and approved before the next begins (see
[DECISIONS.md](DECISIONS.md) D-08). Issue IDs refer to
[KNOWN_ISSUES.md](KNOWN_ISSUES.md).

| Phase | Goal | Fixes | Status |
|---|---|---|---|
| 0 | Safety net: version control, zero-dependency test runner, calculations extracted into `src/finance.js` with no behaviour change, documentation | — | **Done (v1.0.1)** |
| 1 | Data integrity: validation module; schema v2 (incl. savings destinations) with migration from PesaFlow; hardened restore (validate → preview → de-duplicate → confirm); quarantine unreadable data | KI-01–05 | Awaiting approval |
| 2 | Calculation correctness: safe-to-spend (D-03) explained in the UI; savings transfers and withdrawals with KCB M-PESA and M-Shwari (D-04); separate income categories; fixed category types; visible uncategorised spending; KSh display | KI-06–08, 10, 11, 18 | Planned |
| 3 | Pay cycles: budget scoped to the current cycle; real cycle length; confirmed rollover at payday | KI-09, 16 | Planned |
| 4 | Rebrand to PesaOtas and UX: blank onboarding; edit transactions; category manager; keep unsaved budget edits; accessibility and mobile readability | KI-12–15 | Planned |
| 5 | PWA and deployment: safe update strategy, PNG icons, storage-persistence request and limitation notice, GitHub Pages | KI-17 | Planned |

Future versions (not before the core is reliable): voice entry, M-Pesa
statement import with user approval, recurring bills, savings goals,
challenges, anomaly detection, monthly reports.
