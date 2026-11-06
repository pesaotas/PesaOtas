(() => {
  "use strict";

  // Amounts in the budget's own currency (v1.6, D-17), e.g. "KSh 25,000" or "$250".
  const money = (value) => PesaCurrency.format(value, state && state.currency);
  const cur = () => PesaCurrency.info(state && state.currency);
  const SAVINGS_TYPES = ["savings_transfer", "savings_withdrawal"];
  const isSavingsType = (type) => SAVINGS_TYPES.includes(type);
  const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  };
  // Dates are formatted by the app, never by the browser (KI-37), so the result is the same in every
  // browser. Each context keeps its own format: "6 Nov 2026" (formatDate), "6 November 2026"
  // (formatLongDate), "Friday, 6 November 2026" (formatDayDate) and "6 Nov 2026, 10:05" (formatWhen).
  // Month names come from fixed lists ("Sep", never "Sept"), as in Insights and Expense Detective.
  const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const MONTHS_LONG = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const WEEKDAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const dateParts = (iso) => { const [y, m, d] = iso.split("-").map(Number); return { y, m, d, wd: new Date(Date.UTC(y, m - 1, d)).getUTCDay() }; };
  const formatDate = (iso) => {
    if (!iso) return "";
    const { y, m, d } = dateParts(iso);
    return `${d} ${MONTHS_SHORT[m - 1]} ${y}`;
  };
  const formatDayDate = (iso) => { const { y, m, d, wd } = dateParts(iso); return `${WEEKDAYS[wd]}, ${d} ${MONTHS_LONG[m - 1]} ${y}`; };
  const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));

  // ---------------------------------------------------------------------------
  // Loading and saving. All rules live in src/storage.js (tested); this layer
  // only decides what the user sees. See docs/DECISIONS.md D-02 and D-09.
  // ---------------------------------------------------------------------------
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const store = (() => { try { return window.localStorage; } catch { return null; } })();
  const boot = store ? PesaStorage.load(store, new Date()) : { status: "unavailable" };

  let state;               // what the screen shows
  let lastSaved;           // last copy confirmed in storage; edits revert to it if a save fails
  let canSave = true;      // false while data needs recovery or storage is unusable
  let recovery = null;     // the load result while damaged data awaits a decision
  let damagedDownloaded = false;
  let pendingRestore = null;
  let toastTimer;
  // Storage protection and safety copies (Phase 5, D-15)
  let persistStatus = "unknown"; // "granted" | "not-granted" | "unsupported" | "unknown"
  let appCopy = null;            // {version, build} of the offline copy, when known
  let askedPersistThisSession = false;
  function storageApi() { return (navigator.storage && typeof navigator.storage.persist === "function") ? navigator.storage : null; }
  const COPY_TITLES = {
    legacy: "Original PesaFlow data",
    preserved: "Copy of PesaFlow data made before moving",
    preUpgrade: "Your data before upgrading to v1.6 (v1.5.0 format)",
    olderVersion: "Data set aside when two versions were found",
    preCurrency: "Before currency change",
    quarantine: "Damaged data set aside",
    reviewRecords: "Your data before unreadable alert review records were set aside",
    preRestore: "Your data before the last restore, recovery, reset or new pay cycle"
  };
  const sizeText = (chars) => chars < 1024 ? "under 1 KB" : `about ${Math.round(chars / 1024)} KB`;
  // Deleting safety copies is allowed only while the current data is saved and healthy (D-15).
  const canManageCopies = (inv) => canSave && !recovery && inv.currentSafe;


  let storedRaw = null;    // the exact stored text this tab last read or wrote (stale-tab protection, D-16)
  let saveBlock = null;    // why saving is paused: recovery | storage | migration | upgrade | conflict | stale
  switch (boot.status) {
    case "ok":
    case "migrated":
    case "upgraded":
      state = boot.state; storedRaw = boot.raw; break;
    case "new":
      // A genuinely new user: nothing on this device. Start empty (nothing is written until they act).
      state = PesaData.createBlankState(); break;
    case "migration-failed":
      state = boot.state; canSave = false; saveBlock = "migration"; break;   // read-only view of the converted copy
    case "upgrade-failed":
      state = boot.state; canSave = false; saveBlock = "upgrade"; break;     // read-only until the upgrade completes
    case "older-version-conflict":
      state = boot.state; storedRaw = boot.raw; canSave = false; saveBlock = "conflict"; break;
    case "review-records-invalid":
      // D-20: the budget is fine; some alert review records can't be read. Read-only until the user decides.
      state = boot.state; storedRaw = boot.raw; canSave = false; saveBlock = "reviews"; break;
    case "corrupt":
      state = PesaData.createBlankState(); canSave = false; recovery = boot; saveBlock = "recovery";
      storedRaw = boot.sourceKey === PesaStorage.KEYS.current ? boot.raw : null; break;
    default: // "unavailable"
      state = PesaData.createBlankState(); canSave = false; saveBlock = "storage";
  }
  lastSaved = clone(state);

  const BLOCKED_MESSAGES = {
    recovery: "Not saved. Choose a recovery option first.",
    storage: "Not saved: this browser isn't storing PesaOtas data.",
    migration: "Not saved: your PesaFlow data hasn't finished moving yet. See the message at the top.",
    upgrade: "Not saved: the upgrade to the v1.6 format hasn't finished yet. See the message at the top.",
    conflict: "Not saved: choose which version of your budget to keep first.",
    stale: "Not saved: this tab is out of date because your data changed in another tab. Reload to continue.",
    reviews: "Not saved: some alert review records couldn't be read. Choose what to do with them first (see the message at the top)."
  };
  function saveState() {
    if (!canSave) {
      state = clone(lastSaved);
      showToast(BLOCKED_MESSAGES[saveBlock] || BLOCKED_MESSAGES.storage);
      return false;
    }
    const result = PesaStorage.save(store, state, { expectedRaw: storedRaw });
    if (result.ok) {
      state = result.state;
      lastSaved = clone(state);
      storedRaw = result.raw;
      askForPersistenceOnce();
      return true;
    }
    state = clone(lastSaved); // never show unsaved changes as if they were saved
    if (result.reason === "changed-elsewhere") {
      markStale("tab");
      showToast(BLOCKED_MESSAGES.stale);
      return false;
    }
    showToast(result.reason === "invalid"
      ? "Not saved: that change failed a data check."
      : "Could not save. Browser storage may be full, so download a backup from Settings.");
    return false;
  }

  const makeId = (prefix) => (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  function downloadText(text, filename) {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function showToast(message) {
    const el = document.getElementById("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }
  // Financial calculations live in src/finance.js (pure, tested). These thin
  // wrappers supply the current state and clock.
  function totals() {
    return PesaFinance.computeTotals(state);
  }
  function daysToPayday() {
    return PesaFinance.daysToPayday(state.payday, new Date());
  }
  function cycle() {
    return PesaFinance.cycleInfo(state, new Date());
  }
  // Newest first; tolerant of missing fields so one bad record can never stop the page rendering (KI-04).
  function newestFirst(a, b) {
    return String(b.date || "").localeCompare(String(a.date || "")) || (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
  }
  function categoryName(id) {
    return state.categories.find(c => c.id === id)?.name || "Other";
  }
  // Income is described by its source, never by a spending category (KI-10).
  // Older entries tagged with a spending category simply show as "Income".
  function incomeSourceName(id) {
    return PesaData.INCOME_SOURCES.find(s => s.id === id)?.name || "Income";
  }
  const activeDestinations = () => (state.savingsDestinations || []).filter(d => !d.archived);
  function destinationName(id) {
    return (state.savingsDestinations || []).find(d => d.id === id)?.name || "Savings";
  }
  const isSavingsCategory = (c) => PesaData.canonicalType(c.kind) === "Savings";
  const prefersReducedMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function setView(view) {
    document.querySelectorAll(".view").forEach(el => el.classList.toggle("active", el.id === `view-${view}`));
    document.querySelectorAll(".nav-link").forEach(el => {
      const on = el.dataset.view === view;
      el.classList.toggle("active", on);
      if (on) el.setAttribute("aria-current", "page"); else el.removeAttribute("aria-current");
    });
    const titles = {overview:"Your money at a glance",transactions:"Your transactions",budget:"Your budget plan",insights:"Your financial insights",settings:"Settings & backup"};
    document.getElementById("page-title").textContent = titles[view] || titles.overview;
    if (view === "settings") { populateSettings(); renderStorageProtection(); renderDataSafety(); }
    if (view === "transactions") renderTransactions();
    window.scrollTo({top:0,behavior:prefersReducedMotion() ? "auto" : "smooth"});
    document.getElementById("page-title").focus({preventScroll:true});
  }
  // Amount of a category's allocation used: spending, plus transfers to its
  // linked savings destination (D-04: transfers fulfil the allocation).
  const usedOf = (t, c) => (t.spentByCategory[c.id] || 0) + (t.savedByCategory[c.id] || 0);
  function budgetProgress(c) {
    const t = totals();
    const used = usedOf(t, c);
    const pct = c.budget > 0 ? Math.min(100, used/c.budget*100) : (used > 0 ? 100 : 0);
    const over = (t.spentByCategory[c.id] || 0) > c.budget;
    const suffix = c.destinationId ? " saved" : "";
    return `<div class="budget-item">
      <div class="budget-item-head"><span class="budget-name">${escapeHTML(c.name)}</span><span class="budget-amount">${money(used)}${suffix} / ${money(c.budget)}</span></div>
      <div class="progress-track"><div class="progress-fill ${over?"over":""}" style="width:${pct}%"></div></div>
    </div>`;
  }
  function describeTransaction(t) {
    if (t.type === "income") {
      const source = incomeSourceName(t.categoryId);
      return { icon: "↗", title: t.note || source, sub: source, amount: `+${money(t.amount)}`, cls: "positive" };
    }
    if (t.type === "savings_transfer") {
      const dest = destinationName(t.destinationId);
      return { icon: "→", title: t.note || `Saved to ${dest}`, sub: `Moved to ${dest} · not spending`, amount: `−${money(t.amount)}`, cls: "transfer" };
    }
    if (t.type === "savings_withdrawal") {
      const dest = destinationName(t.destinationId);
      return { icon: "←", title: t.note || `Withdrawn from ${dest}`, sub: `From ${dest} · not income`, amount: `+${money(t.amount)}`, cls: "transfer" };
    }
    const cat = categoryName(t.categoryId);
    return { icon: "↘", title: t.note || cat, sub: cat, amount: `−${money(t.amount)}`, cls: "negative" };
  }
  function transactionMarkup(t, withDelete=false) {
    const d = describeTransaction(t);
    return `<div class="activity-row">
      <div class="activity-icon ${d.cls === "transfer" ? "activity-icon-savings" : ""}" aria-hidden="true">${d.icon}</div>
      <div class="activity-info"><strong>${escapeHTML(d.title)}</strong><small>${escapeHTML(d.sub)} · ${formatDate(t.date)}</small></div>
      <span class="activity-amount ${d.cls}">${d.amount}</span>
      ${withDelete ? `<div class="row-actions">
        <button class="icon-button" type="button" data-edit="${escapeHTML(t.id)}" aria-label="Edit: ${escapeHTML(d.title)}, ${escapeHTML(d.amount)}, ${escapeHTML(formatDate(t.date))}"><span aria-hidden="true">✎</span></button>
        <button class="icon-button icon-button-danger" type="button" data-delete="${escapeHTML(t.id)}" aria-label="Delete: ${escapeHTML(d.title)}, ${escapeHTML(d.amount)}, ${escapeHTML(formatDate(t.date))}"><span aria-hidden="true">×</span></button>
      </div>` : ""}
    </div>`;
  }

  /** Plain-language breakdown of the safe-to-spend figure (D-03). */
  function renderSafeBreakdown(t, days, guide, due) {
    const sum = t.flexible + t.unallocated;
    const unallocatedNote = t.unallocated < 0
      ? "Below zero: your plan needs more than you have (from overspending or allocating more than you hold), so this comes off."
      : "Cash that hasn't been given a job in your budget yet.";
    const paceLine = due
      ? `<p>Payday has arrived. Start your new pay cycle to get a daily guide for it.</p>`
      : guide === null
      ? `<p>Set your payday in Settings to get a daily guide.</p>`
        : `<p>Spread over <strong>${days} day${days === 1 ? "" : "s"}</strong> to payday, that's about <strong>${money(guide)} a day</strong> (rounded down).</p>`;
    document.getElementById("safe-breakdown").innerHTML = `
      <p class="breakdown-lead">It's your spending cash minus everything still set aside for bills, essentials, savings and other commitments.</p>
      <div class="breakdown-rows" role="table" aria-label="Safe to spend calculation">
        <div class="breakdown-row" role="row"><span role="cell">Flexible budget left<small>Unspent money in your Flexible categories</small></span><strong role="cell" id="flexible-left">${money(t.flexible)}</strong></div>
        <div class="breakdown-row" role="row"><span role="cell">+ Unallocated money<small>${escapeHTML(unallocatedNote)}</small></span><strong role="cell" class="${t.unallocated < 0 ? "is-negative" : ""}">${money(t.unallocated)}</strong></div>
        <div class="breakdown-row breakdown-total" role="row"><span role="cell">= Safe to spend now</span><strong role="cell">${money(t.safeToSpend)}</strong></div>
      </div>
      <p class="tiny-muted">Never more than your spending cash (${money(t.cash)}) and never below zero.${sum < 0 ? ` Right now the sum is ${money(sum)}, so it shows ${money(0)}.` : ""}</p>
      ${paceLine}
      <p class="tiny-muted">Moving money to savings is not spending. It leaves your spending cash, and if the destination is linked to a Savings budget category, it fulfils that allocation so the money is never set aside twice.</p>`;
  }

  function renderSavingsOverview(t) {
    const rows = activeDestinations().map(d => `<div class="savings-row"><span>${escapeHTML(d.name)}</span><strong>${money(t.destinationBalances[d.id] || 0)}</strong></div>`).join("");
    const linked = state.categories.filter(c => c.destinationId && isSavingsCategory(c)).map(c =>
      `<p class="tiny-muted">${escapeHTML(c.name)}: ${money(t.savedByCategory[c.id] || 0)} of ${money(c.budget)} saved to ${escapeHTML(destinationName(c.destinationId))}.</p>`).join("");
    document.getElementById("savings-overview").innerHTML =
      rows + `<div class="savings-row savings-total"><span>Total savings</span><strong>${money(t.totalSavings)}</strong></div>` + linked;
  }

  // Progress through the pay cycle uses the real start and payday (no 30-day assumption).
  function renderCycleProgress(info) {
    const bar = document.getElementById("payday-progress");
    const note = document.getElementById("cycle-progress-note");
    if (info.rolloverDue) {
      bar.style.width = "100%";
      note.textContent = "This pay cycle has ended. Start your new cycle when you're ready.";
    } else if (info.lengthDays) {
      const day = Math.min(info.lengthDays, info.elapsedDays + 1);
      bar.style.width = `${Math.max(4, Math.min(100, info.elapsedDays / info.lengthDays * 100))}%`;
      note.textContent = `Day ${day} of ${info.lengthDays} in this pay cycle.`;
    } else {
      bar.style.width = "0%";
      note.textContent = state.payday ? "Set when this pay cycle started (Settings) to see your progress." : "Your progress through the pay cycle will show here.";
    }
  }
  function renderRolloverBanner(info) {
    const banner = document.getElementById("rollover-banner");
    banner.classList.toggle("hidden", !info.rolloverDue);
    if (!info.rolloverDue) return;
    const when = info.today === info.payday ? "Today is payday." : `Payday was on ${formatDate(info.payday)}.`;
    document.getElementById("rollover-banner-text").textContent =
      `${when} Your budget is still counting the old pay cycle. Start the new cycle when you're ready. You'll see a summary first, and nothing changes until you confirm.`;
  }

  function renderOverview() {
    const t = totals();
    const days = daysToPayday();
    const info = cycle();
    // On or after payday the new cycle is due: no daily guide until the user starts it (KI-25).
    const guide = state.payday && !info.rolloverDue ? PesaFinance.dailyGuide(t.safeToSpend, days) : null;
    document.getElementById("cash-balance").textContent = money(t.cash);
    document.getElementById("reserved-total").textContent = money(t.allocatedRemaining);
    document.getElementById("unallocated-total").textContent = money(t.unallocated);
    document.getElementById("days-to-payday").innerHTML = state.payday ? `${days} <small>days</small>` : `<span class="payday-unset">Not set</span>`;
    document.getElementById("payday-date").textContent = state.payday ? formatDayDate(state.payday) : "Add your next payday in Settings";
    document.getElementById("income-total").textContent = money(t.earned);
    document.getElementById("expense-total").textContent = money(t.spent);
    document.getElementById("safe-to-spend").textContent = money(t.safeToSpend);
    document.getElementById("daily-guide").textContent = guide === null ? "Not available" : money(guide);
    document.getElementById("daily-guide-note").textContent = info.rolloverDue ? "Start your new pay cycle" : guide === null ? "Set a payday to see this" : "Safe to spend ÷ days to payday";
    renderSafeBreakdown(t, days, guide, info.rolloverDue);
    renderSavingsOverview(t);
    renderCycleProgress(info);
    renderRolloverBanner(info);
    document.querySelectorAll(".period-label").forEach(el => {
      el.textContent = state.cycleStart ? `This pay cycle (since ${formatDate(state.cycleStart)})` : "Since you started recording";
    });
    document.getElementById("overview-budgets").innerHTML = state.categories.slice(0,5).map(budgetProgress).join("");
    const recent = [...state.transactions].sort(newestFirst).slice(0,5);
    document.getElementById("recent-transactions").innerHTML = recent.length ? recent.map(x=>transactionMarkup(x)).join("") : `<div class="empty-state">No transactions yet.<br>Record your first expense to see your activity here.</div>`;
    const alert = document.getElementById("budget-alert");
    if (t.unallocated < 0) {
      alert.classList.remove("hidden");
      alert.textContent = `Your plan is over-allocated by ${money(Math.abs(t.unallocated))}. Reduce some allocations or record additional income before spending more.`;
    } else if (t.overCount > 0) {
      alert.classList.remove("hidden");
      alert.textContent = `${t.overCount === 1 ? "1 budget category is over its" : `${t.overCount} budget categories are over their`} planned amount. Review your budget before making more purchases.`;
    } else {
      alert.classList.add("hidden");
    }
  }
  function renderTransactions() {
    const filter = document.getElementById("transaction-filter").value;
    const items = [...state.transactions]
      .filter(t => filter === "all"
        || (filter === "savings" ? isSavingsType(t.type)
          : filter === "cycle" ? !state.cycleStart || t.date >= state.cycleStart
          : t.type === filter))
      .sort(newestFirst);
    document.getElementById("transaction-count").textContent = `${items.length} ${items.length===1?"entry":"entries"}`;
    document.getElementById("all-transactions").innerHTML = items.length ? items.map(t=>transactionMarkup(t,true)).join("") : `<div class="empty-state">Nothing here yet.<br>Your recorded transactions will appear here.</div>`;
  }
  // Unsaved budget edits survive any re-render (fixes KI-12). Keyed by category ID.
  let budgetDraft = {};
  const hasBudgetDraft = () => Object.keys(budgetDraft).length > 0;
  function renderBudget() {
    const t = totals();
    document.getElementById("budget-total").textContent = money(t.planned);
    document.getElementById("budget-unallocated").textContent = money(t.unallocated);
    document.getElementById("over-budget-count").textContent = t.overCount;
    // Drop drafts for categories that no longer exist.
    for (const id of Object.keys(budgetDraft)) if (!state.categories.some(c => c.id === id)) delete budgetDraft[id];
    const list = document.getElementById("budget-list");
    if (!state.categories.length) {
      list.innerHTML = `<div class="empty-state card">No budget categories yet.<br><button class="button button-secondary" type="button" data-suggest-categories>Add common categories</button> <button class="button button-secondary" type="button" data-new-category>Add your own</button></div>`;
    } else {
      list.innerHTML = state.categories.map(c => {
        const draft = budgetDraft[c.id] || {};
        const spent = t.spentByCategory[c.id] || 0;
        const used = usedOf(t, c);
        let status = `${money(spent)} spent · ${money(Math.max(0,c.budget-used))} left`;
        let link = "";
        if (isSavingsCategory(c)) {
          const chosen = draft.link !== undefined ? draft.link : (c.destinationId || "");
          const options = activeDestinations().map(d => `<option value="${escapeHTML(d.id)}" ${chosen === d.id ? "selected" : ""}>${escapeHTML(d.name)}</option>`).join("");
          link = `<label class="link-field"><span>Saved to</span><select class="input compact-input savings-link" data-link-id="${escapeHTML(c.id)}" aria-label="${escapeHTML(c.name)}: savings destination"><option value="">Not linked</option>${options}</select></label>`;
          if (c.destinationId) status = `${money(t.savedByCategory[c.id] || 0)} saved${spent ? ` + ${money(spent)} spent` : ""} · ${money(Math.max(0,c.budget-used))} left`;
        }
        const value = draft.budget !== undefined ? draft.budget : c.budget;
        const changed = draft.budget !== undefined || draft.link !== undefined;
        return `<article class="card budget-edit-card${changed ? " has-draft" : ""}">
          <div class="budget-edit-top"><strong>${escapeHTML(c.name)}</strong><span class="budget-edit-tags"><span class="category-kind">${escapeHTML(c.kind)}</span><button class="text-button" type="button" data-edit-category="${escapeHTML(c.id)}" aria-label="Edit category ${escapeHTML(c.name)}">Edit</button></span></div>
          <div class="budget-edit-bottom"><input class="input budget-value" type="number" min="0" step="50" inputmode="numeric" value="${escapeHTML(value)}" data-budget-id="${escapeHTML(c.id)}" aria-label="${escapeHTML(c.name)} allocation (${escapeHTML(cur().code)})"><span>${status}</span></div>
          ${link}
          ${changed ? `<p class="draft-note">Not saved yet</p>` : ""}
        </article>`;
      }).join("");
    }
    document.getElementById("discard-budget-button").classList.toggle("hidden", !hasBudgetDraft());
    document.getElementById("budget-save-status").textContent = hasBudgetDraft()
      ? "You have unsaved changes. They'll stay here until you save or discard them."
      : "Changes are saved on this device.";
  }
  // ---------------------------------------------------------------------------
  // Insights (v1.6 Phase 2, D-18): read-only figures from src/insights.js.
  // ---------------------------------------------------------------------------
  const calendarDays = (n) => `${n} calendar ${n === 1 ? "day" : "days"}`;
  let insightPeriod = PesaInsights.resolvePeriod(store ? PesaStorage.readDeviceInfo(store).insightsPeriod : null);
  document.getElementById("insight-period").addEventListener("change", e => {
    if (!e.target.matches('input[name="insight-period"]')) return;
    insightPeriod = PesaInsights.resolvePeriod(e.target.value);
    if (store) PesaStorage.updateDeviceInfo(store, { insightsPeriod: insightPeriod }); // a per-device preference, not financial data
    renderInsights();
  });
  const pctText = (x) => `${Math.round(x * 100)}%`;
  /** "▲ 12% more than the previous 30 days (KSh 8,880)" — words carry the meaning, not colour. */
  function compareLine(ch, range, opts = {}) {
    if (range.id === "all" || range.coverage.empty) return "";
    const prevLabel = PesaInsights.PERIODS[range.id].previous;
    if (!ch) return `<p class="kpi-compare muted-compare">No comparison yet: that needs records going back to ${escapeHTML(formatDate(range.previous.start))}.</p>`;
    let text, arrow = "";
    if (opts.signed) {
      text = ch.diff === 0 ? `Same as ${prevLabel} (${money(ch.previous)})`
        : `${money(Math.abs(ch.diff))} ${ch.diff > 0 ? "higher" : "lower"} than ${prevLabel} (${money(ch.previous)})`;
      arrow = ch.diff > 0 ? "▲" : ch.diff < 0 ? "▼" : "";
    } else if (ch.previous === 0) {
      text = ch.diff === 0 ? `None in ${prevLabel} either` : `None in ${prevLabel}`;
    } else if (ch.diff === 0) {
      text = `Same as ${prevLabel} (${money(ch.previous)})`;
    } else if (!ch.pct) {
      // Under 1%: give the amount instead of "0% less".
      text = `${money(Math.abs(ch.diff))} ${ch.diff > 0 ? "more" : "less"} than ${prevLabel} (${money(ch.previous)})`;
      arrow = ch.diff > 0 ? "▲" : "▼";
    } else {
      text = `${Math.abs(ch.pct)}% ${ch.diff > 0 ? "more" : "less"} than ${prevLabel} (${money(ch.previous)})`;
      arrow = ch.diff > 0 ? "▲" : "▼";
    }
    return `<p class="kpi-compare">${arrow ? `<span aria-hidden="true">${arrow}</span> ` : ""}${escapeHTML(text)}</p>`;
  }
  function kpiCard(id, label, figure, explain, compare) {
    return `<article class="card kpi-card" aria-labelledby="kpi-${id}"><h3 class="kpi-label" id="kpi-${id}">${escapeHTML(label)}</h3>` +
      `<p class="kpi-figure" id="kpi-${id}-figure">${figure}</p><p class="kpi-explain">${explain}</p>${compare}</article>`;
  }
  function renderInsights() {
    const today = todayISO();
    document.querySelectorAll('input[name="insight-period"]').forEach(r => { r.checked = r.value === insightPeriod; });
    const sum = PesaInsights.summary(state, insightPeriod, today);
    const range = sum.range;
    const noRecords = state.transactions.length === 0;
    document.getElementById("insight-empty").classList.toggle("hidden", !noRecords);
    document.getElementById("insight-body").classList.toggle("hidden", noRecords);
    const cov = range.coverage;
    let coverage = "";
    if (!noRecords) {
      if (cov.empty) coverage = "No entries are dated today or earlier yet.";
      else if (cov.partial) coverage = `Your records start on ${formatDate(cov.recordsStart)}, so this period's figures cover ${formatDate(cov.coveredStart)} – ${formatDate(range.end)}: ${calendarDays(cov.coveredDays)} of its ${range.days}. Averages use these ${calendarDays(cov.coveredDays)}.`;
      else coverage = `${range.id === "all" ? "All your records" : range.label}: ${formatDate(range.start)} – ${formatDate(range.end)} (${calendarDays(range.days)}).`;
      if (sum.futureEntries) coverage += ` ${sum.futureEntries} ${sum.futureEntries === 1 ? "entry is" : "entries are"} dated after today and not included yet.`;
    }
    document.getElementById("insight-coverage").textContent = coverage;
    if (noRecords) { renderCycleHistory(); return; }

    const days = sum.averageDaily.days;
    // D-18: calendar days of covered history, not the number of dates with entries.
    const dailyExplain = days
      ? `Total expenses divided by ${calendarDays(days)}${cov.partial ? ` (${formatDate(sum.averageDaily.from)} – ${formatDate(sum.averageDaily.to)})` : ""}. Days without entries count as no recorded spending.`
      : "No recorded history in this period yet, so there is no daily average.";
    const ive = sum.incomeVsExpenses, net = sum.netCash, leaks = sum.leaks, top = sum.largestCategory;
    const prevLabel = range.id === "all" ? "" : PesaInsights.PERIODS[range.id].previous;
    const cards = [
      kpiCard("expenses", "Total expenses", escapeHTML(money(sum.expenses.amount)),
        `${sum.expenses.count} ${sum.expenses.count === 1 ? "expense" : "expenses"} recorded. Savings transfers aren't spending, so they're not included.`,
        compareLine(sum.expenses.change, range)),
      kpiCard("daily", "Average daily spending", `${escapeHTML(money(sum.averageDaily.amount))}<small> a day</small>`,
        dailyExplain,
        compareLine(sum.averageDaily.change, range)),
      kpiCard("largest", "Largest spending category", top ? escapeHTML(top.name) : "None yet",
        top ? `${escapeHTML(money(top.amount))}, ${pctText(top.share)} of your spending in this period.` : "No spending recorded in this period.",
        top ? compareLine(top.change, range) : ""),
      kpiCard("income", "Income vs expenses", ive.spentShare === null ? (ive.expenses ? "No income" : "Nothing yet") : `${pctText(ive.spentShare)}<small> of income spent</small>`,
        `${escapeHTML(money(ive.income))} came in and ${escapeHTML(money(ive.expenses))} was spent` +
          (ive.difference < 0 ? `: spending was ${escapeHTML(money(-ive.difference))} more than income.` : ive.income ? `, leaving ${escapeHTML(money(ive.difference))}.` : "."),
        range.id === "all" ? "" : !sum.previousTotals ? compareLine(null, range)
          : `<p class="kpi-compare">${ive.previousSpentShare === null ? `No income recorded in ${escapeHTML(prevLabel)}` : `In ${escapeHTML(prevLabel)}: ${pctText(ive.previousSpentShare)} of income spent`}</p>`),
      kpiCard("net", "Net cash movement", `${net.amount > 0 ? "+" : ""}${escapeHTML(money(net.amount))}`,
        `How much your spending cash ${net.amount >= 0 ? "grew" : "fell"}: income ${escapeHTML(money(net.income))} − spending ${escapeHTML(money(net.expenses))} − moved to savings ${escapeHTML(money(net.transfers))} + taken from savings ${escapeHTML(money(net.withdrawals))}.`,
        compareLine(net.change, range, { signed: true })),
      kpiCard("leaks", "Potential spending leaks", escapeHTML(money(leaks.total)),
        leaks.count ? `${leaks.count} ${leaks.count === 1 ? "purchase" : "purchases"} of ${escapeHTML(money(leaks.threshold))} or less, or without a category: ${pctText(leaks.share)} of your spending. Worth a look, but not necessarily wasteful.`
          : `No purchases of ${escapeHTML(money(leaks.threshold))} or less and nothing uncategorised in this period.`,
        compareLine(leaks.change, range))
    ];
    document.getElementById("insight-kpis").innerHTML = cards.join("");
    renderCharts(range.id, today);
    renderDetective();

    // Where your money went
    const rows = sum.breakdown.rows.filter(r => r.amount > 0);
    document.getElementById("insight-breakdown").innerHTML = rows.length
      ? `<ol class="spend-rows">${rows.map(r => {
          const ch = r.change;
          const chText = !ch ? "" : ch.previous === 0 ? `none in ${prevLabel}` : ch.diff === 0 ? `same as ${prevLabel}`
            : `${ch.pct ? `${Math.abs(ch.pct)}%` : money(Math.abs(ch.diff))} ${ch.diff > 0 ? "more" : "less"} than ${prevLabel}`;
          return `<li class="spend-row"><div class="spend-top"><strong>${escapeHTML(r.name)}</strong><span>${escapeHTML(money(r.amount))} · ${pctText(r.share)}</span></div>` +
            `<div class="progress-track" aria-hidden="true"><div class="progress-fill" style="width:${Math.max(1, Math.round(r.share * 100))}%"></div></div>` +
            `<small class="tiny-muted">${r.count} ${r.count === 1 ? "entry" : "entries"}${chText ? ` · ${escapeHTML(chText)}` : ""}</small></li>`;
        }).join("")}</ol>`
      : `<p class="empty-state">No spending recorded in this period.</p>`;

    // History: weeks for 30 days, months otherwise
    const unit = PesaInsights.historyUnit(range.id);
    const buckets = PesaInsights.series(state, range, unit);
    document.getElementById("insight-history-title").textContent = unit === "week" ? "Week by week" : "Month by month";
    // Why a row is partial: records start part-way through it, the period starts part-way through it, or it isn't over yet.
    const partialNote = (b) => {
      if (!b.partial) return "";
      if (b.coveredDays === 0) return "no records yet";
      if (b.coveredDays < b.days) return `records start ${formatDate(cov.recordsStart)}`;
      if (b.start === range.start && b.end === range.end) return "";
      if (b.start === range.start) return unit === "week" ? "" : `from ${formatDate(b.start)}`; // week labels already show the dates
      return "so far";
    };
    // On phones each row becomes a small card (CSS); the explicit roles keep it a table for screen readers.
    const cols = ["Money in", "Spending", "To savings (net)", "Cash change"];
    document.getElementById("insight-history").innerHTML =
      `<table class="history-table" role="table"><caption class="sr-only">${unit === "week" ? "Week by week" : "Month by month"}: money in, spending, savings and change in cash</caption>` +
      `<thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">${unit === "week" ? "Week" : "Month"}</th>${cols.map(c => `<th scope="col" role="columnheader">${c}</th>`).join("")}</tr></thead><tbody role="rowgroup">` +
      buckets.map(b => {
        const note = partialNote(b);
        const vals = [money(b.income), money(b.expenses), money(b.transfers - b.withdrawals), `${b.net > 0 ? "+" : ""}${money(b.net)}`];
        return `<tr role="row"><th scope="row" role="rowheader">${escapeHTML(b.label)}${note ? `<small>(${escapeHTML(note)})</small>` : ""}</th>` +
          vals.map((v, i) => `<td role="cell" data-label="${cols[i]}">${escapeHTML(v)}</td>`).join("") + `</tr>`;
      }).join("") + `</tbody></table>`;

    // Patterns
    const pat = PesaInsights.patterns(state, range.id, today);
    const parts = [];
    if (range.id !== "all") {
      if (!pat.comparable) parts.push(`<p>Changes by category appear once your records go back to ${escapeHTML(formatDate(range.previous.start))}, so the whole of ${escapeHTML(prevLabel)} can be compared.</p>`);
      else if (!pat.increases.length && !pat.decreases.length) parts.push(`<p>No category changed compared with ${escapeHTML(prevLabel)}.</p>`);
      else {
        const line = (r) => `<li><strong>${escapeHTML(r.name)}</strong>: ${escapeHTML(money(r.amount))} (${r.change.previous === 0 ? `none in ${escapeHTML(prevLabel)}` : `${escapeHTML(money(Math.abs(r.change.diff)))} ${r.change.diff > 0 ? "more" : "less"} than ${escapeHTML(money(r.change.previous))}`})</li>`;
        if (pat.increases.length) parts.push(`<h4>Spending more than ${escapeHTML(prevLabel)}</h4><ul>${pat.increases.map(line).join("")}</ul>`);
        if (pat.decreases.length) parts.push(`<h4>Spending less than ${escapeHTML(prevLabel)}</h4><ul>${pat.decreases.map(line).join("")}</ul>`);
      }
    }
    if (!pat.available) {
      parts.push(pat.reason === "period"
        ? `<p>Month patterns compare whole months. Choose <strong>Last 6 months</strong> or <strong>All time</strong> to see them.</p>`
        : `<p>Month patterns need at least ${PesaInsights.SETTINGS.minCompleteMonths} complete months of records in this period. There ${pat.completeMonths === 1 ? "is" : "are"} ${pat.completeMonths} so far.</p>`);
    } else {
      parts.push(pat.highMonths.length
        ? `<h4>Months with unusually high spending</h4><ul>${pat.highMonths.map(m => `<li><strong>${escapeHTML(m.label)}</strong>: ${escapeHTML(money(m.expenses))}, ${m.abovePct}% above a typical month (${escapeHTML(money(Math.round(m.median)))})</li>`).join("")}</ul>`
        : `<p>No month stands out: none of the ${pat.completeMonths} complete months was more than ${Math.round((PesaInsights.SETTINGS.highMonthFactor - 1) * 100)}% above a typical month.</p>`);
      parts.push(pat.everyMonth.length
        ? `<h4>Spent on every month</h4><ul>${pat.everyMonth.map(c => `<li><strong>${escapeHTML(c.name)}</strong>: about ${escapeHTML(money(c.monthlyAverage))} a month</li>`).join("")}</ul>`
        : `<p>No category had spending in every one of the ${pat.completeMonths} complete months.</p>`);
    }
    document.getElementById("insight-patterns").innerHTML = parts.join("");
    renderCycleHistory();
  }

  // ---------------------------------------------------------------------------
  // Insights charts (v1.6 Phase 3, D-19). Figures come from src/insights.js and
  // are drawn by src/charts.js; this code only chooses, formats and shows them.
  // Read-only: nothing here saves anything. Each chart is one keyboard control
  // (arrow keys, Home, End), with Previous/Next buttons, a details panel, a
  // table with the same figures, and a polite announcement on selection.
  // ---------------------------------------------------------------------------
  const CHART_PAGE = 25;
  const chartState = {
    trend: { items: [], meta: null, sel: 0, hover: null, period: null, shown: CHART_PAGE, hit: null, width: 0 },
    flow: { items: [], meta: null, sel: 0, hover: null, period: null, shown: CHART_PAGE, hit: null, width: 0 },
    cats: { items: [], meta: null, sel: 0, hover: null, period: null, shown: CHART_PAGE, hit: null, width: 0 }
  };
  const chartEl = (key, part) => document.getElementById(`chart-${key}-${part}`);
  const UNIT_WORD = { day: "day", week: "week", month: "month" };
  const withoutYear = (label) => label.replace(/ \d{4}$/, "");
  const datesText = (b) => b.start === b.end ? formatDate(b.start) : `${formatDate(b.start)} – ${formatDate(b.end)}`;
  const shareText = (x) => (x > 0 && Math.round(x * 100) === 0 ? "less than 1%" : pctText(x));
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  /** Short notes for a bar: period clipping and coverage are separate things (D-19). */
  function bucketNotes(b, unit) {
    const notes = [];
    if (b.state === "no-history") notes.push("no records yet");
    else if (b.state === "partly-covered") notes.push(`records start ${formatDate(b.coveredStart)}`);
    else if (b.state === "no-spending" && unit !== "month") notes.push("no spending recorded");
    if (b.clipped) notes.push(b.soFar ? `partial ${UNIT_WORD[unit]}, so far` : `partial ${UNIT_WORD[unit]}`);
    return notes;
  }
  /** A full sentence explaining a bar's dates and coverage, for the details panel. */
  function bucketSentence(b, unit, range) {
    const w = UNIT_WORD[unit];
    const out = [];
    if (b.clipped && b.soFar) out.push(`This ${w} isn't over yet: the figures run to today.`);
    else if (b.clipped) out.push(`Partial ${w}: only ${datesText(b)} is inside this period, so this isn't a full ${w}'s total.`);
    if (b.state === "no-history") out.push(range.coverage.recordsStart ? `No records yet for these dates: your records start on ${formatDate(range.coverage.recordsStart)}.` : "No records yet for these dates.");
    else if (b.state === "partly-covered") out.push(`Your records start on ${formatDate(b.coveredStart)}, so ${plural(b.coveredDays, "day", "days")} of these ${b.days} are covered.`);
    else if (b.state === "no-spending") out.push(unit === "day" ? "No spending recorded on this day." : "No spending recorded on these dates.");
    return out.join(" ");
  }
  /** Read-only entry list with "Show 25 more". */
  function entryListMarkup(key, found, noun) {
    const c = chartState[key];
    if (!found.count) return "";
    const shown = found.entries.slice(0, c.shown);
    return `<p class="chart-entries-head"><strong>${plural(found.count, noun, noun + "s")}</strong> · total ${escapeHTML(money(found.total))}${found.count > shown.length ? ` · showing the newest ${shown.length}` : ""}</p>` +
      `<div class="activity-list chart-entries">${shown.map(t => transactionMarkup(t, false)).join("")}</div>` +
      (found.count > shown.length ? `<button class="button button-secondary chart-more" type="button" data-chart-more="${key}">Show ${Math.min(CHART_PAGE, found.count - shown.length)} more</button>` : "");
  }
  let swatchSeq = 0; // each hatch pattern gets its own ID (several legends can be on the page at once)
  function swatch(kind, color) {
    const hatchId = `sw-hatch-${++swatchSeq}`;
    const fill = { spending: PesaCharts.COLORS.spending, income: PesaCharts.COLORS.income }[kind] || color;
    const shapes = {
      "partly-covered": `<rect x="1" y="1" width="14" height="12" rx="2" fill="${PesaCharts.COLORS.spendingTint}" stroke="${PesaCharts.COLORS.spending}" stroke-dasharray="3 2"/>`,
      "no-spending": `<rect x="1" y="10" width="14" height="3" rx="1" fill="${PesaCharts.COLORS.axisText}"/>`,
      "no-history": `<defs><pattern id="${hatchId}" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke="${PesaCharts.COLORS.hatch}" stroke-width="2"/></pattern></defs><rect x="1" y="1" width="14" height="12" fill="url(#${hatchId})" stroke="${PesaCharts.COLORS.hatch}"/>`
    };
    return `<svg class="chart-swatch" width="16" height="14" aria-hidden="true" focusable="false">${shapes[kind] || `<rect x="1" y="1" width="14" height="12" rx="2" fill="${fill}"/>`}</svg>`;
  }
  const KEY_TEXT = { spending: "Spending", "partly-covered": "Partly covered: your records start inside", "no-spending": "No spending recorded", "no-history": "No records yet" };

  function renderCharts(periodId, today) {
    const trend = PesaInsights.spendingTrend(state, periodId, today);
    const flow = PesaInsights.incomeExpenseMonths(state, periodId, today);
    const cats = PesaInsights.categorySegments(state, periodId, today);
    setChartData("trend", trend.buckets, { ...trend, today }, periodId, trend.buckets.length - 1);
    setChartData("flow", flow.months, { ...flow, today }, periodId, flow.months.length - 1);
    setChartData("cats", cats.segments, { ...cats, today }, periodId, 0);
  }
  function setChartData(key, items, meta, period, defaultIndex) {
    const c = chartState[key];
    if (c.period !== period || c.sel >= items.length || c.sel < 0) { c.sel = Math.max(0, defaultIndex); c.shown = CHART_PAGE; }
    c.items = items; c.meta = meta; c.period = period; c.hover = null;
    renderChartCard(key);
  }

  function renderChartCard(key) {
    const c = chartState[key], m = c.meta;
    const hasData = key === "cats" ? m.total > 0 : m.hasHistory;
    const emptyText = !m.hasHistory && key !== "cats"
      ? "No recorded history in this period yet, so there's nothing to chart."
      : key === "cats" ? (m.range.coverage.empty ? "No recorded history in this period yet, so there's nothing to chart." : "No spending recorded in this period.") : "";
    chartEl(key, "empty").textContent = hasData ? "" : emptyText;
    chartEl(key, "empty").classList.toggle("hidden", hasData);
    chartEl(key, "body").classList.toggle("hidden", !hasData);
    chartEl(key, "summary").classList.toggle("hidden", !hasData);
    if (!hasData) { chartEl(key, "area").innerHTML = ""; return; }
    const unit = key === "trend" ? m.unit : "month";
    // Summary sentence (also the chart's accessible description).
    let summary = "";
    if (key === "trend") {
      const top = c.items.reduce((best, b) => (b.expenses > (best ? best.expenses : 0) ? b : best), null);
      summary = m.total > 0
        ? `${money(m.total)} spent, shown by ${UNIT_WORD[unit]}${c.items.length === 1 ? "" : ` across ${plural(c.items.length, UNIT_WORD[unit], UNIT_WORD[unit] + "s")}`}. Highest: ${datesText(top)}, ${money(top.expenses)}.`
        : "No spending recorded in this period.";
    } else if (key === "flow") {
      summary = `${money(m.income)} came in and ${money(m.expenses)} was spent across ${plural(c.items.length, "month", "months")}${c.items.some(x => x.clipped) ? "; partial months are marked" : ""}.`;
    } else {
      const top = c.items[0];
      summary = `${top.name} is the largest: ${shareText(top.share)} of ${money(m.total)} spent.` +
        (m.grouped ? ` The ${c.items.at(-1).members.length} smallest categories are grouped as ${c.items.at(-1).name}.` : "");
    }
    chartEl(key, "summary").textContent = summary;
    const stepWord = key === "cats" ? "category" : UNIT_WORD[unit];
    chartEl(key, "prev").setAttribute("aria-label", `Previous ${stepWord}`);
    chartEl(key, "next").setAttribute("aria-label", `Next ${stepWord}`);
    chartEl(key, "help").textContent = key === "cats"
      ? "Use the left and right arrow keys, Home and End to choose a category, or use the category buttons."
      : `Use the left and right arrow keys, Home and End to choose a ${UNIT_WORD[unit]}.`;
    // Key (legend): only what is on the chart.
    const states = [...new Set(c.items.map(b => b.state))];
    let keyItems = [];
    if (key === "trend") keyItems = ["spending", "partly-covered", "no-spending", "no-history"].filter(s => s === "spending" || states.includes(s)).map(s => [s, KEY_TEXT[s]]);
    if (key === "flow") keyItems = [["income", "Income"], ["spending", "Expenses"]].concat(["partly-covered", "no-history"].filter(s => states.includes(s)).map(s => [s, KEY_TEXT[s]]));
    chartEl(key, "key").innerHTML = keyItems.map(([k, text]) => `<li>${swatch(k)}<span>${escapeHTML(text)}</span></li>`).join("");
    chartEl(key, "key").classList.toggle("hidden", !keyItems.length);
    if (key === "cats") renderCategoryLegend();
    renderChartTable(key);
    renderChartDetail(key);
    drawChart(key, true);
  }

  function renderCategoryLegend() {
    const c = chartState.cats;
    document.getElementById("chart-cats-legend").innerHTML = c.items.map((s, i) =>
      `<button class="chart-legend-item" type="button" data-chart-pick="cats:${i}" aria-pressed="${i === c.sel}">` +
      `${swatch("category", PesaCharts.COLORS.categories[i % PesaCharts.COLORS.categories.length])}` +
      `<span class="chart-legend-name">${escapeHTML(s.name)}</span><span class="chart-legend-value">${escapeHTML(money(s.amount))} · ${shareText(s.share)}</span></button>`).join("");
  }

  function renderChartTable(key) {
    const c = chartState[key], m = c.meta;
    const unit = key === "trend" ? m.unit : "month";
    let head, rows, caption;
    if (key === "trend") {
      caption = `Spending by ${UNIT_WORD[unit]}`;
      head = [unit === "day" ? "Day" : unit === "week" ? "Week" : "Month", "Spending"];
      rows = c.items.map(b => [b.label, bucketNotes(b, unit), [money(b.expenses)]]);
    } else if (key === "flow") {
      caption = "Income and expenses by month";
      head = ["Month", "Income", "Expenses", "Difference"];
      rows = c.items.map(b => [b.label, bucketNotes(b, "month"), [money(b.income), money(b.expenses), `${b.difference > 0 ? "+" : ""}${money(b.difference)}`]]);
    } else {
      caption = "Spending by category";
      head = ["Category", "Spending", "Share", "Entries"];
      rows = [];
      for (const s of c.items) {
        rows.push([s.name, [], [money(s.amount), shareText(s.share), String(s.count)]]);
        if (s.group) for (const mem of s.members) rows.push([`– ${mem.name}`, ["in " + s.name], [money(mem.amount), shareText(mem.share), String(mem.count)]]);
      }
    }
    chartEl(key, "table").innerHTML =
      `<table class="history-table chart-data-table" role="table"><caption class="sr-only">${escapeHTML(caption)}</caption>` +
      `<thead role="rowgroup"><tr role="row">${head.map(h => `<th scope="col" role="columnheader">${escapeHTML(h)}</th>`).join("")}</tr></thead><tbody role="rowgroup">` +
      rows.map(([label, notes, vals]) => `<tr role="row"><th scope="row" role="rowheader">${escapeHTML(label)}${notes.length ? `<small>(${escapeHTML(notes.join("; "))})</small>` : ""}</th>` +
        vals.map((v, i) => `<td role="cell" data-label="${escapeHTML(head[i + 1])}">${escapeHTML(v)}</td>`).join("") + `</tr>`).join("") +
      `</tbody></table>`;
  }

  function renderChartDetail(key) {
    const c = chartState[key], m = c.meta;
    const item = c.items[c.sel];
    if (!item) { chartEl(key, "detail").innerHTML = ""; return; }
    let html = "";
    if (key === "trend") {
      const found = PesaInsights.entriesFor(state, { start: item.start, end: item.end, types: ["expense"] }, m.today);
      const sentence = bucketSentence(item, m.unit, m.range);
      html = `<h4>${escapeHTML(datesText(item))}${item.soFar ? " (so far)" : ""}</h4>` +
        `<p class="chart-detail-figure">${escapeHTML(money(item.expenses))} <small>spent</small></p>` +
        (sentence ? `<p class="chart-detail-note">${escapeHTML(sentence)}</p>` : "") +
        entryListMarkup(key, found, "expense");
    } else if (key === "flow") {
      const sentence = bucketSentence(item, "month", m.range);
      const diff = item.difference;
      html = `<h4>${escapeHTML(datesText(item))}${item.clipped ? (item.soFar ? " (partial month, so far)" : " (partial month)") : ""}</h4>` +
        `<dl class="chart-detail-pairs"><div><dt>${swatch("income")} Income</dt><dd>${escapeHTML(money(item.income))}</dd></div>` +
        `<div><dt>${swatch("spending")} Expenses</dt><dd>${escapeHTML(money(item.expenses))}</dd></div>` +
        `<div><dt>Difference</dt><dd>${diff > 0 ? `${escapeHTML(money(diff))} more came in than was spent` : diff < 0 ? `spending was ${escapeHTML(money(-diff))} more than income` : "the same"}</dd></div></dl>` +
        (sentence ? `<p class="chart-detail-note">${escapeHTML(sentence)}</p>` : "") +
        `<p class="chart-detail-note">Savings transfers and withdrawals aren't income or spending, so they're not included.</p>`;
    } else {
      const found = PesaInsights.entriesFor(state, { start: m.range.start, end: m.range.end, categoryKeys: item.members.map(x => x.key) }, m.today);
      html = `<h4>${escapeHTML(item.name)}</h4>` +
        `<p class="chart-detail-figure">${escapeHTML(money(item.amount))} <small>${shareText(item.share)} of spending in this period</small></p>` +
        (item.group ? `<p class="chart-detail-note">Includes ${plural(item.members.length, "category", "categories")}:</p><ul class="chart-members">${item.members.map(x => `<li><strong>${escapeHTML(x.name)}</strong> ${escapeHTML(money(x.amount))} · ${shareText(x.share)} · ${plural(x.count, "entry", "entries")}</li>`).join("")}</ul>` : "") +
        entryListMarkup(key, found, "expense");
    }
    chartEl(key, "detail").innerHTML = html;
    chartEl(key, "prev").disabled = c.sel <= 0;
    chartEl(key, "next").disabled = c.sel >= c.items.length - 1;
  }

  /** Draws the SVG at the chart area's real width (redrawn on resize). Never at zero width. */
  function drawChart(key, force) {
    const c = chartState[key], m = c.meta;
    const area = chartEl(key, "area");
    if (!m || !c.items.length || chartEl(key, "body").classList.contains("hidden")) return;
    const width = Math.floor(area.clientWidth);
    if (!width) return; // Insights isn't visible yet; the resize observer draws it when it is.
    if (!force && width === c.width) return;
    c.width = width;
    const err = chartEl(key, "error");
    try {
      let r;
      if (key === "trend") {
        r = PesaCharts.trendChart({ id: "chart-trend", width, code: state.currency, selected: c.sel, hover: c.hover,
          bars: c.items.map((b, i) => ({ value: b.expenses, state: b.state,
            tick: m.unit === "month" && b.clipped ? withoutYear(b.label) : b.tick,
            subTick: m.unit === "month" && (i === 0 || b.start.slice(5, 7) === "01") ? b.year : "",
            title: `${b.label}: ${money(b.expenses)} spent${bucketNotes(b, m.unit).length ? ` (${bucketNotes(b, m.unit).join("; ")})` : ""}` })) });
      } else if (key === "flow") {
        r = PesaCharts.pairedChart({ id: "chart-flow", width, code: state.currency, selected: c.sel, hover: c.hover,
          months: c.items.map((b, i) => ({ income: b.income, expenses: b.expenses, state: b.state,
            tick: b.clipped ? withoutYear(b.label) : b.tick, subTick: i === 0 || b.start.slice(5, 7) === "01" ? b.year : "",
            title: `${b.label}: income ${money(b.income)}, expenses ${money(b.expenses)}${bucketNotes(b, "month").length ? ` (${bucketNotes(b, "month").join("; ")})` : ""}` })) });
      } else {
        r = PesaCharts.donutChart({ id: "chart-cats", size: Math.min(width, 260), selected: c.sel,
          segments: c.items.map(s => ({ value: s.amount, title: `${s.name}: ${money(s.amount)} (${shareText(s.share)})` })),
          centre: { value: money(m.total), label: "spent" } });
      }
      area.innerHTML = r.svg;
      c.hit = r.hit || null;
      err.classList.add("hidden");
      area.classList.remove("hidden");
    } catch (e) {
      // Never a blank card: say so, and keep the table (built separately) available.
      area.innerHTML = "";
      area.classList.add("hidden");
      err.textContent = "This chart couldn't be drawn. The same figures are in the table below.";
      err.classList.remove("hidden");
      const details = chartEl(key, "table").closest("details");
      if (details) details.open = true;
      console.warn("PesaOtas: chart not drawn", key, e && e.message);
    }
  }

  function selectChart(key, index, announce) {
    const c = chartState[key];
    if (!c.items.length) return;
    const i = Math.max(0, Math.min(c.items.length - 1, index));
    if (i === c.sel && !announce) return;
    c.sel = i; c.shown = CHART_PAGE;
    renderChartDetail(key);
    if (key === "cats") renderCategoryLegend();
    drawChart(key, true);
    if (announce) {
      const it = c.items[i];
      document.getElementById("chart-announcer").textContent = key === "trend"
        ? `${datesText(it)}${it.soFar ? " so far" : ""}: ${money(it.expenses)} spent.`
        : key === "flow" ? `${datesText(it)}: income ${money(it.income)}, expenses ${money(it.expenses)}.`
        : `${it.name}: ${money(it.amount)}, ${shareText(it.share)}.`;
    }
  }

  ["trend", "flow", "cats"].forEach(key => {
    const area = chartEl(key, "area");
    area.addEventListener("keydown", e => {
      const c = chartState[key];
      const moves = { ArrowLeft: c.sel - 1, ArrowDown: c.sel - 1, ArrowRight: c.sel + 1, ArrowUp: c.sel + 1, Home: 0, End: c.items.length - 1 };
      if (!(e.key in moves)) return;
      e.preventDefault();
      selectChart(key, moves[e.key], true);
    });
    area.addEventListener("click", e => {
      const c = chartState[key];
      let i = -1;
      if (key === "cats") { const g = e.target.closest("[data-index]"); i = g ? Number(g.dataset.index) : -1; }
      else { const svg = area.querySelector("svg"); if (svg) i = PesaCharts.indexAt(c.hit, e.clientX - svg.getBoundingClientRect().left); }
      if (i >= 0) selectChart(key, i, true);
    });
    if (key !== "cats") {
      area.addEventListener("pointermove", e => {
        if (e.pointerType !== "mouse") return;
        const c = chartState[key], svg = area.querySelector("svg");
        if (!svg) return;
        const i = PesaCharts.indexAt(c.hit, e.clientX - svg.getBoundingClientRect().left);
        const h = i >= 0 ? i : null;
        if (h !== c.hover) { c.hover = h; drawChart(key, true); }
      });
      area.addEventListener("pointerleave", () => { const c = chartState[key]; if (c.hover !== null) { c.hover = null; drawChart(key, true); } });
    }
    if (typeof ResizeObserver === "function") new ResizeObserver(() => drawChart(key, false)).observe(area);
  });
  document.getElementById("insight-charts").addEventListener("click", e => {
    const step = e.target.closest("[data-chart-step]");
    if (step) { const [key, d] = step.dataset.chartStep.split(":"); selectChart(key, chartState[key].sel + Number(d), true); return; }
    const pick = e.target.closest("[data-chart-pick]");
    if (pick) { const [key, i] = pick.dataset.chartPick.split(":"); selectChart(key, Number(i), true); return; }
    const more = e.target.closest("[data-chart-more]");
    if (more) {
      const key = more.dataset.chartMore;
      chartState[key].shown += CHART_PAGE;
      renderChartDetail(key);
      const next = chartEl(key, "detail").querySelectorAll(".chart-entries .activity-row")[chartState[key].shown - CHART_PAGE];
      if (next) { next.setAttribute("tabindex", "-1"); next.focus({ preventScroll: false }); }
    }
  });

  // ---------------------------------------------------------------------------
  // Expense Detective (v1.6 Phase 4, D-20). Rules come from src/detective.js;
  // this code only shows them. Read-only, except the review buttons, which change
  // only meta.alertReviews through the normal verified, stale-tab-checked save.
  // ---------------------------------------------------------------------------
  const DETECTIVE_PAGE = 25;
  let detectiveFilter = "toReview";
  let detectiveResult = null;
  const detectiveShown = new Map();   // alert ID → entries shown
  const detectiveOpen = new Set();    // alert IDs whose entry list is open
  const DETECTIVE_ICONS = { "unusual-bill": "◆", "large-expense": "▲", "small-purchases": "∑", "uncategorised": "?", "spending-pace": "◷" };
  const FILTER_LABELS = { toReview: "To review", reviewed: "Reviewed", dismissed: "Dismissed" };
  const PACE_STATUS = { ahead: "Ahead of pace", "on-pace": "On pace", over: "Over allocation", "nothing-spent": "Nothing spent yet" };
  // "On pace" is only said when it's true: too early in the cycle, or ahead by less than the alert amount, is said as such.
  const paceLabel = (x, p) => x.status !== "on-pace" ? PACE_STATUS[x.status]
    : p.tooEarly ? "Too early to judge"
    : x.gapPoints >= PesaDetective.SETTINGS.pace.minGapPct ? "Ahead, small amount so far" : PACE_STATUS[x.status];
  // Element IDs from a hash of the alert ID: always valid and never shared by two alerts.
  const detId = (prefix, a) => `${prefix}-${PesaDetective.fnv1a64(a.id)}`;

  function detectiveEntries(a) {
    const byId = new Map(state.transactions.map(t => [t.id, t]));
    const list = a.entryIds.map(id => byId.get(id)).filter(Boolean);
    if (!list.length) return "";
    const shown = list.slice(0, detectiveShown.get(a.id) || DETECTIVE_PAGE);
    const total = list.reduce((sum, t) => sum + t.amount, 0);
    const editable = a.rule === "uncategorised";
    const rows = shown.map(t => editable
      ? `<div class="detective-entry">${transactionMarkup(t, false)}<button class="button button-secondary detective-edit" type="button" data-detective-edit="${escapeHTML(t.id)}" aria-label="Edit: ${escapeHTML(describeTransaction(t).title)}, ${escapeHTML(money(t.amount))}, ${escapeHTML(formatDate(t.date))}"${canSave ? "" : " disabled"}>Edit</button></div>`
      : transactionMarkup(t, false)).join("");
    const more = list.length > shown.length
      ? `<button class="button button-secondary chart-more" type="button" data-detective-more="${escapeHTML(a.id)}">Show ${Math.min(DETECTIVE_PAGE, list.length - shown.length)} more</button>` : "";
    const head = `${plural(list.length, "entry", "entries")} · total ${money(total)}${list.length > shown.length ? ` · showing the newest ${shown.length}` : ""}`;
    if (list.length === 1 && !editable) return `<div class="activity-list detective-entries">${rows}</div>`;
    const sid = detId("det-ent", a);
    return `<details class="detective-more-details" data-entries-for="${escapeHTML(a.id)}" aria-labelledby="${sid}"${detectiveOpen.has(a.id) ? " open" : ""}><summary id="${sid}">Show the ${plural(list.length, "entry", "entries")}${editable ? " (with Edit)" : ""}</summary>` +
      `<p class="chart-entries-head">${escapeHTML(head)}</p><div class="activity-list detective-entries">${rows}</div>${more}</details>`;
  }

  function detectiveCard(a) {
    const st = a.review ? a.review.state : "observation";
    const rec = a.review ? a.review.record : null;
    const when = rec ? formatWhen(rec.actedAt) : "";
    const note = st === "changed" ? `Changed since you ${rec.status === "dismissed" ? "dismissed" : "reviewed"} it on ${when}.`
      : st === "unknown-status" ? `Marked “${rec.status}” by a newer version of PesaOtas. It's kept unchanged until you choose an action here.`
      : st === "reviewed" ? `Reviewed on ${when}.` : st === "dismissed" ? `Dismissed on ${when}.` : "";
    const byId = new Map(state.transactions.map(t => [t.id, t]));
    const history = (a.historyIds || []).map(id => byId.get(id)).filter(Boolean);
    const extra = [];
    if (a.rule === "small-purchases") {
      if (a.top && a.top.length) extra.push(`Mostly: ${a.top.map(t => `${t.name} ${money(t.total)} (${t.count})`).join(", ")}.`);
      if (a.count) extra.push(`Average small purchase: ${money(a.average)}.`);
      if (a.previous) extra.push(`The ${F_days(a.previous)} before: ${plural(a.previous.count, "purchase", "purchases")}, ${money(a.previous.total)}.`);
    }
    const wid = detId("det-why", a);
    const why = `<details class="detective-why" aria-labelledby="${wid}"><summary id="${wid}">Why ${a.kind === "alert" ? "was this flagged" : "is this shown"}?</summary><ul>${a.why.map(w => `<li>${escapeHTML(w)}</li>`).join("")}</ul>` +
      (history.length ? `<p class="chart-entries-head">Earlier entries used</p><div class="activity-list">${history.map(t => transactionMarkup(t, false)).join("")}</div>` : "") + `</details>`;
    let actions = "";
    if (a.kind === "alert") {
      const can = canSave && a.reviewable;
      const btn = (action, label) => `<button class="button button-secondary" type="button" data-detective-action="${action}" data-alert-id="${escapeHTML(a.id)}" aria-label="${escapeHTML(`${label}: ${a.title}`)}"${can ? "" : " disabled"}>${label}</button>`;
      const set = st === "reviewed" ? [btn("dismissed", "Dismiss"), btn("move-back", "Move back to To review")]
        : st === "dismissed" ? [btn("reviewed", "Mark as reviewed"), btn("move-back", "Move back to To review")]
        : [btn("reviewed", "Mark as reviewed"), btn("dismissed", "Dismiss")];
      actions = a.reviewable ? `<div class="detective-actions">${set.join("")}</div>` : `<p class="detective-note">${escapeHTML(a.notReviewableReason || "")}</p>`;
    }
    return `<article class="detective-card detective-${escapeHTML(a.kind)}" tabindex="-1" data-alert-id="${escapeHTML(a.id)}" aria-labelledby="${detId("det", a)}">` +
      `<p class="detective-tag"><span aria-hidden="true">${DETECTIVE_ICONS[a.rule] || "•"}</span> ${escapeHTML(a.label)}</p>` +
      `<h4 id="${detId("det", a)}">${escapeHTML(a.title)}</h4>` +
      `<p class="detective-figure">${escapeHTML(a.figure)}</p>` +
      `<p class="detective-text">${escapeHTML(a.text)}</p>` +
      extra.map(x => `<p class="detective-note">${escapeHTML(x)}</p>`).join("") +
      (note ? `<p class="detective-status${st === "changed" || st === "unknown-status" ? " detective-status-changed" : ""}">${escapeHTML(note)}</p>` : "") +
      why + detectiveEntries(a) + actions + `</article>`;
  }
  const F_days = (p) => `${PesaFinance.daysBetween(p.start, p.end) + 1} days`;

  function renderDetective(focus) {
    const r = PesaDetective.run(state, todayISO());
    detectiveResult = r;
    const S = r.windows.summary;
    const where = S.kind === "cycle" ? "This pay cycle" : "This month";
    document.getElementById("detective-window").textContent =
      `${where}: ${datesText(S)}. Uses your ${S.kind === "cycle" ? "pay cycle" : "calendar month (no pay cycle is set)"}, not the period chosen above.` +
      (r.futureCount ? ` ${plural(r.futureCount, "entry", "entries")} dated after today ${r.futureCount === 1 ? "isn't" : "aren't"} included.` : "");
    const blocked = document.getElementById("detective-blocked");
    blocked.textContent = canSave ? "" : `Review buttons are unavailable. ${BLOCKED_MESSAGES[saveBlock] || BLOCKED_MESSAGES.storage}`;
    blocked.classList.toggle("hidden", canSave);
    for (const k of Object.keys(FILTER_LABELS)) {
      const b = document.getElementById(`detective-filter-${k}`);
      b.textContent = `${FILTER_LABELS[k]} (${r.groups[k].length})`;
      b.setAttribute("aria-pressed", String(detectiveFilter === k));
    }
    const items = r.groups[detectiveFilter];
    const whereLower = S.kind === "cycle" ? "this pay cycle" : "this month";
    document.getElementById("detective-list").innerHTML = items.length ? items.map(detectiveCard).join("")
      : `<p class="empty-state">${detectiveFilter === "toReview" ? `Nothing to review ${whereLower}. “What Expense Detective checked” below shows what was looked at.`
        : detectiveFilter === "reviewed" ? "No reviewed alerts." : "No dismissed alerts."}</p>`;
    document.getElementById("detective-observations").innerHTML = detectiveFilter === "toReview" ? r.observations.map(detectiveCard).join("") : "";
    // Spending pace
    const p = r.pace;
    let pace;
    if (!p.available) {
      pace = `<p class="muted">${escapeHTML(p.reason === "payday-passed" ? "Payday has arrived; start your new pay cycle to see your spending pace." : "Set your pay cycle in Settings to see your spending pace.")}</p>`;
    } else {
      const cols = ["Allocation used", "Pay cycle gone", "Status"];
      pace = `<p class="muted">${escapeHTML(`${p.elapsedDays} of ${p.lengthDays} days of the pay cycle gone (${datesText({ start: p.start, end: PesaFinance.addDays(p.payday, -1) })}). Compares the share of each allocation used with the share of the pay cycle gone; not a forecast.`)}</p>` +
        (p.tooEarly ? `<p class="detective-note">Too early in the pay cycle to judge pace (it needs ${PesaDetective.SETTINGS.pace.minDays} days).</p>` : "") +
        (p.rows.length ? `<div class="table-wrap"><table class="history-table detective-pace-table" role="table"><caption class="sr-only">Spending pace by category</caption>` +
          `<thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Category</th>${cols.map(c => `<th scope="col" role="columnheader">${c}</th>`).join("")}</tr></thead><tbody role="rowgroup">` +
          p.rows.map(x => `<tr role="row"><th scope="row" role="rowheader">${escapeHTML(x.name)}<small>${escapeHTML(`${money(x.spent)} of ${money(x.budget)}`)}</small></th>` +
            `<td role="cell" data-label="${cols[0]}">${x.usedPct}%</td><td role="cell" data-label="${cols[1]}">${x.timePct}%</td><td role="cell" data-label="${cols[2]}">${escapeHTML(paceLabel(x, p))}</td></tr>`).join("") +
          `</tbody></table></div>` : `<p class="muted">No Essential, Flexible, Personal, Event or Other categories with an allocation.</p>`) +
        (p.overall ? `<p class="detective-note">${escapeHTML(`Overall: ${money(p.overall.spent)} of ${money(p.overall.budget)} (${p.overall.usedPct}%) used, with ${p.overall.timePct}% of the pay cycle gone. Bills and Savings categories aren't included.`)}</p>` : "") +
        (p.rows.some(x => x.status === "over") ? `<p class="detective-note">“Over allocation” is shown for information; the Overview already warns about it.</p>` : "") +
        (p.futureNote ? `<p class="detective-note">${escapeHTML(p.futureNote)}</p>` : "");
    }
    document.getElementById("detective-pace").innerHTML = pace;
    // What was checked
    const label = { ok: "Checked", insufficient: "Not enough history", unavailable: "Not available" };
    document.getElementById("detective-checks").innerHTML = `<ul class="detective-check-list">${r.checks.map(c => `<li><strong>${label[c.kind]}:</strong> ${escapeHTML(c.text)}</li>`).join("")}` +
      (r.keptRecords ? `<li><strong>Kept:</strong> ${plural(r.keptRecords, "review record", "review records")} for alerts not shown now. Nothing is deleted automatically.</li>` : "") + `</ul>`;
    if (focus) {
      const cards = [...document.querySelectorAll("#detective-list .detective-card")];
      (cards[Math.min(focus.index, cards.length - 1)] || document.getElementById("detective-list")).focus({ preventScroll: false });
    }
  }

  document.getElementById("detective").addEventListener("toggle", e => {
    const d = e.target;
    if (!d.matches || !d.matches("details[data-entries-for]")) return;
    if (d.open) detectiveOpen.add(d.dataset.entriesFor); else detectiveOpen.delete(d.dataset.entriesFor);
  }, true);
  document.getElementById("detective").addEventListener("click", e => {
    const f = e.target.closest("[data-detective-filter]");
    if (f) { detectiveFilter = f.dataset.detectiveFilter; renderDetective(); return; }
    const more = e.target.closest("[data-detective-more]");
    if (more) {
      const id = more.dataset.detectiveMore;
      detectiveShown.set(id, (detectiveShown.get(id) || DETECTIVE_PAGE) + DETECTIVE_PAGE);
      detectiveOpen.add(id);
      renderDetective();
      return;
    }
    const edit = e.target.closest("[data-detective-edit]");
    if (edit) { startEdit(edit.dataset.detectiveEdit); return; }
    const act = e.target.closest("[data-detective-action]");
    if (!act || !detectiveResult) return;
    const a = detectiveResult.alerts.find(x => x.id === act.dataset.alertId);
    if (!a) return;
    const cards = [...document.querySelectorAll("#detective-list .detective-card")];
    const index = Math.max(0, cards.findIndex(c => c.dataset.alertId === a.id));
    const action = act.dataset.detectiveAction;
    try {
      state = action === "move-back" ? PesaDetective.clearReview(state, a.id) : PesaDetective.applyReview(state, a, action, new Date());
    } catch {
      return showToast("This alert can't be reviewed.");
    }
    if (!saveState()) { renderDetective(); return; }
    const done = action === "move-back" ? "Moved back to To review" : action === "reviewed" ? "Marked as reviewed" : "Dismissed";
    document.getElementById("detective-announcer").textContent = `${done}: ${a.title}.`;
    showToast(`${done}.`);
    renderDetective({ index });
  });

  // ---------------------------------------------------------------------------
  // Unreadable alert review records (D-20): a separate decision, never presented
  // as damage to the budget. The verified copy of the original is made by
  // storage before this is shown; continuing never changes or deletes it.
  // ---------------------------------------------------------------------------
  function openReviewRecordsDialog() {
    if (boot.status !== "review-records-invalid" || saveBlock !== "reviews") return;
    const issues = boot.report.reviewIssues;
    document.getElementById("reviews-intro").innerHTML =
      `<p><strong>Your budget and transactions are fine.</strong> ${plural(issues.length, "alert review record", "alert review records")} (marks saying an Expense Detective alert was reviewed or dismissed) couldn't be read:</p>`;
    document.getElementById("reviews-content").innerHTML =
      `<ul class="issue-plain">${issues.slice(0, 40).map(x => `<li>${escapeHTML(x.text)}</li>`).join("")}${issues.length > 40 ? `<li>…and ${issues.length - 40} more</li>` : ""}</ul>` +
      (boot.copyVerified
        ? `<p class="muted">A copy of your data exactly as it was is kept in Settings → Data safety. Continuing saves your budget with the ${plural(boot.state.meta.alertReviews ? boot.state.meta.alertReviews.length : 0, "record", "records")} that can be read; it doesn't change or delete that copy. The affected alerts will show as new.</p>`
        : reviewCopyListDamaged()
          ? `<p class="replace-note"><strong>PesaOtas can't save a safety copy here, because the list that holds these copies on this device is itself damaged</strong> (it's left untouched). Download the original data and keep the file. You can then use Settings → Restore from backup with that file: its preview lists the records that will be left out, and nothing changes until you confirm.</p>`
          : `<p class="replace-note"><strong>PesaOtas couldn't save a safety copy of your data, so you can't continue yet.</strong> Free up browser storage, then try again, or download the original data.</p>`) +
      `<p class="muted">Until you decide, PesaOtas shows your budget but saves nothing.</p>`;
    document.getElementById("reviews-continue").classList.toggle("hidden", !boot.copyVerified);
    document.getElementById("reviews-retry").classList.toggle("hidden", !!boot.copyVerified);
    openDialog(document.getElementById("reviews-dialog"));
  }
  const reviewCopyListDamaged = () => !!store && PesaStorage.recoveryInventory(store).damagedLists.includes(PesaStorage.KEYS.reviewRecords);
  const reviewsError = (msg) => { const el = document.getElementById("reviews-error"); el.textContent = msg; el.classList.toggle("hidden", !msg); };
  document.getElementById("reviews-continue").addEventListener("click", () => {
    if (!boot.copyVerified || saveBlock !== "reviews") return;
    const res = PesaStorage.continueWithoutInvalidReviews(store, boot.state, boot.raw);
    if (res.ok) {
      state = res.state; lastSaved = clone(state); storedRaw = res.raw; canSave = true; saveBlock = null; noticeKind = null;
      reviewsError("");
      closeDialog(document.getElementById("reviews-dialog"));
      renderAll(); renderNotice(); renderDataSafety();
      showToast("Saved without the unreadable alert review records. The original is kept in Data safety.");
      return;
    }
    if (res.reason === "copy-missing") {
      boot.copyVerified = false;
      openReviewRecordsDialog();
      return reviewsError("The safety copy of your original data is no longer there, so nothing was changed. Try again to save a new copy first.");
    }
    if (res.reason === "changed-elsewhere") {
      closeDialog(document.getElementById("reviews-dialog"));
      markStale("tab");
      return showToast(BLOCKED_MESSAGES.stale);
    }
    reviewsError("Nothing was changed: the browser couldn't save. Free up browser storage, then try again.");
  });
  document.getElementById("reviews-retry").addEventListener("click", () => {
    boot.copyVerified = PesaStorage.keepReviewRecordsCopy(store, new Date(), boot.raw);
    reviewsError(boot.copyVerified ? "" : reviewCopyListDamaged()
      ? "The safety copy still couldn't be saved, because the list for these copies is damaged. Download the original data instead."
      : "The safety copy still couldn't be saved. Free up browser storage, or download the original data.");
    openReviewRecordsDialog();
    renderNotice(); renderDataSafety();
  });
  document.getElementById("reviews-download").addEventListener("click", () => {
    downloadText(boot.raw, `pesaotas-original-data-${todayISO()}.json`);
    showToast("Original data downloaded, exactly as it was stored.");
  });
  document.getElementById("reviews-later").addEventListener("click", () => { closeDialog(document.getElementById("reviews-dialog")); renderNotice(); });

  // Closed pay cycles, worked out live from transactions and the stored dates/allocations.
  function renderCycleHistory() {
    const el = document.getElementById("cycle-history");
    const cycles = [...(state.cycles || [])].reverse();
    if (!cycles.length) {
      el.innerHTML = `<p class="muted">Your closed pay cycles will appear here after you start your first new cycle.</p>`;
      return;
    }
    el.innerHTML = cycles.map(c => {
      const sum = PesaFinance.cycleSummary(state, c.start, c.end, c.budgets);
      const last = PesaFinance.addDays(c.end, -1);
      const range = c.start ? `${formatDate(c.start)} – ${formatDate(last)} (${sum.lengthDays} days)` : `Up to ${formatDate(last)}`;
      return `<div class="cycle-row">
        <strong>${escapeHTML(range)}</strong>
        <dl class="cycle-figures">
          <div><dt>Income</dt><dd>${money(sum.earned)}</dd></div>
          <div><dt>Spending</dt><dd>${money(sum.spent)}</dd></div>
          <div><dt>Saved (net)</dt><dd>${money(sum.savedNet)}</dd></div>
          <div><dt>Cash at the end</dt><dd>${money(sum.closingCash)}</dd></div>
        </dl>
      </div>`;
    }).join("");
  }

  // ---------------------------------------------------------------------------
  // Entry form: expense · income · save · withdraw
  // ---------------------------------------------------------------------------
  const currentType = () => document.querySelector('input[name="transaction-type"]:checked').value;
  function populateCategorySelect() {
    const type = currentType();
    const select = document.getElementById("tx-category");
    const old = select.value;
    if (type === "income") {
      select.innerHTML = PesaData.INCOME_SOURCES.map(s => `<option value="${s.id}">${escapeHTML(s.name)}</option>`).join("");
    } else {
      select.innerHTML = state.categories.map(c=>`<option value="${escapeHTML(c.id)}">${escapeHTML(c.name)}</option>`).join("") + `<option value="other">Other / uncategorised</option>`;
    }
    if ([...select.options].some(o=>o.value===old)) select.value = old;
    const dest = document.getElementById("tx-destination");
    const oldDest = dest.value;
    const t = totals();
    dest.innerHTML = activeDestinations().map(d => `<option value="${escapeHTML(d.id)}">${escapeHTML(d.name)} (${money(t.destinationBalances[d.id] || 0)})</option>`).join("");
    if ([...dest.options].some(o=>o.value===oldDest)) dest.value = oldDest;
    updateTxForm();
  }
  function updateTxForm() {
    const type = currentType();
    const savings = isSavingsType(type);
    document.getElementById("tx-category-field").classList.toggle("hidden", savings);
    document.getElementById("tx-destination-field").classList.toggle("hidden", !savings);
    document.getElementById("tx-category-label").textContent = type === "income" ? "Income source" : "Category";
    document.getElementById("tx-destination-label").textContent = type === "savings_withdrawal" ? "Withdraw from" : "Save to";
    const helper = document.getElementById("tx-helper");
    const t = totals();
    const destId = document.getElementById("tx-destination").value;
    if (type === "savings_transfer") {
      helper.textContent = `Spending cash available: ${money(t.cash)}. Moving money to savings is not spending.`;
    } else if (type === "savings_withdrawal") {
      helper.textContent = destId ? withdrawalHint(destId, entryDate()) : "";
    } else {
      helper.textContent = "";
    }
    helper.classList.toggle("hidden", !helper.textContent);
  }
  document.querySelectorAll('input[name="transaction-type"]').forEach(r => r.addEventListener("change", populateCategorySelect));
  document.getElementById("tx-destination").addEventListener("change", updateTxForm);
  document.getElementById("tx-date").addEventListener("change", updateTxForm);
  const entryDate = () => {
    const d = document.getElementById("tx-date").value;
    return PesaValidation.isValidISODate(d) ? d : todayISO();
  };
  // What a destination holds on a date, and how much of it later withdrawals depend on (KI-24).
  function withdrawalHint(destId, date, blocked = false) {
    const held = PesaFinance.balanceOn(state, destId, date);
    const available = PesaFinance.availableToWithdraw(state, destId, date);
    const name = destinationName(destId);
    const base = `${name} holds ${money(held)} on ${formatDate(date)}.`;
    const limit = available < held
      ? ` ${money(held - available)} of that is needed for withdrawals recorded later, so you can withdraw up to ${money(available)}.`
      : " You can withdraw up to that.";
    if (blocked) return `Not saved. ${base}${available < held ? limit : ""}`;
    return `${base}${limit} Withdrawals are not income.`;
  }
  document.querySelectorAll("[data-open-savings]").forEach(btn => btn.addEventListener("click", () => {
    setView("transactions");
    document.querySelector(`input[name="transaction-type"][value="${btn.dataset.openSavings}"]`).checked = true;
    populateCategorySelect();
  }));

  /** A day below zero that `candidate` would create (ignores problems already present). */
  function newSavingsIssue(candidate, onlyDestinationId) {
    const before = new Set(PesaFinance.savingsOrderIssues(state).map(i => i.destinationId));
    return PesaFinance.savingsOrderIssues(candidate)
      .find(i => !before.has(i.destinationId) && (!onlyDestinationId || i.destinationId === onlyDestinationId)) || null;
  }

  // ---------------------------------------------------------------------------
  // Category manager (replaces browser prompt() boxes). Rules: src/entries.js.
  // ---------------------------------------------------------------------------
  const KIND_HELP = {
    Essential: "Needs such as food and transport. Unspent money stays set aside.",
    Bills: "Regular bills such as rent, electricity and Wi-Fi. Unspent money stays set aside.",
    Savings: "Money you plan to save. Link it to KCB M-PESA or M-Shwari and your transfers count towards it.",
    Flexible: "Wants such as eating out and fun. Unspent money counts towards safe to spend.",
    Personal: "Personal items you're planning for. Unspent money stays set aside.",
    Event: "A one-off event. Unspent money stays set aside.",
    Other: "Anything else. Unspent money stays set aside."
  };
  let categoryEditingId = null;
  const shortRandom = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10));
  function categoryInput() {
    return {
      name: document.getElementById("cat-name").value,
      kind: document.getElementById("cat-kind").value,
      budget: document.getElementById("cat-budget").value,
      destinationId: document.getElementById("cat-link").value || undefined
    };
  }
  function categoryOpts() {
    return categoryEditingId ? { editingId: categoryEditingId } : { newId: PesaEntries.newCategoryId(state, shortRandom()) };
  }
  function openCategoryDialog(id) {
    const c = id ? state.categories.find(x => x.id === id) : null;
    if (id && !c) return showToast("That category no longer exists.");
    categoryEditingId = id || null;
    document.getElementById("category-title").textContent = c ? `Edit “${c.name}”` : "Add a category";
    document.getElementById("cat-save").textContent = c ? "Save changes" : "Add category";
    document.getElementById("cat-name").value = c ? c.name : "";
    document.getElementById("cat-kind").innerHTML = PesaData.CATEGORY_TYPES.map(k => `<option value="${k}" ${(c ? c.kind : "Essential") === k ? "selected" : ""}>${k}</option>`).join("");
    document.getElementById("cat-budget").value = c ? c.budget : "";
    document.getElementById("cat-link").innerHTML = `<option value="">Not linked</option>` +
      activeDestinations().map(d => `<option value="${escapeHTML(d.id)}" ${c && c.destinationId === d.id ? "selected" : ""}>${escapeHTML(d.name)}</option>`).join("");
    document.getElementById("cat-error").classList.add("hidden");
    const del = document.getElementById("cat-delete-section");
    del.classList.toggle("hidden", !c);
    if (c) {
      const u = PesaEntries.categoryUsage(state, c.id);
      const parts = [];
      parts.push(u.transactionCount
        ? `It has ${u.transactionCount} transaction${u.transactionCount === 1 ? "" : "s"} (${money(u.totalSpent)} in total). Choose where they should go; nothing is deleted.`
        : "No transactions use it.");
      if (u.allocation) parts.push(`Its ${money(u.allocation)} allocation will be released into unallocated money.`);
      if (u.linkedTo) parts.push(`Its link to ${destinationName(u.linkedTo)} will be removed; your savings entries and balance are not affected.`);
      document.getElementById("cat-usage").textContent = parts.join(" ");
      document.getElementById("cat-move-field").classList.toggle("hidden", !u.transactionCount);
      document.getElementById("cat-move").innerHTML = `<option value="">Choose…</option>` +
        state.categories.filter(x => x.id !== c.id).map(x => `<option value="${escapeHTML(x.id)}">${escapeHTML(x.name)}</option>`).join("") +
        `<option value="${PesaData.UNCATEGORISED_ID}">Other / uncategorised</option>`;
    }
    updateCategoryForm();
    openDialog(document.getElementById("category-dialog"));
    document.getElementById("cat-name").focus();
  }
  function updateCategoryForm() {
    const kind = document.getElementById("cat-kind").value;
    document.getElementById("cat-kind-help").textContent = KIND_HELP[kind] || "";
    document.getElementById("cat-link-field").classList.toggle("hidden", kind !== "Savings");
    const notesEl = document.getElementById("cat-notes");
    const r = PesaEntries.validateCategory(state, categoryInput(), categoryOpts());
    const notes = r.ok ? r.notes : [];
    notesEl.textContent = notes.join(" ");
    notesEl.classList.toggle("hidden", !notes.length);
  }
  ["cat-kind", "cat-link", "cat-name", "cat-budget"].forEach(id => document.getElementById(id).addEventListener("input", updateCategoryForm));
  document.getElementById("cat-kind").addEventListener("change", updateCategoryForm);
  document.getElementById("cat-cancel").addEventListener("click", () => closeDialog(document.getElementById("category-dialog")));
  document.getElementById("category-dialog").addEventListener("close", () => { categoryEditingId = null; });
  document.getElementById("category-form").addEventListener("submit", e => {
    e.preventDefault();
    const err = document.getElementById("cat-error");
    const r = PesaEntries.validateCategory(state, categoryInput(), categoryOpts());
    if (!r.ok) { err.textContent = r.errors.join(" "); err.classList.remove("hidden"); return; }
    const editing = categoryEditingId;
    state = r.state;
    if (!saveState()) { renderAll(); return; }
    if (editing) delete budgetDraft[editing]; // the dialog's values are now saved
    closeDialog(document.getElementById("category-dialog"));
    renderAll();
    showToast(editing ? `Category “${r.category.name}” updated.` : `Category “${r.category.name}” added.`);
  });
  document.getElementById("cat-delete").addEventListener("click", () => {
    const id = categoryEditingId;
    const c = state.categories.find(x => x.id === id);
    if (!c) return;
    const err = document.getElementById("cat-error");
    const moveTo = document.getElementById("cat-move").value;
    const r = PesaEntries.deleteCategory(state, id, moveTo || undefined);
    if (!r.ok) { err.textContent = r.errors.join(" "); err.classList.remove("hidden"); return; }
    const before = totals().safeToSpend, after = PesaFinance.computeTotals(r.state).safeToSpend;
    const target = moveTo === PesaData.UNCATEGORISED_ID ? "Other / uncategorised" : (state.categories.find(x => x.id === moveTo) || {}).name;
    const msg = [`Delete “${c.name}”?`];
    if (r.moved) msg.push(`Its ${r.moved} transaction${r.moved === 1 ? "" : "s"} will move to “${target}”.`);
    if (r.released) msg.push(`Its ${money(r.released)} allocation will be released into unallocated money.`);
    if (after !== before) msg.push(`Safe to spend will change from ${money(before)} to ${money(after)}.`);
    msg.push("No transaction is deleted.");
    if (!confirm(msg.join(" "))) return;
    state = r.state;
    if (!saveState()) { renderAll(); return; }
    delete budgetDraft[id];
    closeDialog(document.getElementById("category-dialog"));
    renderAll();
    showToast(`Category “${c.name}” deleted.${r.moved ? ` ${r.moved} transaction${r.moved === 1 ? "" : "s"} moved.` : ""}`);
  });

  // Buttons that may appear in several places (onboarding, empty budget).
  document.addEventListener("click", e => {
    if (e.target.closest("[data-new-category]")) return openCategoryDialog(null);
    if (e.target.closest("[data-suggest-categories]")) {
      const r = PesaEntries.addSuggestedCategories(state, () => shortRandom());
      if (!r.added) return showToast("You already have those categories.");
      state = r.state;
      if (!saveState()) { renderAll(); return; }
      renderAll();
      setView("budget");
      showToast(`Added ${r.added} categories, each at ${money(0)}. Set an allocation for each one, then save.`);
    }
  });

  // ---------------------------------------------------------------------------
  // First-run setup checklist (only for a genuinely new, empty PesaOtas).
  // ---------------------------------------------------------------------------
  function renderOnboarding() {
    const card = document.getElementById("onboarding");
    const active = state.meta && state.meta.onboarding === "active" && canSave && !recovery;
    const steps = { settings: !!state.payday, categories: state.categories.length > 0, entry: state.transactions.length > 0 };
    const finished = Object.values(steps).every(Boolean);
    card.classList.toggle("hidden", !active || finished);
    Object.entries(steps).forEach(([key, done], i) => {
      const li = card.querySelector(`[data-step="${key}"]`);
      li.classList.toggle("is-done", done);
      li.querySelector(".step-status").textContent = done ? "✓" : String(i + 1);
      const sr = li.querySelector(".sr-only") || li.insertBefore(Object.assign(document.createElement("span"), { className: "sr-only" }), li.firstChild);
      sr.textContent = done ? "Done: " : "To do: ";
    });
  }
  document.getElementById("onboarding-hide").addEventListener("click", () => {
    state.meta = { ...state.meta, onboarding: "done" };
    if (saveState()) showToast("Setup hidden. You can find everything under Budget and Settings.");
    renderAll();
  });

  function populateSettings() {
    document.getElementById("opening-balance").value = state.openingBalance;
    document.getElementById("payday-input").value = state.payday;
    document.getElementById("cycle-start-input").value = state.cycleStart || "";
    const t = totals();
    document.getElementById("savings-balance-fields").innerHTML = activeDestinations().map(d => `
      <label class="field-label" for="dest-open-${escapeHTML(d.id)}">${escapeHTML(d.name)}: starting balance (${escapeHTML(cur().symbol)})</label>
      <input class="input dest-opening" id="dest-open-${escapeHTML(d.id)}" data-dest-id="${escapeHTML(d.id)}" type="number" min="0" step="1" value="${d.openingBalance}">
      <small class="tiny-muted">Balance now: ${money(t.destinationBalances[d.id] || 0)}</small>`).join("");
  }
  function renderAll() {
    renderCurrencyLabels();
    renderOnboarding(); renderOverview(); renderTransactions(); renderBudget(); renderInsights(); populateCategorySelect();
  }

  document.querySelectorAll(".nav-link").forEach(btn=>btn.addEventListener("click",()=>setView(btn.dataset.view)));
  document.querySelectorAll("[data-view-link]").forEach(btn=>btn.addEventListener("click",()=>setView(btn.dataset.viewLink)));
  document.querySelectorAll("[data-open-transaction]").forEach(btn=>btn.addEventListener("click",()=>setView("transactions")));
  document.getElementById("tx-date").value = todayISO();
  // ---------------------------------------------------------------------------
  // New and edited entries share one set of rules (src/entries.js).
  // ---------------------------------------------------------------------------
  let editingId = null;
  function setEntryMode(id) {
    editingId = id;
    const editing = !!id;
    document.getElementById("tx-form-title").textContent = editing ? "Edit transaction" : "Add a transaction";
    document.getElementById("tx-form-subtitle").textContent = editing
      ? "Change any detail. Every total is recalculated when you save."
      : "A few details are all you need.";
    document.getElementById("tx-submit").textContent = editing ? "Save changes" : "Save transaction";
    document.getElementById("tx-cancel-edit").classList.toggle("hidden", !editing);
    document.getElementById("transaction-form").classList.toggle("is-editing", editing);
  }
  function resetEntryForm() {
    const form = document.getElementById("transaction-form");
    form.reset();
    document.getElementById("tx-date").value = todayISO();
    document.querySelector('input[name="transaction-type"][value="expense"]').checked = true;
    setEntryMode(null);
    populateCategorySelect();
  }
  function startEdit(id) {
    const tx = state.transactions.find(t => t.id === id);
    if (!tx) return showToast("That entry no longer exists.");
    setView("transactions");
    setEntryMode(id);
    document.querySelector(`input[name="transaction-type"][value="${tx.type}"]`).checked = true;
    populateCategorySelect();
    document.getElementById("tx-amount").value = tx.amount;
    document.getElementById("tx-date").value = tx.date;
    document.getElementById("tx-note").value = tx.note || "";
    if (isSavingsType(tx.type)) {
      document.getElementById("tx-destination").value = tx.destinationId;
    } else {
      const select = document.getElementById("tx-category");
      const fallback = tx.type === "income" ? "inc-other" : "other"; // older income tags / deleted categories
      select.value = [...select.options].some(o => o.value === tx.categoryId) ? tx.categoryId : fallback;
    }
    updateTxForm();
    const form = document.getElementById("transaction-form");
    form.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    document.getElementById("tx-amount").focus({ preventScroll: true });
  }
  document.getElementById("tx-cancel-edit").addEventListener("click", () => { resetEntryForm(); showToast("Editing cancelled. Nothing was changed."); });

  document.getElementById("transaction-form").addEventListener("submit", e => {
    e.preventDefault();
    const type = currentType();
    const input = {
      type,
      amount: document.getElementById("tx-amount").value,
      date: document.getElementById("tx-date").value,
      note: document.getElementById("tx-note").value,
      categoryId: isSavingsType(type) ? undefined : document.getElementById("tx-category").value,
      destinationId: isSavingsType(type) ? document.getElementById("tx-destination").value : undefined
    };
    const wasEditing = editingId;
    const result = PesaEntries.validateEntry(state, input, wasEditing
      ? { replacingId: wasEditing, now: new Date() }
      : { newId: makeId(isSavingsType(type) ? "sv" : "tx"), now: new Date() });
    if (!result.ok) return showToast(result.errors[0]);
    for (const c of result.confirms) if (!confirm(c.message)) return;
    const e1 = result.entry;
    state = result.state;
    if (!saveState()) { renderAll(); return; }
    const name = isSavingsType(e1.type) ? destinationName(e1.destinationId) : "";
    const done = wasEditing ? "Changes saved. All totals have been recalculated."
      : e1.type === "savings_withdrawal" ? `Withdrew ${money(e1.amount)} from ${name}.`
      : e1.type === "savings_transfer" ? `Saved ${money(e1.amount)} to ${name}.`
      : "Transaction saved.";
    resetEntryForm();
    renderAll();
    showToast(done);
  });
  document.getElementById("transaction-filter").addEventListener("change",renderTransactions);
  document.getElementById("all-transactions").addEventListener("click", e => {
    const editBtn = e.target.closest("[data-edit]");
    if (editBtn) return startEdit(editBtn.dataset.edit);
    const btn = e.target.closest("[data-delete]");
    if (!btn) return;
    const tx = state.transactions.find(t => t.id === btn.dataset.delete);
    if (!tx) return;
    const check = PesaEntries.validateDelete(state, tx.id);
    if (!check.ok) return showToast(check.error);
    const what = isSavingsType(tx.type)
      ? `Delete this savings entry? Your spending cash and ${destinationName(tx.destinationId)} balance will be recalculated.`
      : "Delete this transaction? Your balance and budget totals will be recalculated.";
    if (!confirm(what)) return;
    state = check.state;
    if (editingId === tx.id) resetEntryForm();
    if (saveState()) showToast("Entry deleted.");
    renderAll();
  });

  // Budget drafts (KI-12): typing or choosing a link records a draft that survives re-renders.
  document.getElementById("budget-list").addEventListener("input", e => {
    const input = e.target.closest(".budget-value");
    if (!input) return;
    const id = input.dataset.budgetId;
    budgetDraft[id] = { ...(budgetDraft[id] || {}), budget: input.value };
    const card = input.closest(".budget-edit-card");
    if (card && !card.classList.contains("has-draft")) {
      card.classList.add("has-draft");
      card.insertAdjacentHTML("beforeend", `<p class="draft-note">Not saved yet</p>`);
    }
    document.getElementById("discard-budget-button").classList.remove("hidden");
    document.getElementById("budget-save-status").textContent = "You have unsaved changes. They'll stay here until you save or discard them.";
  });
  document.getElementById("budget-list").addEventListener("change", e => {
    const sel = e.target.closest(".savings-link");
    if (!sel) return;
    const id = sel.dataset.linkId;
    budgetDraft[id] = { ...(budgetDraft[id] || {}), link: sel.value };
    renderBudget();
  });
  document.getElementById("budget-list").addEventListener("click", e => {
    const b = e.target.closest("[data-edit-category]");
    if (b) openCategoryDialog(b.dataset.editCategory);
  });
  document.getElementById("discard-budget-button").addEventListener("click", () => {
    budgetDraft = {};
    renderBudget();
    showToast("Unsaved budget changes discarded.");
  });
  window.addEventListener("beforeunload", e => {
    if (hasBudgetDraft()) { e.preventDefault(); e.returnValue = ""; }
  });
  document.getElementById("save-budget-button").addEventListener("click",()=>{
    const updates = [];
    for (const input of document.querySelectorAll(".budget-value")) {
      const category = state.categories.find(c=>c.id===input.dataset.budgetId);
      if (!category) continue;
      const check = PesaValidation.parseWholeShillings(input.value, {allowZero:true});
      if (!check.ok) { input.focus(); return showToast(`${category.name}: allocation ${check.error}. Nothing was changed.`); }
      updates.push([category, check.value]);
    }
    const links = [...document.querySelectorAll(".savings-link")].map(sel => [state.categories.find(c => c.id === sel.dataset.linkId), sel.value]).filter(([c]) => c);
    const chosen = links.map(([, v]) => v).filter(Boolean);
    const clash = chosen.find((v, i) => chosen.indexOf(v) !== i);
    if (clash) return showToast(`Only one Savings category can be linked to ${destinationName(clash)}. Nothing was changed.`);
    updates.forEach(([category, value]) => { category.budget = value; });
    links.forEach(([category, value]) => { if (value) category.destinationId = value; else delete category.destinationId; });
    if (saveState()) { budgetDraft = {}; showToast("Budget allocations updated."); }
    renderAll();
  });
  document.getElementById("savings-form").addEventListener("submit", e => {
    e.preventDefault();
    const changes = [];
    for (const input of document.querySelectorAll(".dest-opening")) {
      const dest = state.savingsDestinations.find(d => d.id === input.dataset.destId);
      if (!dest) continue;
      const check = PesaValidation.parseWholeShillings(input.value, {allowZero:true});
      if (!check.ok) { input.focus(); return showToast(`${dest.name}: starting balance ${check.error}. Nothing was changed.`); }
      changes.push([dest.id, check.value]);
    }
    const candidate = { ...state, savingsDestinations: state.savingsDestinations.map(d => {
      const change = changes.find(([id]) => id === d.id);
      return change ? { ...d, openingBalance: change[1] } : d;
    }) };
    const issue = newSavingsIssue(candidate);
    if (issue) return showToast(`${destinationName(issue.destinationId)} would hold ${money(issue.balance)} on ${formatDate(issue.date)} after your recorded withdrawals. Enter a higher starting balance.`);
    state.savingsDestinations = candidate.savingsDestinations;
    if (saveState()) showToast("Savings balances saved.");
    renderAll(); populateSettings();
  });
  document.getElementById("add-category-button").addEventListener("click", () => openCategoryDialog(null));
  document.getElementById("settings-form").addEventListener("submit",e=>{
    e.preventDefault();
    const opening = PesaValidation.parseWholeShillings(document.getElementById("opening-balance").value, {allowZero:true});
    const payday = document.getElementById("payday-input").value;
    if (!opening.ok) return showToast(`The opening balance ${opening.error}.`);
    if (!PesaValidation.isValidISODate(payday)) return showToast("Choose a valid payday.");
    const cycleStart = document.getElementById("cycle-start-input").value;
    if (cycleStart && !PesaValidation.isValidISODate(cycleStart)) return showToast("Choose a valid date for when this pay cycle started.");
    if (cycleStart && cycleStart >= payday) return showToast("The pay cycle must start before payday.");
    const lastClosed = (state.cycles || []).slice(-1)[0];
    if (cycleStart && lastClosed && cycleStart < lastClosed.end) return showToast(`This pay cycle can't start before ${formatDate(lastClosed.end)}, when your last closed cycle ended.`);
    state.openingBalance = opening.value; state.payday = payday;
    if (cycleStart) state.cycleStart = cycleStart; else delete state.cycleStart;
    if (saveState()) showToast("Settings saved.");
    renderAll(); populateSettings();
  });
  document.getElementById("export-button").addEventListener("click",()=>{
    downloadText(PesaData.serializeBackup(state), `pesaotas-backup-${todayISO()}.json`);
    if (store) PesaStorage.updateDeviceInfo(store, { lastBackupAt: new Date().toISOString() });
    renderStorageProtection();
    if (saveBlock === "reviews" && boot.report && boot.report.reviewIssues) {
      const n = boot.report.reviewIssues.length;
      return showToast(`Backup downloaded, without the ${plural(n, "alert review record", "alert review records")} that couldn't be read. To keep ${n === 1 ? "it" : "them"}, also download the original data.`);
    }
    showToast("Backup downloaded.");
  });
  document.getElementById("import-file").addEventListener("change",async e=>{
    await startRestore(e.target.files[0]);
    e.target.value = "";
  });
  document.getElementById("reset-button").addEventListener("click",()=>{
    if (!confirm("Erase everything and start PesaOtas empty? Your budget, transactions, pay cycles, savings records and alert review records will be removed from this browser. A copy is kept in Settings → Data safety (only the most recent copy), so download a backup first if you might need it.")) return;
    budgetDraft = {};
    if (applyReplacement(PesaData.createBlankState(state.currency), "PesaOtas has been emptied. Your previous data is in Data safety.")) {
      resetEntryForm();
      setView("overview");
    }
  });

  // ---------------------------------------------------------------------------
  // Replacing all data (restore, recovery, reset): one guarded path.
  // ---------------------------------------------------------------------------
  function applyReplacement(newState, message) {
    if (!store) { showToast("This browser isn't storing PesaOtas data, so nothing can be saved here."); return false; }
    if (saveBlock === "upgrade" || saveBlock === "conflict" || saveBlock === "stale") { showToast(BLOCKED_MESSAGES[saveBlock]); return false; }
    if (recovery && !recovery.quarantined && !damagedDownloaded) {
      showToast("Download the damaged data first, so nothing is lost.");
      return false;
    }
    if (!recovery && !PesaStorage.keepPreRestoreCopy(store, new Date())) {
      showToast("Couldn't keep a safety copy of your current data. Download a backup first, then try again.");
      return false;
    }
    const result = PesaStorage.save(store, newState, { expectedRaw: storedRaw });
    if (!result.ok) {
      if (result.reason === "changed-elsewhere") { markStale("tab"); showToast(BLOCKED_MESSAGES.stale); return false; }
      showToast(result.reason === "invalid" ? "Not saved: the data failed a final check." : "Could not save. Browser storage may be full.");
      return false;
    }
    state = result.state; lastSaved = clone(state); storedRaw = result.raw; canSave = true; recovery = null; saveBlock = null;
    if (noticeKind !== "migrated") noticeKind = null;
    renderAll(); populateSettings(); renderDataSafety(); renderNotice();
    showToast(message);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Shared preview markup
  // ---------------------------------------------------------------------------
  const formatLongDate = (iso) => {
    if (!iso) return "Not set";
    const { y, m, d } = dateParts(iso);
    return `${d} ${MONTHS_LONG[m - 1]} ${y}`;
  };
  // A moment (for example when a safety copy was made), in this device's local time: "6 Nov 2026, 10:05".
  const formatWhen = (iso) => {
    const d = iso ? new Date(iso) : null;
    if (!d || isNaN(d)) return "unknown date";
    return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  // What a restore or recovery leaves out: financial items and alert review records are counted separately (D-20).
  const leaveOutCount = (r) => r.rejected.length + (r.reviewIssues || []).length;
  const leaveOutPhrase = (r) => {
    // Unchanged wording when only financial items are left out (as before v1.6 Phase 4).
    if (!(r.reviewIssues || []).length) return String(r.rejected.length);
    const parts = [];
    if (r.rejected.length) parts.push(`${r.rejected.length} ${r.rejected.length === 1 ? "item" : "items"}`);
    const n = (r.reviewIssues || []).length;
    if (n) parts.push(`${n} alert review ${n === 1 ? "record" : "records"}`);
    return parts.join(" and ");
  };
  const leaveOutText = (verb, r) => (leaveOutCount(r) ? `${verb}, leaving out ${leaveOutPhrase(r)}` : "");
  function issueSection(title, items, cls) {
    if (!items.length) return "";
    const shown = items.slice(0, 40).map(m => `<li>${escapeHTML(m)}</li>`).join("");
    const more = items.length > 40 ? `<li>…and ${items.length - 40} more</li>` : "";
    return `<section class="issue-group ${cls}"><h4>${escapeHTML(title)} <span>(${items.length})</span></h4><ul>${shown}${more}</ul></section>`;
  }
  const reviewIssueTexts = (r) => (r.reviewIssues || []).map(x => x.text);
  const issueSections = (r) =>
    issueSection("Will be left out", r.rejected, "issue-rejected") +
    ((r.reviewIssues || []).length
      ? issueSection("Alert review records that can't be read and will be left out (your transactions and amounts are not affected)", reviewIssueTexts(r), "issue-rejected issue-reviews")
      : "") +
    issueSection("Corrected automatically", r.fixed, "issue-fixed") +
    issueSection("Please check", r.warnings, "issue-warning") +
    issueSection("Good to know", r.notes, "issue-note");
  function summaryMarkup(s, context) {
    const view = context === "view";
    const money = (v) => PesaCurrency.format(v, s.currency); // the backup's own currency
    const rows = [
      ["Currency", PesaCurrency.label(s.currency)],
      ["Opening balance", money(s.openingBalance)],
      ["Next payday", formatLongDate(s.payday)],
      ["Pay cycle", s.cycleStart ? `Started ${formatLongDate(s.cycleStart)}${s.closedCycles ? ` · ${s.closedCycles} earlier cycle(s) in history` : ""}` : "No start date set"],
      ["Budget categories", String(s.categoryCount)],
      ["Transactions", `${s.transactionCount} (${s.incomeCount} income, ${s.expenseCount} expenses)`],
      ["Dates covered", s.firstDate ? `${formatDate(s.firstDate)} – ${formatDate(s.lastDate)}` : "No transactions"],
      [view ? "Spending cash" : "Cash after restoring", money(s.cash)],
      [view ? "Savings" : "Savings after restoring", `${money(s.totalSavings)} (${s.savingsCount} savings ${s.savingsCount === 1 ? "entry" : "entries"})`],
      ["Savings destinations", s.destinations.join(", ") || "None"],
      ["Alert review records", `${s.alertReviewCount || 0} ${(s.alertReviewCount || 0) === 1 ? "record" : "records"} that can be read`]
    ];
    return `<dl class="summary-list">${rows.map(([k,v]) => `<div><dt>${escapeHTML(k)}</dt><dd>${escapeHTML(v)}</dd></div>`).join("")}</dl>`;
  }
  function openDialog(dlg) {
    if (typeof dlg.showModal === "function") { if (!dlg.open) dlg.showModal(); }
    else dlg.setAttribute("open", "");
  }
  function closeDialog(dlg) {
    if (typeof dlg.close === "function") dlg.close(); else dlg.removeAttribute("open");
  }

  // ---------------------------------------------------------------------------
  // Restore: analyse → preview → explicit confirmation → replace
  // ---------------------------------------------------------------------------
  async function startRestore(file) {
    if (!file) return;
    let text;
    try { text = await file.text(); } catch { return showToast("That file couldn't be opened."); }
    openRestoreDialog(PesaData.analyzeBackup(text));
  }
  function openRestoreDialog(report) {
    const dlg = document.getElementById("restore-dialog");
    const title = document.getElementById("restore-title");
    const content = document.getElementById("restore-content");
    const confirmBtn = document.getElementById("restore-confirm");
    const cancelBtn = document.getElementById("restore-cancel");
    pendingRestore = report.ok ? report : null;
    if (!report.ok) {
      title.textContent = "This file can't be restored";
      content.innerHTML = `<p class="muted">Nothing on this device has been changed.</p><ul class="issue-plain">${report.errors.map(m => `<li>${escapeHTML(m)}</li>`).join("")}</ul>`;
      confirmBtn.classList.add("hidden");
      cancelBtn.textContent = "Close";
    } else {
      const current = totals();
      // Entries on this device that the file doesn't contain would disappear from the app (D-09 rule 9).
      const inFile = new Set(report.state.transactions.map(x => x.id));
      const missing = state.transactions.filter(x => !inFile.has(x.id));
      const latest = missing.map(x => x.date).sort().slice(-1)[0];
      const missingNote = missing.length
        ? ` <strong>${missing.length} ${missing.length === 1 ? "entry" : "entries"} on this device ${missing.length === 1 ? "is" : "are"} not in this file and will no longer be in the app</strong> (the latest dated ${escapeHTML(formatDate(latest))}).`
        : "";
      const currentReviews = (state.meta && Array.isArray(state.meta.alertReviews)) ? state.meta.alertReviews.length : 0;
      const replaces = recovery
        ? `<strong>Your damaged data stays safe</strong> in Settings → Data safety.`
        : `<strong>This replaces everything on this device now:</strong> ${state.transactions.length} transactions, cash ${escapeHTML(money(current.cash))}${currentReviews ? `, ${plural(currentReviews, "alert review record", "alert review records")}` : ""}.${missingNote} A copy of what's replaced is kept in Settings → Data safety, but only the most recent one, so download a backup first if you might need it.`;
      title.textContent = "Check this backup before restoring";
      content.innerHTML =
        `<p class="muted">${report.format === "pesaflow-v1" ? "This is an older PesaFlow backup. It will be converted for PesaOtas."
          : report.format === "pesaotas-v2" ? "This is a backup from PesaOtas v1.5.0 or earlier (amounts in Kenyan shillings). It will be converted to the v1.6 format."
          : "PesaOtas backup."}</p>` +
        (report.summary.currency !== state.currency && !recovery
          ? `<p class="replace-note">This backup is in <strong>${escapeHTML(PesaCurrency.label(report.summary.currency))}</strong>; your budget is currently in ${escapeHTML(PesaCurrency.label(state.currency))}. Restoring brings back the backup's currency too. Amounts are never converted.</p>` : "") +
        summaryMarkup(report.summary) +
        `<p class="replace-note">${replaces}</p>` +
        issueSections(report);
      confirmBtn.textContent = leaveOutText("Restore", report) || "Replace my data";
      confirmBtn.classList.remove("hidden");
      cancelBtn.textContent = "Cancel";
    }
    openDialog(dlg);
  }
  document.getElementById("restore-cancel").addEventListener("click", () => {
    pendingRestore = null;
    closeDialog(document.getElementById("restore-dialog"));
    if (recovery) renderNotice();
  });
  document.getElementById("restore-confirm").addEventListener("click", () => {
    if (!pendingRestore) return;
    const report = pendingRestore;
    const leftMsg = !(report.reviewIssues || []).length ? `${report.rejected.length} item(s)` : leaveOutPhrase(report);
    if (applyReplacement(report.state, leaveOutCount(report) ? `Backup restored (${leftMsg} left out).` : "Backup restored.")) {
      pendingRestore = null;
      closeDialog(document.getElementById("restore-dialog"));
      closeDialog(document.getElementById("recovery-dialog"));
    }
  });

  // ---------------------------------------------------------------------------
  // New pay cycle (rollover): preview → explanation → explicit confirmation.
  // Never automatic; never deletes or changes a transaction (D-12).
  // ---------------------------------------------------------------------------
  function openRolloverDialog() {
    if (!state.payday) { setView("settings"); return showToast("Set your payday first."); }
    const today = todayISO();
    const start = state.payday <= today ? state.payday : today; // paid early → today
    document.getElementById("roll-start").value = start;
    document.getElementById("roll-next").value = PesaFinance.suggestNextPayday(start);
    document.getElementById("roll-amount").value = "";
    document.getElementById("roll-dest").innerHTML = activeDestinations().map(d => `<option value="${escapeHTML(d.id)}">${escapeHTML(d.name)}</option>`).join("");
    document.getElementById("rollover-error").classList.add("hidden");
    renderRolloverPreview();
    openDialog(document.getElementById("rollover-dialog"));
  }
  function renderRolloverPreview() {
    const start = document.getElementById("roll-start").value;
    const content = document.getElementById("rollover-content");
    if (!PesaValidation.isValidISODate(start)) { content.innerHTML = `<p class="muted">Choose the date the new cycle starts.</p>`; return; }
    const sum = PesaFinance.cycleSummary(state, state.cycleStart || "", start);
    const lastDay = PesaFinance.addDays(start, -1);
    const range = state.cycleStart ? `${formatDate(state.cycleStart)} – ${formatDate(lastDay)} (${sum.lengthDays} days)` : `everything up to ${formatDate(lastDay)}`;
    const after = state.transactions.filter(t => t.date >= start).length;
    const left = sum.categories.filter(c => c.left > 0).map(c => `<li>${escapeHTML(c.name)}: ${money(c.left)} not used</li>`).join("");
    const over = sum.overspent.map(o => `<li>${escapeHTML(o.name)}: over by ${money(o.by)}</li>`).join("");
    const planned = state.categories.reduce((a, c) => a + c.budget, 0);
    content.innerHTML = `
      <h3 class="rollover-heading">The cycle that's ending: ${escapeHTML(range)}</h3>
      <dl class="summary-list">
        <div><dt>Income</dt><dd>${money(sum.earned)}</dd></div>
        <div><dt>Spending</dt><dd>${money(sum.spent)}</dd></div>
        <div><dt>Saved (net)</dt><dd>${money(sum.savedNet)}</dd></div>
        <div><dt>Spending cash at the end</dt><dd>${money(sum.closingCash)}</dd></div>
        <div><dt>Left in allocations</dt><dd>${money(sum.leftInAllocations)}</dd></div>
        <div><dt>Savings balances</dt><dd>${money(totals().totalSavings)}</dd></div>
      </dl>
      ${left || over ? `<section class="issue-group issue-note"><h4>By category</h4><ul>${left}${over}</ul></section>` : ""}
      <section class="issue-group issue-fixed">
        <h4>What happens when you start the new cycle</h4>
        <ul>
          <li><strong>Nothing is deleted.</strong> Every transaction stays in your history, and this cycle is listed under Insights.</li>
          <li><strong>Your spending cash carries over as it is</strong> (${money(sum.closingCash)} at the end of this cycle). It's real money, so it isn't reset.</li>
          <li><strong>Allocations start again.</strong> Each category gets its full amount for the new cycle (${money(planned)} in total). You can change amounts in Budget.</li>
          <li><strong>Money left in allocations (${money(sum.leftInAllocations)}) is released.</strong> It stays in your spending cash, and the new cycle's allocations are set aside from it. Until your salary is recorded, your plan may show as short.</li>
          <li><strong>KCB M-PESA and M-Shwari balances don't change.</strong></li>
          ${after ? `<li>${after} ${after === 1 ? "entry" : "entries"} dated from ${formatDate(start)} will count towards the new cycle.</li>` : ""}
          <li>A copy of your data from before this step is kept in Settings → Data safety.</li>
        </ul>
      </section>`;
  }
  ["roll-start"].forEach(id => document.getElementById(id).addEventListener("change", () => {
    const start = document.getElementById("roll-start").value;
    if (PesaValidation.isValidISODate(start)) document.getElementById("roll-next").value = PesaFinance.suggestNextPayday(start);
    renderRolloverPreview();
  }));
  document.querySelectorAll("[data-open-rollover]").forEach(btn => btn.addEventListener("click", openRolloverDialog));
  document.getElementById("rollover-cancel").addEventListener("click", () => closeDialog(document.getElementById("rollover-dialog")));
  document.getElementById("rollover-confirm").addEventListener("click", () => {
    const err = document.getElementById("rollover-error");
    const fail = (msg) => { err.textContent = msg; err.classList.remove("hidden"); };
    if (!canSave) return fail("Nothing can be saved right now. Deal with the notice at the top of the page first.");
    const start = document.getElementById("roll-start").value;
    const nextPayday = document.getElementById("roll-next").value;
    const rawAmount = document.getElementById("roll-amount").value.trim();
    let transfer;
    if (rawAmount) {
      const check = PesaValidation.parseWholeShillings(rawAmount);
      if (!check.ok) return fail(`The amount to save ${check.error}.`);
      transfer = { amount: check.value, destinationId: document.getElementById("roll-dest").value, id: makeId("sv") };
      const closing = PesaFinance.cycleSummary(state, state.cycleStart || "", start).closingCash;
      if (check.value > Math.max(0, closing) && !confirm(`Saving ${money(check.value)} is more than your spending cash at the end of the cycle (${money(closing)}). Your spending cash would go below zero. Continue?`)) return;
    }
    const result = PesaFinance.startNewCycle(state, { start, nextPayday, now: new Date(), transfer });
    if (!result.ok) return fail(result.errors.join(" "));
    if (applyReplacement(result.state, `New pay cycle started on ${formatDate(start)}. Nothing was deleted; your earlier data is in Data safety.`)) {
      closeDialog(document.getElementById("rollover-dialog"));
      setView("overview");
    }
  });

  // ---------------------------------------------------------------------------
  // Recovery: damaged data found on this device
  // ---------------------------------------------------------------------------
  function openRecoveryDialog() {
    if (!recovery) return;
    const r = recovery.report;
    const source = recovery.sourceKey === PesaStorage.KEYS.legacy ? "your PesaFlow data" : "your saved PesaOtas data";
    const locked = !recovery.quarantined && !damagedDownloaded;
    let html = `<p>PesaOtas found ${source} on this device but can't use it safely as it is. <strong>Nothing has been deleted.</strong></p>`;
    html += recovery.quarantined
      ? `<p class="muted">A copy has been set aside safely on this device. You can download it any time from Settings → Data safety.</p>`
      : `<p class="replace-note"><strong>PesaOtas couldn't make a safety copy.</strong> Download the damaged data first. The other options unlock after that.</p>`;
    if (r.ok) {
      html += `<p><strong>Recoverable:</strong> ${r.state.transactions.length} transactions and ${r.state.categories.length} budget categories pass every check.</p>` + issueSections(r);
    } else {
      html += `<p>It is too damaged to recover automatically:</p><ul class="issue-plain">${r.errors.map(m => `<li>${escapeHTML(m)}</li>`).join("")}</ul>`;
    }
    html += `<p class="muted">Choose what to do. Until you do, nothing you change will be saved.</p>`;
    document.getElementById("recovery-content").innerHTML = html;

    const recoverBtn = document.getElementById("recovery-recover");
    recoverBtn.classList.toggle("hidden", !r.ok);
    if (r.ok) recoverBtn.textContent = leaveOutCount(r)
      ? `Recover ${r.state.transactions.length} transactions (leave out ${leaveOutPhrase(r)})`
      : `Recover ${r.state.transactions.length} transactions`;
    recoverBtn.disabled = locked;
    document.getElementById("recovery-blank").disabled = locked;
    document.getElementById("recovery-import").disabled = locked;
    document.getElementById("recovery-restore-label").classList.toggle("is-disabled", locked);
    openDialog(document.getElementById("recovery-dialog"));
  }
  document.getElementById("recovery-dialog").addEventListener("cancel", e => e.preventDefault()); // must choose
  document.getElementById("recovery-download").addEventListener("click", () => {
    if (!recovery) return;
    downloadText(recovery.raw, `pesaotas-damaged-data-${todayISO()}.json`);
    damagedDownloaded = true;
    openRecoveryDialog();
    showToast("Damaged data downloaded.");
  });
  document.getElementById("recovery-recover").addEventListener("click", () => {
    if (!recovery || !recovery.report.ok) return;
    const r = recovery.report;
    const left = !leaveOutCount(r) ? "" : !(r.reviewIssues || []).length
      ? ` ${r.rejected.length} item(s) listed under "Will be left out" won't be included.`
      : ` ${leaveOutPhrase(r)} listed as left out won't be included.`;
    if (!confirm(`Use the recovered data?${left} The damaged original stays in Data safety.`)) return;
    if (applyReplacement(r.state, "Recovered data saved.")) closeDialog(document.getElementById("recovery-dialog"));
  });
  document.getElementById("recovery-import").addEventListener("change", async e => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    closeDialog(document.getElementById("recovery-dialog"));
    await startRestore(file);
  });
  document.getElementById("recovery-blank").addEventListener("click", () => {
    if (!confirm("Start with an empty budget? The damaged data stays in Settings → Data safety, where you can download it later.")) return;
    if (applyReplacement(PesaData.createBlankState(), "Started a new, empty budget.")) closeDialog(document.getElementById("recovery-dialog"));
  });
  document.getElementById("recovery-later").addEventListener("click", () => {
    closeDialog(document.getElementById("recovery-dialog"));
    renderNotice();
  });

  // ---------------------------------------------------------------------------
  // Notices shown at the top of every screen
  // ---------------------------------------------------------------------------
  let noticeKind = {
    migrated: "migrated", "migration-failed": "migration-failed", corrupt: "recovery", unavailable: "unavailable",
    upgraded: "upgraded", "upgrade-failed": "upgrade-failed", "older-version-conflict": "conflict",
    "review-records-invalid": "reviews"
  }[boot.status] || null;
  const failReasons = {
    "preserve-failed": "it couldn't make a safety copy of the original first",
    "storage-full": "browser storage is full",
    "readback-mismatch": "the saved copy didn't match when checked",
    "readback-invalid": "the saved copy didn't pass its checks",
    "write-failed": "the browser refused to save"
  };
  function renderNotice() {
    const box = document.getElementById("data-notice");
    const text = document.getElementById("data-notice-text");
    const actions = document.getElementById("data-notice-actions");
    const kind = recovery ? "recovery" : noticeKind;
    box.className = "data-notice hidden";
    actions.innerHTML = "";
    if (!kind) return;
    if (kind === "migrated") {
      const r = boot.report;
      const fixed = r.fixed.length ? ` ${r.fixed.length} value(s) stored as text were converted to numbers.` : "";
      text.textContent = `Your PesaFlow budget has moved to PesaOtas: ${boot.state.transactions.length} transactions and ${boot.state.categories.length} budget categories, with every total checked.${fixed} Your original data is still kept on this device (Settings → Data safety). KCB M-PESA and M-Shwari are set up as savings destinations, ready for a coming update.`;
      actions.innerHTML = `<button class="button button-secondary" data-notice="dismiss">Got it</button>`;
      box.classList.add("notice-success");
    } else if (kind === "migration-failed") {
      text.textContent = `PesaOtas couldn't move your PesaFlow data yet because ${failReasons[boot.reason] || "of a storage problem"}. Your original data is untouched. You can look around, but changes won't be saved. Free up browser storage or download your data, then reload this page.`;
      actions.innerHTML = `<button class="button button-secondary" data-notice="download-legacy">↓ Download your PesaFlow data</button>`;
      box.classList.add("notice-warning");
    } else if (kind === "upgraded") {
      text.textContent = `Your data has been upgraded to the PesaOtas v1.6 format, and every record was checked: ${boot.state.transactions.length} transactions and ${boot.state.categories.length} budget categories. Nothing was converted or removed. A copy in the old format is kept in Settings → Data safety, in case you ever need to go back to PesaOtas v1.5.0.`;
      actions.innerHTML = `<button class="button button-secondary" data-notice="dismiss">Got it</button>`;
      box.classList.add("notice-success");
    } else if (kind === "upgrade-failed") {
      const why = failReasons[boot.reason] || "of a storage problem";
      text.textContent = boot.stage === "copy"
        ? "PesaOtas needs to upgrade your data to the v1.6 format, but it couldn't save a safety copy first, so it didn't start. Nothing has been changed: your data is exactly as PesaOtas v1.5.0 saved it. You can look around, but changes won't be saved until the upgrade completes. Free up browser storage, then try again."
        : boot.stage === "write"
          ? `A safety copy of your data was saved (Settings → Data safety), but the upgraded data couldn't be saved because ${why}. ${boot.originalIntact ? "Your data is still saved exactly as PesaOtas v1.5.0 left it." : "PesaOtas couldn't confirm that the original is unchanged, but the safety copy holds it exactly."} Changes won't be saved until the upgrade completes. Free up browser storage, then try again.`
          : "Your data was upgraded to the v1.6 format, saved and checked, and a copy in the old format was kept. One last step didn't complete: PesaOtas couldn't leave the note that stops older versions (v1.5.0 and earlier) opening out-of-date data. Changes won't be saved until it completes. Try again.";
      actions.innerHTML = `<button class="button button-primary" data-notice="reload">Try again</button>` +
        `<button class="button button-secondary" data-notice="download-upgrade">↓ Download your data</button>`;
      box.classList.add("notice-warning");
    } else if (kind === "conflict") {
      text.textContent = "Two versions of your budget were found in this browser. Choose which one to keep; nothing will be saved until you do. Nothing has been overwritten or deleted.";
      actions.innerHTML = `<button class="button button-primary" data-notice="conflict">Review options</button>`;
      box.classList.add("notice-warning");
    } else if (kind === "stale") {
      text.textContent = "Your PesaOtas data was changed in another tab or window, so this tab is out of date. To protect your data it won't save anything. Reload to see the latest data.";
      actions.innerHTML = `<button class="button button-primary" data-notice="reload">Reload</button>`;
      box.classList.add("notice-warning");
    } else if (kind === "older-tab") {
      text.textContent = "An older version of PesaOtas (v1.5.0 or earlier), open in another tab, has just saved changes. They have not replaced your data here, and both are kept. Close that tab, then reload this one to choose which data to keep.";
      actions.innerHTML = `<button class="button button-primary" data-notice="reload">Reload</button>`;
      box.classList.add("notice-warning");
    } else if (kind === "unavailable") {
      text.textContent = "This browser isn't letting PesaOtas store data, so nothing you enter will be saved. Check that site data is allowed for this page, or try another browser.";
      box.classList.add("notice-warning");
    } else if (kind === "reviews") {
      const n = boot.report.reviewIssues.length;
      text.textContent = `Your budget and transactions are fine. ${n} alert review ${n === 1 ? "record" : "records"} (marks saying an Expense Detective alert was reviewed or dismissed) couldn't be read. ` +
        (boot.copyVerified ? "A copy of your data exactly as it was is kept in Settings → Data safety. " : "PesaOtas couldn't save a safety copy of your data, so it can't continue yet. ") +
        "Nothing will be saved until you choose what to do.";
      actions.innerHTML = `<button class="button button-primary" data-notice="reviews">Review options</button>` +
        `<button class="button button-secondary" data-notice="download-original">↓ Download the original data</button>`;
      box.classList.add("notice-warning");
    } else if (kind === "recovery") {
      text.textContent = "Your saved budget data needs attention. Nothing has been deleted, and nothing will be saved until you choose what to do.";
      actions.innerHTML = `<button class="button button-primary" data-notice="recovery">Review options</button>`;
      box.classList.add("notice-warning");
    }
    box.classList.remove("hidden");
  }
  document.getElementById("data-notice-actions").addEventListener("click", e => {
    const action = e.target.closest("[data-notice]")?.dataset.notice;
    if (action === "dismiss") { noticeKind = null; renderNotice(); }
    if (action === "recovery") openRecoveryDialog();
    if (action === "conflict") openConflictDialog();
    if (action === "reload") location.reload();
    if (action === "download-upgrade") {
      if (boot.stage !== "marker" && boot.originalRaw) {
        downloadText(boot.originalRaw, `pesaotas-v1.5-data-${todayISO()}.json`);
        showToast("Your data downloaded, exactly as PesaOtas v1.5.0 saved it.");
      } else {
        downloadText(PesaData.serializeBackup(state), `pesaotas-backup-${todayISO()}.json`);
        showToast("Backup downloaded.");
      }
    }
    if (action === "reviews") openReviewRecordsDialog();
    if (action === "download-original" && boot.raw) {
      downloadText(boot.raw, `pesaotas-original-data-${todayISO()}.json`);
      showToast("Original data downloaded, exactly as it was stored.");
    }
    if (action === "download-legacy") {
      const raw = PesaStorage.getRecoveryText(store, "legacy");
      if (raw) { downloadText(raw, `pesaflow-original-data-${todayISO()}.json`); showToast("PesaFlow data downloaded."); }
      else showToast("The original PesaFlow data is no longer on this device.");
    }
  });

  // ---------------------------------------------------------------------------
  // Settings → Data safety
  // ---------------------------------------------------------------------------
  function renderDataSafety() {
    const el = document.getElementById("data-safety-list");
    if (!store) { el.innerHTML = `<p class="muted">This browser isn't letting PesaOtas store data.</p>`; return; }
    const inv = PesaStorage.recoveryInventory(store);
    const manage = canManageCopies(inv);
    const restoreBlocked = saveBlock === "upgrade" || saveBlock === "conflict" || saveBlock === "stale" || saveBlock === "storage";
    const detail = (it) => {
      if (it.kind === "legacy") return "Still on this device, unchanged. PesaOtas never edits it or deletes it on its own.";
      if (it.kind === "quarantine") return `${formatWhen(it.at)} · ${it.reason || "failed its checks"}`;
      if (it.kind === "preCurrency") return `Saved ${formatWhen(it.at)} · before changing ${it.from || "?"} to ${it.to || "?"}`;
      if (it.kind === "olderVersion") return `Saved ${formatWhen(it.at)} · ${it.reason || "not chosen"}`;
      if (it.kind === "reviewRecords") return `Saved ${formatWhen(it.at)} · your budget and transactions were not affected`;
      return `Saved ${formatWhen(it.at)}`;
    };
    const rows = inv.items.map(it => `<div class="safety-row"><div><strong>${escapeHTML(COPY_TITLES[it.kind])}</strong><small>${escapeHTML(detail(it))} · ${escapeHTML(sizeText(it.size))}${it.onlyCopy ? " · only copy on this device" : ""}</small></div>
      <div class="safety-actions"><button class="button button-secondary" type="button" data-recover="${it.kind}" data-index="${it.index}" aria-label="Download: ${escapeHTML(COPY_TITLES[it.kind])}">↓ Download</button>
      <button class="button button-secondary" type="button" data-restore-copy="${it.kind}" data-index="${it.index}" aria-label="Restore: ${escapeHTML(COPY_TITLES[it.kind])}"${restoreBlocked ? " disabled" : ""}>Restore…</button>
      <button class="button button-danger" type="button" data-delete-copy="${it.kind}" data-index="${it.index}" aria-label="Delete: ${escapeHTML(COPY_TITLES[it.kind])}"${manage ? "" : " disabled"}>Delete…</button></div></div>`).join("");
    const damaged = inv.damagedLists.length
      ? `<p class="replace-note">A safety list on this device is itself damaged. It has been left untouched.</p>` : "";
    const locked = inv.items.length && !manage
      ? `<p class="replace-note">Safety copies can't be deleted right now, because your current data isn't saved and checked${recovery ? " (choose a recovery option first)" : ""}. They may be all that's left.</p>` : "";
    el.innerHTML = inv.items.length
      ? rows + damaged + locked + `<p class="tiny-muted"><strong>Restore…</strong> checks a copy and shows a preview first; nothing is replaced until you confirm. A downloaded copy can also be restored with “Restore from backup”.</p>
          <p class="tiny-muted"><strong>Restoring replaces everything.</strong> Each copy is a snapshot of one moment. Restoring one (for example, the copy made before a new pay cycle) replaces all current data, so anything recorded after that copy was made will no longer be in the app. Only the most recent replaced copy is kept here, so download a backup first.</p>
          <p class="tiny-muted"><strong>Deleting a copy</strong> only frees space; it never changes your current data. PesaOtas asks you to confirm each one, and asks you to download a copy first if it's the only one on this device.</p>`
      : damaged + `<p class="muted">No safety copies yet. They appear here automatically when PesaOtas moves, restores, recovers or resets your data.</p>`;
  }
  document.getElementById("data-safety-list").addEventListener("click", e => {
    const res = e.target.closest("[data-restore-copy]");
    if (res) {
      const raw = PesaStorage.getRecoveryText(store, res.dataset.restoreCopy, Number(res.dataset.index));
      if (raw === null) return showToast("That copy couldn't be read.");
      return openRestoreDialog(PesaData.analyzeBackup(raw));
    }
    const del = e.target.closest("[data-delete-copy]");
    if (del) return openCopyDelete(del.dataset.deleteCopy, Number(del.dataset.index));
    const btn = e.target.closest("[data-recover]");
    if (!btn) return;
    const raw = PesaStorage.getRecoveryText(store, btn.dataset.recover, Number(btn.dataset.index));
    if (raw === null) return showToast("That copy couldn't be read.");
    downloadText(raw, `pesaotas-${btn.dataset.recover}-copy-${todayISO()}.json`);
    showToast("Copy downloaded.");
  });

  // ---------------------------------------------------------------------------
  // Deleting a safety copy: per-type consequences → (download if it's the only
  // copy) → tick to confirm → verified delete. Never automatic (D-15).
  // ---------------------------------------------------------------------------
  let pendingCopyDelete = null;
  function copyConsequences(it) {
    const migrated = !!(state.meta && state.meta.migratedFrom);
    const same = it.copies > 0;
    switch (it.kind) {
      case "legacy": return [
        "This is the data the old PesaFlow app saved, exactly as it left it.",
        migrated
          ? "Your PesaOtas data was created from it when you upgraded, so deleting it doesn't change anything you see in PesaOtas."
          : "Your current PesaOtas data was not moved from it, so anything that exists only in this data will be lost.",
        same ? "An identical copy stays in Data safety, so you can still download it later."
             : "You won't be able to download PesaFlow's original data again.",
        "If you still open the old PesaFlow app in this browser, it will start empty. PesaOtas won't move or re-create this data."
      ];
      case "preserved": return [
        "This copy of your PesaFlow data was made just before it was moved into PesaOtas, in case the move went wrong.",
        "Deleting it doesn't change your current PesaOtas data.",
        same ? "An identical copy (such as the original PesaFlow data) stays on this device, so nothing is lost."
             : "It's the last copy on this device of your data as it was in PesaFlow."
      ];
      case "preUpgrade": return [
        "This is your data exactly as PesaOtas v1.5.0 saved it, copied just before it was upgraded to the v1.6 format.",
        "It's only needed if you ever go back to PesaOtas v1.5.0. It doesn't include anything recorded since the upgrade.",
        "Deleting it doesn't change your current data.",
        same ? "An identical copy stays on this device, so nothing is lost." : "It's the last copy on this device of your data in the v1.5.0 format."
      ];
      case "olderVersion": return [
        "This is one of two versions of your budget that PesaOtas found in this browser. You chose to keep the other one.",
        "It may contain entries that aren't in your current data.",
        "Deleting it doesn't change your current data."
      ];
      case "preCurrency": return [
        `This is your data as it was just before the currency was changed from ${it.from || "?"} to ${it.to || "?"}.`,
        "Restoring it would bring back that currency, but also replace anything recorded since.",
        "Deleting it doesn't change your current data. You can still change the currency back at any time; nothing is lost by doing that.",
        same ? "An identical copy stays on this device." : "It's the only copy of that moment on this device."
      ];
      case "quarantine": return [
        "This is saved data that failed PesaOtas's checks and couldn't be opened. It was set aside instead of being deleted.",
        "It may still hold transactions or settings that could be recovered from the downloaded file.",
        "Deleting it doesn't change your current data."
      ];
      default: return [
        "This is how your data looked just before it was last replaced as a whole by a restore, a recovery, a reset or a new pay cycle.",
        same ? "It's identical to your current data, so nothing is lost by deleting it."
             : "Apart from a backup file you downloaded yourself, it's your only way back to that point.",
        "Deleting it doesn't change your current data. The next restore, recovery, reset or new pay cycle keeps a new copy here."
      ];
    }
  }
  function openCopyDelete(kind, index) {
    const inv = PesaStorage.recoveryInventory(store);
    const it = inv.items.find(i => i.kind === kind && i.index === index);
    const raw = PesaStorage.getRecoveryText(store, kind, index);
    if (!it || raw === null) { renderDataSafety(); return showToast("That copy is no longer on this device."); }
    if (!canManageCopies(inv)) { renderDataSafety(); return showToast("Safety copies can't be deleted while your current data needs attention."); }
    pendingCopyDelete = { kind, index, raw, onlyCopy: it.onlyCopy, downloaded: false };
    const dlg = document.getElementById("copy-delete-dialog");
    document.getElementById("copy-delete-title").textContent = `Delete “${COPY_TITLES[kind]}”?`;
    const when = it.kind === "legacy" ? "" : `${it.kind === "quarantine" ? "Set aside" : "Saved"} ${formatWhen(it.at)} · `;
    document.getElementById("copy-delete-content").innerHTML =
      `<p class="muted">${escapeHTML(when + sizeText(it.size))}</p><ul class="copy-facts">${copyConsequences(it).map(t => `<li>${escapeHTML(t)}</li>`).join("")}</ul>`;
    document.getElementById("copy-delete-only").classList.toggle("hidden", !it.onlyCopy);
    document.getElementById("copy-delete-downloaded").classList.add("hidden");
    document.getElementById("copy-delete-check").checked = false;
    document.getElementById("copy-delete-error").classList.add("hidden");
    updateCopyDeleteButton();
    openDialog(dlg);
    document.getElementById("copy-delete-cancel").focus();
  }
  function updateCopyDeleteButton() {
    const p = pendingCopyDelete;
    document.getElementById("copy-delete-confirm").disabled =
      !p || !document.getElementById("copy-delete-check").checked || (p.onlyCopy && !p.downloaded);
  }
  document.getElementById("copy-delete-check").addEventListener("change", updateCopyDeleteButton);
  document.getElementById("copy-delete-download").addEventListener("click", () => {
    const p = pendingCopyDelete;
    if (!p) return;
    downloadText(p.raw, `pesaotas-${p.kind}-copy-${todayISO()}.json`);
    p.downloaded = true;
    document.getElementById("copy-delete-downloaded").classList.remove("hidden");
    updateCopyDeleteButton();
  });
  document.getElementById("copy-delete-cancel").addEventListener("click", () => closeDialog(document.getElementById("copy-delete-dialog")));
  document.getElementById("copy-delete-dialog").addEventListener("close", () => { pendingCopyDelete = null; });
  document.getElementById("copy-delete-confirm").addEventListener("click", () => {
    const p = pendingCopyDelete;
    if (!p || document.getElementById("copy-delete-confirm").disabled) return;
    const err = document.getElementById("copy-delete-error");
    if (!canSave || recovery) { err.textContent = "Your current data needs attention first. Nothing was deleted."; err.classList.remove("hidden"); return; }
    const result = PesaStorage.deleteRecoveryItem(store, p.kind, p.index, p.raw, { acknowledgedOnlyCopy: p.onlyCopy && p.downloaded });
    if (!result.ok) {
      err.textContent = ({
        "changed": "This copy changed after you opened this (perhaps in another tab). Nothing was deleted. Please look again.",
        "missing": "This copy is no longer on this device. Nothing was deleted.",
        "only-copy": "This is now the only copy on this device. Download it first. Nothing was deleted.",
        "current-not-safe": "Your current data isn't saved and checked, so safety copies are being kept. Nothing was deleted.",
        "damaged-list": "This safety list is damaged, so it's being left untouched. Nothing was deleted."
      })[result.reason] || "Couldn't delete: browser storage didn't respond. Nothing else was changed.";
      err.classList.remove("hidden");
      renderDataSafety();
      return;
    }
    closeDialog(document.getElementById("copy-delete-dialog"));
    renderDataSafety(); renderStorageProtection();
    showToast("Safety copy deleted. Your current data is unchanged.");
  });

  // ---------------------------------------------------------------------------
  // Settings → Storage protection (D-15). Asking the browser to keep data
  // ("persistent storage") reduces, but never removes, the need for backups.
  // ---------------------------------------------------------------------------
  async function refreshPersistStatus() {
    const api = storageApi();
    if (!api || typeof api.persisted !== "function") { persistStatus = "unsupported"; return; }
    try { persistStatus = (await api.persisted()) ? "granted" : "not-granted"; }
    catch { persistStatus = "unsupported"; }
  }
  async function requestPersistence(manual) {
    const api = storageApi();
    if (!api) { persistStatus = "unsupported"; renderStorageProtection(); return; }
    let granted = false;
    try { granted = await api.persist(); } catch { granted = false; }
    if (store) PesaStorage.updateDeviceInfo(store, { persistAskedAt: new Date().toISOString(), persistGranted: granted });
    persistStatus = granted ? "granted" : "not-granted";
    renderStorageProtection();
    if (manual) showToast(granted
      ? "This browser has agreed to protect your PesaOtas data."
      : "The browser said no for now. It decides by itself; installing PesaOtas or using it regularly can help.");
  }
  // Asked once, automatically, after the first successful save (not on page load).
  function askForPersistenceOnce() {
    if (askedPersistThisSession || !store || !storageApi()) return;
    askedPersistThisSession = true;
    if (PesaStorage.readDeviceInfo(store).persistAskedAt) return;
    refreshPersistStatus().then(() => persistStatus === "granted"
      ? PesaStorage.updateDeviceInfo(store, { persistAskedAt: new Date().toISOString(), persistGranted: true })
      : requestPersistence(false));
  }
  function renderStorageProtection() {
    const dl = document.getElementById("storage-status");
    if (!dl) return;
    const info = store ? PesaStorage.readDeviceInfo(store) : {};
    const usage = store ? PesaStorage.storageUsage(store) : { total: 0 };
    const protection = {
      granted: "Protected: the browser won't clear it to free up space",
      "not-granted": "Not protected yet: the browser may clear it if the device runs low on space",
      unsupported: "This browser doesn't offer storage protection",
      unknown: "Checking…"
    }[persistStatus];
    const offline = !location.protocol.startsWith("http")
      ? "Not available when PesaOtas is opened as a file"
      : appCopy ? `Ready (version ${appCopy.version})`
      : ("serviceWorker" in navigator) ? "Not ready yet. Open PesaOtas online once more" : "Not supported by this browser";
    const rows = [
      ["Protection", protection],
      ["Last backup downloaded", info.lastBackupAt ? formatWhen(info.lastBackupAt) : "Not yet on this device"],
      ["Space used", `${sizeText(usage.total)} of the roughly 5 MB browsers allow`],
      ["Works offline", offline]
    ];
    dl.innerHTML = rows.map(([k, v]) => `<div><dt>${escapeHTML(k)}</dt><dd>${escapeHTML(v)}</dd></div>`).join("");
    document.getElementById("persist-button").classList.toggle("hidden", persistStatus !== "not-granted" || !store);
  }
  document.getElementById("persist-button").addEventListener("click", () => requestPersistence(true));

  const now = new Date();
  document.getElementById("today-label").textContent = formatDayDate(todayISO()).toUpperCase();
  // ---------------------------------------------------------------------------
  // Currency (v1.6, D-17): one currency per budget, never converted.
  // ---------------------------------------------------------------------------
  /** True once the budget holds any amount, so a currency change would relabel real figures. */
  function hasRecords(s) {
    return s.openingBalance > 0 || s.transactions.length > 0 || (s.cycles || []).length > 0 ||
      s.categories.some(c => c.budget > 0) || (s.savingsDestinations || []).some(d => d.openingBalance > 0);
  }
  function renderCurrencyLabels() {
    document.querySelectorAll("[data-currency-symbol]").forEach(el => { el.textContent = cur().symbol; });
    document.querySelectorAll("[data-currency-select]").forEach(sel => {
      if (!sel.options.length) sel.innerHTML = PesaCurrency.CODES.map(c => `<option value="${c}">${escapeHTML(PesaCurrency.label(c))}</option>`).join("");
      sel.value = state.currency;
    });
    document.getElementById("currency-change-button").disabled = true;
    const kes = state.currency === "KES";
    document.getElementById("export-v15-button").disabled = !kes;
    document.getElementById("export-v15-note").textContent = kes
      ? "Only needed if you ever go back to PesaOtas v1.5.0. It keeps every amount, transaction, category, savings account and pay cycle. It leaves out only things v1.6 alone keeps, none of them financial: the record of currency changes, when your budget was upgraded, and alert review records."
      : `Not available for a budget in ${PesaCurrency.label(state.currency)}: PesaOtas v1.5.0 shows every amount as Kenyan shillings, so it would misread this budget. To go back to v1.5.0, change the currency back to Kenyan Shilling (KES) first, or use the copy made before the upgrade (Data safety).`;
  }
  document.getElementById("currency-select").addEventListener("change", e => {
    document.getElementById("currency-change-button").disabled = e.target.value === state.currency;
  });
  document.getElementById("currency-change-button").addEventListener("click", () => {
    requestCurrencyChange(document.getElementById("currency-select").value);
  });
  document.getElementById("onboarding-currency").addEventListener("change", e => {
    const to = e.target.value;
    e.target.value = state.currency; // shown again once saved
    requestCurrencyChange(to);
  });
  function requestCurrencyChange(to) {
    if (!PesaCurrency.isSupported(to) || to === state.currency) return;
    if (!canSave) return showToast(BLOCKED_MESSAGES[saveBlock] || BLOCKED_MESSAGES.storage);
    if (hasBudgetDraft()) return showToast("Save or discard your budget changes first.");
    if (!hasRecords(state)) {
      // Nothing recorded yet, so there is nothing to relabel.
      state = { ...state, currency: to };
      if (saveState()) showToast(`Currency set to ${PesaCurrency.label(to)}.`);
      renderAll(); populateSettings();
      return;
    }
    openCurrencyDialog(to);
  }
  let pendingCurrency = null;
  function openCurrencyDialog(to) {
    const from = state.currency;
    const t = totals();
    const latest = state.transactions.slice().sort(newestFirst)[0];
    const examples = [["Opening balance", state.openingBalance], ["Spending cash now", t.cash]];
    if (latest) examples.push([`Latest entry (${formatDate(latest.date)})`, latest.amount]);
    const f = (v, c) => escapeHTML(PesaCurrency.format(v, c));
    pendingCurrency = { from, to };
    document.getElementById("currency-dialog-title").textContent = `Change the currency to ${PesaCurrency.info(to).name}?`;
    document.getElementById("currency-dialog-content").innerHTML =
      `<dl class="summary-list"><div><dt>Current currency</dt><dd>${escapeHTML(PesaCurrency.label(from))}</dd></div><div><dt>New currency</dt><dd>${escapeHTML(PesaCurrency.label(to))}</dd></div></dl>` +
      `<p><strong>No exchange-rate conversion takes place.</strong> Only the label changes: every number in your budget stays exactly the same.</p>` +
      `<table class="currency-examples"><caption>How your amounts will look</caption><thead><tr><th scope="col">Amount</th><th scope="col">Now</th><th scope="col">After the change</th></tr></thead><tbody>` +
      examples.map(([k, v]) => `<tr><th scope="row">${escapeHTML(k)}</th><td>${f(v, from)}</td><td>${f(v, to)}</td></tr>`).join("") +
      `</tbody></table>` +
      `<p class="muted">Use this if your budget is in the wrong currency. Before changing, PesaOtas saves a copy of your data in Settings → Data safety (“Before currency change”). To undo, change the currency back (nothing is lost) or restore that copy.</p>`;
    document.getElementById("currency-dialog-check-text").textContent =
      `I understand my amounts will be shown in ${PesaCurrency.label(to)} instead of ${PesaCurrency.label(from)}, without any conversion.`;
    document.getElementById("currency-dialog-check").checked = false;
    document.getElementById("currency-dialog-confirm").textContent = `Change to ${to}`;
    document.getElementById("currency-dialog-confirm").disabled = true;
    document.getElementById("currency-dialog-error").classList.add("hidden");
    openDialog(document.getElementById("currency-dialog"));
    document.getElementById("currency-dialog-cancel").focus();
  }
  const currencyError = (msg) => { const el = document.getElementById("currency-dialog-error"); el.textContent = msg; el.classList.remove("hidden"); };
  document.getElementById("currency-dialog-check").addEventListener("change", e => {
    document.getElementById("currency-dialog-confirm").disabled = !e.target.checked;
  });
  document.getElementById("currency-dialog-cancel").addEventListener("click", () => closeDialog(document.getElementById("currency-dialog")));
  document.getElementById("currency-dialog").addEventListener("close", () => { pendingCurrency = null; renderCurrencyLabels(); });
  document.getElementById("currency-dialog-download").addEventListener("click", () => {
    downloadText(PesaData.serializeBackup(state), `pesaotas-backup-${todayISO()}.json`);
    if (store) PesaStorage.updateDeviceInfo(store, { lastBackupAt: new Date().toISOString() });
    showToast("Backup downloaded.");
  });
  document.getElementById("currency-dialog-confirm").addEventListener("click", () => {
    const p = pendingCurrency;
    if (!p || !document.getElementById("currency-dialog-check").checked) return;
    if (!canSave) return currencyError(BLOCKED_MESSAGES[saveBlock] || BLOCKED_MESSAGES.storage);
    if (hasBudgetDraft()) return currencyError("Save or discard your budget changes first. Nothing has been changed.");
    if (state.currency !== p.from) return currencyError("The currency changed while this was open. Nothing has been changed.");
    const now = new Date();
    // 1. A verified safety copy first, in its own list (never replaces another copy).
    if (!PesaStorage.keepPreCurrencyCopy(store, now, p.from, p.to)) {
      return currencyError("PesaOtas couldn't save a safety copy of your data first, so the currency was not changed. Nothing has been changed. Free up browser storage, or download a backup, then try again.");
    }
    // 2. Relabel only: the same numbers, a new currency code, and a record of the change.
    const history = (state.meta.currencyHistory || []).concat([{ from: p.from, to: p.to, changedAt: now.toISOString() }]);
    state = { ...state, currency: p.to, meta: { ...state.meta, currencyHistory: history } };
    if (!saveState()) {
      renderAll();
      return currencyError(`A safety copy was saved in Settings → Data safety, but the new currency couldn't be saved. Your budget is still in ${PesaCurrency.label(p.from)}; nothing else has changed.`);
    }
    closeDialog(document.getElementById("currency-dialog"));
    renderAll(); populateSettings(); renderDataSafety();
    showToast(`Currency changed to ${PesaCurrency.label(p.to)}. Amounts were not converted. A copy from before the change is in Settings → Data safety.`);
  });

  // Going back to v1.5.0 (D-16): a backup it can restore. KES budgets only.
  document.getElementById("export-v15-button").addEventListener("click", () => {
    const r = PesaData.toV15Backup(state);
    if (!r.ok) {
      return showToast(r.reason === "currency"
        ? `PesaOtas v1.5.0 can't show a budget in ${PesaCurrency.label(r.currency)} correctly, so this backup isn't available.`
        : "This backup couldn't be made: your data didn't pass a final check.");
    }
    downloadText(r.text, `pesaotas-v1.5-compatible-backup-${todayISO()}.json`);
    if (store) PesaStorage.updateDeviceInfo(store, { lastBackupAt: new Date().toISOString() });
    renderStorageProtection();
    showToast(r.omitted.length
      ? `v1.5.0-compatible backup downloaded. Left out (v1.6 only): ${r.omitted.join("; ")}.`
      : "v1.5.0-compatible backup downloaded. Nothing was left out.");
  });

  // ---------------------------------------------------------------------------
  // Two versions found (D-16): v1.6 data, plus different data saved since by an
  // older version. Nothing is chosen automatically; the other is always kept.
  // ---------------------------------------------------------------------------
  function openConflictDialog() {
    if (saveBlock !== "conflict") return;
    const older = boot.olderReport;
    const olderOk = !!(older && PesaData.isClean(older) && older.format === "pesaotas-v2");
    document.getElementById("conflict-intro").innerHTML =
      `<p>This budget was upgraded to the v1.6 format, but an older version of PesaOtas (v1.5.0 or earlier) has since saved different data in this browser, for example in a tab that was still open, or after going back to v1.5.0. <strong>Nothing has been overwritten or deleted.</strong></p>` +
      `<p class="muted">Choose which data to keep. The other one is kept in full in Settings → Data safety, where you can download or restore it later. Until you choose, nothing will be saved.</p>`;
    const latestOf = (st) => st.transactions.map(x => x.date).sort().slice(-1)[0];
    const col = (title, st) => `<section class="conflict-col"><h3>${escapeHTML(title)}</h3>${summaryMarkup(PesaData.summarize(st), "view")}<p class="tiny-muted">Latest entry: ${st.transactions.length ? escapeHTML(formatDate(latestOf(st))) : "none"}</p></section>`;
    document.getElementById("conflict-content").innerHTML =
      col("PesaOtas v1.6 data", boot.state) +
      (olderOk ? col("Saved by the older version", older.state)
        : `<section class="conflict-col"><h3>Saved by the older version</h3><p>This data can't be used as it is:</p><ul class="issue-plain">${((older && older.errors) || ["It couldn't be read."]).map(m => `<li>${escapeHTML(m)}</li>`).join("")}</ul><p class="muted">It will be kept in Data safety if you keep the v1.6 data.</p></section>`);
    document.getElementById("conflict-older").classList.toggle("hidden", !olderOk);
    document.getElementById("conflict-error").classList.add("hidden");
    openDialog(document.getElementById("conflict-dialog"));
  }
  function resolveConflict(choice) {
    const r = PesaStorage.resolveOlderVersion(store, new Date(), choice, { currentRaw: boot.raw, olderRaw: boot.olderRaw });
    if (!r.ok) {
      const err = document.getElementById("conflict-error");
      err.textContent = ({
        changed: "Your data changed in another tab while this was open. Nothing was changed here. Reload and choose again.",
        "copy-failed": "PesaOtas couldn't save a safety copy of the other data first, so nothing was changed. Free up browser storage, then try again."
      })[r.reason] || "That couldn't be completed, so nothing was changed. Reload and try again.";
      err.classList.remove("hidden");
      return;
    }
    state = r.state; lastSaved = clone(state); storedRaw = r.raw; canSave = true; saveBlock = null; noticeKind = null;
    closeDialog(document.getElementById("conflict-dialog"));
    renderAll(); populateSettings(); renderDataSafety(); renderNotice();
    showToast(choice === "keep-current"
      ? "Kept the v1.6 data. The data saved by the older version is in Settings → Data safety."
      : "Now using the data saved by the older version, upgraded to the v1.6 format. Your previous v1.6 data is in Settings → Data safety.");
  }
  document.getElementById("conflict-keep").addEventListener("click", () => resolveConflict("keep-current"));
  document.getElementById("conflict-older").addEventListener("click", () => resolveConflict("use-older"));
  document.getElementById("conflict-later").addEventListener("click", () => { closeDialog(document.getElementById("conflict-dialog")); renderNotice(); });

  // ---------------------------------------------------------------------------
  // Other tabs (D-16). A tab whose data was changed elsewhere stops saving, so it
  // can never overwrite newer data; saves also re-check the stored data first.
  // ---------------------------------------------------------------------------
  function markStale(kind) {
    if (saveBlock === "stale" && kind !== "older") return;
    canSave = false; saveBlock = "stale";
    noticeKind = kind === "older" ? "older-tab" : "stale";
    renderNotice(); renderDataSafety(); renderDetective();
  }
  window.addEventListener("storage", e => {
    if (!store) return;
    if (e.key === null) return markStale("tab"); // storage cleared from another tab
    if (e.key === PesaStorage.KEYS.current && e.newValue !== storedRaw) return markStale("tab");
    if (e.key === PesaStorage.KEYS.v15 && e.newValue !== null && !PesaStorage.isMovedMarker(e.newValue)) return markStale("older");
  });

  renderAll();
  renderNotice();
  if (recovery) openRecoveryDialog();
  if (saveBlock === "conflict") openConflictDialog();
  if (saveBlock === "reviews") openReviewRecordsDialog();
  document.querySelectorAll(".app-version").forEach(el => { el.textContent = `v${window.PESAOTAS_VERSION || ""}`; });
  refreshPersistStatus().then(renderStorageProtection);

  // ---------------------------------------------------------------------------
  // App updates (D-14). A new version installs in the background and waits.
  // It is used only when the user chooses "Update now", never while there are
  // unsaved changes. Updates replace app files only; saved data is untouched.
  // ---------------------------------------------------------------------------
  const UPDATED_FLAG = "pesaotas.just-updated";
  try {
    if (sessionStorage.getItem(UPDATED_FLAG)) {
      sessionStorage.removeItem(UPDATED_FLAG);
      showToast(`Updated to PesaOtas v${window.PESAOTAS_VERSION}. Your data is unchanged.`);
    }
  } catch { /* session storage unavailable: no message */ }

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    const banner = document.getElementById("update-banner");
    const text = document.getElementById("update-text");
    const nowBtn = document.getElementById("update-now");
    const laterBtn = document.getElementById("update-later");
    const hadController = !!navigator.serviceWorker.controller;
    let waiting = null;        // a complete new version, ready to use
    let applying = false;      // this tab asked for the switch
    let elsewhere = false;     // another tab switched; this tab should reload
    let dismissed = false;
    const busy = () => hasBudgetDraft() || editingId !== null || !!document.querySelector("dialog[open]");
    function renderUpdate() {
      if (applying) return;
      const show = !dismissed && (waiting || elsewhere);
      banner.classList.toggle("hidden", !show);
      if (!show) return;
      const blocked = busy();
      if (elsewhere) {
        text.textContent = blocked
          ? "PesaOtas was updated in another tab. Save or discard your changes here, then reload to use the new version."
          : "PesaOtas was updated in another tab. Reload this tab to use the new version. Your data is unchanged.";
        nowBtn.textContent = "Reload";
      } else {
        text.textContent = blocked
          ? "A new version of PesaOtas is ready. Save or discard your unsaved changes (and close any open window) first, then update."
          : "A new version of PesaOtas is ready. Updating only replaces the app's files. Your data stays exactly as it is.";
        nowBtn.textContent = "Update now";
      }
      nowBtn.disabled = blocked;
    }
    function offer(worker) { waiting = worker; dismissed = false; renderUpdate(); }
    nowBtn.addEventListener("click", () => {
      if (busy()) return renderUpdate();
      if (elsewhere) return location.reload();
      if (!waiting) return;
      applying = true;
      nowBtn.disabled = true;
      text.textContent = "Updating…";
      try { sessionStorage.setItem(UPDATED_FLAG, "1"); } catch { /* no message after reload */ }
      waiting.postMessage({ type: "SKIP_WAITING" });
    });
    laterBtn.addEventListener("click", () => { dismissed = true; renderUpdate(); });
    // Keep the banner's advice current as drafts are made, saved or discarded.
    ["input", "change", "click", "close"].forEach(t => document.addEventListener(t, () => { if (waiting || elsewhere) setTimeout(renderUpdate, 0); }, true));

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (applying) { location.reload(); return; }
      if (hadController) { elsewhere = true; dismissed = false; renderUpdate(); }
    });
    const askVersion = () => {
      const c = navigator.serviceWorker.controller;
      if (!c || typeof MessageChannel !== "function") return;
      const ch = new MessageChannel();
      ch.port1.onmessage = (e) => { if (e.data && e.data.version) { appCopy = e.data; renderStorageProtection(); } };
      c.postMessage({ type: "GET_VERSION" }, [ch.port2]);
    };
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").then(reg => {
        if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const w = reg.installing;
          if (!w) return;
          w.addEventListener("statechange", () => {
            if (w.state === "installed" && navigator.serviceWorker.controller) offer(w);
            if (w.state === "redundant" && waiting === w) { waiting = null; renderUpdate(); }
          });
        });
        navigator.serviceWorker.ready.then(askVersion);
        const check = () => reg.update().catch(() => { /* offline: try again later */ });
        setInterval(check, 60 * 60 * 1000);
        document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
      }).catch(() => { /* offline support unavailable; the app still works */ });
      navigator.serviceWorker.addEventListener("controllerchange", askVersion);
    });
  }
})();
