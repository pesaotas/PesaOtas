/**
 * PesaOtas Expense Detective (v1.6 Phase 4, decision D-20) — pure and
 * read-only: it never changes the data it is given, never touches the page or
 * storage, and needs "today" passed in. Rules are deterministic and use
 * whole-number arithmetic. Nothing here categorises, edits, deletes, reviews
 * or dismisses anything; `applyReview` / `clearReview` return NEW data and are
 * only called after the user presses a button.
 *
 * Windows (all inclusive; entries dated after today are never used):
 *   S  summary window   — this pay cycle to today (cycle start on or before
 *                          today), otherwise this calendar month to today
 *   C  candidate window — S start minus 30 days, to today (single-entry alerts)
 *   R1 unusual-bill history — same bill series, 12 months before the bill's date
 *                          to the day before it
 *   R2 large-expense history — same category, 180 days before to the day before
 *   P  pace window      — pay cycle start to today (needs a pay cycle)
 *
 * Fingerprints are 64-bit FNV-1a hashes of the evidence (each transaction's
 * ID, amount, date and category reference, plus the rule's settings). They are
 * used ONLY to notice that evidence changed. They are not a security or
 * privacy mechanism. Notes and descriptions are never part of a fingerprint or
 * of a review record.
 *
 * Browser: `window.PesaDetective`. Node: `require("./src/detective.js")`.
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./finance.js"), require("./currency.js"), require("./insights.js"));
  } else {
    root.PesaDetective = factory(root.PesaFinance, root.PesaCurrency, root.PesaInsights);
  }
})(typeof self !== "undefined" ? self : this, function (F, C, I) {
  "use strict";

  /** Every threshold, in one place (D-20). */
  const SETTINGS = Object.freeze({
    candidateLookbackDays: 30,
    bill: Object.freeze({ minEarlier: 3, minMonths: 3, historyMonths: 12, medianOf: 6, moreThanNum: 5, moreThanDen: 4 }), // more than 125%
    large: Object.freeze({ minEarlier: 5, historyDays: 180, multiple: 3 }),                                               // at least 3×
    small: Object.freeze({ minCount: 10, minSharePct: 10 }),
    pace: Object.freeze({ minGapPct: 25, minDays: 3, kinds: Object.freeze(["Essential", "Flexible", "Personal", "Event", "Other"]) }),
    reappear: Object.freeze({ smallGrowthNum: 5, smallGrowthDen: 4, paceGapPoints: 25 }),
    uncategorisedMaxEntries: 2000
  });
  const RULES = Object.freeze({ bill: "unusual-bill", large: "large-expense", small: "small-purchases", uncat: "uncategorised", pace: "spending-pace" });
  const KNOWN_STATUSES = Object.freeze(["reviewed", "dismissed"]);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dateText = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
  const monthText = (ym) => { const [y, m] = ym.split("-").map(Number); return `${MONTHS[m - 1]} ${y}`; };
  const byOrder = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  /** Lower case, digits removed, anything that isn't a letter becomes a space, spaces collapsed. */
  function normaliseNote(note) {
    return String(note || "").toLowerCase().replace(/[0-9]/g, "").replace(/[^\p{L}]+/gu, " ").trim().replace(/\s+/g, " ");
  }

  /** Twice the median of whole numbers (an exact whole number, so comparisons need no fractions). */
  function median2(values) {
    const s = [...values].sort((a, b) => a - b);
    const n = s.length;
    return n % 2 ? 2 * s[(n - 1) / 2] : s[n / 2 - 1] + s[n / 2];
  }

  // 64-bit FNV-1a over UTF-8 bytes — change detection only (not security).
  const FNV_OFFSET = 0xcbf29ce484222325n, FNV_PRIME = 0x100000001b3n, MASK64 = 0xffffffffffffffffn;
  const encoder = typeof TextEncoder === "function" ? new TextEncoder() : null;
  function fnv1a64(text) {
    const bytes = encoder ? encoder.encode(text) : Buffer.from(text, "utf8");
    let h = FNV_OFFSET;
    for (let i = 0; i < bytes.length; i++) { h ^= BigInt(bytes[i]); h = (h * FNV_PRIME) & MASK64; }
    return h.toString(16).padStart(16, "0");
  }
  /**
   * An entry or category ID as it appears inside an alert ID. IDs made only of
   * letters, digits and ": _ . -" are used unchanged (so existing review
   * records keep matching). Any other ID (spaces, "&", "/", accents… all
   * allowed for entries and categories) becomes "_h" + its 64-bit hash, which
   * always fits the review-record ID format. Alert IDs are never parsed back.
   */
  const ID_PLAIN = /^[A-Za-z0-9:_.-]{1,120}$/;
  const idPart = (id) => (ID_PLAIN.test(id) ? id : `_h${fnv1a64(String(id))}`);
  const US = "\u001f", RS = "\u001e";
  /** One transaction's evidence: ID, amount, date and category reference (never the note). */
  const evidence = (t) => [t.id, t.amount, t.date, t.categoryId || ""].join(US);
  const hashEntries = (entries) => entries.map(evidence).sort().join(RS);

  // ---------------------------------------------------------------------------
  // Windows and inputs
  // ---------------------------------------------------------------------------
  function windows(state, today) {
    const cs = state.cycleStart;
    const cycle = F.isISODate(cs) && cs <= today;
    const sStart = cycle ? cs : `${today.slice(0, 7)}-01`;
    return {
      today,
      summary: { start: sStart, end: today, kind: cycle ? "cycle" : "month" },
      candidates: { start: F.addDays(sStart, -SETTINGS.candidateLookbackDays), end: today }
    };
  }

  function context(state, today) {
    const categories = new Map(state.categories.map(c => [c.id, c]));
    const expenses = state.transactions.filter(t => t.type === "expense" && t.date <= today);
    return {
      today, categories, expenses,
      code: state.currency, money: (n) => C.format(n, state.currency),
      threshold: C.info(state.currency).smallPurchase,
      futureCount: state.transactions.filter(t => t.date > today).length
    };
  }

  // ---------------------------------------------------------------------------
  // U1 — unusual bill
  // ---------------------------------------------------------------------------
  function unusualBills(ctx, win, checks) {
    const st = SETTINGS.bill;
    const series = new Map(); // categoryId|note → entries
    const blank = new Map();  // categoryId → count of blank-note bills in C
    for (const t of ctx.expenses) {
      const c = ctx.categories.get(t.categoryId);
      if (!c || c.kind !== "Bills") continue;
      const key = normaliseNote(t.note);
      if (!key) { if (t.date >= win.candidates.start) blank.set(c.id, (blank.get(c.id) || 0) + 1); continue; }
      const k = `${c.id}${US}${key}`;
      if (!series.has(k)) series.set(k, { category: c, key, entries: [] });
      series.get(k).entries.push(t);
    }
    for (const [catId, n] of blank) {
      checks.push({ rule: RULES.bill, kind: "insufficient", text: `${ctx.categories.get(catId).name}: ${plural(n, "bill has", "bills have")} no description, so ${n === 1 ? "it" : "they"} can't be compared with earlier bills.` });
    }
    const alerts = [];
    for (const s of series.values()) {
      s.entries.sort(byOrder);
      const candidates = s.entries.filter(t => t.date >= win.candidates.start);
      let compared = 0, short = null;
      for (const t of candidates) {
        const from = F.addMonths(t.date, -st.historyMonths);
        const history = s.entries.filter(h => h.date >= from && h.date < t.date);
        const months = new Set(history.map(h => h.date.slice(0, 7)));
        if (history.length < st.minEarlier || months.size < st.minMonths) { short = { history: history.length, months: months.size }; continue; }
        compared++;
        const used = [...history].sort(byOrder).slice(-st.medianOf);
        const m2 = median2(used.map(h => h.amount));
        const flagged = 2 * st.moreThanDen * t.amount > st.moreThanNum * m2 && 2 * t.amount - m2 >= 2 * ctx.threshold;
        if (!flagged) continue;
        const typical = Math.round(m2 / 2);
        const pct = Math.round((2 * t.amount * 100) / m2) - 100;
        alerts.push({
          id: `${RULES.bill}:${idPart(t.id)}`, rule: RULES.bill, kind: "alert",
          label: "Unusual bill", subject: s.category.name, date: t.date, amount: t.amount,
          title: `Unusual bill: ${s.category.name}`,
          figure: ctx.money(t.amount),
          text: `${ctx.money(t.amount)} on ${dateText(t.date)}, ${pct}% more than usual. Usual: ${ctx.money(typical)}, the median of your last ${plural(used.length, "bill", "bills")} described like this (${[...new Set(used.map(h => monthText(h.date.slice(0, 7))))].join(", ")}).`,
          why: [
            `Bills are compared with earlier bills in the same category with a matching description (ignoring numbers, punctuation and capital letters).`,
            `This bill is flagged because it is more than 125% of the usual amount and at least ${ctx.money(ctx.threshold)} more.`,
            `Usual amount: the median of the latest ${plural(used.length, "bill", "bills")} in the 12 months before ${dateText(t.date)} (${history.length} earlier ${history.length === 1 ? "bill" : "bills"} in ${plural(months.size, "month", "months")}).`
          ],
          entryIds: [t.id], historyIds: used.map(h => h.id).reverse(),
          fingerprint: fnv1a64([RULES.bill, evidence(t), hashEntries(history), m2, JSON.stringify(st), ctx.threshold].join(RS)),
          basis: null, reviewable: true
        });
      }
      if (candidates.length) {
        checks.push(compared
          ? { rule: RULES.bill, kind: "ok", text: `${s.category.name} ("${s.key}"): ${plural(compared, "bill", "bills")} compared with earlier ones.` }
          : { rule: RULES.bill, kind: "insufficient", text: `${s.category.name} ("${s.key}"): ${plural(short.history, "earlier bill", "earlier bills")} in ${plural(short.months, "month", "months")}; needs ${st.minEarlier} in ${st.minMonths} different months to compare.` });
      }
    }
    return alerts;
  }

  // ---------------------------------------------------------------------------
  // U2 — unusually large expense (non-Bills categories)
  // ---------------------------------------------------------------------------
  function largeExpenses(ctx, win, checks) {
    const st = SETTINGS.large;
    const byCat = new Map();
    for (const t of ctx.expenses) {
      const c = ctx.categories.get(t.categoryId);
      if (!c || c.kind === "Bills") continue;
      if (!byCat.has(c.id)) byCat.set(c.id, { category: c, entries: [] });
      byCat.get(c.id).entries.push(t);
    }
    const alerts = [];
    for (const g of byCat.values()) {
      g.entries.sort(byOrder);
      const candidates = g.entries.filter(t => t.date >= win.candidates.start);
      if (!candidates.length) continue;
      let compared = 0, most = 0;
      for (const t of candidates) {
        const from = F.addDays(t.date, -st.historyDays);
        const history = g.entries.filter(h => h.date >= from && h.date < t.date);
        if (history.length < st.minEarlier) { most = Math.max(most, history.length); continue; }
        compared++;
        const m2 = median2(history.map(h => h.amount));
        const flagged = 2 * t.amount >= st.multiple * m2 && 2 * t.amount - m2 >= 2 * ctx.threshold;
        if (!flagged) continue;
        const typical = Math.round(m2 / 2);
        const times = Math.floor((2 * t.amount * 10) / m2) / 10;
        alerts.push({
          id: `${RULES.large}:${idPart(t.id)}`, rule: RULES.large, kind: "alert",
          label: "Unusually large expense", subject: g.category.name, date: t.date, amount: t.amount,
          title: `Unusually large expense: ${g.category.name}`,
          figure: ctx.money(t.amount),
          text: `${ctx.money(t.amount)} on ${dateText(t.date)}, about ${times} times your usual ${g.category.name} expense (${ctx.money(typical)}, the median of ${plural(history.length, "expense", "expenses")} in the 180 days before).`,
          why: [
            `An expense is flagged when it is at least ${st.multiple} times the median of the same category's expenses in the 180 days before it, and at least ${ctx.money(ctx.threshold)} more.`,
            `It needs at least ${st.minEarlier} earlier expenses in that time to compare; here there were ${history.length}.`
          ],
          entryIds: [t.id], historyIds: [...history].sort(byOrder).reverse().map(h => h.id),
          fingerprint: fnv1a64([RULES.large, evidence(t), hashEntries(history), m2, JSON.stringify(st), ctx.threshold].join(RS)),
          basis: null, reviewable: true
        });
      }
      checks.push(compared
        ? { rule: RULES.large, kind: "ok", text: `${g.category.name}: ${plural(compared, "expense", "expenses")} compared with the 180 days before.` }
        : { rule: RULES.large, kind: "insufficient", text: `${g.category.name}: ${plural(most, "earlier expense", "earlier expenses")} in the 180 days before; needs ${st.minEarlier} to compare.` });
    }
    return alerts;
  }

  // ---------------------------------------------------------------------------
  // Small purchases (window S) — an alert only with enough evidence
  // ---------------------------------------------------------------------------
  function smallPurchases(state, ctx, win, checks) {
    const S = win.summary;
    const leaks = I.leakSummary(state, S.start, S.end);
    const total = I.totalsBetween(state, S.start, S.end).expenses;
    const entries = ctx.expenses.filter(t => t.date >= S.start && t.amount <= leaks.threshold).sort(byOrder);
    const byCat = new Map();
    for (const t of entries) {
      const c = ctx.categories.get(t.categoryId);
      const key = c ? c.id : I.UNCATEGORISED;
      const row = byCat.get(key) || { key, name: c ? c.name : I.UNCATEGORISED_NAME, count: 0, total: 0 };
      row.count++; row.total += t.amount;
      byCat.set(key, row);
    }
    const top = [...byCat.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)).slice(0, 3);
    // Comparison with the previous window of equal length, only when records cover all of it (D-18).
    const days = F.daysBetween(S.start, S.end) + 1;
    const prevStart = F.addDays(S.start, -days), prevEnd = F.addDays(S.start, -1);
    const first = I.recordsStart(state, ctx.today);
    const previous = first && first <= prevStart ? I.leakSummary(state, prevStart, prevEnd) : null;
    const st = SETTINGS.small;
    const isAlert = leaks.smallCount >= st.minCount && total > 0 && 100 * leaks.smallTotal >= st.minSharePct * total;
    const sharePct = total > 0 ? Math.round((leaks.smallTotal * 100) / total) : 0;
    const frame = fnv1a64([RULES.small, S.start, ctx.code, leaks.threshold, JSON.stringify(st)].join(RS));
    const where = S.kind === "cycle" ? "this pay cycle" : "this month";
    const result = {
      id: `${RULES.small}:${S.start}`, rule: RULES.small, kind: isAlert ? "alert" : "observation",
      label: isAlert ? "Small purchases add up" : "Observation: small purchases",
      title: "Small purchases add up", subject: "Small purchases",
      figure: ctx.money(leaks.smallTotal),
      count: leaks.smallCount, total: leaks.smallTotal, share: total > 0 ? leaks.smallTotal / total : 0, spending: total,
      average: leaks.smallCount ? Math.round(leaks.smallTotal / leaks.smallCount) : 0,
      top, previous: previous ? { count: previous.smallCount, total: previous.smallTotal, start: prevStart, end: prevEnd } : null,
      threshold: leaks.threshold,
      text: leaks.smallCount
        ? `${plural(leaks.smallCount, "purchase", "purchases")} of ${ctx.money(leaks.threshold)} or less came to ${ctx.money(leaks.smallTotal)}, ${sharePct}% of your spending ${where}.`
        : `No purchases of ${ctx.money(leaks.threshold)} or less ${where}.`,
      why: [
        `Small purchases are expenses of ${ctx.money(leaks.threshold)} or less (the small-purchase amount for ${C.label(ctx.code)}). They aren't wrong in themselves; this shows how they add up.`,
        `This needs a review only when there are at least ${st.minCount} of them and they make up at least ${st.minSharePct}% of your spending ${where}; otherwise it's shown as an observation.`
      ],
      entryIds: [...entries].reverse().map(t => t.id),
      fingerprint: fnv1a64([frame, hashEntries(entries)].join(RS)),
      basis: { count: leaks.smallCount, total: leaks.smallTotal, frame },
      reviewable: isAlert
    };
    const why = isAlert ? "" : leaks.smallCount < st.minCount
      ? ` (fewer than ${st.minCount}, so an observation rather than an alert)`
      : ` (${sharePct < st.minSharePct ? `under ${st.minSharePct}%` : `${sharePct}%`} of spending, so an observation rather than an alert)`;
    checks.push({ rule: RULES.small, kind: "ok", text: `Small purchases ${where}: ${plural(leaks.smallCount, "purchase", "purchases")}, ${ctx.money(leaks.smallTotal)}${why}.` });
    return result;
  }

  // ---------------------------------------------------------------------------
  // Uncategorised spending (window S)
  // ---------------------------------------------------------------------------
  function uncategorised(ctx, win, checks) {
    const S = win.summary;
    const entries = ctx.expenses.filter(t => t.date >= S.start && !ctx.categories.has(t.categoryId)).sort(byOrder);
    const where = S.kind === "cycle" ? "this pay cycle" : "this month";
    checks.push({ rule: RULES.uncat, kind: "ok", text: entries.length ? `Uncategorised ${where}: ${plural(entries.length, "expense", "expenses")}.` : `Nothing uncategorised ${where}.` });
    if (!entries.length) return null;
    const total = entries.reduce((a, t) => a + t.amount, 0);
    const entryHashes = [...new Set(entries.map(t => fnv1a64(evidence(t))))].sort();
    const tooMany = entryHashes.length > SETTINGS.uncategorisedMaxEntries;
    return {
      id: `${RULES.uncat}:${S.start}`, rule: RULES.uncat, kind: "alert",
      label: "Uncategorised spending", subject: "Uncategorised", title: "Expenses without a category",
      figure: ctx.money(total), count: entries.length, total,
      text: entries.length === 1
        ? `1 expense (${ctx.money(total)}) has no category, so it isn't part of any allocation. It still reduces your spending cash. Choosing a category makes your budget more accurate.`
        : `${entries.length} expenses (${ctx.money(total)}) have no category, so they aren't part of any allocation. They still reduce your spending cash. Choosing a category makes your budget more accurate.`,
      why: [
        `An expense is uncategorised when it is recorded as "Other / uncategorised" or its category has been deleted.`,
        `Use Edit to choose a category. PesaOtas never changes a category for you.`
      ],
      entryIds: [...entries].reverse().map(t => t.id),
      fingerprint: fnv1a64([RULES.uncat, S.start, hashEntries(entries)].join(RS)),
      basis: { entryHashes },
      reviewable: !tooMany,
      notReviewableReason: tooMany ? "Too many uncategorised entries to record a review; categorise some first." : null
    };
  }

  // ---------------------------------------------------------------------------
  // Spending pace (pay cycle only)
  // ---------------------------------------------------------------------------
  function spendingPace(state, ctx, checks) {
    const st = SETTINGS.pace;
    const today = ctx.today;
    const start = F.isISODate(state.cycleStart) && state.cycleStart <= today ? state.cycleStart : null;
    const payday = F.isISODate(state.payday) ? state.payday : null;
    const base = { available: false, reason: null, rows: [], alerts: [], overall: null, futureNote: null };
    if (!start || !payday) { checks.push({ rule: RULES.pace, kind: "unavailable", text: "Spending pace: set your pay cycle in Settings to see it." }); return { ...base, reason: "no-cycle" }; }
    if (payday <= today) { checks.push({ rule: RULES.pace, kind: "unavailable", text: "Spending pace: payday has arrived; start your new pay cycle to see it." }); return { ...base, reason: "payday-passed" }; }
    const L = F.daysBetween(start, payday);
    const e = F.daysBetween(start, today) + 1;
    if (L <= 0) { checks.push({ rule: RULES.pace, kind: "unavailable", text: "Spending pace: the pay cycle dates need checking in Settings." }); return { ...base, reason: "no-cycle" }; }
    const summary = F.cycleSummary(state, start, F.addDays(today, 1)); // up to today: entries dated later are left out
    const rows = [], alerts = [];
    let totalSpent = 0, totalBudget = 0, futureEntries = 0;
    for (const c of state.categories) {
      if (!st.kinds.includes(c.kind) || !(c.budget > 0)) continue;
      const row = summary.categories.find(x => x.id === c.id);
      const spent = row ? row.spent : 0;
      totalSpent += spent; totalBudget += c.budget;
      futureEntries += state.transactions.filter(t => t.type === "expense" && t.categoryId === c.id && t.date >= start && t.date > today).length;
      const gapNum = spent * L - c.budget * e;
      const gapPoints = Math.floor((100 * gapNum) / (c.budget * L));
      let status;
      if (spent === 0) status = "nothing-spent";
      else if (spent >= c.budget) status = "over";
      else if (e >= st.minDays && spent >= ctx.threshold && 100 * gapNum >= st.minGapPct * c.budget * L) status = "ahead";
      else status = "on-pace";
      const usedPct = Math.round((spent * 100) / c.budget), timePct = Math.round((e * 100) / L);
      rows.push({ categoryId: c.id, name: c.name, kind: c.kind, budget: c.budget, spent, usedPct, timePct, gapPoints, status });
      if (status === "ahead") {
        const entries = ctx.expenses.filter(t => t.categoryId === c.id && t.date >= start).sort(byOrder);
        const frame = fnv1a64([RULES.pace, start, payday, c.id, c.budget, JSON.stringify(st), ctx.threshold].join(RS));
        alerts.push({
          id: `${RULES.pace}:${start}:${idPart(c.id)}`, rule: RULES.pace, kind: "alert",
          label: "Ahead of pace", subject: c.name, title: `Ahead of pace: ${c.name}`,
          figure: `${usedPct}%`,
          text: `${c.name}: ${usedPct}% of its allocation used (${ctx.money(spent)} of ${ctx.money(c.budget)}) with ${timePct}% of the pay cycle gone (${e} of ${L} days).`,
          why: [
            `A category is ahead of pace when the share of its allocation used is at least ${st.minGapPct} percentage points more than the share of the pay cycle gone, after at least ${st.minDays} days and at least ${ctx.money(ctx.threshold)} spent.`,
            `Only entries dated up to today are counted. This is a comparison, not a forecast.`
          ],
          entryIds: [...entries].reverse().map(t => t.id),
          fingerprint: fnv1a64([frame, hashEntries(entries.map(t => ({ id: t.id, amount: t.amount, date: t.date, categoryId: "" })))].join(RS)),
          basis: { gapPoints, frame }, reviewable: true
        });
      }
    }
    checks.push({ rule: RULES.pace, kind: "ok", text: `Spending pace: ${plural(rows.length, "category", "categories")} checked (${e} of ${L} days of the pay cycle gone).` });
    return {
      available: true, reason: null, start, payday, lengthDays: L, elapsedDays: e, rows, alerts,
      overall: totalBudget > 0 ? { spent: totalSpent, budget: totalBudget, usedPct: Math.round((totalSpent * 100) / totalBudget), timePct: Math.round((e * 100) / L) } : null,
      futureNote: futureEntries ? `Leaves out ${plural(futureEntries, "entry", "entries")} dated after today; the Budget screen includes ${futureEntries === 1 ? "it" : "them"}.` : null,
      tooEarly: e < st.minDays
    };
  }

  // ---------------------------------------------------------------------------
  // Review state (decision 8): material changes only, never time alone
  // ---------------------------------------------------------------------------
  const recordsOf = (state) => (state.meta && Array.isArray(state.meta.alertReviews) ? state.meta.alertReviews : []);

  /** Has the evidence changed materially since this record was made? */
  function materiallyChanged(alert, rec) {
    if (rec.fingerprint === alert.fingerprint) return false;
    if (alert.rule === RULES.bill || alert.rule === RULES.large) return true;
    const b = rec.basis || {};
    if (alert.rule === RULES.uncat) {
      const seen = new Set(Array.isArray(b.entryHashes) ? b.entryHashes : []);
      return alert.basis.entryHashes.some(h => !seen.has(h));
    }
    if (alert.rule === RULES.small) {
      if (b.frame !== alert.basis.frame) return true;
      const r = SETTINGS.reappear;
      return r.smallGrowthDen * alert.basis.total >= r.smallGrowthNum * (b.total || 0) && alert.basis.total - (b.total || 0) >= alert.threshold;
    }
    if (alert.rule === RULES.pace) {
      if (b.frame !== alert.basis.frame) return true;
      return alert.basis.gapPoints >= (Number.isInteger(b.gapPoints) ? b.gapPoints : -Infinity) + SETTINGS.reappear.paceGapPoints;
    }
    return true;
  }

  /** "new" | "reviewed" | "dismissed" | "changed" | "unknown-status", with the record when there is one. */
  function reviewStateOf(alert, records) {
    const rec = records.find(r => r.id === alert.id);
    if (!rec) return { state: "new", record: null };
    if (!KNOWN_STATUSES.includes(rec.status)) return { state: "unknown-status", record: rec };
    if (materiallyChanged(alert, rec)) return { state: "changed", record: rec };
    return { state: rec.status, record: rec };
  }

  /**
   * Record a review or dismissal (the user pressed a button). Returns NEW data.
   * An existing record is updated in place and keeps every field this version
   * doesn't know; nothing else changes.
   */
  function applyReview(state, alert, status, now) {
    if (!KNOWN_STATUSES.includes(status)) throw new Error("Unknown review status");
    if (!alert.reviewable) throw new Error("This alert can't be reviewed");
    const list = recordsOf(state);
    const i = list.findIndex(r => r.id === alert.id);
    const update = { id: alert.id, rule: alert.rule, status, actedAt: now.toISOString(), fingerprint: alert.fingerprint };
    let record;
    if (i >= 0) {
      record = { ...list[i], ...update };
      if (alert.basis) record.basis = alert.basis;
    } else {
      record = alert.basis ? { ...update, basis: alert.basis } : update;
    }
    const next = i >= 0 ? list.map((r, j) => (j === i ? record : r)) : [...list, record];
    return { ...state, meta: { ...state.meta, alertReviews: next } };
  }

  /** "Move back to To review": removes this alert's record (the user's explicit choice). Returns NEW data. */
  function clearReview(state, alertId) {
    const list = recordsOf(state);
    if (!list.some(r => r.id === alertId)) return state;
    const next = list.filter(r => r.id !== alertId);
    const meta = { ...state.meta };
    if (next.length) meta.alertReviews = next; else delete meta.alertReviews;
    return { ...state, meta };
  }

  // ---------------------------------------------------------------------------
  // Everything Expense Detective shows
  // ---------------------------------------------------------------------------
  function run(state, today) {
    const win = windows(state, today);
    const ctx = context(state, today);
    const checks = [];
    const records = recordsOf(state);
    const single = [...unusualBills(ctx, win, checks), ...largeExpenses(ctx, win, checks)]
      .sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : a.id < b.id ? -1 : 1));
    const small = smallPurchases(state, ctx, win, checks);
    const uncat = uncategorised(ctx, win, checks);
    const pace = spendingPace(state, ctx, checks);
    const alerts = [...(uncat ? [uncat] : []), ...pace.alerts, ...(small.kind === "alert" ? [small] : []), ...single]
      .map(a => ({ ...a, review: reviewStateOf(a, records) }));
    const groups = { toReview: [], reviewed: [], dismissed: [] };
    for (const a of alerts) {
      if (a.review.state === "reviewed") groups.reviewed.push(a);
      else if (a.review.state === "dismissed") groups.dismissed.push(a);
      else groups.toReview.push(a);
    }
    const shown = new Set(alerts.map(a => a.id));
    return {
      windows: win, threshold: ctx.threshold, futureCount: ctx.futureCount,
      alerts, groups,
      observations: small.kind === "observation" ? [small] : [],
      small, pace, checks,
      keptRecords: records.filter(r => !shown.has(r.id)).length
    };
  }

  return Object.freeze({
    SETTINGS, RULES, KNOWN_STATUSES,
    normaliseNote, median2, fnv1a64, idPart, windows, run, reviewStateOf, materiallyChanged, applyReview, clearReview
  });
});
