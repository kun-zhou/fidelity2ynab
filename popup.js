/**
 * Fidelity2YNAB - Popup Script
 *
 * Scrapes transactions from Fidelity and imports them to YNAB.
 * Features:
 * - Two-column preview with match lines
 * - Processing transactions become scheduled
 * - Watermark system to track last import
 */

// Global state
let currentTransactions = [];
let transactionsToImport = [];
let transactionsToUpdate = [];
let transactionsPending = [];
let transactionsMatched = [];
let unmatchedYnab = [];
let ynabConfig = null;

// Two-column UI state
let skippedTransactions = new Set();
let matchCanvas = null;

// Bank adapter
const bankAdapter = FidelityAdapter;

// DOM element references
let scrapeBtn, toastContainer, resultsDiv, skipCoreFundsCheckbox;
let ynabStatusText, configureYnabBtn, summaryStats, ynabImportBtn;
let ynabModal, ynabTokenInput, ynabBudgetSelect, ynabAccountSelect;
let saveYnabConfigBtn, cancelYnabConfigBtn;

document.addEventListener("DOMContentLoaded", () => {
  // Get DOM elements
  scrapeBtn = document.getElementById("scrapeBtn");
  toastContainer = document.getElementById("toastContainer");
  resultsDiv = document.getElementById("results");
  skipCoreFundsCheckbox = document.getElementById("skipCoreFunds");
  ynabStatusText = document.getElementById("ynabStatusText");
  summaryStats = document.getElementById("summaryStats");
  ynabImportBtn = document.getElementById("ynabImportBtn");
  configureYnabBtn = document.getElementById("configureYnabBtn");
  ynabModal = document.getElementById("ynabModal");
  ynabTokenInput = document.getElementById("ynabToken");
  ynabBudgetSelect = document.getElementById("ynabBudget");
  ynabAccountSelect = document.getElementById("ynabAccount");
  saveYnabConfigBtn = document.getElementById("saveYnabConfig");
  cancelYnabConfigBtn = document.getElementById("cancelYnabConfig");

  // Load saved settings
  if (skipCoreFundsCheckbox) {
    loadSettings();
    skipCoreFundsCheckbox.addEventListener("change", () => {
      setStorageValue("skipCoreFunds", skipCoreFundsCheckbox.checked);
    });
  }

  // Load YNAB configuration
  loadYnabConfig();

  // Event listeners
  scrapeBtn?.addEventListener("click", scrapeTransactions);
  ynabImportBtn?.addEventListener("click", importToYNAB);
  configureYnabBtn?.addEventListener("click", openYnabConfig);
  saveYnabConfigBtn?.addEventListener("click", saveYnabConfig);
  cancelYnabConfigBtn?.addEventListener("click", closeYnabModal);

  // Close modal when clicking backdrop
  ynabModal?.addEventListener("click", (e) => {
    if (e.target === ynabModal) closeYnabModal();
  });

  // YNAB token input - load budgets when token is entered
  ynabTokenInput?.addEventListener("input", debounce(async () => {
    const token = ynabTokenInput.value.trim();
    if (token.length > 20) {
      await loadYnabBudgets(token);
    }
  }, 500));

  // Budget selection - load accounts when budget is selected
  ynabBudgetSelect?.addEventListener("change", async () => {
    const token = ynabTokenInput.value.trim();
    const budgetId = ynabBudgetSelect.value;
    if (token && budgetId) {
      await loadYnabAccounts(token, budgetId);
    }
  });
});

async function scrapeTransactions() {
  try {
    scrapeBtn.disabled = true;

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });

    if (!bankAdapter.matchesUrl(tab.url)) {
      showStatus(`Please navigate to a ${bankAdapter.bankName} page first`, "error");
      return;
    }

    // Inject content script
    try {
      await browser.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["browser-polyfill.min.js", "lib/banks/fidelity/scraper.js", "content.js"],
      });
    } catch (e) { /* Script might already be injected */ }

    const response = await browser.tabs.sendMessage(tab.id, {
      action: "scrapeTransactions",
      skipCoreFunds: skipCoreFundsCheckbox?.checked ?? true,
    });

    if (response?.error) {
      showStatus(response.error, "error");
      resultsDiv.innerHTML = `
        <div class="text-center py-5">
          <p class="text-red-600 mb-3">${response.error}</p>
          <p class="text-sm text-gray-500">Navigate to Fidelity Activity & Orders page and try again.</p>
        </div>`;
      return;
    }

    if (response?.transactions) {
      currentTransactions = response.transactions;

      if (currentTransactions.length === 0) {
        showStatus("No transactions found", "error");
        displayTransactions([]);
      } else {
        showStatus(`✓ Scraped ${currentTransactions.length} transaction${currentTransactions.length > 1 ? "s" : ""}`, "success");
        if (ynabConfig?.token) {
          await analyzeTransactions();
        } else {
          displayTransactions(currentTransactions);
        }
      }
    } else {
      showStatus("Failed to scrape transactions", "error");
    }
  } catch (error) {
    showStatus(`Error: ${error.message}`, "error");
  } finally {
    scrapeBtn.disabled = false;
  }
}

function displayTransactions(transactions) {
  if (transactions.length === 0) {
    resultsDiv.innerHTML = `<div class="text-center py-5 text-gray-500">No transactions found</div>`;
    return;
  }

  const byDate = new Map();
  transactions.forEach((txn) => {
    const date = txn.date || 'N/A';
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(txn);
  });

  let html = `
    <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
      <div class="text-sm text-gray-700">
        <strong>${transactions.length}</strong> transaction${transactions.length !== 1 ? "s" : ""} scraped
        <span class="text-gray-500 ml-2">Configure YNAB to enable import</span>
      </div>
    </div>`;

  byDate.forEach((txns, date) => {
    const items = txns.map((txn) => {
      const amountClass = txn.type === "credit" ? "text-green-600" : "text-gray-900";
      return `
        <div class="border-b border-gray-200 py-3 last:border-b-0">
          <div class="flex justify-between items-start">
            <div class="flex-1">
              <div class="text-sm text-gray-900">${txn.description || "N/A"}</div>
              ${txn.status ? `<div class="text-xs text-orange-600 italic mt-1">${txn.status}</div>` : ""}
            </div>
            <span class="text-sm ${amountClass} ml-4">${txn.amount || "N/A"}</span>
          </div>
        </div>`;
    }).join('');

    html += `
      <div class="bg-white border border-gray-200 rounded-lg mb-3">
        <div class="px-4 py-2 border-b border-gray-200">
          <span class="text-sm font-medium text-gray-700">${date}</span>
        </div>
        <div class="px-4">${items}</div>
      </div>`;
  });

  resultsDiv.innerHTML = html;
}

function showStatus(message, type) {
  const bgColor = type === "success" ? "bg-green-600" : type === "error" ? "bg-red-600" : "bg-blue-600";
  const toast = document.createElement("div");
  toast.className = `${bgColor} text-white text-sm px-4 py-3 rounded-lg shadow-lg pointer-events-auto transition-all duration-300 opacity-0 translate-y-2`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  requestAnimationFrame(() => toast.classList.remove("opacity-0", "translate-y-2"));
  setTimeout(() => {
    toast.classList.add("opacity-0", "translate-y-2");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function debounce(func, wait) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

async function loadSettings() {
  const settings = await getStorageValues(["skipCoreFunds"]);
  if (skipCoreFundsCheckbox) {
    skipCoreFundsCheckbox.checked = settings.skipCoreFunds !== false;
  }
}

async function loadYnabConfig() {
  const config = await getStorageValue("ynabConfig");
  if (config) ynabConfig = config;
  updateYnabStatus();
}

function updateYnabStatus() {
  const connected = ynabConfig?.token && ynabConfig?.budgetId && ynabConfig?.accountId;
  ynabStatusText.classList.toggle("text-green-600", connected);
  ynabStatusText.classList.toggle("text-gray-500", !connected);
  ynabStatusText.textContent = connected ? "YNAB Connected" : "Configure YNAB";
}

function openYnabConfig() {
  if (ynabConfig?.token) {
    ynabTokenInput.value = "";
    ynabTokenInput.placeholder = "Token saved • enter new to replace";
    loadYnabBudgets(ynabConfig.token).then(() => {
      if (ynabConfig.budgetId) {
        ynabBudgetSelect.value = ynabConfig.budgetId;
        loadYnabAccounts(ynabConfig.token, ynabConfig.budgetId).then(() => {
          if (ynabConfig.accountId) ynabAccountSelect.value = ynabConfig.accountId;
        });
      }
    });
  } else {
    ynabTokenInput.value = "";
    ynabTokenInput.placeholder = "Enter your YNAB PAT";
  }
  ynabModal.classList.remove("hidden");
}

function closeYnabModal() {
  ynabModal.classList.add("hidden");
}

async function loadYnabBudgets(token) {
  try {
    const api = new YNABApi(token);
    const budgets = await api.getBudgets();
    ynabBudgetSelect.disabled = false;
    ynabBudgetSelect.innerHTML = '<option value="">Select a budget...</option>';
    budgets.forEach((b) => {
      const opt = document.createElement("option");
      opt.value = b.id;
      opt.textContent = b.name;
      ynabBudgetSelect.appendChild(opt);
    });
  } catch (error) {
    showStatus(`YNAB Error: ${error.message}`, "error");
    ynabBudgetSelect.disabled = true;
    ynabBudgetSelect.innerHTML = '<option value="">Error loading budgets</option>';
  }
}

async function loadYnabAccounts(token, budgetId) {
  try {
    const api = new YNABApi(token);
    const accounts = await api.getAccounts(budgetId);
    ynabAccountSelect.disabled = false;
    ynabAccountSelect.innerHTML = '<option value="">Select account...</option>';
    accounts.filter((a) => !a.closed && !a.deleted).forEach((a) => {
      const opt = document.createElement("option");
      opt.value = a.id;
      opt.textContent = a.name;
      ynabAccountSelect.appendChild(opt);
    });
  } catch (error) {
    showStatus(`YNAB Error: ${error.message}`, "error");
    ynabAccountSelect.disabled = true;
    ynabAccountSelect.innerHTML = '<option value="">Error loading accounts</option>';
  }
}

async function saveYnabConfig() {
  const newToken = ynabTokenInput.value.trim();
  const budgetId = ynabBudgetSelect.value;
  const accountId = ynabAccountSelect.value;
  const token = newToken || ynabConfig?.token;

  if (!token || !budgetId || !accountId) {
    showStatus("Please fill in all fields", "error");
    return;
  }

  ynabConfig = {
    token,
    budgetId,
    accountId,
    budgetName: ynabBudgetSelect.options[ynabBudgetSelect.selectedIndex].textContent,
    accountName: ynabAccountSelect.options[ynabAccountSelect.selectedIndex].textContent,
  };

  await setStorageValue("ynabConfig", ynabConfig);
  updateYnabStatus();
  closeYnabModal();
  showStatus("YNAB configuration saved!", "success");
}

async function importToYNAB() {
  if (!ynabConfig?.token) {
    showStatus("Please configure YNAB first", "error");
    openYnabConfig();
    return;
  }

  const canvasMatches = matchCanvas?.getMatches() || [];
  const toCreate = [];
  const toMatch = [];
  const toSchedule = [];

  for (const { fidelityIndex, ynabId, type } of canvasMatches) {
    if (skippedTransactions.has(fidelityIndex)) continue;
    const bankTxn = currentTransactions[fidelityIndex];
    if (!bankTxn) continue;

    if (type === 'create') {
      if (bankAdapter.isProcessing(bankTxn)) {
        toSchedule.push(bankTxn);
      } else {
        toCreate.push(bankTxn);
      }
    } else if (type === 'match' && ynabId) {
      const ynabTxn = [...transactionsToUpdate, ...transactionsMatched, ...transactionsPending]
        .map(item => item.ynab)
        .find(y => y.id === ynabId) || unmatchedYnab.find(y => y.id === ynabId);
      if (ynabTxn?.cleared !== 'cleared') {
        toMatch.push({ bank: bankTxn, ynab: ynabTxn });
      }
    }
  }

  // Add auto-matched transactions not in canvas
  for (const { bank, ynab } of transactionsToUpdate) {
    const idx = currentTransactions.findIndex(t => JSON.stringify(t) === JSON.stringify(bank));
    if (!skippedTransactions.has(idx) && !toMatch.some(m => m.ynab.id === ynab.id)) {
      toMatch.push({ bank, ynab });
    }
  }

  if (!toCreate.length && !toMatch.length && !toSchedule.length) {
    showStatus("No transactions to import", "info");
    return;
  }

  try {
    ynabImportBtn.disabled = true;
    const api = new YNABApi(ynabConfig.token);
    let createdCount = 0, updatedCount = 0, scheduledCount = 0;
    let lastProcessedTxn = null;

    // Sort chronologically (oldest first)
    const getDate = (txn) => bankAdapter.parseDate(txn.date);
    toCreate.sort((a, b) => getDate(a).localeCompare(getDate(b)));
    toMatch.sort((a, b) => getDate(a.bank).localeCompare(getDate(b.bank)));
    toSchedule.sort((a, b) => getDate(a).localeCompare(getDate(b)));

    // 1. Create new transactions
    if (toCreate.length > 0) {
      const ynabTxns = toCreate.map((txn) => bankAdapter.toYNABTransaction(txn, ynabConfig.accountId));
      const result = await api.createTransactions(ynabConfig.budgetId, ynabTxns);
      createdCount = result.transactions?.length || toCreate.length;
      lastProcessedTxn = { txn: toCreate[toCreate.length - 1], ynabId: result.transaction_ids?.[result.transaction_ids.length - 1] };
    }

    // 2. Update matched transactions
    for (const { bank, ynab } of toMatch) {
      await api.updateTransaction(ynabConfig.budgetId, ynab.id, {
        cleared: 'cleared',
        date: bankAdapter.parseDate(bank.date)
      });
      updatedCount++;
      lastProcessedTxn = { txn: bank, ynabId: ynab.id, existingMemo: ynab.memo };
    }

    // 3. Add watermark to last processed transaction
    if (lastProcessedTxn?.ynabId) {
      await api.updateTransaction(ynabConfig.budgetId, lastProcessedTxn.ynabId, {
        date: bankAdapter.parseDate(lastProcessedTxn.txn.date),
        memo: Watermark.createMemo(lastProcessedTxn.txn, lastProcessedTxn.existingMemo || '')
      });
    }

    // 4. Create scheduled transactions (last, since they're future-dated)
    for (const txn of toSchedule) {
      await api.createScheduledTransaction(ynabConfig.budgetId, bankAdapter.toScheduledTransaction(txn, ynabConfig.accountId));
      scheduledCount++;
    }

    const msgs = [];
    if (createdCount) msgs.push(`${createdCount} created`);
    if (updatedCount) msgs.push(`${updatedCount} cleared`);
    if (scheduledCount) msgs.push(`${scheduledCount} scheduled`);
    showStatus(`✓ ${msgs.join(", ")}`, "success");

    skippedTransactions.clear();
    await analyzeTransactions();
  } catch (error) {
    showStatus(`Import Error: ${error.message}`, "error");
  } finally {
    ynabImportBtn.disabled = false;
  }
}

// Track watermark info for display
let lastWatermarkInfo = null;
let transactionsBeforeWatermark = [];

async function analyzeTransactions() {
  if (!ynabConfig?.token || !currentTransactions.length) return;

  try {
    const api = new YNABApi(ynabConfig.token);
    const deduplicator = new TransactionDeduplicator(bankAdapter);

    const earliestDate = deduplicator.getEarliestBankDate(currentTransactions);
    if (!earliestDate) return;

    const fetchDate = new Date(earliestDate);
    fetchDate.setDate(fetchDate.getDate() - 5);

    const ynabTxns = await api.getTransactionsSinceDate(ynabConfig.budgetId, ynabConfig.accountId, deduplicator.formatDate(fetchDate));

    // Find watermark - transactions at or before this were already imported
    lastWatermarkInfo = Watermark.findWatermarkIndex(ynabTxns, currentTransactions);

    // Filter transactions: only process those AFTER the watermark
    let transactionsToProcess = currentTransactions;
    transactionsBeforeWatermark = [];
    if (lastWatermarkInfo) {
      transactionsBeforeWatermark = currentTransactions.slice(0, lastWatermarkInfo.fidelityIndex + 1);
      transactionsToProcess = currentTransactions.slice(lastWatermarkInfo.fidelityIndex + 1);
    }

    const result = deduplicator.findTransactionsToImport(transactionsToProcess, ynabTxns);

    transactionsToImport = result.toImport;
    transactionsToUpdate = result.toUpdate;
    transactionsPending = result.pending || [];
    transactionsMatched = result.matched;
    unmatchedYnab = result.unmatchedYnab || [];

    displayTransactionsWithYnabPreview({ ...result, beforeWatermark: transactionsBeforeWatermark, watermarkInfo: lastWatermarkInfo });
  } catch (error) {
    showStatus(`Analysis Error: ${error.message}`, "error");
  }
}

function displayTransactionsWithYnabPreview(analysisResult) {
  const { toImport, toUpdate, pending, matched, unmatchedYnab, beforeWatermark = [], watermarkInfo } = analysisResult;

  if (!currentTransactions.length) {
    resultsDiv.innerHTML = '<div class="text-center py-5 text-gray-500">No transactions found</div>';
    return;
  }

  const toImportMap = new Map(toImport.map(item => [JSON.stringify(item.bank), item.suggestions]));
  const toUpdateMap = new Map(toUpdate.map(item => [JSON.stringify(item.bank), item.ynab]));
  const pendingMap = new Map(pending.map(item => [JSON.stringify(item.bank), item.ynab]));
  const matchedMap = new Map(matched.map(item => [JSON.stringify(item.bank), item.ynab]));

  const initialMatches = [];
  let fidelityHtml = '', ynabHtml = '';
  let pendingClearedFidelity = [], pendingClearedYnab = [];

  // Add beforeWatermark section at the top (collapsed)
  if (beforeWatermark.length > 0) {
    fidelityHtml += html.beforeWatermarkSection(beforeWatermark, watermarkInfo);
    // Add empty spacer on YNAB side
    ynabHtml += `<div class="text-xs text-gray-400 mb-2 py-1">${beforeWatermark.length} already imported</div>`;
  }

  const flushCleared = () => {
    if (pendingClearedFidelity.length) {
      fidelityHtml += html.clearedSection(pendingClearedFidelity);
      pendingClearedFidelity = [];
    }
    if (pendingClearedYnab.length) {
      ynabHtml += html.ynabClearedSection(pendingClearedYnab);
      pendingClearedYnab = [];
    }
  };

  // Only process transactions AFTER the watermark
  const transactionsToDisplay = beforeWatermark.length > 0
    ? currentTransactions.slice(beforeWatermark.length)
    : currentTransactions;

  transactionsToDisplay.forEach((txn, idx) => {
    const index = beforeWatermark.length + idx; // Maintain original index for skipping
    const key = JSON.stringify(txn);
    const toUpdateYnab = toUpdateMap.get(key);
    const pendingYnab = pendingMap.get(key);
    const matchedYnab = matchedMap.get(key);
    const isSkipped = skippedTransactions.has(index);

    let matchState = '', isCleared = false;

    if (matchedYnab) {
      matchState = 'matched';
      isCleared = true;
      initialMatches.push({ fidelityIndex: index, ynabId: matchedYnab.id, type: 'match' });
    } else if (toUpdateYnab) {
      matchState = 'matched';
      initialMatches.push({ fidelityIndex: index, ynabId: toUpdateYnab.id, type: 'match' });
    } else if (pendingYnab) {
      matchState = 'matched';
      initialMatches.push({ fidelityIndex: index, ynabId: pendingYnab.id, type: 'match' });
    } else {
      matchState = 'new';
      initialMatches.push({ fidelityIndex: index, ynabId: `__CREATE_${index}__`, type: 'create' });
    }

    if (isCleared) {
      pendingClearedFidelity.push({ txn, index, ynab: matchedYnab });
      pendingClearedYnab.push({ ynab: matchedYnab, fidelityIndex: index });
    } else {
      flushCleared();
      fidelityHtml += html.fidelityItem(txn, index, isSkipped, matchState);

      if (toUpdateYnab) {
        ynabHtml += html.ynabItem(toUpdateYnab, 'matched', index);
      } else if (pendingYnab) {
        ynabHtml += html.ynabItem(pendingYnab, 'matched', index);
      } else {
        ynabHtml += html.createNewTarget(index, isSkipped ? null : txn, bankAdapter.formatPayeeName(txn.description));
      }
    }
  });

  flushCleared();
  unmatchedYnab.forEach(ynab => ynabHtml += html.ynabItem(ynab, 'available', null));

  const toCreateCount = toImport.filter(item => !item.suggestions.length).length;
  const toMatchCount = toImport.filter(item => item.suggestions.length).length + toUpdate.length;

  summaryStats.innerHTML = html.matchSummaryText({
    toCreate: toCreateCount,
    toMatch: toMatchCount,
    toSkip: skippedTransactions.size,
    beforeWatermark: beforeWatermark.length
  });
  ynabImportBtn.disabled = !(toCreateCount || toMatchCount);

  resultsDiv.innerHTML = html.twoColumnContainer(fidelityHtml, ynabHtml);

  if (matchCanvas) matchCanvas.destroy();
  matchCanvas = new MatchCanvas({ onMatchChanged: () => {} });
  matchCanvas.init();
  matchCanvas.setMatches(initialMatches);

  setupScrollSync();
  attachSkipButtonHandlers();
}

let skipHandlerAttached = false;
function attachSkipButtonHandlers() {
  if (skipHandlerAttached) return;
  skipHandlerAttached = true;

  resultsDiv.addEventListener('click', (e) => {
    const skipBtn = e.target.closest('.skip-btn');
    if (!skipBtn) return;

    const index = parseInt(skipBtn.dataset.index, 10);
    if (isNaN(index)) return;

    skippedTransactions.has(index) ? skippedTransactions.delete(index) : skippedTransactions.add(index);

    displayTransactionsWithYnabPreview({
      toImport: transactionsToImport,
      toUpdate: transactionsToUpdate,
      pending: transactionsPending,
      matched: transactionsMatched,
      unmatchedYnab,
      beforeWatermark: transactionsBeforeWatermark,
      watermarkInfo: lastWatermarkInfo
    });
  });
}

/**
 * Synchronized scrolling between columns using wheel events.
 * - Scrolling DOWN: both columns scroll together
 * - Scrolling UP: if YNAB column is ahead, it catches up first
 */
let scrollSyncCleanup = null;
function setupScrollSync() {
  const fidelityCol = document.getElementById('fidelityColumn');
  const ynabCol = document.getElementById('ynabColumn');
  if (!fidelityCol || !ynabCol) return;

  scrollSyncCleanup?.();

  const onWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY;

    if (delta > 0) {
      // Scrolling DOWN - both scroll together
      fidelityCol.scrollTop += delta;
      ynabCol.scrollTop += delta;
    } else {
      // Scrolling UP - if YNAB is ahead, it catches up first
      const fidelityAtTop = fidelityCol.scrollTop <= 0;
      const ynabAhead = ynabCol.scrollTop > fidelityCol.scrollTop;

      if (ynabAhead && fidelityAtTop) {
        ynabCol.scrollTop += delta;
      } else if (ynabAhead) {
        fidelityCol.scrollTop += delta;
        ynabCol.scrollTop = Math.max(fidelityCol.scrollTop, ynabCol.scrollTop + delta);
      } else {
        fidelityCol.scrollTop += delta;
        ynabCol.scrollTop += delta;
      }
    }
  };

  fidelityCol.addEventListener('wheel', onWheel, { passive: false });
  ynabCol.addEventListener('wheel', onWheel, { passive: false });

  scrollSyncCleanup = () => {
    fidelityCol.removeEventListener('wheel', onWheel);
    ynabCol.removeEventListener('wheel', onWheel);
  };
}
