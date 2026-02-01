/**
 * Fidelity2YNAB - Popup Script
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
let beforeWatermarkTxns = [];
let afterWatermarkTxns = [];
let watermarkInfo = null;
let allYnabTxns = [];

// Bank adapter (Fidelity)
const bankAdapter = FidelityAdapter;

// DOM element references
let scrapeBtn,
  toastContainer,
  resultsDiv,
  skipCoreFundsCheckbox,
  hideClearedCheckbox;
let ynabStatusText, configureYnabBtn, summaryStats, ynabImportBtn;
let ynabModal, ynabTokenInput, ynabBudgetSelect, ynabAccountSelect;
let saveYnabConfigBtn, cancelYnabConfigBtn;
let alertModal, alertTitle, alertMessage, alertOkBtn;
let confirmModal, confirmTitle, confirmMessage, confirmOkBtn, confirmCancelBtn;

// Wait for DOM to be fully loaded
document.addEventListener("DOMContentLoaded", () => {
  // DOM elements - throw if critical elements are missing
  scrapeBtn = document.getElementById("scrapeBtn");
  toastContainer = document.getElementById("toastContainer");
  resultsDiv = document.getElementById("results");
  skipCoreFundsCheckbox = document.getElementById("skipCoreFunds");
  hideClearedCheckbox = document.getElementById("hideCleared");

  if (!toastContainer) throw new Error("toastContainer element not found");
  if (!resultsDiv) throw new Error("results element not found");

  // YNAB elements
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

  if (!ynabStatusText) throw new Error("ynabStatusText element not found");
  if (!summaryStats) throw new Error("summaryStats element not found");
  if (!ynabModal) throw new Error("ynabModal element not found");
  if (!ynabTokenInput) throw new Error("ynabToken element not found");
  if (!ynabBudgetSelect) throw new Error("ynabBudget element not found");
  if (!ynabAccountSelect) throw new Error("ynabAccount element not found");

  // Alert modal elements
  alertModal = document.getElementById("alertModal");
  alertTitle = document.getElementById("alertTitle");
  alertMessage = document.getElementById("alertMessage");
  alertOkBtn = document.getElementById("alertOkBtn");

  if (!alertModal) throw new Error("alertModal element not found");
  if (!alertTitle) throw new Error("alertTitle element not found");
  if (!alertMessage) throw new Error("alertMessage element not found");

  // Confirmation modal elements
  confirmModal = document.getElementById("confirmModal");
  confirmTitle = document.getElementById("confirmTitle");
  confirmMessage = document.getElementById("confirmMessage");
  confirmOkBtn = document.getElementById("confirmOkBtn");
  confirmCancelBtn = document.getElementById("confirmCancelBtn");

  if (!confirmModal) throw new Error("confirmModal element not found");
  if (!confirmTitle) throw new Error("confirmTitle element not found");
  if (!confirmMessage) throw new Error("confirmMessage element not found");
  if (!confirmOkBtn) throw new Error("confirmOkBtn element not found");
  if (!confirmCancelBtn) throw new Error("confirmCancelBtn element not found");

  // Load saved settings
  if (skipCoreFundsCheckbox) {
    loadSettings().catch((error) => {
      console.error("Error loading settings:", error);
      // Default to true if storage fails
      skipCoreFundsCheckbox.checked = true;
      if (hideClearedCheckbox) {
        hideClearedCheckbox.checked = true;
      }
    });

    // Save setting when changed
    skipCoreFundsCheckbox.addEventListener("change", async () => {
      try {
        await setStorageValue("skipCoreFunds", skipCoreFundsCheckbox.checked);
      } catch (error) {
        console.error("Error saving settings:", error);
      }
    });
  }

  // Save hide cleared setting and re-render when changed
  if (hideClearedCheckbox) {
    hideClearedCheckbox.addEventListener("change", async () => {
      try {
        await setStorageValue("hideCleared", hideClearedCheckbox.checked);
        // Re-render the display if we have transactions
        if (currentTransactions.length > 0 && ynabConfig && ynabConfig.token) {
          displayTransactionsWithYnabPreview({
            toImport: transactionsToImport,
            toUpdate: transactionsToUpdate,
            pending: transactionsPending,
            matched: transactionsMatched,
            unmatchedYnab: [],
            failedTransactions: [],
          });
        }
      } catch (error) {
        console.error("Error saving hide cleared setting:", error);
      }
    });
  }

  // Load YNAB configuration
  loadYnabConfig();

  // Event listeners
  if (scrapeBtn) {
    scrapeBtn.addEventListener("click", scrapeTransactions);
  }
  if (!configureYnabBtn) throw new Error("configureYnabBtn element not found");
  if (!saveYnabConfigBtn) throw new Error("saveYnabConfigBtn element not found");
  if (!cancelYnabConfigBtn) throw new Error("cancelYnabConfigBtn element not found");
  if (!alertOkBtn) throw new Error("alertOkBtn element not found");

  configureYnabBtn.addEventListener("click", openYnabConfig);
  saveYnabConfigBtn.addEventListener("click", saveYnabConfig);
  cancelYnabConfigBtn.addEventListener("click", closeYnabModal);
  alertOkBtn.addEventListener("click", closeAlertModal);

  // YNAB token input - load budgets when token is entered
  ynabTokenInput.addEventListener(
    "input",
    debounce(async () => {
      const token = ynabTokenInput.value.trim();
      if (token.length > 20) {
        // Basic validation
        await loadYnabBudgets(token);
      }
    }, 500)
  );

  // Budget selection - load accounts when budget is selected
  ynabBudgetSelect.addEventListener("change", async () => {
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

    // Get the active tab
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });

    // Check if we're on a supported bank page
    if (!bankAdapter.matchesUrl(tab.url)) {
      showStatus(`Please navigate to a ${bankAdapter.bankName} page first`, "error");
      scrapeBtn.disabled = false;
      return;
    }

    // Inject the content script if not already injected
    // Note: scraper.js must be loaded before content.js as content.js depends on it
    try {
      await browser.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["browser-polyfill.min.js", "lib/banks/fidelity/scraper.js", "content.js"],
      });
    } catch (e) {
      // Script might already be injected, continue
    }

    // Send message to content script with settings
    const skipCoreFunds = skipCoreFundsCheckbox
      ? skipCoreFundsCheckbox.checked
      : true;

    const response = await browser.tabs.sendMessage(tab.id, {
      action: "scrapeTransactions",
      skipCoreFunds: skipCoreFunds,
    });

    // Check for validation errors
    if (response && response.error) {
      showStatus(response.error, "error");
      resultsDiv.innerHTML = `
        <div class="empty-state">
          <h3>❌ Page Validation Failed</h3>
          <p>${response.error}</p>
          <br>
          <p><strong>Instructions:</strong></p>
          <ol style="text-align: left; display: inline-block;">
            <li>Log in to <a href="https://digital.fidelity.com" target="_blank">Fidelity.com</a></li>
            <li>Navigate to your account</li>
            <li>Click on the "Activity & Orders" tab</li>
            <li>Wait for transactions to load</li>
            <li>Try scraping again</li>
          </ol>
        </div>
      `;
      scrapeBtn.disabled = false;
      return;
    }

    if (response && response.transactions) {
      currentTransactions = response.transactions;

      if (currentTransactions.length === 0) {
        showStatus(
          "No transactions found on this page. Try adjusting the date filter.",
          "error"
        );
        displayTransactions(currentTransactions);
      } else {
        showStatus(
          `✓ Successfully scraped ${currentTransactions.length} transaction${
            currentTransactions.length > 1 ? "s" : ""
          }`,
          "success"
        );

        // If YNAB is configured, analyze transactions
        if (ynabConfig && ynabConfig.token) {
          await analyzeTransactions();
        } else {
          displayTransactions(currentTransactions);
        }
      }
    } else {
      showStatus("Failed to scrape transactions", "error");
    }
  } catch (error) {
    console.error("Error scraping transactions:", error);
    showStatus(`Error: ${error.message}`, "error");
  } finally {
    scrapeBtn.disabled = false;
  }
}

function displayTransactions(transactions) {
  if (!resultsDiv) {
    throw new Error("Results div not found in displayTransactions");
  }

  if (transactions.length === 0) {
    resultsDiv.innerHTML = `
      <div class="text-center py-5">
        <p class="text-muted mb-3">Click "Scrape Transactions" to extract data from the current page</p>
        <button id="scrapeBtn" class="btn btn-primary">Scrape Transactions</button>
      </div>
    `;
    // Re-attach event listener
    document.getElementById("scrapeBtn").addEventListener("click", scrapeTransactions);
    return;
  }

  let html = `
    <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
      <div class="text-sm text-gray-700">
        <strong class="font-semibold">${
          transactions.length
        }</strong> transaction${transactions.length !== 1 ? "s" : ""} scraped
        <span class="text-gray-500 ml-2">Configure YNAB to enable import</span>
      </div>
    </div>
  `;

  // Group transactions by date
  const transactionsByDate = new Map();

  transactions.forEach((txn) => {
    const date = txn.date || 'N/A';
    if (!transactionsByDate.has(date)) {
      transactionsByDate.set(date, []);
    }
    transactionsByDate.get(date).push(txn);
  });

  // Render each date group
  transactionsByDate.forEach((txns, date) => {
    let groupHtml = '';

    txns.forEach((txn) => {
      const amountClass = txn.type === "credit" ? "text-green-600" : "text-gray-900";

      groupHtml += `
        <div class="border-b border-gray-200 py-3 last:border-b-0">
          <div class="flex justify-between items-start">
            <div class="flex-1">
              <div class="text-sm text-gray-900">${txn.description || "N/A"}</div>
              ${
                txn.status
                  ? `<div class="text-xs text-orange-600 italic mt-1">Status: ${txn.status}</div>`
                  : ""
              }
            </div>
            <div class="flex flex-col items-end ml-4">
              <span class="text-sm ${amountClass === 'text-green-600' ? 'text-green-600' : 'text-gray-900'}">${txn.amount || "N/A"}</span>
            </div>
          </div>
        </div>
      `;
    });

    html += `
      <div class="bg-white border border-gray-200 rounded-lg mb-3">
        <div class="px-4 py-2 border-b border-gray-200">
          <span class="text-sm font-medium text-gray-700">${date}</span>
        </div>
        <div class="px-4">
          ${groupHtml}
        </div>
      </div>
    `;
  });

  resultsDiv.innerHTML = html;
}

function showStatus(message, type) {
  const bgColor =
    type === "success"
      ? "bg-green-600"
      : type === "error"
      ? "bg-red-600"
      : "bg-blue-600";

  const toast = document.createElement("div");
  toast.className = `${bgColor} text-white text-sm px-4 py-3 rounded-lg shadow-lg pointer-events-auto flex items-center gap-2 transition-all duration-300 opacity-0 translate-y-2`;
  toast.textContent = message;

  toastContainer.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.remove("opacity-0", "translate-y-2");
  });

  // Auto-dismiss after 3 seconds
  setTimeout(() => {
    toast.classList.add("opacity-0", "translate-y-2");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ===== YNAB Functions =====

// Utility: Debounce function
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Load user settings from storage
async function loadSettings() {
  const settings = await getStorageValues(["skipCoreFunds", "hideCleared"]);

  // Default to true if not set
  if (skipCoreFundsCheckbox) {
    skipCoreFundsCheckbox.checked = settings.skipCoreFunds !== false;
  }

  // Load hide cleared (default to true)
  if (hideClearedCheckbox) {
    hideClearedCheckbox.checked = settings.hideCleared !== false;
  }
}

// Load YNAB configuration from storage
async function loadYnabConfig() {
  try {
    const config = await getStorageValue("ynabConfig");
    if (config) {
      ynabConfig = config;
    }
    updateYnabStatus();
  } catch (error) {
    console.error("Error loading YNAB config:", error);
  }
}

// Update YNAB status display
function updateYnabStatus() {
  if (ynabConfig && ynabConfig.token && ynabConfig.budgetId && ynabConfig.accountId) {
    ynabStatusText.classList.remove("text-gray-500");
    ynabStatusText.classList.add("text-green-600");
    ynabStatusText.textContent = "YNAB Connected";
  } else {
    ynabStatusText.classList.remove("text-green-600");
    ynabStatusText.classList.add("text-gray-500");
    ynabStatusText.textContent = "Configure YNAB";
  }
}

// Open YNAB configuration modal
function openYnabConfig() {
  // Pre-fill if config exists
  if (ynabConfig) {
    ynabTokenInput.value = ynabConfig.token || "";
    if (ynabConfig.token) {
      loadYnabBudgets(ynabConfig.token).then(() => {
        if (ynabConfig.budgetId) {
          ynabBudgetSelect.value = ynabConfig.budgetId;
          loadYnabAccounts(ynabConfig.token, ynabConfig.budgetId).then(() => {
            if (ynabConfig.accountId) {
              ynabAccountSelect.value = ynabConfig.accountId;
            }
          });
        }
      });
    }
  }
  ynabModal.classList.remove("hidden");
}

// Close YNAB modal
function closeYnabModal() {
  ynabModal.classList.add("hidden");
}

// Show alert modal
function showAlert(title, message) {
  alertTitle.textContent = title;
  // Replace \n with <br> for proper line breaks in HTML
  alertMessage.innerHTML = message.replace(/\n/g, "<br>");
  alertModal.classList.remove("hidden");
}

// Close alert modal
function closeAlertModal() {
  alertModal.classList.add("hidden");
}

// Show confirmation modal and return a Promise that resolves to true/false
function showConfirm(title, messageHtml) {
  return new Promise((resolve) => {
    confirmTitle.textContent = title;
    confirmMessage.innerHTML = messageHtml;
    confirmModal.classList.remove("hidden");

    // Handle OK button
    const handleOk = () => {
      confirmModal.classList.add("hidden");
      confirmOkBtn.removeEventListener("click", handleOk);
      confirmCancelBtn.removeEventListener("click", handleCancel);
      resolve(true);
    };

    // Handle Cancel button
    const handleCancel = () => {
      confirmModal.classList.add("hidden");
      confirmOkBtn.removeEventListener("click", handleOk);
      confirmCancelBtn.removeEventListener("click", handleCancel);
      resolve(false);
    };

    confirmOkBtn.addEventListener("click", handleOk);
    confirmCancelBtn.addEventListener("click", handleCancel);
  });
}

// Load YNAB budgets
async function loadYnabBudgets(token) {
  try {
    const api = new YNABApi(token);
    const budgets = await api.getBudgets();

    ynabBudgetSelect.disabled = false;
    ynabBudgetSelect.innerHTML = '<option value="">Select a budget...</option>';

    budgets.forEach((budget) => {
      const option = document.createElement("option");
      option.value = budget.id;
      option.textContent = budget.name;
      ynabBudgetSelect.appendChild(option);
    });
  } catch (error) {
    console.error("Error loading budgets:", error);
    showStatus(`YNAB Error: ${error.message}`, "error");
    ynabBudgetSelect.disabled = true;
    ynabBudgetSelect.innerHTML =
      '<option value="">Error loading budgets</option>';
  }
}

// Load YNAB accounts
async function loadYnabAccounts(token, budgetId) {
  try {
    const api = new YNABApi(token);
    const accounts = await api.getAccounts(budgetId);

    ynabAccountSelect.disabled = false;
    ynabAccountSelect.innerHTML =
      '<option value="">Select Fidelity account...</option>';

    // Filter for open accounts only
    const openAccounts = accounts.filter((acc) => !acc.closed && !acc.deleted);

    openAccounts.forEach((account) => {
      const option = document.createElement("option");
      option.value = account.id;
      option.textContent = `${account.name}`;
      ynabAccountSelect.appendChild(option);
    });
  } catch (error) {
    console.error("Error loading accounts:", error);
    showStatus(`YNAB Error: ${error.message}`, "error");
    ynabAccountSelect.disabled = true;
    ynabAccountSelect.innerHTML =
      '<option value="">Error loading accounts</option>';
  }
}

// Save YNAB configuration
async function saveYnabConfig() {
  const token = ynabTokenInput.value.trim();
  const budgetId = ynabBudgetSelect.value;
  const accountId = ynabAccountSelect.value;

  if (!token || !budgetId || !accountId) {
    showStatus("Please fill in all YNAB fields", "error");
    return;
  }

  const budgetName =
    ynabBudgetSelect.options[ynabBudgetSelect.selectedIndex].textContent;
  const accountName =
    ynabAccountSelect.options[ynabAccountSelect.selectedIndex].textContent;

  ynabConfig = {
    token,
    budgetId,
    accountId,
    budgetName,
    accountName,
  };

  try {
    await setStorageValue("ynabConfig", ynabConfig);
    updateYnabStatus();
    closeYnabModal();
    showStatus("YNAB configuration saved!", "success");
  } catch (error) {
    console.error("Error saving YNAB config:", error);
    showStatus("Error saving configuration", "error");
  }
}

// Import transactions to YNAB
async function importToYNAB() {
  if (!ynabConfig || !ynabConfig.token) {
    showStatus("Please configure YNAB first", "error");
    openYnabConfig();
    return;
  }

  // Get matches from canvas
  const canvasMatches = matchCanvas ? matchCanvas.getMatches() : [];

  // Separate into creates and matches, excluding skipped
  const toCreate = [];
  const toMatch = [];
  const toSchedule = []; // Processing transactions

  for (const match of canvasMatches) {
    const { fidelityIndex, ynabId, type } = match;

    // Skip if user marked as skipped
    if (skippedTransactions.has(fidelityIndex)) continue;

    const bankTxn = currentTransactions[fidelityIndex];
    if (!bankTxn) continue;

    // Check if this is a processing transaction
    const isProcessing = bankAdapter.isProcessing(bankTxn);

    if (type === 'create') {
      if (isProcessing) {
        toSchedule.push(bankTxn);
      } else {
        toCreate.push(bankTxn);
      }
    } else if (type === 'match' && ynabId) {
      // Find the YNAB transaction
      const ynabTxn = [...transactionsToUpdate, ...transactionsMatched, ...transactionsPending]
        .map(item => item.ynab)
        .find(y => y.id === ynabId) || unmatchedYnab.find(y => y.id === ynabId);

      if (ynabTxn && ynabTxn.cleared !== 'cleared') {
        toMatch.push({ bank: bankTxn, ynab: ynabTxn });
      }
    }
  }

  // Also add auto-matched toUpdate transactions not in canvas
  for (const { bank, ynab } of transactionsToUpdate) {
    const fidelityIndex = currentTransactions.findIndex(t => JSON.stringify(t) === JSON.stringify(bank));
    if (skippedTransactions.has(fidelityIndex)) continue;
    if (!toMatch.some(m => m.ynab.id === ynab.id)) {
      toMatch.push({ bank, ynab });
    }
  }

  if (toCreate.length === 0 && toMatch.length === 0 && toSchedule.length === 0) {
    showStatus("No transactions to import or update", "info");
    return;
  }

  try {
    const importBtn = document.getElementById("ynabImportBtn");
    if (importBtn) importBtn.disabled = true;

    const api = new YNABApi(ynabConfig.token);
    let createdCount = 0, updatedCount = 0, scheduledCount = 0;
    let lastCreatedTxn = null;

    // Create new cleared transactions (with watermark on last one)
    if (toCreate.length > 0) {
      const ynabTxns = toCreate.map((txn, idx) => {
        const ynabTxn = bankAdapter.toYNABTransaction(txn, ynabConfig.accountId);
        // Add watermark to the last non-processing transaction
        if (idx === toCreate.length - 1) {
          ynabTxn.memo = Watermark.createMemo(txn, ynabTxn.memo);
          lastCreatedTxn = txn;
        }
        return ynabTxn;
      });
      const result = await api.createTransactions(ynabConfig.budgetId, ynabTxns);
      createdCount = result.transactions?.length || toCreate.length;
    }

    // Create scheduled transactions for processing items (no watermark)
    for (const txn of toSchedule) {
      const scheduledTxn = bankAdapter.toScheduledTransaction(txn, ynabConfig.accountId);
      await api.createScheduledTransaction(ynabConfig.budgetId, scheduledTxn);
      scheduledCount++;
    }

    // Update matched transactions to cleared
    for (const { bank, ynab } of toMatch) {
      const updates = { cleared: 'cleared' };
      if (!ynab.transfer_account_id) {
        updates.date = bankAdapter.parseDate(bank.date);
      }
      // Add watermark if this is the last transaction and we didn't create any
      if (toCreate.length === 0 && bank === toMatch[toMatch.length - 1].bank) {
        updates.memo = Watermark.createMemo(bank, ynab.memo);
      }
      await api.updateTransaction(ynabConfig.budgetId, ynab.id, updates);
      updatedCount++;
    }

    const messages = [];
    if (createdCount > 0) messages.push(`${createdCount} created`);
    if (updatedCount > 0) messages.push(`${updatedCount} cleared`);
    if (scheduledCount > 0) messages.push(`${scheduledCount} scheduled`);
    showStatus(`✓ ${messages.join(", ")}`, "success");

    // Reset skipped transactions and re-analyze
    skippedTransactions.clear();
    await analyzeTransactions();
  } catch (error) {
    showStatus(`Import Error: ${error.message}`, "error");
  } finally {
    const importBtn = document.getElementById("ynabImportBtn");
    if (importBtn) importBtn.disabled = false;
  }
}

// Analyze transactions and find what needs to be imported
async function analyzeTransactions() {
  if (!ynabConfig || !ynabConfig.token || currentTransactions.length === 0) return;

  try {
    const api = new YNABApi(ynabConfig.token);
    const deduplicator = new TransactionDeduplicator(bankAdapter);

    const earliestDate = deduplicator.getEarliestBankDate(currentTransactions);
    if (!earliestDate) return;

    const fetchDate = new Date(earliestDate);
    fetchDate.setDate(fetchDate.getDate() - 5);
    const sinceDate = deduplicator.formatDate(fetchDate);

    const ynabTxns = await api.getTransactionsSinceDate(ynabConfig.budgetId, ynabConfig.accountId, sinceDate);
    const result = deduplicator.findTransactionsToImport(currentTransactions, ynabTxns);

    transactionsToImport = result.toImport;
    transactionsToUpdate = result.toUpdate;
    transactionsPending = result.pending || [];
    transactionsMatched = result.matched;
    unmatchedYnab = result.unmatchedYnab || [];

    displayTransactionsWithYnabPreview(result);
  } catch (error) {
    showStatus(`Analysis Error: ${error.message}`, "error");
  }
}

// Display transactions with YNAB two-column preview
function displayTransactionsWithYnabPreview(analysisResult) {
  if (!resultsDiv) {
    throw new Error("Results div not found in displayTransactionsWithYnabPreview");
  }

  const { toImport, toUpdate, pending, matched, unmatchedYnab } = analysisResult;

  if (currentTransactions.length === 0) {
    resultsDiv.innerHTML = '<div class="text-center py-5 text-muted">No transactions found</div>';
    return;
  }

  // Create maps for quick lookup
  const toImportMap = new Map(toImport.map(item => [JSON.stringify(item.bank), item.suggestions]));
  const toUpdateMap = new Map(toUpdate.map(item => [JSON.stringify(item.bank), item.ynab]));
  const pendingMap = new Map(pending.map(item => [JSON.stringify(item.bank), item.ynab]));
  const matchedMap = new Map(matched.map(item => [JSON.stringify(item.bank), item.ynab]));

  // Initialize matches for canvas
  const initialMatches = [];
  const hideCleared = hideClearedCheckbox && hideClearedCheckbox.checked;

  // Build both columns in parallel, grouping consecutive cleared transactions
  let fidelityHtml = '';
  let ynabHtml = '';
  let pendingClearedFidelity = [];
  let pendingClearedYnab = [];

  // Helper to flush accumulated cleared transactions as collapsible section
  const flushClearedSections = () => {
    if (pendingClearedFidelity.length > 0 && hideCleared) {
      fidelityHtml += html.clearedSection(pendingClearedFidelity);
      pendingClearedFidelity = [];
    }
    if (pendingClearedYnab.length > 0 && hideCleared) {
      ynabHtml += html.ynabClearedSection(pendingClearedYnab);
      pendingClearedYnab = [];
    }
  };

  currentTransactions.forEach((txn, index) => {
    const txnKey = JSON.stringify(txn);
    const suggestions = toImportMap.get(txnKey);
    const toUpdateYnab = toUpdateMap.get(txnKey);
    const pendingYnab = pendingMap.get(txnKey);
    const matchedYnab = matchedMap.get(txnKey);

    const isSkipped = skippedTransactions.has(index);
    let matchState = '';
    let isCleared = false;

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
    } else if (suggestions !== undefined) {
      matchState = 'new';
      if (suggestions.length === 1) {
        initialMatches.push({ fidelityIndex: index, ynabId: suggestions[0].id, type: 'match' });
      } else if (suggestions.length === 0) {
        initialMatches.push({ fidelityIndex: index, ynabId: `__CREATE_${index}__`, type: 'create' });
      }
    }

    if (isCleared && hideCleared) {
      // Accumulate cleared transactions
      pendingClearedFidelity.push({ txn, index, ynab: matchedYnab });
      pendingClearedYnab.push({ ynab: matchedYnab, fidelityIndex: index });
    } else {
      // Flush any accumulated cleared transactions first
      flushClearedSections();

      // Render Fidelity item
      fidelityHtml += html.fidelityItem(txn, index, isSkipped, matchState);

      // Render corresponding YNAB item
      if (matchedYnab && !hideCleared) {
        ynabHtml += html.ynabItem(matchedYnab, 'matched', index);
      } else if (toUpdateYnab) {
        ynabHtml += html.ynabItem(toUpdateYnab, 'matched', index);
      } else if (pendingYnab) {
        ynabHtml += html.ynabItem(pendingYnab, 'matched', index);
      } else if (suggestions !== undefined) {
        const formattedPayee = bankAdapter.formatPayeeName(txn.description);
        ynabHtml += html.createNewTarget(index, isSkipped ? null : txn, formattedPayee);
      }
    }
  });

  // Flush any remaining cleared transactions at the end
  flushClearedSections();

  // Render unmatched YNAB transactions at the bottom
  unmatchedYnab.forEach(ynab => {
    ynabHtml += html.ynabItem(ynab, 'available', null);
  });

  // Count stats for summary
  const toCreate = toImport.filter(item => item.suggestions.length === 0).length;
  const toMatch = toImport.filter(item => item.suggestions.length > 0).length + toUpdate.length;
  const toSkip = skippedTransactions.size;

  // Update summary stats in action bar
  summaryStats.innerHTML = html.matchSummaryText({ toCreate, toMatch, toSkip, beforeWatermark: 0 });

  // Show/hide import button based on actions available (use invisible to reserve space)
  const hasActions = toCreate > 0 || toMatch > 0;
  if (hasActions) {
    ynabImportBtn.classList.remove("invisible");
  } else {
    ynabImportBtn.classList.add("invisible");
  }

  // Render two-column layout
  resultsDiv.innerHTML = html.twoColumnContainer(fidelityHtml, ynabHtml);

  // Initialize match canvas
  if (matchCanvas) matchCanvas.destroy();
  matchCanvas = new MatchCanvas({
    onMatchChanged: (change) => {
      // Handle match changes from drag/drop
    }
  });
  matchCanvas.init();
  matchCanvas.setMatches(initialMatches);

  // Setup synchronized scrolling
  setupScrollSync();

  // Attach skip button handlers
  attachSkipButtonHandlers();
}

// Handle skip button clicks
function attachSkipButtonHandlers() {
  resultsDiv.addEventListener('click', (e) => {
    const skipBtn = e.target.closest('.skip-btn');
    if (!skipBtn) return;

    const index = parseInt(skipBtn.dataset.index, 10);
    if (isNaN(index)) return;

    if (skippedTransactions.has(index)) {
      skippedTransactions.delete(index);
    } else {
      skippedTransactions.add(index);
    }

    // Re-render to update UI
    displayTransactionsWithYnabPreview({
      toImport: transactionsToImport,
      toUpdate: transactionsToUpdate,
      pending: transactionsPending,
      matched: transactionsMatched,
      unmatchedYnab: unmatchedYnab,
      failedTransactions: []
    });
  });
}

// Synchronized scrolling between columns
let scrollSyncActive = false;

function setupScrollSync() {
  const fidelityCol = document.getElementById('fidelityColumn');
  const ynabCol = document.getElementById('ynabColumn');

  if (!fidelityCol || !ynabCol) return;

  let lastScrollTop = { fidelity: 0, ynab: 0 };
  let isScrolling = false;

  const syncScroll = (source, target, sourceKey, targetKey) => {
    if (isScrolling) return;
    isScrolling = true;

    const delta = source.scrollTop - lastScrollTop[sourceKey];
    const targetMaxScroll = target.scrollHeight - target.clientHeight;
    const sourceMaxScroll = source.scrollHeight - source.clientHeight;

    // Calculate new target scroll position
    let newTargetScroll = target.scrollTop + delta;

    // Clamp to valid range
    newTargetScroll = Math.max(0, Math.min(newTargetScroll, targetMaxScroll));

    // Only sync if target isn't already at its limit in the direction of scroll
    const atBottom = target.scrollTop >= targetMaxScroll - 1;
    const atTop = target.scrollTop <= 1;

    if (delta > 0 && !atBottom) {
      target.scrollTop = newTargetScroll;
    } else if (delta < 0 && !atTop) {
      target.scrollTop = newTargetScroll;
    }

    lastScrollTop[sourceKey] = source.scrollTop;
    lastScrollTop[targetKey] = target.scrollTop;

    requestAnimationFrame(() => {
      isScrolling = false;
    });
  };

  fidelityCol.addEventListener('scroll', () => {
    syncScroll(fidelityCol, ynabCol, 'fidelity', 'ynab');
  });

  ynabCol.addEventListener('scroll', () => {
    syncScroll(ynabCol, fidelityCol, 'ynab', 'fidelity');
  });

  scrollSyncActive = true;
}

