/**
 * Fidelity2YNAB - Popup Script
 *
 * UI layer for the extension. Business logic is in TransactionService.
 */

// Services
const bankAdapter = FidelityAdapter;
const txnService = new TransactionService(bankAdapter);

// State
let ynabConfig = null;
let skippedIndices = new Set();
let matchCanvas = null;

// Analysis results from service
let analysisResult = { transactions: [], unmatchedYnab: [], watermarkIndex: -1 };
let rawScrapedTxns = [];

// DOM elements
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

  // Load settings
  loadSettings();
  loadYnabConfig();

  // Event listeners
  scrapeBtn?.addEventListener("click", scrapeTransactions);
  ynabImportBtn?.addEventListener("click", importToYNAB);
  configureYnabBtn?.addEventListener("click", openYnabConfig);
  saveYnabConfigBtn?.addEventListener("click", saveYnabConfig);
  cancelYnabConfigBtn?.addEventListener("click", closeYnabModal);
  ynabModal?.addEventListener("click", (e) => {
    if (e.target === ynabModal) closeYnabModal();
  });

  skipCoreFundsCheckbox?.addEventListener("change", () => {
    setStorageValue("skipCoreFunds", skipCoreFundsCheckbox.checked);
  });

  ynabTokenInput?.addEventListener("input", debounce(async () => {
    const token = ynabTokenInput.value.trim();
    if (token.length > 20) await loadYnabBudgets(token);
  }, 500));

  ynabBudgetSelect?.addEventListener("change", async () => {
    const token = ynabTokenInput.value.trim() || ynabConfig?.token;
    const budgetId = ynabBudgetSelect.value;
    if (token && budgetId) await loadYnabAccounts(token, budgetId);
  });
});

// ============================================================================
// Scraping
// ============================================================================

async function scrapeTransactions() {
  try {
    scrapeBtn.disabled = true;
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });

    if (!bankAdapter.matchesUrl(tab.url)) {
      showStatus(`Navigate to ${bankAdapter.bankName} first`, "error");
      return;
    }

    // Inject content script
    try {
      await browser.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["browser-polyfill.min.js", "lib/banks/fidelity/scraper.js", "content.js"],
      });
    } catch (e) { /* Already injected */ }

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
      rawScrapedTxns = response.transactions;
      skippedIndices.clear();

      if (rawScrapedTxns.length === 0) {
        showStatus("No transactions found", "error");
        displaySimpleList([]);
      } else {
        showStatus(`Scraped ${rawScrapedTxns.length} transaction${rawScrapedTxns.length > 1 ? "s" : ""}`, "success");
        if (ynabConfig?.token) {
          await analyzeAndDisplay();
        } else {
          displaySimpleList(rawScrapedTxns);
        }
      }
    } else {
      showStatus("Failed to scrape", "error");
    }
  } catch (error) {
    showStatus(`Error: ${error.message}`, "error");
  } finally {
    scrapeBtn.disabled = false;
  }
}

// ============================================================================
// Analysis & Display
// ============================================================================

async function analyzeAndDisplay() {
  if (!ynabConfig?.token || !rawScrapedTxns?.length) return;

  try {
    const api = new YNABApi(ynabConfig.token);
    const deduplicator = new TransactionDeduplicator(bankAdapter);

    // Fetch YNAB transactions
    const earliestDate = deduplicator.getEarliestBankDate(rawScrapedTxns);
    if (!earliestDate) return;

    const fetchDate = new Date(earliestDate);
    fetchDate.setDate(fetchDate.getDate() - 5);
    const ynabTxns = await api.getTransactionsSinceDate(
      ynabConfig.budgetId,
      ynabConfig.accountId,
      deduplicator.formatDate(fetchDate)
    );

    // Use service to analyze
    analysisResult = txnService.analyze(rawScrapedTxns, ynabTxns);
    renderTransactions();
  } catch (error) {
    showStatus(`Analysis Error: ${error.message}`, "error");
  }
}

function renderTransactions() {
  const { transactions, unmatchedYnab } = analysisResult;

  if (!transactions.length) {
    resultsDiv.innerHTML = '<div class="text-center py-5 text-gray-500">No transactions found</div>';
    return;
  }

  const initialMatches = [];
  let fidelityHtml = '', ynabHtml = '';
  let pendingCleared = [];

  // Separate by state
  const beforeWatermark = transactions.filter(t => t.state === 'before-watermark');
  const active = transactions.filter(t => t.state !== 'before-watermark');

  // Flush consecutive cleared transactions as collapsible group
  const flushCleared = () => {
    if (pendingCleared.length) {
      fidelityHtml += html.clearedSection(pendingCleared.map(t => ({ txn: t.fidelity, index: t.index })));
      ynabHtml += html.ynabClearedSection(pendingCleared.map(t => ({ ynab: t.ynab, fidelityIndex: t.index })));
      pendingCleared.forEach(t => initialMatches.push({ fidelityIndex: t.index, ynabId: t.ynab.id, type: 'match' }));
      pendingCleared = [];
    }
  };

  // Render active transactions in chronological order
  for (const txn of active) {
    const isSkipped = skippedIndices.has(txn.index);

    if (txn.state === 'cleared') {
      // Accumulate consecutive cleared for collapsing
      pendingCleared.push(txn);
    } else {
      flushCleared();
      fidelityHtml += html.fidelityItem(txn.fidelity, txn.index, isSkipped, txn.state === 'new' ? 'new' : 'matched');

      if (txn.ynab) {
        ynabHtml += html.ynabItem(txn.ynab, 'matched', txn.index);
        initialMatches.push({ fidelityIndex: txn.index, ynabId: txn.ynab.id, type: 'match' });
      } else {
        const payee = bankAdapter.formatPayeeName(txn.fidelity.description);
        ynabHtml += html.createNewTarget(txn.index, isSkipped ? null : txn.fidelity, payee);
        initialMatches.push({ fidelityIndex: txn.index, ynabId: `__CREATE_${txn.index}__`, type: 'create' });
      }
    }
  }

  flushCleared();
  unmatchedYnab.forEach(ynab => ynabHtml += html.ynabItem(ynab, 'available', null));

  // Before-watermark section at bottom (older transactions)
  if (beforeWatermark.length > 0) {
    const watermarkTxn = txnService.getWatermarkTransaction(transactions);
    fidelityHtml += html.beforeWatermarkSection(
      beforeWatermark.map(t => t.fidelity),
      watermarkTxn ? { lastTxn: watermarkTxn } : null
    );
    ynabHtml += html.ynabBeforeWatermarkSection(beforeWatermark.length);
  }

  // Update stats
  const stats = txnService.getStats(transactions, skippedIndices);
  summaryStats.innerHTML = html.matchSummaryText(stats);
  ynabImportBtn.disabled = !txnService.hasImportableTransactions(transactions, skippedIndices);

  // Render
  resultsDiv.innerHTML = html.twoColumnContainer(fidelityHtml, ynabHtml);

  if (matchCanvas) matchCanvas.destroy();
  matchCanvas = new MatchCanvas({ onMatchChanged: () => {} });
  matchCanvas.init();
  matchCanvas.setMatches(initialMatches);

  setupScrollSync();
  attachSkipButtonHandlers();
}

/** Simple list display when YNAB is not configured */
function displaySimpleList(txnList) {
  if (txnList.length === 0) {
    resultsDiv.innerHTML = `<div class="text-center py-5 text-gray-500">No transactions found</div>`;
    return;
  }

  const byDate = new Map();
  txnList.forEach((txn) => {
    const date = txn.date || 'N/A';
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(txn);
  });

  let htmlContent = `
    <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
      <div class="text-sm text-gray-700">
        <strong>${txnList.length}</strong> transaction${txnList.length !== 1 ? "s" : ""} scraped
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

    htmlContent += `
      <div class="bg-white border border-gray-200 rounded-lg mb-3">
        <div class="px-4 py-2 border-b border-gray-200">
          <span class="text-sm font-medium text-gray-700">${date}</span>
        </div>
        <div class="px-4">${items}</div>
      </div>`;
  });

  resultsDiv.innerHTML = htmlContent;
}

// ============================================================================
// Import
// ============================================================================

async function importToYNAB() {
  if (!ynabConfig?.token) {
    showStatus("Configure YNAB first", "error");
    openYnabConfig();
    return;
  }

  const { transactions } = analysisResult;
  const { toCreate, toMatch, toSchedule } = txnService.prepareImport(transactions, skippedIndices);

  if (!toCreate.length && !toMatch.length && !toSchedule.length) {
    showStatus("Nothing to import", "info");
    return;
  }

  try {
    ynabImportBtn.disabled = true;
    const api = new YNABApi(ynabConfig.token);
    let createdCount = 0, updatedCount = 0, scheduledCount = 0;
    let lastProcessedTxn = null;

    // 1. Create new transactions
    if (toCreate.length > 0) {
      const ynabTxns = toCreate.map(txn => bankAdapter.toYNABTransaction(txn, ynabConfig.accountId));
      const result = await api.createTransactions(ynabConfig.budgetId, ynabTxns);
      createdCount = result.transactions?.length || toCreate.length;
      lastProcessedTxn = {
        txn: toCreate[toCreate.length - 1],
        ynabId: result.transaction_ids?.[result.transaction_ids.length - 1]
      };
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

    // 4. Create scheduled transactions
    for (const txn of toSchedule) {
      await api.createScheduledTransaction(
        ynabConfig.budgetId,
        bankAdapter.toScheduledTransaction(txn, ynabConfig.accountId)
      );
      scheduledCount++;
    }

    const msgs = [];
    if (createdCount) msgs.push(`${createdCount} created`);
    if (updatedCount) msgs.push(`${updatedCount} cleared`);
    if (scheduledCount) msgs.push(`${scheduledCount} scheduled`);
    showStatus(`✓ ${msgs.join(", ")}`, "success");

    // Refresh
    skippedIndices.clear();
    await analyzeAndDisplay();
  } catch (error) {
    showStatus(`Import Error: ${error.message}`, "error");
  } finally {
    ynabImportBtn.disabled = false;
  }
}

// ============================================================================
// UI Helpers
// ============================================================================

let skipHandlerAttached = false;
function attachSkipButtonHandlers() {
  if (skipHandlerAttached) return;
  skipHandlerAttached = true;

  resultsDiv.addEventListener('click', (e) => {
    const skipBtn = e.target.closest('.skip-btn');
    if (!skipBtn) return;

    const index = parseInt(skipBtn.dataset.index, 10);
    if (isNaN(index)) return;

    skippedIndices.has(index) ? skippedIndices.delete(index) : skippedIndices.add(index);
    renderTransactions();
  });
}

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
      fidelityCol.scrollTop += delta;
      ynabCol.scrollTop += delta;
    } else {
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

// ============================================================================
// Settings & YNAB Config
// ============================================================================

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
