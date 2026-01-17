/**
 * Fidelity2YNAB - Content Script
 * Thin wrapper that handles Chrome message passing
 * Delegates to bank-specific scraper (Fidelity)
 */

/**
 * Message listener for communication with popup
 * Handles two actions:
 * - 'validatePage': Validates current page is Activity & Orders
 * - 'scrapeTransactions': Validates page and scrapes transactions
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'validatePage') {
    // validateFidelityActivityPage is defined in lib/banks/fidelity/scraper.js
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
    // scrapeTransactions is defined in lib/banks/fidelity/scraper.js
    const transactions = scrapeTransactions(skipCoreFunds);
    sendResponse({ transactions, valid: true });
  }

  return true;
});
