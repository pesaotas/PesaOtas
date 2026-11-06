/**
 * PesaOtas Insights — read-only analysis of recorded transactions (v1.6,
 * decision D-18). Pure: never changes the data it is given, never touches the
 * page or storage, and needs the current date passed in.
 *
 * Rules:
 *  - Only "expense" entries are spending and only "income" entries are income.
 *    Savings transfers and withdrawals are reported separately: a transfer is
 *    never spending and a withdrawal is never income (D-04).
 *  - Periods end today and include today. Entries dated after today haven't
 *    happened yet and are left out (and counted, so the screen can say so).
 *  - Comparisons are always with a previous period of exactly the same number
 *    of days, and only when the records cover ALL of that previous period.
 *    Otherwise there is no comparison — never a guess.
 *  - Average daily spending is divided by CALENDAR days of covered history:
 *    from the later of the period's start and the first recorded entry,
 *    through the period's end, inclusive (`coveredDaysBetween`). Days without
 *    entries in that span count as days with no recorded spending; the number
 *    of dates that happen to have entries is never used. The same rule applies
 *    to the current and the previous period. `coverage` says which days these are.
 *  - Patterns need enough complete months; with less data they are not shown.
 *
 * Browser: `window.PesaInsights`. Node: `require("./src/insights.js")`.
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./finance.js"), require("./data-model.js"), require("./currency.js"));
  } else {
    root.PesaInsights = factory(root.PesaFinance, root.PesaData, root.PesaCurrency);
  }
})(typeof self !== "undefined" ? self : this, function (F, D, C) {
  "use strict";

  const PERIODS = Object.freeze({
    "30d": Object.freeze({ id: "30d", label: "Last 30 days", previous: "the previous 30 days" }),
    "6m": Object.freeze({ id: "6m", label: "Last 6 months", previous: "the 6 months before" }),
    all: Object.freeze({ id: "all", label: "All time", previous: null })
  });
  const DEFAULT_PERIOD = "30d";
  /** A supported period ID, or the default for anything else (including inherited names such as "toString"). */
  const resolvePeriod = (id) => (typeof id === "string" && Object.prototype.hasOwnProperty.call(PERIODS, id) ? id : DEFAULT_PERIOD);

  /** Thresholds used by the pattern checks, in one place (D-18). */
  const SETTINGS = Object.freeze({
    minCompleteMonths: 3,     // months needed before "unusually high" or "every month" are shown
    highMonthFactor: 1.25,    // a month is "unusually high" above 125% of the median complete month
    maxChanges: 3             // biggest category increases/decreases listed
  });

  const UNCATEGORISED = "__uncategorised";
  const UNCATEGORISED_NAME = "Other / uncategorised";
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const shortDate = (iso) => { const [, m, d] = iso.split("-").map(Number); return `${d} ${MONTHS[m - 1]}`; };
  const monthLabel = (ym) => { const [y, m] = ym.split("-").map(Number); return `${MONTHS[m - 1]} ${y}`; };
  const lastDayOfMonth = (iso) => F.addDays(F.addMonths(`${iso.slice(0, 7)}-01`, 1), -1);
  const maxISO = (a, b) => (a > b ? a : b);
  const minISO = (a, b) => (a < b ? a : b);
  const dayCount = (from, to) => F.daysBetween(from, to) + 1; // inclusive

  /**
   * The denominator for averages (D-18): calendar days from the later of `start`
   * and `first` (the first recorded entry) through `end`, inclusive. 0 when there
   * are no records yet or they start after `end`. Days without entries count.
   */
  function coveredDaysBetween(first, start, end) {
    if (!first) return 0;
    const from = maxISO(start, first);
    return from <= end ? dayCount(from, end) : 0;
  }

  /** Earliest date of any entry on or before today (null if none): when records start. */
  function recordsStart(state, today) {
    let first = null;
    for (const t of state.transactions) if (t.date <= today && (first === null || t.date < first)) first = t.date;
    return first;
  }

  /**
   * The dates a period covers, its comparison period, and how much of it has records.
   * @param {"30d"|"6m"|"all"} periodId
   * @param {string} today  YYYY-MM-DD
   */
  function periodRange(state, periodId, today) {
    const id = resolvePeriod(periodId);
    const first = recordsStart(state, today);
    let start;
    if (id === "30d") start = F.addDays(today, -29);
    else if (id === "6m") start = F.addDays(F.addMonths(today, -6), 1);
    else start = first || today;
    const days = dayCount(start, today);
    const previous = id === "all" ? null : { start: F.addDays(start, -days), end: F.addDays(start, -1), days };
    const coveredStart = first ? maxISO(start, first) : null;
    const coveredDays = coveredDaysBetween(first, start, today);
    return {
      id, label: PERIODS[id].label, start, end: today, days,
      previous,
      comparable: !!(previous && first && first <= previous.start),
      coverage: { recordsStart: first, coveredStart, coveredDays, partial: !!(first && first > start), empty: !first }
    };
  }

  /** Name, type and key for a spending category; unknown IDs count as uncategorised (as in finance.js). */
  function categoryLookup(state) {
    const byId = new Map(state.categories.map(c => [c.id, c]));
    return (id) => {
      const c = byId.get(id);
      return c ? { key: c.id, name: c.name, kind: c.kind || "" } : { key: UNCATEGORISED, name: UNCATEGORISED_NAME, kind: "" };
    };
  }

  /**
   * Totals for entries dated from `from` to `to`, both included.
   * @returns {{income, expenses, transfers, withdrawals, net, counts:{income,expense,transfer,withdrawal}, byCategory: Map<key,{key,name,kind,amount,count}>}}
   */
  function totalsBetween(state, from, to) {
    const cat = categoryLookup(state);
    const r = { income: 0, expenses: 0, transfers: 0, withdrawals: 0, net: 0,
      counts: { income: 0, expense: 0, transfer: 0, withdrawal: 0 }, byCategory: new Map() };
    for (const t of state.transactions) {
      if (t.date < from || t.date > to) continue;
      if (t.type === "expense") {
        r.expenses += t.amount; r.counts.expense++;
        const c = cat(t.categoryId);
        const row = r.byCategory.get(c.key) || { ...c, amount: 0, count: 0 };
        row.amount += t.amount; row.count++;
        r.byCategory.set(c.key, row);
      } else if (t.type === "income") { r.income += t.amount; r.counts.income++; }
      else if (t.type === "savings_transfer") { r.transfers += t.amount; r.counts.transfer++; }
      else if (t.type === "savings_withdrawal") { r.withdrawals += t.amount; r.counts.withdrawal++; }
    }
    // The change in spending cash: money in, minus spending, minus money moved to savings, plus money brought back.
    r.net = r.income - r.expenses - r.transfers + r.withdrawals;
    return r;
  }

  /** Change from a previous amount: difference, and percentage when the previous amount isn't zero. */
  const change = (current, previous) => ({
    previous, diff: current - previous,
    pct: previous > 0 ? Math.round(((current - previous) / previous) * 100) : null
  });

  /**
   * Small purchases (at or below the currency's investigation threshold, D-17)
   * and uncategorised spending — worth a look, not necessarily wasteful.
   * Each entry is counted once even if it is both.
   */
  function leakSummary(state, from, to) {
    const threshold = C.info(state.currency).smallPurchase;
    const known = new Set(state.categories.map(c => c.id));
    const r = { threshold, count: 0, total: 0, smallCount: 0, smallTotal: 0, uncategorisedCount: 0, uncategorisedTotal: 0 };
    for (const t of state.transactions) {
      if (t.type !== "expense" || t.date < from || t.date > to) continue;
      const small = t.amount <= threshold;
      const uncategorised = !known.has(t.categoryId);
      if (small) { r.smallCount++; r.smallTotal += t.amount; }
      if (uncategorised) { r.uncategorisedCount++; r.uncategorisedTotal += t.amount; }
      if (small || uncategorised) { r.count++; r.total += t.amount; }
    }
    return r;
  }

  /** Spending by category in a period, largest first, with shares and (when comparable) changes. */
  function categoryBreakdown(state, range) {
    const cur = totalsBetween(state, range.start, range.end);
    const prev = range.comparable ? totalsBetween(state, range.previous.start, range.previous.end) : null;
    const rows = [...cur.byCategory.values()].map(row => ({
      ...row,
      share: cur.expenses > 0 ? row.amount / cur.expenses : 0,
      change: prev ? change(row.amount, (prev.byCategory.get(row.key) || { amount: 0 }).amount) : null
    }));
    // Categories that had spending before but none now are part of the comparison too.
    if (prev) {
      for (const p of prev.byCategory.values()) {
        if (!cur.byCategory.has(p.key)) rows.push({ ...p, amount: 0, count: 0, share: 0, change: change(0, p.amount) });
      }
    }
    rows.sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
    return { total: cur.expenses, rows };
  }

  /**
   * The six summary figures for a period (D-18). Every figure comes with what
   * it would be compared to; `null` comparisons mean "not enough history".
   */
  function summary(state, periodId, today) {
    const range = periodRange(state, periodId, today);
    const cur = totalsBetween(state, range.start, range.end);
    const prev = range.comparable ? totalsBetween(state, range.previous.start, range.previous.end) : null;
    // Same denominator rule for both periods (D-18). A comparison exists only when
    // records cover the whole previous period, so there it is that period's length.
    const days = coveredDaysBetween(range.coverage.recordsStart, range.start, range.end);
    const avgDaily = days > 0 ? Math.round(cur.expenses / days) : 0;
    const prevDays = prev ? coveredDaysBetween(range.coverage.recordsStart, range.previous.start, range.previous.end) : 0;
    const prevAvgDaily = prevDays > 0 ? Math.round(prev.expenses / prevDays) : null;
    const breakdown = categoryBreakdown(state, range);
    const top = breakdown.rows.find(r => r.amount > 0) || null;
    const leaks = leakSummary(state, range.start, range.end);
    const prevLeaks = prev ? leakSummary(state, range.previous.start, range.previous.end) : null;
    const future = state.transactions.filter(t => t.date > today).length;
    return {
      range, totals: cur, previousTotals: prev, futureEntries: future,
      expenses: { amount: cur.expenses, count: cur.counts.expense, change: prev ? change(cur.expenses, prev.expenses) : null },
      averageDaily: {
        amount: avgDaily, days, from: days > 0 ? range.coverage.coveredStart : null, to: range.end,
        previousDays: prev ? prevDays : null,
        change: prevAvgDaily !== null ? change(avgDaily, prevAvgDaily) : null
      },
      largestCategory: top ? {
        key: top.key, name: top.name, amount: top.amount, share: top.share,
        change: prev ? change(top.amount, (prev.byCategory.get(top.key) || { amount: 0 }).amount) : null
      } : null,
      incomeVsExpenses: {
        income: cur.income, expenses: cur.expenses, difference: cur.income - cur.expenses,
        spentShare: cur.income > 0 ? cur.expenses / cur.income : null,
        previousSpentShare: prev && prev.income > 0 ? prev.expenses / prev.income : null
      },
      netCash: { amount: cur.net, income: cur.income, expenses: cur.expenses, transfers: cur.transfers, withdrawals: cur.withdrawals, change: prev ? change(cur.net, prev.net) : null },
      leaks: { ...leaks, share: cur.expenses > 0 ? leaks.total / cur.expenses : 0, change: prevLeaks ? change(leaks.total, prevLeaks.total) : null },
      breakdown
    };
  }

  // ---------------------------------------------------------------------------
  // Time series: days, calendar weeks (Monday–Sunday) or calendar months.
  // Buckets at either end may be partial; `days` and `coveredDays` say how much.
  // ---------------------------------------------------------------------------
  const weekStart = (iso) => { const [y, m, d] = iso.split("-").map(Number); const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); return F.addDays(iso, -((dow + 6) % 7)); };

  /**
   * @param {"day"|"week"|"month"} unit
   * @returns {Array<{start,end,label,days,coveredDays,partial,income,expenses,transfers,withdrawals,net}>}
   */
  function series(state, range, unit) {
    const out = [];
    let cursor = unit === "week" ? weekStart(range.start) : unit === "month" ? `${range.start.slice(0, 7)}-01` : range.start;
    while (cursor <= range.end) {
      const natEnd = unit === "day" ? cursor : unit === "week" ? F.addDays(cursor, 6) : lastDayOfMonth(cursor);
      const start = maxISO(cursor, range.start), end = minISO(natEnd, range.end);
      const t = totalsBetween(state, start, end);
      const coveredDays = coveredDaysBetween(range.coverage.recordsStart, start, end);
      const days = dayCount(start, end);
      const label = unit === "month" ? monthLabel(cursor.slice(0, 7))
        : unit === "week" ? (start === end ? shortDate(start) : `${shortDate(start)} – ${shortDate(end)}`) : shortDate(start);
      out.push({ start, end, label, days, coveredDays, partial: days < dayCount(cursor, natEnd) || coveredDays < days,
        income: t.income, expenses: t.expenses, transfers: t.transfers, withdrawals: t.withdrawals, net: t.net });
      cursor = F.addDays(natEnd, 1);
    }
    return out;
  }

  /** The grouping used for a period's history: weeks for 30 days, months otherwise. */
  const historyUnit = (periodId) => (periodId === "30d" ? "week" : "month");

  // ---------------------------------------------------------------------------
  // Patterns over complete months (D-18). Nothing is shown without enough data.
  // ---------------------------------------------------------------------------
  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

  /**
   * @returns {{available:boolean, reason?:string, completeMonths:number,
   *   highMonths:Array<{label,start,expenses,median,abovePct}>,
   *   everyMonth:Array<{key,name,monthlyAverage,months}>,
   *   increases:Array, decreases:Array}}
   */
  function patterns(state, periodId, today) {
    const range = periodRange(state, periodId, today);
    const changes = range.comparable ? categoryBreakdown(state, range).rows.filter(r => r.change && r.change.diff !== 0) : [];
    const increases = changes.filter(r => r.change.diff > 0).sort((a, b) => b.change.diff - a.change.diff).slice(0, SETTINGS.maxChanges);
    const decreases = changes.filter(r => r.change.diff < 0).sort((a, b) => a.change.diff - b.change.diff).slice(0, SETTINGS.maxChanges);
    const base = { completeMonths: 0, highMonths: [], everyMonth: [], increases, decreases, comparable: range.comparable };
    if (periodId === "30d") return { ...base, available: false, reason: "period" };
    // Complete months: whole calendar months inside the period, fully covered by records.
    const months = series(state, range, "month").filter(m => !m.partial);
    if (months.length < SETTINGS.minCompleteMonths) return { ...base, completeMonths: months.length, available: false, reason: "data" };
    const med = median(months.map(m => m.expenses));
    const highMonths = med > 0 ? months
      .filter(m => m.expenses > med * SETTINGS.highMonthFactor)
      .map(m => ({ label: m.label, start: m.start, expenses: m.expenses, median: med, abovePct: Math.round((m.expenses / med - 1) * 100) })) : [];
    const perMonth = months.map(m => totalsBetween(state, m.start, m.end).byCategory);
    const everyMonth = [...perMonth[0].keys()]
      .filter(key => perMonth.every(map => (map.get(key) || { amount: 0 }).amount > 0))
      .map(key => {
        const amounts = perMonth.map(map => map.get(key).amount);
        return { key, name: perMonth[0].get(key).name, months: months.length, monthlyAverage: Math.round(amounts.reduce((a, b) => a + b, 0) / months.length) };
      })
      .sort((a, b) => b.monthlyAverage - a.monthlyAverage);
    return { ...base, available: true, completeMonths: months.length, highMonths, everyMonth };
  }

  // ---------------------------------------------------------------------------
  // Chart data (v1.6 Phase 3, D-19). Read-only, like everything above: these only
  // regroup the tested figures from `series` and `categoryBreakdown`. No
  // amounts are worked out anywhere else.
  // ---------------------------------------------------------------------------
  const TREND_UNITS = Object.freeze({ "30d": "day", "6m": "week", all: "month" });
  /** Spending-trend grouping: days for 30 days, Monday–Sunday weeks for 6 months, months for all time. */
  const trendUnit = (periodId) => TREND_UNITS[resolvePeriod(periodId)];
  const GROUP_KEY = "__other-categories";
  /** Categories shown separately before the rest are grouped (more than six → five plus a group). */
  const SEGMENT_LIMIT = 6;

  /** "8–31 Oct" or "29 Jun – 5 Jul" (no year). */
  function rangeLabel(start, end) {
    if (start === end) return shortDate(start);
    const [, m1, d1] = start.split("-").map(Number);
    const [, m2, d2] = end.split("-").map(Number);
    return m1 === m2 ? `${d1}–${d2} ${MONTHS[m2 - 1]}` : `${shortDate(start)} – ${shortDate(end)}`;
  }

  /**
   * Two separate ideas, never mixed (D-19):
   *  - `clipped`: the bar is shorter than its whole day/week/month because the
   *    selected period starts or ends inside it (`soFar` when it ends today).
   *  - `state`: how much of the bar your records cover —
   *      "no-history"     no covered days (before your first record)
   *      "partly-covered" your records begin inside this bar
   *      "no-spending"    covered, but no spending recorded
   *      "spending"       covered, with spending
   */
  function chartBuckets(state, range, unit, today) {
    return series(state, range, unit).map(b => {
      const natStart = unit === "day" ? b.start : unit === "week" ? weekStart(b.start) : `${b.start.slice(0, 7)}-01`;
      const natEnd = unit === "day" ? b.start : unit === "week" ? F.addDays(natStart, 6) : lastDayOfMonth(b.start);
      const clipped = b.start !== natStart || b.end !== natEnd;
      const st = b.coveredDays === 0 ? "no-history" : b.coveredDays < b.days ? "partly-covered" : b.expenses === 0 ? "no-spending" : "spending";
      const year = b.start.slice(0, 4);
      return {
        start: b.start, end: b.end, days: b.days, coveredDays: b.coveredDays,
        coveredStart: b.coveredDays > 0 ? F.addDays(b.end, 1 - b.coveredDays) : null,
        clipped, soFar: clipped && b.end === today && b.end !== natEnd, state: st,
        label: unit === "day" ? `${shortDate(b.start)} ${year}`
          : unit === "week" ? `${rangeLabel(b.start, b.end)} ${b.end.slice(0, 4)}`
          : clipped ? `${rangeLabel(b.start, b.end)} ${year}` : monthLabel(b.start.slice(0, 7)),
        tick: unit === "month" ? MONTHS[Number(b.start.slice(5, 7)) - 1] : shortDate(b.start),
        year,
        income: b.income, expenses: b.expenses, transfers: b.transfers, withdrawals: b.withdrawals
      };
    });
  }

  /**
   * Spending trend for a period: one bar per day (30 days), week (6 months) or
   * month (all time). The bars add up to the period's total expenses.
   */
  function spendingTrend(state, periodId, today) {
    const range = periodRange(state, periodId, today);
    const unit = trendUnit(range.id);
    const buckets = chartBuckets(state, range, unit, today);
    return {
      range, unit, buckets,
      total: buckets.reduce((a, b) => a + b.expenses, 0),
      max: buckets.reduce((a, b) => Math.max(a, b.expenses), 0),
      hasHistory: !range.coverage.empty
    };
  }

  /**
   * Income and expenses by calendar month, each month cut to the period's dates
   * (Last 30 days: the two months it overlaps, e.g. 8–31 Oct and 1–6 Nov).
   * Savings transfers and withdrawals are neither (D-04, D-18).
   */
  function incomeExpenseMonths(state, periodId, today) {
    const range = periodRange(state, periodId, today);
    const months = chartBuckets(state, range, "month", today).map(m => ({ ...m, difference: m.income - m.expenses }));
    return {
      range, months,
      income: months.reduce((a, m) => a + m.income, 0),
      expenses: months.reduce((a, m) => a + m.expenses, 0),
      max: months.reduce((a, m) => Math.max(a, m.income, m.expenses), 0),
      hasHistory: !range.coverage.empty
    };
  }

  /**
   * Spending by category for the donut (D-19): up to six categories are shown
   * separately; with more than six, the five largest are shown and the rest
   * are grouped as "Other categories (N)" (N ≥ 2). "Other / uncategorised" is an
   * ordinary category here. Largest first; ties alphabetical (as categoryBreakdown).
   */
  function categorySegments(state, periodId, today) {
    const range = periodRange(state, periodId, today);
    const b = categoryBreakdown(state, range);
    const rows = b.rows.filter(r => r.amount > 0);
    const seg = (r) => ({ key: r.key, name: r.name, amount: r.amount, count: r.count, share: b.total > 0 ? r.amount / b.total : 0, group: false, members: [{ key: r.key, name: r.name, amount: r.amount, count: r.count, share: b.total > 0 ? r.amount / b.total : 0 }] });
    let segments = rows.map(seg);
    if (rows.length > SEGMENT_LIMIT) {
      const rest = rows.slice(SEGMENT_LIMIT - 1);
      const amount = rest.reduce((a, r) => a + r.amount, 0);
      segments = rows.slice(0, SEGMENT_LIMIT - 1).map(seg).concat([{
        key: GROUP_KEY, name: `Other categories (${rest.length})`, amount,
        count: rest.reduce((a, r) => a + r.count, 0), share: b.total > 0 ? amount / b.total : 0, group: true,
        members: rest.map(r => seg(r).members[0])
      }]);
    }
    return { range, total: b.total, segments, grouped: rows.length > SEGMENT_LIMIT };
  }

  /**
   * The entries behind a bar or a category (read-only), newest first — the same
   * order as the Transactions screen. Only entries dated today or earlier.
   * @param {{start:string, end:string, types?:string[], categoryKeys?:string[]}} sel
   * @returns {{entries:object[], count:number, total:number}}
   */
  function entriesFor(state, sel, today) {
    const cat = categoryLookup(state);
    const end = minISO(sel.end, today);
    const types = sel.types ? new Set(sel.types) : null;
    const keys = sel.categoryKeys ? new Set(sel.categoryKeys) : null;
    const entries = state.transactions.filter(t => t.date >= sel.start && t.date <= end
      && (!types || types.has(t.type))
      && (!keys || (t.type === "expense" && keys.has(cat(t.categoryId).key))));
    entries.sort((a, b) => String(b.date).localeCompare(String(a.date)) || (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
    return { entries, count: entries.length, total: entries.reduce((a, t) => a + t.amount, 0) };
  }

  return Object.freeze({
    PERIODS, DEFAULT_PERIOD, resolvePeriod, SETTINGS, UNCATEGORISED, UNCATEGORISED_NAME,
    recordsStart, coveredDaysBetween, periodRange, totalsBetween, leakSummary, categoryBreakdown, summary, series, historyUnit, patterns,
    trendUnit, GROUP_KEY, SEGMENT_LIMIT, spendingTrend, incomeExpenseMonths, categorySegments, entriesFor
  });
});
