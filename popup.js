/**
 * Fidelity2YNAB - Popup Script
 *
 * Main UI controller for the extension popup
 * Handles:
 * - Transaction scraping and display
 * - YNAB configuration and API interactions
 * - Settings management (Chrome storage)
 * - Import preview with transaction matching
 */

// Global state
let currentTransactions = [];
let transactionsToImport = [];
let transactionsToUpdate = [];
let transactionsPending = [];
let transactionsMatched = [];
let unmatchedYnab = [];
let ynabConfig = null;

// DOM element references
let scrapeBtn,
  toastContainer,
  resultsDiv,
  skipCoreFundsCheckbox,
  hideClearedCheckbox;
let ynabStatus, ynabStatusText, configureYnabBtn;
let ynabModal, ynabTokenInput, ynabBudgetSelect, ynabAccountSelect;
let saveYnabConfigBtn, cancelYnabConfigBtn;
let alertModal, alertTitle, alertMessage, alertOkBtn;
let confirmModal, confirmTitle, confirmMessage, confirmOkBtn, confirmCancelBtn;

// Wait for DOM to be fully loaded
document.addEventListener("DOMContentLoaded", () => {
  console.log("Popup loaded");

  // DOM elements - throw if critical elements are missing
  scrapeBtn = document.getElementById("scrapeBtn");
  toastContainer = document.getElementById("toastContainer");
  resultsDiv = document.getElementById("results");
  skipCoreFundsCheckbox = document.getElementById("skipCoreFunds");
  hideClearedCheckbox = document.getElementById("hideCleared");

  if (!toastContainer) throw new Error("toastContainer element not found");
  if (!resultsDiv) throw new Error("results element not found");

  // YNAB elements
  ynabStatus = document.getElementById("ynabStatus");
  ynabStatusText = document.getElementById("ynabStatusText");
  configureYnabBtn = document.getElementById("configureYnabBtn");
  ynabModal = document.getElementById("ynabModal");
  ynabTokenInput = document.getElementById("ynabToken");
  ynabBudgetSelect = document.getElementById("ynabBudget");
  ynabAccountSelect = document.getElementById("ynabAccount");
  saveYnabConfigBtn = document.getElementById("saveYnabConfig");
  cancelYnabConfigBtn = document.getElementById("cancelYnabConfig");

  if (!ynabStatus) throw new Error("ynabStatus element not found");
  if (!ynabStatusText) throw new Error("ynabStatusText element not found");
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
        console.log(
          "Saved setting - skipCoreFunds:",
          skipCoreFundsCheckbox.checked
        );
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
        console.log(
          "Saved setting - hideCleared:",
          hideClearedCheckbox.checked
        );
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
    scrapeBtn.addEventListener("click", () => {
      console.log("Scrape button clicked");
      scrapeTransactions();
    });
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

  console.log("Event listeners attached");
});

async function scrapeTransactions() {
  try {
    scrapeBtn.disabled = true;

    // Get the active tab
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    // Check if we're on a Fidelity page
    if (!tab.url.includes("fidelity.com")) {
      showStatus("Please navigate to a Fidelity page first", "error");
      scrapeBtn.disabled = false;
      return;
    }

    // Inject the content script if not already injected
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
    } catch (e) {
      // Script might already be injected, continue
      console.log("Content script already injected or failed to inject:", e);
    }

    // Send message to content script with settings
    const skipCoreFunds = skipCoreFundsCheckbox
      ? skipCoreFundsCheckbox.checked
      : true;
    console.log("Scraping with skipCoreFunds:", skipCoreFunds);

    const response = await chrome.tabs.sendMessage(tab.id, {
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
    document.getElementById("scrapeBtn").addEventListener("click", () => {
      console.log("Scrape button clicked");
      scrapeTransactions();
    });
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
    console.log(
      "Loaded setting - skipCoreFunds:",
      skipCoreFundsCheckbox.checked
    );
  }

  // Load hide cleared (default to true)
  if (hideClearedCheckbox) {
    hideClearedCheckbox.checked = settings.hideCleared !== false;
    console.log(
      "Loaded setting - hideCleared:",
      hideClearedCheckbox.checked
    );
  }
}

// Load YNAB configuration from storage
async function loadYnabConfig() {
  try {
    const config = await getStorageValue("ynabConfig");
    if (config) {
      ynabConfig = config;
      updateYnabStatus();
    } else {
      ynabStatus.style.display = "flex";
    }
  } catch (error) {
    console.error("Error loading YNAB config:", error);
  }
}

// Update YNAB status display
function updateYnabStatus() {
  if (
    ynabConfig &&
    ynabConfig.token &&
    ynabConfig.budgetId &&
    ynabConfig.accountId
  ) {
    ynabStatusText.classList.remove("text-gray-500");
    ynabStatusText.classList.add("text-green-600");
    ynabStatusText.textContent = `YNAB Status: Connected to ${ynabConfig.budgetName} → ${ynabConfig.accountName}`;
  } else {
    ynabStatusText.classList.remove("text-green-600");
    ynabStatusText.classList.add("text-gray-500");
    ynabStatusText.textContent = "Not Connected";
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
  ynabModal.style.display = "flex";
}

// Close YNAB modal
function closeYnabModal() {
  ynabModal.style.display = "none";
}

// Show alert modal
function showAlert(title, message) {
  alertTitle.textContent = title;
  // Replace \n with <br> for proper line breaks in HTML
  alertMessage.innerHTML = message.replace(/\n/g, "<br>");
  alertModal.style.display = "flex";
}

// Close alert modal
function closeAlertModal() {
  alertModal.style.display = "none";
}

// Show confirmation modal and return a Promise that resolves to true/false
function showConfirm(title, messageHtml) {
  return new Promise((resolve) => {
    confirmTitle.textContent = title;
    confirmMessage.innerHTML = messageHtml;
    confirmModal.style.display = "flex";

    // Handle OK button
    const handleOk = () => {
      confirmModal.style.display = "none";
      confirmOkBtn.removeEventListener("click", handleOk);
      confirmCancelBtn.removeEventListener("click", handleCancel);
      resolve(true);
    };

    // Handle Cancel button
    const handleCancel = () => {
      confirmModal.style.display = "none";
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

    console.log("Loaded budgets:", budgets.length);
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

    console.log("Loaded accounts:", openAccounts.length);
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
    console.log("YNAB config saved");
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

  if (transactionsToImport.length === 0 && transactionsToUpdate.length === 0) {
    showStatus("No transactions to import or update", "info");
    return;
  }

  // Check if all suggestion dropdowns have a selection
  const dropdowns = document.querySelectorAll(".suggestion-dropdown");
  const unselectedDropdowns = [];
  dropdowns.forEach((dropdown) => {
    if (!dropdown.value || dropdown.value === "") {
      unselectedDropdowns.push(dropdown);
    }
  });

  if (unselectedDropdowns.length > 0) {
    showAlert(
      "Selection Required",
      `Please select an action for all ${
        unselectedDropdowns.length
      } transaction${
        unselectedDropdowns.length > 1 ? "s" : ""
      } with matching suggestions before importing.\n\nFor each "MATCH AVAILABLE" transaction, choose either "Create new transaction" or match with an existing YNAB transaction.`
    );
    // Highlight the first unselected dropdown button
    if (unselectedDropdowns[0]) {
      const fidelityIndex = unselectedDropdowns[0].getAttribute(
        "data-fidelity-index"
      );
      const dropdownBtn = document.querySelector(
        `.custom-dropdown-btn[data-fidelity-index="${fidelityIndex}"]`
      );
      if (dropdownBtn) {
        dropdownBtn.style.border = "0.125rem solid #d32f2f";
        dropdownBtn.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
        setTimeout(() => {
          dropdownBtn.style.border = "0.0625rem solid #d1d5db";
        }, 3000);
      }
    }
    return;
  }

  // Check for unmatched YNAB transactions and confirm with user
  // First, collect all YNAB IDs that the user has selected to match
  const userSelectedYnabIds = new Set();
  const allDropdowns = document.querySelectorAll(".suggestion-dropdown");
  allDropdowns.forEach((dropdown) => {
    const selectedValue = dropdown.value;
    if (
      selectedValue &&
      selectedValue !== "" &&
      selectedValue !== "__CREATE_NEW__"
    ) {
      userSelectedYnabIds.add(selectedValue);
    }
  });

  // Filter out YNAB transactions that the user has manually selected to match
  const stillUnmatched = unmatchedYnab.filter(
    (txn) => !userSelectedYnabIds.has(txn.id)
  );

  if (stillUnmatched && stillUnmatched.length > 0) {
    const unmatchedList = stillUnmatched
      .map(
        (txn) =>
          `<li>${txn.date}: ${txn.payee_name || "Unknown"} - $${(
            txn.amount / 1000
          ).toFixed(2)} (${txn.cleared})</li>`
      )
      .join("");

    const confirmed = await showConfirm(
      "Unmatched YNAB Transactions",
      `<p style="margin-bottom: 0.75rem;">The following ${
        stillUnmatched.length
      } YNAB transaction${
        stillUnmatched.length > 1 ? "s" : ""
      } could not be automatically matched with Fidelity transactions:</p>
      <ul style="margin: 0 0 0.75rem 1.25rem; padding: 0; max-height: 12.5rem; overflow-y: auto;">
        ${unmatchedList}
      </ul>
      <p style="margin: 0;">Do you want to continue with the import?</p>`
    );

    if (!confirmed) {
      console.log(
        "Import cancelled by user due to unmatched YNAB transactions"
      );
      return;
    }
  }

  try {
    const totalActions =
      transactionsToImport.length + transactionsToUpdate.length;
    showStatus(
      `Processing ${totalActions} transaction${
        totalActions > 1 ? "s" : ""
      } to YNAB...`,
      "info"
    );

    const importBtn = document.getElementById("ynabImportBtn");
    if (importBtn) importBtn.disabled = true;

    const api = new YNABApi(ynabConfig.token);
    const dateTolerance = 5;
    const deduplicator = new TransactionDeduplicator(dateTolerance);

    let createdCount = 0;
    let updatedCount = 0;

    // Step 1: Process new transactions (create or match with suggestions)
    if (transactionsToImport.length > 0) {
      const toCreate = [];
      const toMatchWithSuggestions = [];

      console.log(
        `Processing ${transactionsToImport.length} transactions to import...`
      );

      // Check user selections for each transaction
      for (const item of transactionsToImport) {
        const fidelityTxn = item.fidelity;
        const suggestions = item.suggestions;

        // Find the index of this transaction in currentTransactions
        const txnIndex = currentTransactions.findIndex(
          (t) =>
            t.date === fidelityTxn.date &&
            t.description === fidelityTxn.description &&
            t.amountValue === fidelityTxn.amountValue
        );

        // Find if user selected a suggestion
        let selectedValue = null;
        if (txnIndex !== -1) {
          const dropdowns = document.querySelectorAll(".suggestion-dropdown");
          for (const dropdown of dropdowns) {
            if (dropdown.dataset.fidelityIndex === String(txnIndex)) {
              selectedValue = dropdown.value;
              break;
            }
          }
        }

        if (suggestions.length === 0) {
          // No suggestions available, automatically create new transaction
          toCreate.push(fidelityTxn);
          console.log(
            "Will create new transaction (no matches):",
            fidelityTxn.description
          );
        } else if (selectedValue === "__CREATE_NEW__") {
          // User explicitly chose to create new transaction
          toCreate.push(fidelityTxn);
          console.log(
            "Will create new transaction for:",
            fidelityTxn.description
          );
        } else if (selectedValue) {
          // User selected a YNAB transaction to match with
          const selectedYnab = suggestions.find((y) => y.id === selectedValue);
          if (selectedYnab) {
            toMatchWithSuggestions.push({
              fidelity: fidelityTxn,
              ynab: selectedYnab,
            });
            console.log(
              "Will match Fidelity transaction with YNAB:",
              fidelityTxn.description,
              "→",
              selectedYnab.payee_name
            );
          } else {
            console.error(
              "Could not find selected YNAB transaction with ID:",
              selectedValue
            );
            throw new Error(
              `Internal error: Could not find YNAB transaction with ID ${selectedValue}`
            );
          }
        } else {
          // No selection found - FAIL HARD
          console.error(
            "No user selection found for transaction:",
            fidelityTxn
          );
          throw new Error(
            `Internal error: Transaction "${fidelityTxn.description}" has no user selection (${suggestions.length} suggestions available)`
          );
        }
      }

      console.log(
        `Summary: ${toCreate.length} to create, ${toMatchWithSuggestions.length} to manually match`
      );

      // Create new transactions
      if (toCreate.length > 0) {
        const ynabTransactions = toCreate.map((txn) =>
          deduplicator.fidelityToYNAB(txn, ynabConfig.accountId)
        );

        const result = await api.createTransactions(
          ynabConfig.budgetId,
          ynabTransactions
        );
        createdCount = result.transactions.length;
        console.log(`Created ${createdCount} new transactions`);
      }

      // Update matched suggestions (same logic as TO CLEAR)
      if (toMatchWithSuggestions.length > 0) {
        for (const match of toMatchWithSuggestions) {
          const updates = { cleared: "cleared" };

          // For non-transfer transactions, also update the date
          const isTransfer =
            match.ynab.transfer_account_id !== null &&
            match.ynab.transfer_account_id !== undefined;
          if (!isTransfer) {
            const fidelityDate = deduplicator.parseFidelityDate(
              match.fidelity.date
            );
            if (fidelityDate) {
              updates.date = fidelityDate;
            }
          }

          await api.updateTransaction(
            ynabConfig.budgetId,
            match.ynab.id,
            updates
          );
          updatedCount++;
        }
        console.log(
          `Matched ${toMatchWithSuggestions.length} transactions with user-selected YNAB transactions`
        );
      }
    }

    // Step 2: Update existing uncleared transactions to cleared
    if (transactionsToUpdate.length > 0) {
      for (const match of transactionsToUpdate) {
        const updates = { cleared: "cleared" };

        // For non-transfer transactions, also update the date
        const isTransfer =
          match.ynab.transfer_account_id !== null &&
          match.ynab.transfer_account_id !== undefined;
        if (!isTransfer) {
          const fidelityDate = deduplicator.parseFidelityDate(
            match.fidelity.date
          );
          if (fidelityDate) {
            updates.date = fidelityDate;
          }
        }

        await api.updateTransaction(
          ynabConfig.budgetId,
          match.ynab.id,
          updates
        );
        updatedCount++;
      }
      console.log(`Updated ${updatedCount} transactions to cleared`);
    }

    // Show success message
    const messages = [];
    if (createdCount > 0) messages.push(`${createdCount} created`);
    if (updatedCount > 0) messages.push(`${updatedCount} updated`);
    showStatus(`✓ Successfully processed: ${messages.join(", ")}!`, "success");

    // Re-analyze to update the preview
    await analyzeTransactions();
  } catch (error) {
    console.error("Error importing to YNAB:", error);
    showStatus(`Import Error: ${error.message}`, "error");
  } finally {
    const importBtn = document.getElementById("ynabImportBtn");
    if (importBtn) importBtn.disabled = false;
  }
}

// Analyze transactions and find what needs to be imported
async function analyzeTransactions() {
  if (!ynabConfig || !ynabConfig.token || currentTransactions.length === 0) {
    return;
  }

  try {
    const api = new YNABApi(ynabConfig.token);
    const dateTolerance = 5;
    const deduplicator = new TransactionDeduplicator(dateTolerance);

    // Find earliest Fidelity transaction date
    const earliestFidelityDate =
      deduplicator.getEarliestFidelityDate(currentTransactions);

    if (!earliestFidelityDate) {
      showStatus("No valid transaction dates found", "error");
      return;
    }

    // Calculate fetch date: earliest Fidelity date - tolerance
    const fetchDate = new Date(earliestFidelityDate);
    fetchDate.setDate(fetchDate.getDate() - dateTolerance);
    const sinceDate = deduplicator.formatDate(fetchDate);

    console.log(
      `Earliest Fidelity date: ${earliestFidelityDate}, fetching YNAB since: ${sinceDate}`
    );

    // Fetch YNAB transactions
    const ynabTransactions = await api.getTransactionsSinceDate(
      ynabConfig.budgetId,
      ynabConfig.accountId,
      sinceDate
    );

    console.log(
      `Found ${ynabTransactions.length} YNAB transactions since ${sinceDate}`
    );

    // Find transactions to import/update
    const result = await deduplicator.findTransactionsToImport(
      currentTransactions,
      ynabTransactions
    );

    transactionsToImport = result.toImport;
    transactionsToUpdate = result.toUpdate;
    transactionsPending = result.pending || [];
    transactionsMatched = result.matched;
    unmatchedYnab = result.unmatchedYnab || [];

    console.log(
      `Analysis: ${result.toImport.length} to import, ${result.toUpdate.length} to update, ${transactionsPending.length} pending, ${result.matched.length} already matched, ${unmatchedYnab.length} unmatched YNAB`
    );

    // Update display with preview
    displayTransactionsWithYnabPreview(result);
  } catch (error) {
    console.error("Error analyzing transactions:", error);
    showStatus(`Analysis Error: ${error.message}`, "error");
  }
}

// Display transactions with YNAB import preview
function displayTransactionsWithYnabPreview(analysisResult) {
  if (!resultsDiv) {
    throw new Error("Results div not found in displayTransactionsWithYnabPreview");
  }

  const { toImport, toUpdate, pending, matched, unmatchedYnab, failedTransactions } =
    analysisResult;

  if (currentTransactions.length === 0) {
    resultsDiv.innerHTML =
      '<div class="text-center py-5 text-muted">No transactions found</div>';
    return;
  }

  // Create maps for quick lookup
  const toImportMap = new Map(
    toImport.map((item) => [JSON.stringify(item.fidelity), item.suggestions])
  );
  const toUpdateMap = new Map(
    toUpdate.map((item) => [JSON.stringify(item.fidelity), item.ynab])
  );
  const pendingMap = new Map(
    pending.map((item) => [JSON.stringify(item.fidelity), item.ynab])
  );
  const matchedMap = new Map(
    matched.map((item) => [JSON.stringify(item.fidelity), item.ynab])
  );

  // Count how many toImport transactions have suggestions (pending matches)
  const pendingCount = toImport.filter(
    (item) => item.suggestions && item.suggestions.length > 0
  ).length;
  const newCount = toImport.length - pendingCount;

  let html = "";

  // Add error for failed transactions
  if (failedTransactions && failedTransactions.length > 0) {
    html += window.html.errorBox(failedTransactions);
  }

  // Add summary with import button
  const totalActions = toImport.length + toUpdate.length;

  // Build summary parts
  const summaryParts = [];
  if (pendingCount > 0)
    summaryParts.push(
      `<strong class="font-semibold">${pendingCount}</strong> pending match${pendingCount !== 1 ? 'es' : ''}`
    );
  if (newCount > 0)
    summaryParts.push(`<strong class="font-semibold">${newCount}</strong> new`);
  if (toUpdate.length > 0)
    summaryParts.push(
      `<strong class="font-semibold">${toUpdate.length}</strong> to clear`
    );

  html += window.html.importSummary(totalActions, summaryParts, matched.length);

  // Show unmatched YNAB transactions only when Import button is disabled (no Fidelity transactions to process)
  if (totalActions === 0 && unmatchedYnab && unmatchedYnab.length > 0) {
    html += window.html.warningBox(unmatchedYnab);
  }

  // Group transactions by date
  const transactionsByDate = new Map();

  currentTransactions.forEach((txn, index) => {
    const txnKey = JSON.stringify(txn);
    const suggestions = toImportMap.get(txnKey);
    const toUpdateYnab = toUpdateMap.get(txnKey);
    const pendingYnab = pendingMap.get(txnKey);
    const matchedYnab = matchedMap.get(txnKey);

    // Skip rendering CLEARED transactions if hideCleared is checked
    if (matchedYnab && hideClearedCheckbox && hideClearedCheckbox.checked) {
      return; // Skip this transaction
    }

    const date = txn.date || 'N/A';
    if (!transactionsByDate.has(date)) {
      transactionsByDate.set(date, []);
    }

    transactionsByDate.get(date).push({
      txn,
      index,
      suggestions,
      toUpdateYnab,
      pendingYnab,
      matchedYnab
    });
  });

  // Render each date group
  transactionsByDate.forEach((transactions, date) => {
    let groupHtml = '';

    transactions.forEach(({ txn, index, suggestions, toUpdateYnab, pendingYnab, matchedYnab }) => {
      const amountClass = txn.type === "credit" ? "credit" : "debit";

      let badgeClass,
        badgeText,
        matchInfo = "",
        dropdownId = "",
        suggestionsList = [];

      if (suggestions !== undefined) {
        // This is a NEW transaction (or has match suggestions)
        if (suggestions.length > 0) {
          badgeClass = "badge-new";
          badgeText = "MATCH AVAILABLE";
          dropdownId = `dropdown-${index}`;
          suggestionsList = suggestions;
        } else {
          badgeClass = "badge-new";
          badgeText = "NEW";
        }
      } else if (pendingYnab) {
        badgeClass = "badge-pending";
        badgeText = "PENDING";
        matchInfo = window.html.matchInfo(pendingYnab);
      } else if (toUpdateYnab) {
        badgeClass = "badge-clear";
        badgeText = "MATCHED";
        matchInfo = window.html.matchInfo(toUpdateYnab);
      } else if (matchedYnab) {
        badgeClass = "badge-cleared";
        badgeText = "CLEARED";
        matchInfo = window.html.matchInfo(matchedYnab);
      }

      groupHtml += window.html.transaction(
        txn,
        amountClass,
        badgeClass,
        badgeText,
        matchInfo || index,
        dropdownId,
        suggestionsList
      );
    });

    html += window.html.dateGroup(date, groupHtml);
  });

  resultsDiv.innerHTML = html;

  // Attach custom dropdown event listeners
  attachCustomDropdownListeners();

  // Re-attach import button event listener if it exists
  const importBtn = document.getElementById("ynabImportBtn");
  if (importBtn) {
    importBtn.addEventListener("click", importToYNAB);
  }
}

// Handle custom dropdown interactions using event delegation
let dropdownListenersAttached = false;

function attachCustomDropdownListeners() {
  // Only attach listeners once using event delegation
  if (dropdownListenersAttached) return;
  dropdownListenersAttached = true;

  // Use event delegation on resultsDiv
  if (!resultsDiv) throw new Error("resultsDiv not found when attaching dropdown listeners");

  // Toggle dropdown on button click
  resultsDiv.addEventListener("click", (e) => {
    const btn = e.target.closest(".custom-dropdown-btn");
    if (btn) {
      e.stopPropagation();
      const dropdownId = btn.getAttribute("data-dropdown-id");
      const dropdown = document.getElementById(dropdownId);

      if (!dropdown) return;

      // Close all other dropdowns
      document.querySelectorAll(".custom-dropdown-menu").forEach((menu) => {
        if (menu.id !== dropdownId) {
          menu.classList.add("hidden");
        }
      });

      // Toggle this dropdown
      const isHidden = dropdown.classList.contains("hidden");
      if (isHidden) {
        // Show dropdown temporarily to measure it
        dropdown.style.visibility = "hidden";
        dropdown.classList.remove("hidden");

        // Position the dropdown below the button (convert pixels to rems)
        const rect = btn.getBoundingClientRect();
        const dropdownWidth = dropdown.offsetWidth;

        dropdown.style.top = `${(rect.bottom + 2) / 16}rem`;
        dropdown.style.left = `${(rect.right - dropdownWidth) / 16}rem`;
        dropdown.style.visibility = "visible";
      } else {
        dropdown.classList.add("hidden");
      }
      return;
    }

    // Handle option selection
    const option = e.target.closest(".dropdown-option");
    if (option) {
      const value = option.getAttribute("data-value");
      const fidelityIndex = option.getAttribute("data-fidelity-index");
      const container = option.closest(".relative");
      const btn = container?.querySelector(".custom-dropdown-btn");
      const dropdown = option.closest(".custom-dropdown-menu");
      const hiddenInput = container?.querySelector(".suggestion-dropdown");

      if (!btn || !dropdown || !hiddenInput) return;

      // Update hidden input value
      hiddenInput.value = value;

      // Update badge appearance to show selection was made
      if (value === "__CREATE_NEW__") {
        btn.innerHTML = "NEW";
        btn.className = "bg-green-600 text-white pointer-events-none px-2 py-0.5 text-xs rounded-full mt-1";
      } else {
        btn.innerHTML = "MATCHED";
        btn.className = "bg-blue-600 text-white pointer-events-none px-2 py-0.5 text-xs rounded-full mt-1";
      }

      // Close dropdown
      dropdown.classList.add("hidden");
    }
  });

  // Close dropdowns when clicking outside
  document.addEventListener("click", () => {
    document.querySelectorAll(".custom-dropdown-menu").forEach((menu) => {
      menu.classList.add("hidden");
    });
  });
}
