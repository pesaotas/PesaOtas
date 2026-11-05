(() => {
  "use strict";

  const STORAGE_KEY = "pesaflow.personal.v1";
  const money = (value) => new Intl.NumberFormat("en-KE", {
    style: "currency", currency: "KES", maximumFractionDigits: 0
  }).format(Math.round(Number(value) || 0));
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

  const starterState = () => ({
    version: 1,
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

  let state = loadState();
  let toastTimer;

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return starterState();
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.categories) || !Array.isArray(parsed.transactions)) {
        return starterState();
      }
      return parsed;
    } catch {
      return starterState();
    }
  }
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch {
      showToast("Could not save. Export a backup and check browser storage.");
      return false;
    }
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
  function categoryName(id) {
    return state.categories.find(c => c.id === id)?.name || "Other";
  }
  function setView(view) {
    document.querySelectorAll(".view").forEach(el => el.classList.toggle("active", el.id === `view-${view}`));
    document.querySelectorAll(".nav-link").forEach(el => el.classList.toggle("active", el.dataset.view === view));
    const titles = {overview:"Your money at a glance",transactions:"Your transactions",budget:"Your budget plan",insights:"Your financial insights",settings:"Settings & backup"};
    document.getElementById("page-title").textContent = titles[view] || titles.overview;
    if (view === "settings") populateSettings();
    if (view === "transactions") renderTransactions();
    window.scrollTo({top:0,behavior:"smooth"});
  }
  function budgetProgress(c) {
    const spent = totals().spentByCategory[c.id] || 0;
    const pct = c.budget > 0 ? Math.min(100, spent/c.budget*100) : (spent > 0 ? 100 : 0);
    const over = spent > c.budget;
    return `<div class="budget-item">
      <div class="budget-item-head"><span class="budget-name">${escapeHTML(c.name)}</span><span class="budget-amount">${money(spent)} / ${money(c.budget)}</span></div>
      <div class="progress-track"><div class="progress-fill ${over?"over":""}" style="width:${pct}%"></div></div>
    </div>`;
  }
  function transactionMarkup(t, withDelete=false) {
    const isIncome = t.type === "income";
    const icon = isIncome ? "↗" : "↘";
    const amountClass = isIncome ? "positive" : "negative";
    return `<div class="activity-row">
      <div class="activity-icon">${icon}</div>
      <div class="activity-info"><strong>${escapeHTML(t.note || categoryName(t.categoryId))}</strong><small>${escapeHTML(categoryName(t.categoryId))} · ${formatDate(t.date)}</small></div>
      <span class="activity-amount ${amountClass}">${isIncome?"+":"−"}${money(t.amount)}</span>
      ${withDelete?`<button class="delete-transaction" data-delete="${escapeHTML(t.id)}" title="Delete transaction" aria-label="Delete transaction">×</button>`:""}
    </div>`;
  }
  function renderOverview() {
    const t = totals();
    const days = daysToPayday();
    document.getElementById("cash-balance").textContent = money(t.cash);
    document.getElementById("reserved-total").textContent = money(t.allocatedRemaining);
    document.getElementById("unallocated-total").textContent = money(t.unallocated);
    document.getElementById("days-to-payday").innerHTML = `${days} <small>days</small>`;
    document.getElementById("payday-date").textContent = state.payday ? new Date(`${state.payday}T12:00:00`).toLocaleDateString("en-KE",{weekday:"long",day:"numeric",month:"long",year:"numeric"}) : "Set your payday in settings";
    document.getElementById("income-total").textContent = money(t.earned);
    document.getElementById("expense-total").textContent = money(t.spent);
    document.getElementById("flexible-left").textContent = money(t.flexible);
    document.getElementById("daily-guide").textContent = money(days > 0 ? t.flexible/days : t.flexible);
    const daysElapsed = state.payday ? Math.max(0,30-days) : 0;
    document.getElementById("payday-progress").style.width = `${Math.min(100,Math.max(4,daysElapsed/30*100))}%`;
    document.getElementById("overview-budgets").innerHTML = state.categories.slice(0,5).map(budgetProgress).join("");
    const recent = [...state.transactions].sort((a,b)=>b.date.localeCompare(a.date) || b.createdAt-a.createdAt).slice(0,5);
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
    const items = [...state.transactions].filter(t=>filter==="all" || t.type===filter)
      .sort((a,b)=>b.date.localeCompare(a.date) || b.createdAt-a.createdAt);
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
      return `<article class="card budget-edit-card">
        <div class="budget-edit-top"><strong>${escapeHTML(c.name)}</strong><span class="category-kind">${escapeHTML(c.kind)}</span></div>
        <div class="budget-edit-bottom"><input class="input budget-value" type="number" min="0" step="50" value="${c.budget}" data-budget-id="${escapeHTML(c.id)}" aria-label="${escapeHTML(c.name)} budget"><span>${money(spent)} spent · ${money(Math.max(0,c.budget-spent))} left</span></div>
      </article>`;
    }).join("");
  }
  function renderInsights() {
    const t = totals();
    document.getElementById("insight-expenses").textContent = money(t.spent);
    document.getElementById("insight-income").textContent = money(t.earned);
    document.getElementById("insight-count").textContent = state.transactions.length;
    const expenses = state.categories.map(c=>({name:c.name,spent:t.spentByCategory[c.id]||0,budget:c.budget}))
      .sort((a,b)=>b.spent-a.spent);
    document.getElementById("insight-categories").innerHTML = expenses.map(c=>{
      const pct = c.budget ? Math.min(100,c.spent/c.budget*100) : (c.spent?100:0);
      return `<div class="insight-line"><strong>${escapeHTML(c.name)}</strong><div class="progress-track"><div class="progress-fill ${c.spent>c.budget?"over":""}" style="width:${pct}%"></div></div><span class="tiny-muted">${money(c.spent)} / ${money(c.budget)}</span></div>`;
    }).join("");
    let message = "Record a few transactions and PesaFlow will start identifying spending patterns.";
    if (state.transactions.length) {
      const top = expenses[0];
      if (top && top.spent > 0) message = `${top.name} is currently your highest recorded spending category at ${money(top.spent)}. Keep recording purchases so you can spot patterns early.`;
      if (t.overCount) message += ` You have ${t.overCount} category/categories above their planned budget.`;
      else message += " None of your recorded categories are over budget. Keep it up.";
    }
    document.getElementById("insight-message").textContent = message;
  }
  function populateCategorySelect() {
    const select = document.getElementById("tx-category");
    const old = select.value;
    select.innerHTML = state.categories.map(c=>`<option value="${escapeHTML(c.id)}">${escapeHTML(c.name)}</option>`).join("") + `<option value="other">Other / uncategorised</option>`;
    if ([...select.options].some(o=>o.value===old)) select.value = old;
  }
  function populateSettings() {
    document.getElementById("opening-balance").value = state.openingBalance;
    document.getElementById("payday-input").value = state.payday;
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
    const amount = Math.round(Number(document.getElementById("tx-amount").value));
    const type = document.querySelector('input[name="transaction-type"]:checked').value;
    const categoryId = document.getElementById("tx-category").value;
    const date = document.getElementById("tx-date").value;
    const note = document.getElementById("tx-note").value.trim();
    if (!Number.isFinite(amount) || amount <= 0 || !date) return showToast("Enter a valid amount and date.");
    const transaction = {id:crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),type,amount,categoryId,date,note,createdAt:Date.now()};
    state.transactions.push(transaction);
    if (saveState()) {
      e.target.reset();
      document.getElementById("tx-date").value = todayISO();
      document.querySelector('input[name="transaction-type"][value="expense"]').checked = true;
      renderAll(); showToast("Transaction saved.");
    }
  });
  document.getElementById("transaction-filter").addEventListener("change",renderTransactions);
  document.getElementById("all-transactions").addEventListener("click",e=>{
    const btn = e.target.closest("[data-delete]");
    if (!btn) return;
    if (!confirm("Delete this transaction? Your balance and budget totals will be recalculated.")) return;
    state.transactions = state.transactions.filter(t=>t.id!==btn.dataset.delete);
    saveState(); renderAll(); showToast("Transaction deleted.");
  });
  document.getElementById("save-budget-button").addEventListener("click",()=>{
    document.querySelectorAll(".budget-value").forEach(input=>{
      const category = state.categories.find(c=>c.id===input.dataset.budgetId);
      const value = Number(input.value);
      if (category && Number.isFinite(value) && value>=0) category.budget = Math.round(value);
    });
    saveState(); renderAll(); showToast("Budget allocations updated.");
  });
  document.getElementById("add-category-button").addEventListener("click",()=>{
    const name = prompt("What would you like to call this budget category?");
    if (!name || !name.trim()) return;
    const budgetRaw = prompt("How much would you like to allocate (KSh)?","0");
    if (budgetRaw === null) return;
    const budget = Number(budgetRaw);
    if (!Number.isFinite(budget) || budget<0) return showToast("Enter a valid budget amount.");
    const kindRaw = prompt("Category type: Essential, Bills, Flexible, Personal, Savings or Other","Other") || "Other";
    state.categories.push({id:`cat-${Date.now()}`,name:name.trim().slice(0,40),budget:Math.round(budget),kind:kindRaw.trim().slice(0,20)});
    saveState(); renderAll(); showToast("Budget category added.");
  });
  document.getElementById("settings-form").addEventListener("submit",e=>{
    e.preventDefault();
    const opening = Number(document.getElementById("opening-balance").value);
    const payday = document.getElementById("payday-input").value;
    if (!Number.isFinite(opening) || opening<0 || !payday) return showToast("Check your balance and payday.");
    state.openingBalance = Math.round(opening); state.payday = payday;
    saveState(); renderAll(); showToast("Settings saved.");
  });
  document.getElementById("export-button").addEventListener("click",()=>{
    const blob = new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `pesaflow-backup-${todayISO()}.json`; a.click();
    URL.revokeObjectURL(url); showToast("Backup downloaded.");
  });
  document.getElementById("import-file").addEventListener("change",async e=>{
    const file = e.target.files[0]; if (!file) return;
    try {
      const imported = JSON.parse(await file.text());
      if (imported.version!==1 || !Array.isArray(imported.categories) || !Array.isArray(imported.transactions) || !Number.isFinite(Number(imported.openingBalance)) || typeof imported.payday!=="string") throw new Error("Invalid backup");
      if (!confirm("Restore this backup? It will replace the data currently saved in this browser.")) return;
      state = imported; saveState(); renderAll(); populateSettings(); showToast("Backup restored.");
    } catch { showToast("That file doesn't look like a valid PesaFlow backup."); }
    e.target.value = "";
  });
  document.getElementById("reset-button").addEventListener("click",()=>{
    if (!confirm("This will permanently remove your saved PesaFlow transactions and settings from this browser. Continue?")) return;
    state = starterState(); saveState(); renderAll(); populateSettings(); showToast("Starter budget restored.");
  });

  const now = new Date();
  document.getElementById("today-label").textContent = now.toLocaleDateString("en-KE",{weekday:"long",day:"numeric",month:"long",year:"numeric"}).toUpperCase();
  renderAll();
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
  }
})();
