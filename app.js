(() => {
  "use strict";

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
  function setView(view) {
    document.querySelectorAll(".view").forEach(el => el.classList.toggle("active", el.id === `view-${view}`));
    document.querySelectorAll(".nav-link").forEach(el => el.classList.toggle("active", el.dataset.view === view));
    const titles = {overview:"Your money at a glance",transactions:"Your transactions",budget:"Your budget plan",insights:"Your financial insights",settings:"Settings & backup"};
    document.getElementById("page-title").textContent = titles[view] || titles.overview;
    if (view === "settings") { populateSettings(); renderDataSafety(); }
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
    document.getElementById("days-to-payday").innerHTML = state.payday ? `${days} <small>days</small>` : `— <small>no payday set</small>`;
    document.getElementById("payday-date").textContent = state.payday ? new Date(`${state.payday}T12:00:00`).toLocaleDateString("en-KE",{weekday:"long",day:"numeric",month:"long",year:"numeric"}) : "Set your payday in settings";
    document.getElementById("income-total").textContent = money(t.earned);
    document.getElementById("expense-total").textContent = money(t.spent);
    document.getElementById("flexible-left").textContent = money(t.flexible);
    document.getElementById("daily-guide").textContent = money(days > 0 ? t.flexible/days : t.flexible);
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
    const items = [...state.transactions].filter(t=>filter==="all" || t.type===filter)
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
    const amountCheck = PesaValidation.parseWholeShillings(document.getElementById("tx-amount").value);
    const type = document.querySelector('input[name="transaction-type"]:checked').value;
    const categoryId = document.getElementById("tx-category").value;
    const date = document.getElementById("tx-date").value;
    const note = document.getElementById("tx-note").value.trim();
    if (!amountCheck.ok) return showToast(`Amount ${amountCheck.error}.`);
    if (!PesaValidation.isValidISODate(date)) return showToast("Choose a valid date.");
    if (categoryId !== "other" && !state.categories.some(c=>c.id===categoryId)) return showToast("Choose a category.");
    const transaction = {id:makeId("tx"),type,amount:amountCheck.value,categoryId,date,note,createdAt:Date.now()};
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
    if (saveState()) showToast("Transaction deleted.");
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
    updates.forEach(([category, value]) => { category.budget = value; });
    if (saveState()) showToast("Budget allocations updated.");
    renderAll();
  });
  document.getElementById("add-category-button").addEventListener("click",()=>{
    const name = prompt("What would you like to call this budget category?");
    if (!name || !name.trim()) return;
    const budgetRaw = prompt("How much would you like to allocate (KSh)?","0");
    if (budgetRaw === null) return;
    const budget = PesaValidation.parseWholeShillings(budgetRaw, {allowZero:true});
    if (!budget.ok) return showToast(`The allocation ${budget.error}.`);
    const kindRaw = prompt("Category type: Essential, Bills, Flexible, Personal, Savings or Other","Other") || "Other";
    state.categories.push({id:makeId("cat"),name:name.trim().slice(0,40),budget:budget.value,kind:kindRaw.trim().slice(0,20) || "Other"});
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
