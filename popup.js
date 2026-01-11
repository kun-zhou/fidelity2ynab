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
let transactionsMatched = [];
let unmatchedYnab = [];
let ynabConfig = null;

// DOM element references
let scrapeBtn,
  statusDiv,
  resultsDiv,
  skipCoreFundsCheckbox,
  hideClearedCheckbox;
let ynabStatus, ynabStatusText, configureYnabBtn;
let ynabModal, ynabTokenInput, ynabBudgetSelect, ynabAccountSelect;
let saveYnabConfigBtn, cancelYnabConfigBtn, dateToleranceInput;
let alertModal, alertTitle, alertMessage, alertOkBtn;
let confirmModal, confirmTitle, confirmMessage, confirmOkBtn, confirmCancelBtn;

// Wait for DOM to be fully loaded
document.addEventListener("DOMContentLoaded", () => {
  console.log("Popup loaded");

  // DOM elements
  scrapeBtn = document.getElementById("scrapeBtn");
  statusDiv = document.getElementById("status");
  resultsDiv = document.querySelector(".results");
  skipCoreFundsCheckbox = document.getElementById("skipCoreFunds");
  hideClearedCheckbox = document.getElementById("hideCleared");
  dateToleranceInput = document.getElementById("dateTolerance");

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

  // Alert modal elements
  alertModal = document.getElementById("alertModal");
  alertTitle = document.getElementById("alertTitle");
  alertMessage = document.getElementById("alertMessage");
  alertOkBtn = document.getElementById("alertOkBtn");

  // Confirmation modal elements
  confirmModal = document.getElementById("confirmModal");
  confirmTitle = document.getElementById("confirmTitle");
  confirmMessage = document.getElementById("confirmMessage");
  confirmOkBtn = document.getElementById("confirmOkBtn");
  confirmCancelBtn = document.getElementById("confirmCancelBtn");

  // Load saved settings
  if (skipCoreFundsCheckbox) {
    try {
      chrome.storage.local.get(
        ["skipCoreFunds", "dateTolerance", "hideCleared"],
        (result) => {
          // Default to true if not set
          if (skipCoreFundsCheckbox) {
            skipCoreFundsCheckbox.checked = result.skipCoreFunds !== false;
            console.log(
              "Loaded setting - skipCoreFunds:",
              skipCoreFundsCheckbox.checked
            );
          }
          // Load hide cleared (default to true)
          if (hideClearedCheckbox) {
            hideClearedCheckbox.checked = result.hideCleared !== false;
            console.log(
              "Loaded setting - hideCleared:",
              hideClearedCheckbox.checked
            );
          }
          // Load date tolerance (default to 5)
          if (dateToleranceInput) {
            dateToleranceInput.value =
              result.dateTolerance !== undefined ? result.dateTolerance : 5;
            console.log(
              "Loaded setting - dateTolerance:",
              dateToleranceInput.value
            );
          }
        }
      );
    } catch (error) {
      console.error("Error loading settings:", error);
      // Default to true if storage fails
      skipCoreFundsCheckbox.checked = true;
      if (hideClearedCheckbox) {
        hideClearedCheckbox.checked = true;
      }
      if (dateToleranceInput) {
        dateToleranceInput.value = 5;
      }
    }

    // Save setting when changed
    skipCoreFundsCheckbox.addEventListener("change", () => {
      try {
        chrome.storage.local.set({
          skipCoreFunds: skipCoreFundsCheckbox.checked,
        });
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
    hideClearedCheckbox.addEventListener("change", () => {
      try {
        chrome.storage.local.set({ hideCleared: hideClearedCheckbox.checked });
        console.log(
          "Saved setting - hideCleared:",
          hideClearedCheckbox.checked
        );
        // Re-render the display if we have transactions
        if (currentTransactions.length > 0 && ynabConfig && ynabConfig.token) {
          displayTransactionsWithYnabPreview({
            toImport: transactionsToImport,
            toUpdate: transactionsToUpdate,
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

  // Save date tolerance when changed
  if (dateToleranceInput) {
    dateToleranceInput.addEventListener("change", () => {
      try {
        const tolerance = parseInt(dateToleranceInput.value);
        chrome.storage.local.set({ dateTolerance: tolerance });
        console.log("Saved setting - dateTolerance:", tolerance);
      } catch (error) {
        console.error("Error saving date tolerance:", error);
      }
    });
  }

  // Load YNAB configuration
  loadYnabConfig();

  // Event listeners
  scrapeBtn.addEventListener("click", () => {
    console.log("Scrape button clicked");
    scrapeTransactions();
  });
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
    showStatus("Validating page...", "info");
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

    showStatus("Scraping transactions...", "info");

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
  if (transactions.length === 0) {
    resultsDiv.innerHTML = `
      <div class="empty-state">
        <p style="margin-bottom: 16px;">Click "Scrape Transactions" to extract data from the current page</p>
        <button id="scrapeBtn">Scrape Transactions</button>
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
    <div class="import-summary">
      <strong>${transactions.length}</strong> transaction${
    transactions.length !== 1 ? "s" : ""
  } scraped
      <span style="color: #666; font-size: 12px; margin-left: 8px;">Configure YNAB to enable import</span>
    </div>
  `;

  transactions.forEach((txn, index) => {
    const amountClass = txn.type === "credit" ? "credit" : "debit";

    html += `
      <div class="transaction">
        <div class="transaction-header">
          <span class="transaction-date">${txn.date || "N/A"}</span>
          <span class="transaction-amount ${amountClass}">${
      txn.amount || "N/A"
    }</span>
        </div>
        <div class="transaction-description">${txn.description || "N/A"}</div>
        ${
          txn.status
            ? `<div class="transaction-status">Status: ${txn.status}</div>`
            : ""
        }
        ${
          txn.cashBalance
            ? `<div class="transaction-balance">Core Position Balance: $${txn.cashBalance}</div>`
            : ""
        }
      </div>
    `;
  });

  resultsDiv.innerHTML = html;
}

function showStatus(message, type) {
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
  statusDiv.style.display = "block";
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

// Load YNAB configuration from storage
async function loadYnabConfig() {
  try {
    chrome.storage.local.get(["ynabConfig"], (result) => {
      if (result.ynabConfig) {
        ynabConfig = result.ynabConfig;
        updateYnabStatus();
      } else {
        ynabStatus.style.display = "flex";
      }
    });
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
    ynabStatus.style.display = "flex";
    ynabStatus.classList.add("configured");
    ynabStatusText.textContent = `${ynabConfig.budgetName} → ${ynabConfig.accountName}`;
  } else {
    ynabStatus.style.display = "flex";
    ynabStatus.classList.remove("configured");
    ynabStatusText.textContent = "Not Configured";
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
      option.textContent = `${account.name} (${account.type})`;
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
    chrome.storage.local.set({ ynabConfig }, () => {
      console.log("YNAB config saved");
      updateYnabStatus();
      closeYnabModal();
      showStatus("YNAB configuration saved!", "success");
      setTimeout(() => (statusDiv.style.display = "none"), 2000);
    });
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
      } with matching suggestions before importing.\n\nFor each yellow suggestion box, choose either "Create new transaction" or match with an existing YNAB transaction.`
    );
    // Highlight the first unselected dropdown
    if (unselectedDropdowns[0]) {
      unselectedDropdowns[0].style.border = "2px solid #d32f2f";
      unselectedDropdowns[0].scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      setTimeout(() => {
        unselectedDropdowns[0].style.border = "1px solid #ffc107";
      }, 3000);
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
      `<p style="margin-bottom: 12px;">The following ${
        stillUnmatched.length
      } YNAB transaction${
        stillUnmatched.length > 1 ? "s" : ""
      } could not be automatically matched with Fidelity transactions:</p>
      <ul style="margin: 0 0 12px 20px; padding: 0; max-height: 200px; overflow-y: auto;">
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
    const dateTolerance = parseInt(dateToleranceInput?.value || "5");
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

        if (selectedValue === "__CREATE_NEW__") {
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
    showStatus("Analyzing transactions with YNAB...", "info");

    const api = new YNABApi(ynabConfig.token);
    const dateTolerance = parseInt(dateToleranceInput?.value || "5");
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
    transactionsMatched = result.matched;
    unmatchedYnab = result.unmatchedYnab || [];

    console.log(
      `Analysis: ${result.toImport.length} to import, ${result.toUpdate.length} to update, ${result.matched.length} already matched, ${unmatchedYnab.length} unmatched YNAB`
    );

    // Update display with preview
    displayTransactionsWithYnabPreview(result);

    statusDiv.style.display = "none";
  } catch (error) {
    console.error("Error analyzing transactions:", error);
    showStatus(`Analysis Error: ${error.message}`, "error");
  }
}

// Display transactions with YNAB import preview
function displayTransactionsWithYnabPreview(analysisResult) {
  const { toImport, toUpdate, matched, unmatchedYnab, failedTransactions } =
    analysisResult;

  if (currentTransactions.length === 0) {
    resultsDiv.innerHTML =
      '<div class="empty-state">No transactions found</div>';
    return;
  }

  // Create maps for quick lookup
  const toImportMap = new Map(
    toImport.map((item) => [JSON.stringify(item.fidelity), item.suggestions])
  );
  const toUpdateMap = new Map(
    toUpdate.map((item) => [JSON.stringify(item.fidelity), item.ynab])
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
    html += `
      <div class="status error" style="display: block; margin-bottom: 12px;">
        ❌ Error: ${failedTransactions.length} transaction${
      failedTransactions.length !== 1 ? "s" : ""
    } failed to parse (invalid date format):
        <ul style="margin: 8px 0 0 20px; padding: 0;">
          ${failedTransactions
            .map((txn) => `<li>Date: "${txn.date}" - ${txn.description}</li>`)
            .join("")}
        </ul>
      </div>
    `;
  }

  // Add summary with import button
  const totalActions = toImport.length + toUpdate.length;

  // Build summary parts
  const summaryParts = [];
  if (pendingCount > 0)
    summaryParts.push(`<strong>${pendingCount}</strong> pending`);
  if (newCount > 0) summaryParts.push(`<strong>${newCount}</strong> new`);
  if (toUpdate.length > 0)
    summaryParts.push(`<strong>${toUpdate.length}</strong> clear`);

  html += `
    <div class="import-summary" style="display: flex; justify-content: space-between; align-items: center;">
      <div>
        <strong>${totalActions}</strong> transaction${
    totalActions !== 1 ? "s" : ""
  } will be processed:
        ${summaryParts.join(", ")}
        ${
          matched.length > 0
            ? ` • <strong>${matched.length}</strong> already cleared`
            : ""
        }
      </div>
      <button id="ynabImportBtn" ${
        totalActions === 0 ? "disabled" : ""
      } style="padding: 6px 16px; white-space: nowrap;">Import to YNAB</button>
    </div>
  `;

  // Show unmatched YNAB transactions only when Import button is disabled (no Fidelity transactions to process)
  if (totalActions === 0 && unmatchedYnab && unmatchedYnab.length > 0) {
    html += `
      <div class="status error" style="display: block; margin-top: 12px;">
        ⚠️ Warning: ${unmatchedYnab.length} YNAB transaction${
      unmatchedYnab.length !== 1 ? "s" : ""
    } could not be matched with Fidelity:
        <ul style="margin: 8px 0 0 20px; padding: 0; max-height: 200px; overflow-y: auto;">
          ${unmatchedYnab
            .map((txn) => {
              const amount = (txn.amount / 1000).toFixed(2);
              return `<li>${txn.date}: ${
                txn.payee_name || "Unknown"
              } - $${amount} [${txn.cleared}]</li>`;
            })
            .join("")}
        </ul>
      </div>
    `;
  }

  currentTransactions.forEach((txn, index) => {
    const txnKey = JSON.stringify(txn);
    const suggestions = toImportMap.get(txnKey);
    const toUpdateYnab = toUpdateMap.get(txnKey);
    const matchedYnab = matchedMap.get(txnKey);

    const amountClass = txn.type === "credit" ? "credit" : "debit";

    let txnClass,
      badgeClass,
      badgeText,
      matchInfo = "";

    if (suggestions !== undefined) {
      // This is a NEW transaction
      txnClass = "new";
      badgeClass = "badge-new";
      badgeText = "NEW";

      // Always show a dropdown for NEW transactions (user must explicitly choose action)
      const dropdownId = `suggestion-${index}`;
      const hasMatches = suggestions.length > 0;
      const headerText = hasMatches
        ? `💡 ${suggestions.length} matching YNAB transaction${
            suggestions.length > 1 ? "s" : ""
          } found with same amount - <strong style="color: #d32f2f;">SELECTION REQUIRED</strong>`
        : `No matching YNAB transactions found`;

      matchInfo = `
        <div class="transaction-suggestion" style="margin-top: 8px; padding: 8px; background: #fff3cd; border-radius: 4px; border: 1px solid #ffc107;">
          <div style="font-size: 12px; color: #856404; margin-bottom: 4px; font-weight: 500;">
            ${headerText}
          </div>
          <select id="${dropdownId}" class="suggestion-dropdown" data-fidelity-index="${index}" style="width: 100%; padding: 4px; border: 1px solid #ffc107; border-radius: 4px; font-size: 12px; background: #fff;">
            ${
              hasMatches
                ? '<option value="" disabled selected>-- Select action (required) --</option>'
                : ""
            }
            <option value="__CREATE_NEW__" ${
              !hasMatches ? "selected" : ""
            }>Create new transaction</option>
            ${suggestions
              .map((ynab) => {
                const amount = (ynab.amount / 1000).toFixed(2);
                return `<option value="${ynab.id}">Match with: ${ynab.date}: ${
                  ynab.payee_name || "Unknown"
                } ($${amount}) [${ynab.cleared}]</option>`;
              })
              .join("")}
          </select>
        </div>
      `;
    } else if (toUpdateYnab) {
      txnClass = "clear";
      badgeClass = "badge-clear";
      badgeText = "TO CLEAR";
      matchInfo = `<div class="transaction-match">Matched: ${
        toUpdateYnab.payee_name || "Unknown"
      } (${toUpdateYnab.date})</div>`;
    } else if (matchedYnab) {
      txnClass = "duplicate";
      badgeClass = "badge-cleared";
      badgeText = "CLEARED";
      matchInfo = `<div class="transaction-match">Matched: ${
        matchedYnab.payee_name || "Unknown"
      }</div>`;
    }

    // Skip rendering CLEARED transactions if hideCleared is checked
    if (matchedYnab && hideClearedCheckbox && hideClearedCheckbox.checked) {
      return; // Skip this transaction
    }

    html += `
      <div class="transaction ${txnClass}">
        <div class="transaction-header">
          <span class="transaction-date">${txn.date || "N/A"}</span>
          <span>
            <span class="transaction-amount ${amountClass}">${
      txn.amount || "N/A"
    }</span>
            <span class="transaction-badge ${badgeClass}">${badgeText}</span>
          </span>
        </div>
        <div class="transaction-description">${txn.description || "N/A"}</div>
        ${matchInfo}
        ${
          txn.status
            ? `<div class="transaction-status">Status: ${txn.status}</div>`
            : ""
        }
        ${
          txn.cashBalance
            ? `<div class="transaction-balance">Core Position Balance: $${txn.cashBalance}</div>`
            : ""
        }
      </div>
    `;
  });

  resultsDiv.innerHTML = html;

  // Re-attach import button event listener if it exists
  const importBtn = document.getElementById("ynabImportBtn");
  if (importBtn) {
    importBtn.addEventListener("click", importToYNAB);
  }
}
