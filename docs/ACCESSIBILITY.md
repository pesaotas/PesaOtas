# Accessibility

PesaOtas aims to be usable with a keyboard, a screen reader, large text and on
small phone screens. This page records what has been tested, how, and what
hasn't been tested yet (KNOWN_ISSUES KI-27).

## Targets (DECISIONS D-13)

- Text at least 12px; WCAG AA contrast (4.5:1 for normal text, 3:1 for large).
- Touch targets at least 44px tall.
- Every control has a name a screen reader can announce; decorative icons are
  hidden from screen readers; the current screen is marked (`aria-current`).
- Visible keyboard focus everywhere; a "Skip to main content" link; focus moves
  to the screen heading when changing screens and into each dialog when it
  opens, and returns to the button that opened it when it closes.
- No sideways scrolling at 375px wide; reduced-motion settings respected.

## What is tested automatically (v1.5.0)

Run in Google Chrome for Testing 153 (headless), at desktop (1280×900) and phone
(375×812) sizes, on all five screens — Overview, Transactions, Budget, Insights,
Settings — with realistic data, and in the dialogs:

| Check | How | Result |
|---|---|---|
| Every visible control can be reached with Tab, and shows a focus ring when reached | Script presses Tab through each screen and compares the controls reached with every visible, enabled control | Pass on all screens, both sizes. *Fixed in 1.5.0:* the calendar button inside date fields (which Chrome now reaches with Tab) had no visible focus ring. |
| Every control has an accessible name | Chrome's own accessibility tree (DevTools protocol `Accessibility.getFullAXTree`): no button, link, text box, checkbox, list box or number field without a name | Pass on all screens and dialogs |
| Text size, contrast, names, 44px targets, no sideways scrolling | In-page audit that computes WCAG contrast from the rendered colours | Pass on all screens and dialogs, the update bar and the Storage protection card |
| Dialogs (delete safety copy, category, new pay cycle) | Focus starts inside; Tab stays inside; Escape closes and returns focus to the opening button | Pass |
| Recovery dialog | Escape does **not** close it (a choice is required) | Pass (Phase 1–4 suites) |
| Update bar | Announced politely (`aria-live`); explains why "Update now" is unavailable while there are unsaved changes | Pass |

These checks are part of the browser test suites that are run for each phase
(see the CHANGELOG for counts).

### Insights charts (v1.6 Phase 3, DECISIONS D-19)

| Check | How | Result |
|---|---|---|
| Each chart is one Tab stop; arrow keys, Home and End choose a bar or category; focus ring visible | Browser suite presses the keys and reads the selected bar and the details panel | Pass |
| Previous/Next buttons, category buttons and "Show as table" are at least 44px and work by click and by touch | Browser suite with touch emulation on a 375px phone | Pass |
| Selections are announced politely (`aria-live`) | Announcer text checked after each selection | Pass |
| Charts are named groups with a description (summary and keyboard help); the SVG drawing is hidden from screen readers; every chart has a captioned table with the same figures | Chrome's accessibility tree; table rows compared with the tested figures | Pass |
| Step buttons have specific names ("Previous day", "Next category") | Accessibility tree | Pass |
| No sideways scrolling, text at least 12px including inside the charts, contrast, names, 44px targets | In-page audit at 320, 375, 390, 768, 1280 and 1600px, all three periods; SVG drawn at its real width (no scaling) | Pass |
| Meaning never by colour alone | Hatching (no records), zero markers (no spending), dashed outlines (partly covered), fixed positions (income left, expenses right), legend and table text | By design; drawn states checked |

### Expense Detective (v1.6 Phase 4, DECISIONS D-20)

| Check | How | Result |
|---|---|---|
| Filter buttons show their counts and pressed state; action buttons name their alert ("Mark as reviewed: Unusual bill: Electricity") | Chrome's accessibility tree | Pass |
| Tab reaches every action button, which shows a focus ring; Enter works | Browser suite presses Tab and Enter | Pass |
| After an action, it is announced politely and focus moves to the next card | Announcer text and the focused element checked | Pass |
| Every card is labelled by its title and has a text type label (never colour alone); "Why was this flagged?" and entry lists are named disclosures | Accessibility tree and DOM checks | Pass |
| No sideways scrolling, text at least 12px, contrast, names, 44px targets | In-page audit at 320, 375, 390, 768, 1280 and 1600px, with every disclosure open | Pass |
| The unreadable-review-records dialog is a named dialog with its choices as buttons | Accessibility tree | Pass |

### Whole app after the interface refinement (v1.6 Phase 5, DECISIONS D-21)

| Check | How | Result |
|---|---|---|
| Every screen (Overview, Transactions, Budget, Insights, Settings), with a full budget and an empty one: text at least 12px, AA contrast, every control named, 44px targets, no sideways scrolling | In-page audit at 320, 375, 390, 768, 1280 and 1600px with every disclosure open | Pass (found and fixed a 17px sideways scroll on the empty Overview at 320px) |
| Element IDs are unique on every screen | DOM check | Pass (the chart legend's hatch pattern ID was repeated; fixed) |
| Navigating moves focus to the screen heading; Tab then lands on a control with a visible focus ring | Browser check on every screen and width | Pass |
| No section heading repeats the page title | DOM check | Pass |
| The logo is decorative (empty alt text) next to the written name; exactly one is shown (sidebar on desktop, header on phones) | DOM check | Pass |
| "Show 50 more" in the transaction history names how many are left and moves focus to the first newly shown entry | Browser check | Pass |
| Placeholders are words ("Not set", "Not available"), not a long dash a screen reader would read as "em dash" | Text review | Done |

## What has not been tested

- **Real screen readers.** No testing with TalkBack (Android), VoiceOver (iPhone,
  Mac) or NVDA/JAWS (Windows) was possible in the build environment. The
  accessibility tree checks above show what a screen reader is *given*, not how
  it *sounds* in practice.
- **A third-party checker.** axe-core could not be installed (the package
  registry is blocked in the build environment), and Chrome 153 no longer
  includes the DevTools contrast audit that was planned as a second opinion.
  Contrast is checked by PesaOtas's own audit, which uses the WCAG formula.
- **Zoom and large text** at 200% browser zoom and with phone font scaling.
- **Voice control** (Voice Access, Voice Control) and switch access.

## Manual checklist

Worth doing on a real phone and a computer before relying on PesaOtas with
assistive technology. Each item should take a minute or two.

### Screen reader (TalkBack on Android, VoiceOver on iPhone)
- [ ] Open PesaOtas. The screen title ("Your money at a glance") is read.
- [ ] Swipe through the Overview: cash available, safe to spend and the daily
      guide are read with "KSh" amounts; icons aren't read as symbols.
- [ ] Bottom navigation: each button is read with its name and the current one
      as "current page" / "selected".
- [ ] Add an expense: every field is announced with its label; after saving,
      the confirmation ("Transaction saved" or similar) is read.
- [ ] Edit and delete an entry: the edit button says which entry it edits.
- [ ] Budget: an allocation field is announced with its category; unsaved
      changes are announced.
- [ ] Settings → Data safety → **Delete…**: the dialog's title and
      consequences are read; the tick box and **Delete permanently** (dimmed
      until ticked) are announced.
- [ ] Update bar (when a new version is published): its message is read.

### Keyboard (computer)
- [ ] Press Tab once: "Skip to main content" appears; Enter jumps to the
      content.
- [ ] Every button, field and link can be reached with Tab and shows a clear
      green ring.
- [ ] Dialogs: Tab stays inside; Escape closes (except the recovery dialog);
      focus returns to where you were.
- [ ] Insights charts: Tab reaches each chart; the arrow keys, Home and End
      change the selected bar or category, and the details below update.
- [ ] Expense Detective: Tab reaches the filter and every Mark as reviewed /
      Dismiss button; after pressing one, the next alert gets focus.

### Zoom and text size
- [ ] Browser zoom 200%: nothing overlaps or is cut off; no sideways scrolling.
- [ ] Phone text size at its largest: amounts and buttons stay readable.

Please record findings in `docs/KNOWN_ISSUES.md`.
