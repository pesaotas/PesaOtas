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

  // Demonstration budget shown on a first visit. It is replaced by blank
  // onboarding in Phase 4 (KI-13); it is never used to replace saved data.
  const starterState = () => ({
    ...PesaData.createBlankState(),
    month: "2026-11",
    openingBalance: 25000,
    payday: "2026-12-01",
    categories: [
      {id:"food",name:"Food",budget:5000,kind:"Essential"},
      {id:"transport",name:"Work transport",budget:3300,kind:"Essential"},
      {id:"graduation",name:"Graduation extras",budget:1500,kind:"Event"},
      {id:"shoes",name:"Shoes",budget:3500,kind:"Personal"},
      {id:"entertainment",name:"Entertainment / dates",budget:2000,kind:"Flexible"},
      {id:"emergency",name:"Emergency savings",budget:4000,kind:"Savings"},
      {id:"jacket",name:"December jacket fund",budget:2000,kind:"Savings"},
      {id:"misc",name:"Miscellaneous",budget:1000,kind:"Flexible"},
      {id:"wifi",name:"Wi-Fi",budget:1500,kind:"Bills"},
      {id:"electricity",name:"Electricity",budget:1000,kind:"Bills"}
    ],
    transactions: []
  });

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

  switch (boot.status) {
    case "ok":
    case "migrated":
      state = boot.state; break;
    case "new":
      state = starterState(); break;
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
  function setView(view) {
    document.querySelectorAll(".view").forEach(el => el.classList.toggle("active", el.id === `view-${view}`));
    document.querySelectorAll(".nav-link").forEach(el => el.classList.toggle("active", el.dataset.view === view));
    const titles = {overview:"Your money at a glance",transactions:"Your transactions",budget:"Your budget plan",insights:"Your financial insights",settings:"Settings & backup"};
    document.getElementById("page-title").textContent = titles[view] || titles.overview;
    if (view === "settings") { populateSettings(); renderDataSafety(); }
    if (view === "transactions") renderTransactions();
    window.scrollTo({top:0,behavior:"smooth"});
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
      <div class="activity-icon ${d.cls === "transfer" ? "activity-icon-savings" : ""}">${d.icon}</div>
      <div class="activity-info"><strong>${escapeHTML(d.title)}</strong><small>${escapeHTML(d.sub)} · ${formatDate(t.date)}</small></div>
      <span class="activity-amount ${d.cls}">${d.amount}</span>
      ${withDelete?`<button class="delete-transaction" data-delete="${escapeHTML(t.id)}" title="Delete entry" aria-label="Delete entry">×</button>`:""}
    </div>`;
  }

  /** Plain-language breakdown of the safe-to-spend figure (D-03). */
  function renderSafeBreakdown(t, days, guide) {
    const sum = t.flexible + t.unallocated;
    const unallocatedNote = t.unallocated < 0
      ? "Below zero: your plan needs more than you have (from overspending or allocating more than you hold), so this comes off."
      : "Cash that hasn't been given a job in your budget yet.";
    const paceLine = guide === null
      ? `<p>Set your payday in Settings to get a daily guide.</p>`
      : days === 0
        ? `<p>It's payday, so the whole amount is available today.</p>`
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

  function renderOverview() {
    const t = totals();
    const days = daysToPayday();
    const guide = state.payday ? PesaFinance.dailyGuide(t.safeToSpend, days) : null;
    document.getElementById("cash-balance").textContent = money(t.cash);
    document.getElementById("reserved-total").textContent = money(t.allocatedRemaining);
    document.getElementById("unallocated-total").textContent = money(t.unallocated);
    document.getElementById("days-to-payday").innerHTML = state.payday ? `${days} <small>days</small>` : `— <small>no payday set</small>`;
    document.getElementById("payday-date").textContent = state.payday ? new Date(`${state.payday}T12:00:00`).toLocaleDateString("en-KE",{weekday:"long",day:"numeric",month:"long",year:"numeric"}) : "Set your payday in settings";
    document.getElementById("income-total").textContent = money(t.earned);
    document.getElementById("expense-total").textContent = money(t.spent);
    document.getElementById("safe-to-spend").textContent = money(t.safeToSpend);
    document.getElementById("daily-guide").textContent = guide === null ? "—" : money(guide);
    document.getElementById("daily-guide-note").textContent = guide === null ? "Set a payday to see this" : days === 0 ? "It's payday" : "Safe to spend ÷ days to payday";
    renderSafeBreakdown(t, days, guide);
    renderSavingsOverview(t);
    const daysElapsed = state.payday ? Math.max(0,30-days) : 0;
    document.getElementById("payday-progress").style.width = `${Math.min(100,Math.max(4,daysElapsed/30*100))}%`;
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
      .filter(t => filter === "all" || (filter === "savings" ? isSavingsType(t.type) : t.type === filter))
      .sort(newestFirst);
    document.getElementById("transaction-count").textContent = `${items.length} ${items.length===1?"entry":"entries"}`;
    document.getElementById("all-transactions").innerHTML = items.length ? items.map(t=>transactionMarkup(t,true)).join("") : `<div class="empty-state">Nothing here yet.<br>Your recorded transactions will appear here.</div>`;
  }
  function renderBudget() {
    const t = totals();
    document.getElementById("budget-total").textContent = money(t.planned);
    document.getElementById("budget-unallocated").textContent = money(t.unallocated);
    document.getElementById("over-budget-count").textContent = t.overCount;
    document.getElementById("budget-list").innerHTML = state.categories.map(c=>{
      const spent = t.spentByCategory[c.id] || 0;
      const used = usedOf(t, c);
      let status = `${money(spent)} spent · ${money(Math.max(0,c.budget-used))} left`;
      let link = "";
      if (isSavingsCategory(c)) {
        const options = activeDestinations().map(d => `<option value="${escapeHTML(d.id)}" ${c.destinationId === d.id ? "selected" : ""}>${escapeHTML(d.name)}</option>`).join("");
        link = `<label class="link-field"><span>Saved to</span><select class="input compact-input savings-link" data-link-id="${escapeHTML(c.id)}" aria-label="${escapeHTML(c.name)}: savings destination"><option value="">Not linked</option>${options}</select></label>`;
        if (c.destinationId) status = `${money(t.savedByCategory[c.id] || 0)} saved${spent ? ` + ${money(spent)} spent` : ""} · ${money(Math.max(0,c.budget-used))} left`;
      }
      return `<article class="card budget-edit-card">
        <div class="budget-edit-top"><strong>${escapeHTML(c.name)}</strong><span class="category-kind">${escapeHTML(c.kind)}</span></div>
        <div class="budget-edit-bottom"><input class="input budget-value" type="number" min="0" step="50" value="${c.budget}" data-budget-id="${escapeHTML(c.id)}" aria-label="${escapeHTML(c.name)} budget"><span>${status}</span></div>
        ${link}
      </article>`;
    }).join("");
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
    let message = "Record a few transactions and PesaFlow will start identifying spending patterns.";
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
      helper.textContent = destId
        ? `${destinationName(destId)} holds ${money(t.destinationBalances[destId] || 0)}. You can withdraw up to that. Withdrawals are not income.`
        : "";
    } else {
      helper.textContent = "";
    }
    helper.classList.toggle("hidden", !helper.textContent);
  }
  document.querySelectorAll('input[name="transaction-type"]').forEach(r => r.addEventListener("change", populateCategorySelect));
  document.getElementById("tx-destination").addEventListener("change", updateTxForm);
  document.querySelectorAll("[data-open-savings]").forEach(btn => btn.addEventListener("click", () => {
    setView("transactions");
    document.querySelector(`input[name="transaction-type"][value="${btn.dataset.openSavings}"]`).checked = true;
    populateCategorySelect();
  }));

  function populateSettings() {
    document.getElementById("opening-balance").value = state.openingBalance;
    document.getElementById("payday-input").value = state.payday;
    const t = totals();
    document.getElementById("savings-balance-fields").innerHTML = activeDestinations().map(d => `
      <label class="field-label" for="dest-open-${escapeHTML(d.id)}">${escapeHTML(d.name)} — starting balance (KSh)</label>
      <input class="input dest-opening" id="dest-open-${escapeHTML(d.id)}" data-dest-id="${escapeHTML(d.id)}" type="number" min="0" step="1" value="${d.openingBalance}">
      <small class="tiny-muted">Balance now: ${money(t.destinationBalances[d.id] || 0)}</small>`).join("");
  }
  function renderAll() {
    renderOverview(); renderTransactions(); renderBudget(); renderInsights(); populateCategorySelect();
  }

  document.querySelectorAll(".nav-link").forEach(btn=>btn.addEventListener("click",()=>setView(btn.dataset.view)));
  document.querySelectorAll("[data-view-link]").forEach(btn=>btn.addEventListener("click",()=>setView(btn.dataset.viewLink)));
  document.querySelectorAll("[data-open-transaction]").forEach(btn=>btn.addEventListener("click",()=>setView("transactions")));
  document.getElementById("tx-date").value = todayISO();
  document.getElementById("transaction-form").addEventListener("submit",e=>{
    e.preventDefault();
    const amountCheck = PesaValidation.parseWholeShillings(document.getElementById("tx-amount").value);
    const type = currentType();
    const date = document.getElementById("tx-date").value;
    const note = document.getElementById("tx-note").value.trim();
    if (!amountCheck.ok) return showToast(`Amount ${amountCheck.error}.`);
    if (!PesaValidation.isValidISODate(date)) return showToast("Choose a valid date.");
    const amount = amountCheck.value;
    let transaction, done;
    if (isSavingsType(type)) {
      const destinationId = document.getElementById("tx-destination").value;
      if (!activeDestinations().some(d => d.id === destinationId)) return showToast("Choose a savings destination.");
      const t = totals();
      const name = destinationName(destinationId);
      if (type === "savings_withdrawal") {
        const balance = t.destinationBalances[destinationId] || 0;
        if (amount > balance) return showToast(`${name} holds ${money(balance)}. You can't withdraw more than that.`);
      } else if (amount > Math.max(0, t.cash)) {
        if (!confirm(`This transfer of ${money(amount)} is more than your spending cash (${money(t.cash)}). Your spending cash would go below zero. Record it anyway?`)) return;
      }
      transaction = {id:makeId("sv"),type,amount,destinationId,date,note,createdAt:Date.now()};
      done = type === "savings_withdrawal" ? `Withdrew ${money(amount)} from ${name}.` : `Saved ${money(amount)} to ${name}.`;
    } else {
      const categoryId = document.getElementById("tx-category").value;
      const valid = type === "income"
        ? PesaData.INCOME_SOURCES.some(s => s.id === categoryId)
        : categoryId === "other" || state.categories.some(c=>c.id===categoryId);
      if (!valid) return showToast(type === "income" ? "Choose an income source." : "Choose a category.");
      transaction = {id:makeId("tx"),type,amount,categoryId,date,note,createdAt:Date.now()};
      done = "Transaction saved.";
    }
    state.transactions.push(transaction);
    if (saveState()) {
      e.target.reset();
      document.getElementById("tx-date").value = todayISO();
      document.querySelector('input[name="transaction-type"][value="expense"]').checked = true;
      renderAll(); showToast(done);
    }
  });
  document.getElementById("transaction-filter").addEventListener("change",renderTransactions);
  document.getElementById("all-transactions").addEventListener("click",e=>{
    const btn = e.target.closest("[data-delete]");
    if (!btn) return;
    const tx = state.transactions.find(t => t.id === btn.dataset.delete);
    if (!tx) return;
    const remaining = state.transactions.filter(t => t.id !== tx.id);
    if (tx.type === "savings_transfer") {
      // Removing a transfer must not leave a destination showing less than nothing.
      const after = PesaFinance.computeTotals({ ...state, transactions: remaining }).destinationBalances[tx.destinationId] || 0;
      if (after < 0) return showToast(`Can't delete this: ${destinationName(tx.destinationId)} would show ${money(after)}. Delete the later withdrawal first.`);
    }
    const what = isSavingsType(tx.type)
      ? `Delete this savings entry? Your spending cash and ${destinationName(tx.destinationId)} balance will be recalculated.`
      : "Delete this transaction? Your balance and budget totals will be recalculated.";
    if (!confirm(what)) return;
    state.transactions = remaining;
    if (saveState()) showToast("Entry deleted.");
    renderAll();
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
    if (saveState()) showToast("Budget allocations updated.");
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
    const balances = PesaFinance.computeTotals(candidate).destinationBalances;
    const negative = candidate.savingsDestinations.find(d => balances[d.id] < 0);
    if (negative) return showToast(`${negative.name} would show ${money(balances[negative.id])} after your recorded withdrawals. Enter a higher starting balance.`);
    state.savingsDestinations = candidate.savingsDestinations;
    if (saveState()) showToast("Savings balances saved.");
    renderAll(); populateSettings();
  });
  document.getElementById("add-category-button").addEventListener("click",()=>{
    const name = prompt("What would you like to call this budget category?");
    if (!name || !name.trim()) return;
    const budgetRaw = prompt("How much would you like to allocate (KSh)?","0");
    if (budgetRaw === null) return;
    const budget = PesaValidation.parseWholeShillings(budgetRaw, {allowZero:true});
    if (!budget.ok) return showToast(`The allocation ${budget.error}.`);
    const kindRaw = prompt(`Category type: ${PesaData.CATEGORY_TYPES.join(", ")}`, "Other");
    if (kindRaw === null) return;
    const kind = PesaData.canonicalType(kindRaw.trim() || "Other"); // fixed list (KI-07)
    if (!kind) return showToast(`Choose one of: ${PesaData.CATEGORY_TYPES.join(", ")}.`);
    state.categories.push({id:makeId("cat"),name:name.trim().slice(0,40),budget:budget.value,kind});
    if (saveState()) showToast("Budget category added.");
    renderAll();
  });
  document.getElementById("settings-form").addEventListener("submit",e=>{
    e.preventDefault();
    const opening = PesaValidation.parseWholeShillings(document.getElementById("opening-balance").value, {allowZero:true});
    const payday = document.getElementById("payday-input").value;
    if (!opening.ok) return showToast(`The opening balance ${opening.error}.`);
    if (!PesaValidation.isValidISODate(payday)) return showToast("Choose a valid payday.");
    state.openingBalance = opening.value; state.payday = payday;
    if (saveState()) showToast("Settings saved.");
    renderAll(); populateSettings();
  });
  document.getElementById("export-button").addEventListener("click",()=>{
    downloadText(PesaData.serializeBackup(state), `pesaotas-backup-${todayISO()}.json`);
    showToast("Backup downloaded.");
  });
  document.getElementById("import-file").addEventListener("change",async e=>{
    await startRestore(e.target.files[0]);
    e.target.value = "";
  });
  document.getElementById("reset-button").addEventListener("click",()=>{
    if (!confirm("Reset to the demonstration budget? This removes your saved transactions and settings from this browser. A copy of your current data is kept in Settings → Data safety.")) return;
    applyReplacement(starterState(), "Demonstration budget restored. Your previous data is in Data safety.");
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
      const replaces = recovery
        ? `<strong>Your damaged data stays safe</strong> in Settings → Data safety.`
        : `<strong>This replaces what's on this device now:</strong> ${state.transactions.length} transactions, cash ${escapeHTML(money(current.cash))}. A copy of it is kept in Settings → Data safety.`;
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
    }
  });

  // ---------------------------------------------------------------------------
  // Settings → Data safety
  // ---------------------------------------------------------------------------
  function renderDataSafety() {
    const el = document.getElementById("data-safety-list");
    if (!store) { el.innerHTML = `<p class="muted">This browser isn't letting PesaOtas store data.</p>`; return; }
    const r = PesaStorage.listRecovery(store);
    const rows = [];
    if (r.legacyPresent) rows.push(["Original PesaFlow data", "Still on this device, unchanged. PesaOtas never edits or deletes it.", "legacy", 0]);
    r.preserved.forEach(p => rows.push(["Copy of PesaFlow data made before moving", `Saved ${formatWhen(p.preservedAt)}`, "preserved", p.index]));
    r.quarantine.forEach(q => rows.push(["Damaged data set aside", `${formatWhen(q.quarantinedAt)} · ${q.reason || "failed its checks"}`, "quarantine", q.index]));
    if (r.preRestore) rows.push(["Your data before the last restore, recovery or reset", `Saved ${formatWhen(r.preRestore.savedAt)}`, "preRestore", 0]);
    const damaged = r.damagedLists.length
      ? `<p class="replace-note">A safety list on this device is itself damaged. It has been left untouched.</p>` : "";
    el.innerHTML = rows.length
      ? rows.map(([title, detail, kind, index]) => `<div class="safety-row"><div><strong>${escapeHTML(title)}</strong><small>${escapeHTML(detail)}</small></div><button class="button button-secondary" type="button" data-recover="${kind}" data-index="${index}">↓ Download</button></div>`).join("")
        + damaged + `<p class="tiny-muted">To use a downloaded copy, choose “Restore from backup”. Every file is checked and previewed before anything is replaced.</p>`
      : damaged + `<p class="muted">No safety copies yet. They appear here automatically when PesaOtas moves, restores, recovers or resets your data.</p>`;
  }
  document.getElementById("data-safety-list").addEventListener("click", e => {
    const btn = e.target.closest("[data-recover]");
    if (!btn) return;
    const raw = PesaStorage.getRecoveryText(store, btn.dataset.recover, Number(btn.dataset.index));
    if (raw === null) return showToast("That copy couldn't be read.");
    downloadText(raw, `pesaotas-${btn.dataset.recover}-copy-${todayISO()}.json`);
    showToast("Copy downloaded.");
  });

  const now = new Date();
  document.getElementById("today-label").textContent = now.toLocaleDateString("en-KE",{weekday:"long",day:"numeric",month:"long",year:"numeric"}).toUpperCase();
  renderAll();
  renderNotice();
  if (recovery) openRecoveryDialog();
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
  }
})();
