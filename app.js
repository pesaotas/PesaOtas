(() => {
  "use strict";

  const money = (value) => PesaFinance.formatKSh(value); // "KSh 25,000" (KI-18)
  const SAVINGS_TYPES = ["savings_transfer", "savings_withdrawal"];
  const isSavingsType = (type) => SAVINGS_TYPES.includes(type);
  const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  };
  const formatDate = (iso) => {
    if (!iso) return "";
    return new Date(`${iso}T12:00:00`).toLocaleDateString("en-KE", {day:"numeric",month:"short",year:"numeric"});
  };
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
    quarantine: "Damaged data set aside",
    preRestore: "Your data before the last restore, recovery, reset or new pay cycle"
  };
  const sizeText = (chars) => chars < 1024 ? "under 1 KB" : `about ${Math.round(chars / 1024)} KB`;
  // Deleting safety copies is allowed only while the current data is saved and healthy (D-15).
  const canManageCopies = (inv) => canSave && !recovery && inv.currentSafe;


  switch (boot.status) {
    case "ok":
    case "migrated":
      state = boot.state; break;
    case "new":
      // A genuinely new user: nothing on this device. Start empty (nothing is written until they act).
      state = PesaData.createBlankState(); break;
    case "migration-failed":
      state = boot.state; canSave = false; break;   // read-only view of the converted copy
    case "corrupt":
      state = PesaData.createBlankState(); canSave = false; recovery = boot; break;
    default: // "unavailable"
      state = PesaData.createBlankState(); canSave = false;
  }
  lastSaved = clone(state);

  function saveState() {
    if (!canSave) {
      state = clone(lastSaved);
      showToast(recovery ? "Not saved — choose a recovery option first." : "Not saved — this browser isn't storing PesaOtas data.");
      return false;
    }
    const result = PesaStorage.save(store, state);
    if (result.ok) {
      state = result.state;
      lastSaved = clone(state);
      askForPersistenceOnce();
      return true;
    }
    state = clone(lastSaved); // never show unsaved changes as if they were saved
    showToast(result.reason === "invalid"
      ? "Not saved — that change failed a data check."
      : "Could not save. Browser storage may be full — download a backup from Settings.");
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
      bar.style.width = "4%";
      note.textContent = state.payday ? "Set when this pay cycle started (Settings) to see your progress." : "Set your payday in Settings.";
    }
  }
  function renderRolloverBanner(info) {
    const banner = document.getElementById("rollover-banner");
    banner.classList.toggle("hidden", !info.rolloverDue);
    if (!info.rolloverDue) return;
    const when = info.today === info.payday ? "Today is payday." : `Payday was on ${formatDate(info.payday)}.`;
    document.getElementById("rollover-banner-text").textContent =
      `${when} Your budget is still counting the old pay cycle. Start the new cycle when you're ready — you'll see a summary first, and nothing changes until you confirm.`;
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
    document.getElementById("days-to-payday").innerHTML = state.payday ? `${days} <small>days</small>` : `— <small>no payday set</small>`;
    document.getElementById("payday-date").textContent = state.payday ? new Date(`${state.payday}T12:00:00`).toLocaleDateString("en-KE",{weekday:"long",day:"numeric",month:"long",year:"numeric"}) : "Set your payday in settings";
    document.getElementById("income-total").textContent = money(t.earned);
    document.getElementById("expense-total").textContent = money(t.spent);
    document.getElementById("safe-to-spend").textContent = money(t.safeToSpend);
    document.getElementById("daily-guide").textContent = guide === null ? "—" : money(guide);
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
      alert.textContent = `${t.overCount} budget category/categories are over their planned amount. Review your budget before making more purchases.`;
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
          <div class="budget-edit-bottom"><input class="input budget-value" type="number" min="0" step="50" inputmode="numeric" value="${escapeHTML(value)}" data-budget-id="${escapeHTML(c.id)}" aria-label="${escapeHTML(c.name)} allocation (KSh)"><span>${status}</span></div>
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
  function renderInsights() {
    const t = totals();
    document.getElementById("insight-expenses").textContent = money(t.spent);
    document.getElementById("insight-income").textContent = money(t.earned);
    document.getElementById("insight-count").textContent = state.transactions.length;
    // Spending only: savings moves never appear as spending (KI-08).
    const rows = state.categories.filter(c => !(c.destinationId && isSavingsCategory(c)))
      .map(c => ({ name: c.name, spent: t.spentByCategory[c.id] || 0, budget: c.budget }));
    if (t.uncategorisedSpent > 0) rows.push({ name: "Other / uncategorised", spent: t.uncategorisedSpent, budget: null }); // KI-11
    rows.sort((a,b) => b.spent - a.spent);
    document.getElementById("insight-categories").innerHTML = rows.map(c => {
      const noBudget = c.budget === null;
      const pct = noBudget ? 100 : c.budget ? Math.min(100,c.spent/c.budget*100) : (c.spent?100:0);
      const over = noBudget || c.spent > c.budget;
      return `<div class="insight-line"><strong>${escapeHTML(c.name)}</strong><div class="progress-track"><div class="progress-fill ${over?"over":""}" style="width:${pct}%"></div></div><span class="tiny-muted">${money(c.spent)} / ${noBudget ? "no budget" : money(c.budget)}</span></div>`;
    }).join("");
    let message = "Record a few transactions and PesaOtas will start identifying spending patterns.";
    if (state.transactions.length) {
      const top = rows[0];
      message = top && top.spent > 0
        ? `${top.name} is currently your highest recorded spending category at ${money(top.spent)}. Keep recording purchases so you can spot patterns early.`
        : "No spending recorded yet.";
      if (t.overCount) message += ` You have ${t.overCount} category/categories above their planned budget.`;
      else if (top && top.spent > 0) message += " None of your recorded categories are over budget. Keep it up.";
      if (t.uncategorisedSpent > 0) message += ` ${money(t.uncategorisedSpent)} of spending has no budget category, so it comes out of your unallocated money.`;
      if (t.transferredToSavings || t.withdrawnFromSavings) {
        message += ` You moved ${money(t.transferredToSavings)} into savings${t.withdrawnFromSavings ? ` and took ${money(t.withdrawnFromSavings)} back out` : ""}; savings moves are not counted as spending or income.`;
      }
    }
    document.getElementById("insight-message").textContent = message;
    renderCycleHistory();
  }

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
      showToast(`Added ${r.added} categories, each at KSh 0. Set an allocation for each one, then save.`);
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
      <label class="field-label" for="dest-open-${escapeHTML(d.id)}">${escapeHTML(d.name)} — starting balance (KSh)</label>
      <input class="input dest-opening" id="dest-open-${escapeHTML(d.id)}" data-dest-id="${escapeHTML(d.id)}" type="number" min="0" step="1" value="${d.openingBalance}">
      <small class="tiny-muted">Balance now: ${money(t.destinationBalances[d.id] || 0)}</small>`).join("");
  }
  function renderAll() {
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
    showToast("Backup downloaded.");
  });
  document.getElementById("import-file").addEventListener("change",async e=>{
    await startRestore(e.target.files[0]);
    e.target.value = "";
  });
  document.getElementById("reset-button").addEventListener("click",()=>{
    if (!confirm("Erase everything and start PesaOtas empty? Your budget, transactions, pay cycles and savings records will be removed from this browser. A copy is kept in Settings → Data safety (only the most recent copy), so download a backup first if you might need it.")) return;
    budgetDraft = {};
    if (applyReplacement(PesaData.createBlankState(), "PesaOtas has been emptied. Your previous data is in Data safety.")) {
      resetEntryForm();
      setView("overview");
    }
  });

  // ---------------------------------------------------------------------------
  // Replacing all data (restore, recovery, reset): one guarded path.
  // ---------------------------------------------------------------------------
  function applyReplacement(newState, message) {
    if (!store) { showToast("This browser isn't storing PesaOtas data, so nothing can be saved here."); return false; }
    if (recovery && !recovery.quarantined && !damagedDownloaded) {
      showToast("Download the damaged data first, so nothing is lost.");
      return false;
    }
    if (!recovery && !PesaStorage.keepPreRestoreCopy(store, new Date())) {
      showToast("Couldn't keep a safety copy of your current data. Download a backup first, then try again.");
      return false;
    }
    const result = PesaStorage.save(store, newState);
    if (!result.ok) {
      showToast(result.reason === "invalid" ? "Not saved — the data failed a final check." : "Could not save. Browser storage may be full.");
      return false;
    }
    state = result.state; lastSaved = clone(state); canSave = true; recovery = null;
    if (noticeKind !== "migrated") noticeKind = null;
    renderAll(); populateSettings(); renderDataSafety(); renderNotice();
    showToast(message);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Shared preview markup
  // ---------------------------------------------------------------------------
  const formatLongDate = (iso) => iso
    ? new Date(`${iso}T12:00:00`).toLocaleDateString("en-KE",{day:"numeric",month:"long",year:"numeric"})
    : "Not set";
  const formatWhen = (iso) => {
    const d = iso ? new Date(iso) : null;
    return d && !isNaN(d) ? d.toLocaleString("en-KE",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}) : "unknown date";
  };
  function issueSection(title, items, cls) {
    if (!items.length) return "";
    const shown = items.slice(0, 40).map(m => `<li>${escapeHTML(m)}</li>`).join("");
    const more = items.length > 40 ? `<li>…and ${items.length - 40} more</li>` : "";
    return `<section class="issue-group ${cls}"><h4>${escapeHTML(title)} <span>(${items.length})</span></h4><ul>${shown}${more}</ul></section>`;
  }
  const issueSections = (r) =>
    issueSection("Will be left out", r.rejected, "issue-rejected") +
    issueSection("Corrected automatically", r.fixed, "issue-fixed") +
    issueSection("Please check", r.warnings, "issue-warning") +
    issueSection("Good to know", r.notes, "issue-note");
  function summaryMarkup(s) {
    const rows = [
      ["Opening balance", money(s.openingBalance)],
      ["Next payday", formatLongDate(s.payday)],
      ["Pay cycle", s.cycleStart ? `Started ${formatLongDate(s.cycleStart)}${s.closedCycles ? ` · ${s.closedCycles} earlier cycle(s) in history` : ""}` : "No start date set"],
      ["Budget categories", String(s.categoryCount)],
      ["Transactions", `${s.transactionCount} (${s.incomeCount} income, ${s.expenseCount} expenses)`],
      ["Dates covered", s.firstDate ? `${formatDate(s.firstDate)} – ${formatDate(s.lastDate)}` : "No transactions"],
      ["Cash after restoring", money(s.cash)],
      ["Savings after restoring", `${money(s.totalSavings)} (${s.savingsCount} savings ${s.savingsCount === 1 ? "entry" : "entries"})`],
      ["Savings destinations", s.destinations.join(", ") || "None"]
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
      const replaces = recovery
        ? `<strong>Your damaged data stays safe</strong> in Settings → Data safety.`
        : `<strong>This replaces everything on this device now:</strong> ${state.transactions.length} transactions, cash ${escapeHTML(money(current.cash))}.${missingNote} A copy of what's replaced is kept in Settings → Data safety, but only the most recent one — download a backup first if you might need it.`;
      title.textContent = "Check this backup before restoring";
      content.innerHTML =
        `<p class="muted">${report.format === "pesaflow-v1" ? "This is an older PesaFlow backup. It will be converted for PesaOtas." : "PesaOtas backup."}</p>` +
        summaryMarkup(report.summary) +
        `<p class="replace-note">${replaces}</p>` +
        issueSections(report);
      confirmBtn.textContent = report.rejected.length ? `Restore, leaving out ${report.rejected.length}` : "Replace my data";
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
    if (applyReplacement(report.state, report.rejected.length ? `Backup restored (${report.rejected.length} item(s) left out).` : "Backup restored.")) {
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
      : `<p class="replace-note"><strong>PesaOtas couldn't make a safety copy.</strong> Download the damaged data first — the other options unlock after that.</p>`;
    if (r.ok) {
      html += `<p><strong>Recoverable:</strong> ${r.state.transactions.length} transactions and ${r.state.categories.length} budget categories pass every check.</p>` + issueSections(r);
    } else {
      html += `<p>It is too damaged to recover automatically:</p><ul class="issue-plain">${r.errors.map(m => `<li>${escapeHTML(m)}</li>`).join("")}</ul>`;
    }
    html += `<p class="muted">Choose what to do. Until you do, nothing you change will be saved.</p>`;
    document.getElementById("recovery-content").innerHTML = html;

    const recoverBtn = document.getElementById("recovery-recover");
    recoverBtn.classList.toggle("hidden", !r.ok);
    if (r.ok) recoverBtn.textContent = r.rejected.length
      ? `Recover ${r.state.transactions.length} transactions (leave out ${r.rejected.length})`
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
    const left = r.rejected.length ? ` ${r.rejected.length} item(s) listed under "Will be left out" won't be included.` : "";
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
  let noticeKind = { migrated: "migrated", "migration-failed": "migration-failed", corrupt: "recovery", unavailable: "unavailable" }[boot.status] || null;
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
    } else if (kind === "unavailable") {
      text.textContent = "This browser isn't letting PesaOtas store data, so nothing you enter will be saved. Check that site data is allowed for this page, or try another browser.";
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
    const detail = (it) => {
      if (it.kind === "legacy") return "Still on this device, unchanged. PesaOtas never edits it or deletes it on its own.";
      if (it.kind === "quarantine") return `${formatWhen(it.at)} · ${it.reason || "failed its checks"}`;
      return `Saved ${formatWhen(it.at)}`;
    };
    const rows = inv.items.map(it => `<div class="safety-row"><div><strong>${escapeHTML(COPY_TITLES[it.kind])}</strong><small>${escapeHTML(detail(it))} · ${escapeHTML(sizeText(it.size))}${it.onlyCopy ? " · only copy on this device" : ""}</small></div>
      <div class="safety-actions"><button class="button button-secondary" type="button" data-recover="${it.kind}" data-index="${it.index}" aria-label="Download: ${escapeHTML(COPY_TITLES[it.kind])}">↓ Download</button>
      <button class="button button-danger" type="button" data-delete-copy="${it.kind}" data-index="${it.index}" aria-label="Delete: ${escapeHTML(COPY_TITLES[it.kind])}"${manage ? "" : " disabled"}>Delete…</button></div></div>`).join("");
    const damaged = inv.damagedLists.length
      ? `<p class="replace-note">A safety list on this device is itself damaged. It has been left untouched.</p>` : "";
    const locked = inv.items.length && !manage
      ? `<p class="replace-note">Safety copies can't be deleted right now, because your current data isn't saved and checked${recovery ? " (choose a recovery option first)" : ""}. They may be all that's left.</p>` : "";
    el.innerHTML = inv.items.length
      ? rows + damaged + locked + `<p class="tiny-muted">To use a downloaded copy, choose “Restore from backup”. Every file is checked and previewed before anything is replaced.</p>
          <p class="tiny-muted"><strong>Restoring replaces everything.</strong> Each copy is a snapshot of one moment. Restoring one — for example the copy made before a new pay cycle — replaces all current data, so anything recorded after that copy was made will no longer be in the app. Only the most recent replaced copy is kept here, so download a backup first.</p>
          <p class="tiny-muted"><strong>Deleting a copy</strong> only frees space; it never changes your current data. PesaOtas asks you to confirm each one, and asks you to download a copy first if it's the only one on this device.</p>`
      : damaged + `<p class="muted">No safety copies yet. They appear here automatically when PesaOtas moves, restores, recovers or resets your data.</p>`;
  }
  document.getElementById("data-safety-list").addEventListener("click", e => {
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
      case "quarantine": return [
        "This is saved data that failed PesaOtas's checks and couldn't be opened. It was set aside instead of being deleted.",
        "It may still hold transactions or settings that could be recovered from the downloaded file.",
        "Deleting it doesn't change your current data."
      ];
      default: return [
        "This is how your data looked just before it was last replaced as a whole — by a restore, a recovery, a reset or a new pay cycle.",
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
        "changed": "This copy changed after you opened this (perhaps in another tab). Nothing was deleted — please look again.",
        "missing": "This copy is no longer on this device. Nothing was deleted.",
        "only-copy": "This is now the only copy on this device. Download it first. Nothing was deleted.",
        "current-not-safe": "Your current data isn't saved and checked, so safety copies are being kept. Nothing was deleted.",
        "damaged-list": "This safety list is damaged, so it's being left untouched. Nothing was deleted."
      })[result.reason] || "Couldn't delete — browser storage didn't respond. Nothing else was changed.";
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
      granted: "Protected — the browser won't clear it to free up space",
      "not-granted": "Not protected yet — the browser may clear it if the device runs low on space",
      unsupported: "This browser doesn't offer storage protection",
      unknown: "Checking…"
    }[persistStatus];
    const offline = !location.protocol.startsWith("http")
      ? "Not available when PesaOtas is opened as a file"
      : appCopy ? `Ready (version ${appCopy.version})`
      : ("serviceWorker" in navigator) ? "Not ready yet — open PesaOtas online once more" : "Not supported by this browser";
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
  document.getElementById("today-label").textContent = now.toLocaleDateString("en-KE",{weekday:"long",day:"numeric",month:"long",year:"numeric"}).toUpperCase();
  renderAll();
  renderNotice();
  if (recovery) openRecoveryDialog();
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
          : "A new version of PesaOtas is ready. Updating only replaces the app's files — your data stays exactly as it is.";
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
