/**
 * Fidelity Transaction Scraper - Content Script
 * Scrapes transaction data from Fidelity Activity & Orders pages
 */

/**
 * Validates that the current page is a valid Fidelity Activity & Orders page
 * @returns {{valid: boolean, error?: string}} Validation result
 */
function validateFidelityActivityPage() {
  const activityTab = document.querySelector('a.new-tab__tab[href*="activity"]');
  if (!activityTab) {
    return {
      valid: false,
      error: 'Activity & Orders tab not found. Please navigate to the Activity & Orders page.'
    };
  }

  const tabText = activityTab.querySelector('.new-tab__text-wrapper.tab-label');
  if (!tabText || !tabText.textContent.includes('Activity')) {
    return {
      valid: false,
      error: 'Not on Activity & Orders page. Please navigate to Activity & Orders.'
    };
  }

  const transactionContainer = document.querySelector('activity-list, account-activity-container');
  if (!transactionContainer) {
    return {
      valid: false,
      error: 'Transaction data not found. Make sure the page is fully loaded.'
    };
  }

  return { valid: true };
}

/**
 * Checks if a transaction is a core fund buy/redemption
 * Core fund transactions end with "(Cash)" and start with specific prefixes
 * @param {string} description - Transaction description
 * @returns {boolean} True if transaction is a core fund operation
 */
function isCoreFundTransaction(description) {
  if (!description) return false;
  const trimmed = description.trim();
  return trimmed.endsWith('(Cash)') &&
         (trimmed.startsWith('REDEMPTION FROM') || trimmed.startsWith('YOU BOUGHT'));
}

/**
 * Parses amount string and extracts numeric value and type
 * @param {string} amountText - Raw amount text (e.g., "+$1,234.56" or "-$500.00")
 * @param {string} color - CSS color of the amount cell
 * @returns {{amount: string, amountValue: number, type: string}} Parsed amount data
 * @throws {Error} If amount format is invalid or transaction type cannot be determined
 */
function parseAmount(amountText, color) {
  const result = { amount: amountText };

  // Parse numeric amount
  const amountMatch = amountText.match(/([+-]?)[$]?([\d,]+\.\d{2})/);
  if (!amountMatch) {
    throw new Error(`Unable to parse amount: "${amountText}"`);
  }

  const sign = amountText.includes('-') ? -1 : 1;
  result.amountValue = sign * parseFloat(amountMatch[2].replace(/,/g, ''));

  // Determine transaction type from color - must be explicit
  if (color.includes('54, 135, 39') || color.includes('green')) {
    result.type = 'credit';
  } else if (color.includes('0, 0, 0') || color.includes('black')) {
    result.type = 'debit';
  } else {
    throw new Error(`Unable to determine transaction type from color: "${color}"`);
  }

  return result;
}

/**
 * Scrapes all transactions from the current Fidelity Activity & Orders page
 * @param {boolean} skipCoreFunds - Whether to filter out core fund buy/redemption transactions
 * @returns {Array<Object>} Array of transaction objects with date, description, amount, etc.
 */
function scrapeTransactions(skipCoreFunds = true) {
  const transactions = [];
  const rowGroups = document.querySelectorAll('div[role="rowgroup"].gridRow');

  rowGroups.forEach((rowGroup) => {
    const row = rowGroup.querySelector('div[role="row"]');
    if (!row) return;

    const transaction = {};

    // Extract date
    const dateCell = row.querySelector('.activity-item-context');
    if (dateCell) transaction.date = dateCell.textContent.trim();

    // Extract description
    const descriptionCell = row.querySelector('.activity-item-break-wording .pvd-grid__item');
    if (descriptionCell) transaction.description = descriptionCell.textContent.trim();

    // Extract and parse amount
    const amountCell = row.querySelector('.ao-status.grid-item__status');
    if (amountCell) {
      try {
        Object.assign(transaction, parseAmount(amountCell.textContent.trim(), amountCell.style.color));
      } catch (error) {
        console.error('Failed to parse amount for transaction:', error.message);
        return; // Skip this transaction
      }
    }

    // Extract status and cash balance
    row.querySelectorAll('.pvd-grid__item').forEach((cell) => {
      const text = cell.textContent.trim();
      if (text === 'Processing') {
        transaction.status = 'Processing';
      } else if (text.match(/^[$]?[\d,]+\.\d{2}$/) && cell.classList.contains('grid-item__status')) {
        const balanceMatch = text.match(/[$]?([\d,]+\.\d{2})/);
        if (balanceMatch) transaction.cashBalance = balanceMatch[1];
      }
    });

    // Add valid transactions (skip core funds if requested)
    if (transaction.date && transaction.description) {
      if (!skipCoreFunds || !isCoreFundTransaction(transaction.description)) {
        transactions.push(transaction);
      }
    }
  });

  return transactions;
}

/**
 * Message listener for communication with popup
 * Handles two actions:
 * - 'validatePage': Validates current page is Activity & Orders
 * - 'scrapeTransactions': Validates page and scrapes transactions
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'validatePage') {
    sendResponse(validateFidelityActivityPage());
    return true;
  }

  if (request.action === 'scrapeTransactions') {
    const validation = validateFidelityActivityPage();
    if (!validation.valid) {
      sendResponse({ error: validation.error, transactions: [] });
      return true;
    }

    const skipCoreFunds = request.skipCoreFunds !== false; // Default to true
    const transactions = scrapeTransactions(skipCoreFunds);
    sendResponse({ transactions, valid: true });
  }

  return true;
});
