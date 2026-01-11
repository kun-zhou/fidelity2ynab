/**
 * YNAB API Integration
 * Provides methods for interacting with the YNAB REST API
 * API Documentation: https://api.ynab.com/v1
 */

const YNAB_API_BASE = "https://api.ynab.com/v1";

/**
 * YNAB API wrapper class
 * Handles authentication and HTTP requests to the YNAB API
 */
class YNABApi {
  /**
   * @param {string} accessToken - YNAB Personal Access Token
   */
  constructor(accessToken) {
    this.accessToken = accessToken;
  }

  /**
   * Makes an authenticated request to the YNAB API
   * @param {string} endpoint - API endpoint (e.g., '/budgets')
   * @param {string} method - HTTP method (GET, POST, PUT, DELETE)
   * @param {Object} body - Request body for POST/PUT requests
   * @returns {Promise<Object>} API response data
   * @throws {Error} If request fails or returns non-2xx status
   */
  async makeRequest(endpoint, method = "GET", body = null) {
    if (!this.accessToken) {
      throw new Error("YNAB access token is missing");
    }

    const options = {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    let response;
    try {
      response = await fetch(`${YNAB_API_BASE}${endpoint}`, options);
    } catch (error) {
      throw new Error(`Network error: ${error.message}`);
    }

    if (!response.ok) {
      let errorDetail;
      try {
        const errorData = await response.json();
        errorDetail =
          errorData.error?.detail ||
          errorData.error?.message ||
          response.statusText;
      } catch {
        errorDetail = response.statusText || `HTTP ${response.status}`;
      }
      throw new Error(`YNAB API error (${response.status}): ${errorDetail}`);
    }

    try {
      return await response.json();
    } catch (error) {
      throw new Error(`Failed to parse YNAB API response: ${error.message}`);
    }
  }

  // Get user information
  async getUser() {
    const data = await this.makeRequest("/user");
    return data.data.user;
  }

  // Get all budgets
  async getBudgets() {
    const data = await this.makeRequest("/budgets");
    return data.data.budgets;
  }

  // Get accounts for a budget
  async getAccounts(budgetId) {
    const data = await this.makeRequest(`/budgets/${budgetId}/accounts`);
    return data.data.accounts;
  }

  // Get transactions for an account since a specific date
  async getTransactionsSinceDate(budgetId, accountId, sinceDate) {
    // Format: YYYY-MM-DD
    const endpoint = `/budgets/${budgetId}/accounts/${accountId}/transactions?since_date=${sinceDate}`;
    const data = await this.makeRequest(endpoint);
    return data.data.transactions;
  }

  // Update a transaction (e.g., to mark as cleared)
  async updateTransaction(budgetId, transactionId, updates) {
    const endpoint = `/budgets/${budgetId}/transactions/${transactionId}`;
    const body = {
      transaction: updates,
    };
    const data = await this.makeRequest(endpoint, "PUT", body);
    return data.data.transaction;
  }

  // Create transactions (bulk)
  async createTransactions(budgetId, transactions) {
    const endpoint = `/budgets/${budgetId}/transactions`;
    const body = {
      transactions: transactions,
    };
    const data = await this.makeRequest(endpoint, "POST", body);
    return data.data;
  }

  // Create a single transaction
  async createTransaction(budgetId, transaction) {
    const result = await this.createTransactions(budgetId, [transaction]);
    return result.transactions[0];
  }
}

/**
 * Transaction deduplication and matching logic
 * Handles matching Fidelity transactions with YNAB transactions
 * and determining which transactions need to be created or updated
 */
class TransactionDeduplicator {
  /**
   * @param {number} dateTolerance - Days +/- to allow when matching dates (default: 5)
   *                                 Used for uncleared transactions to handle payment timing differences
   */
  constructor(dateTolerance = 5) {
    this.dateTolerance = dateTolerance;
  }

  /**
   * Finds the earliest Fidelity transaction date
   * @param {Array} fidelityTransactions - Array of Fidelity transactions
   * @returns {string|null} Earliest date string in YYYY-MM-DD format, or null if no valid transactions
   */
  getEarliestFidelityDate(fidelityTransactions) {
    if (fidelityTransactions.length === 0) {
      return null;
    }

    const dates = [];
    for (const txn of fidelityTransactions) {
      try {
        dates.push(this.parseFidelityDate(txn.date));
      } catch (error) {
        console.error("Failed to parse date:", error.message);
      }
    }

    if (dates.length === 0) {
      return null;
    }

    const sorted = dates.sort((a, b) => a.localeCompare(b));
    return sorted[0];
  }

  /**
   * Formats a JavaScript Date object as YYYY-MM-DD
   * @param {Date} date - Date object to format
   * @returns {string} Formatted date string
   */
  formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  /**
   * Parses Fidelity date format (e.g., "Jan-12-2026") to YYYY-MM-DD
   * @param {string} dateStr - Fidelity date string (format: MMM-DD-YYYY)
   * @returns {string} ISO date string (YYYY-MM-DD)
   * @throws {Error} If date parsing fails
   */
  parseFidelityDate(dateStr) {
    if (!dateStr || typeof dateStr !== "string") {
      throw new Error(`Invalid date input: ${dateStr}`);
    }

    const parts = dateStr.split("-");
    if (parts.length !== 3) {
      throw new Error(`Invalid date format: ${dateStr} (expected MMM-DD-YYYY)`);
    }

    const [monthAbbr, day, year] = parts;
    const monthMap = {
      Jan: "01",
      Feb: "02",
      Mar: "03",
      Apr: "04",
      May: "05",
      Jun: "06",
      Jul: "07",
      Aug: "08",
      Sep: "09",
      Oct: "10",
      Nov: "11",
      Dec: "12",
    };

    const month = monthMap[monthAbbr];
    if (!month || isNaN(year) || isNaN(day)) {
      throw new Error(
        `Invalid date components in "${dateStr}" (month: ${monthAbbr}, day: ${day}, year: ${year})`
      );
    }

    return `${year}-${month}-${day.padStart(2, "0")}`;
  }

  /**
   * Formats a payee name by removing prefixes/postfixes and applying title case
   * @param {string} description - Raw description from Fidelity
   * @returns {string} Formatted payee name
   */
  formatPayeeName(description) {
    if (!description) return "";

    // Remove DIRECT DEBIT or DIRECT DEPOSIT prefix
    let formatted = description
      .replace(/^DIRECT DEBIT\s*/i, "")
      .replace(/^DIRECT DEPOSIT\s*/i, "");

    // Remove (cash) postfix
    formatted = formatted.replace(/\s*\(CASH\)\s*$/i, "");

    // Convert to title case (capitalize first letter of each word)
    formatted = formatted
      .toLowerCase()
      .split(" ")
      .map((word) => {
        if (word.length === 0) return word;
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(" ");

    return formatted;
  }

  /**
   * Converts a Fidelity transaction to YNAB format
   * @param {Object} fidelityTxn - Fidelity transaction object
   * @param {string} accountId - YNAB account ID
   * @returns {Object} YNAB-formatted transaction
   * @throws {Error} If transaction is missing required fields or has invalid data
   */
  fidelityToYNAB(fidelityTxn, accountId) {
    // Validate required fields
    if (!fidelityTxn.date) {
      throw new Error("Transaction missing date field");
    }
    if (!fidelityTxn.description) {
      throw new Error("Transaction missing description field");
    }
    if (
      fidelityTxn.amountValue === undefined ||
      fidelityTxn.amountValue === null
    ) {
      throw new Error("Transaction missing amountValue field");
    }

    const date = this.parseFidelityDate(fidelityTxn.date);

    // YNAB uses milliunits (amount * 1000)
    const amount = Math.round(fidelityTxn.amountValue * 1000);

    // Validate cleared status - must be explicit
    let clearedStatus;
    if (fidelityTxn.status === "Processing") {
      clearedStatus = "uncleared";
    } else if (
      fidelityTxn.status === undefined ||
      fidelityTxn.status === null ||
      fidelityTxn.status === ""
    ) {
      clearedStatus = "cleared";
    } else {
      throw new Error(`Unknown transaction status: "${fidelityTxn.status}"`);
    }

    return {
      account_id: accountId,
      date: date,
      amount: amount,
      payee_name: this.formatPayeeName(fidelityTxn.description),
      memo: fidelityTxn.status || null,
      cleared: clearedStatus,
      approved: false,
    };
  }

  /**
   * Checks if two dates are within the tolerance window
   * @param {string} date1Str - First date (YYYY-MM-DD)
   * @param {string} date2Str - Second date (YYYY-MM-DD)
   * @returns {boolean} True if dates are within tolerance
   */
  datesWithinTolerance(date1Str, date2Str) {
    const date1 = new Date(date1Str);
    const date2 = new Date(date2Str);

    // Validate dates
    if (isNaN(date1.getTime()) || isNaN(date2.getTime())) {
      console.error("Invalid date in comparison:", date1Str, date2Str);
      return false;
    }

    const diffMs = Math.abs(date1 - date2);
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    return diffDays <= this.dateTolerance;
  }

  /**
   * Checks if a Fidelity transaction matches a YNAB transaction
   * Matches by amount (exact) and date (with tolerance for uncleared or transfers)
   * @param {Object} fidelityTxn - Fidelity transaction
   * @param {Object} ynabTxn - YNAB transaction
   * @returns {boolean} True if transactions match
   */
  isMatch(fidelityTxn, ynabTxn) {
    // Compare amount (must be exact)
    const fidelityAmount = Math.round((fidelityTxn.amountValue || 0) * 1000);
    if (fidelityAmount !== ynabTxn.amount) return false;

    // Compare date
    let fidelityDate;
    try {
      fidelityDate = this.parseFidelityDate(fidelityTxn.date);
    } catch (error) {
      console.error("Failed to parse Fidelity date:", error.message);
      return false;
    }

    // Check if transaction is a transfer (has transfer_account_id set)
    const isTransfer =
      ynabTxn.transfer_account_id !== null &&
      ynabTxn.transfer_account_id !== undefined;

    // Apply tolerance for uncleared transactions or transfers
    // Exact date match for cleared non-transfer transactions
    const shouldApplyTolerance = ynabTxn.cleared !== "cleared" || isTransfer;

    return shouldApplyTolerance
      ? this.datesWithinTolerance(fidelityDate, ynabTxn.date)
      : fidelityDate === ynabTxn.date;
  }

  /**
   * Analyzes Fidelity and YNAB transactions to determine what needs to be imported or updated
   * Uses the earliest Fidelity transaction date as the anchor point
   * @param {Array} fidelityTransactions - Fidelity transactions to process
   * @param {Array} ynabTransactions - Existing YNAB transactions
   * @returns {Promise<Object>} Object containing toImport, toUpdate, matched, unmatchedYnab, and failedTransactions arrays
   */
  async findTransactionsToImport(fidelityTransactions, ynabTransactions) {
    // Validate inputs
    if (!Array.isArray(fidelityTransactions)) {
      throw new Error("fidelityTransactions must be an array");
    }
    if (!Array.isArray(ynabTransactions)) {
      throw new Error("ynabTransactions must be an array");
    }

    // Step 1: Find earliest Fidelity transaction date
    const earliestFidelityDate =
      this.getEarliestFidelityDate(fidelityTransactions);

    if (!earliestFidelityDate) {
      console.log("No valid Fidelity transactions to process");
      return {
        toImport: [],
        toUpdate: [],
        matched: [],
        unmatchedYnab: [],
        failedTransactions: fidelityTransactions,
      };
    }

    console.log("Earliest Fidelity transaction date:", earliestFidelityDate);

    // Step 2: Validate all Fidelity transactions
    const validFidelityTxns = [];
    const failedTransactions = [];

    for (const txn of fidelityTransactions) {
      try {
        const txnDate = this.parseFidelityDate(txn.date);
        validFidelityTxns.push(txn);
      } catch (error) {
        console.error("Failed to parse date:", error.message, txn);
        failedTransactions.push(txn);
      }
    }

    console.log(
      `Processing ${validFidelityTxns.length} of ${fidelityTransactions.length} Fidelity transactions`
    );

    // Step 3: Match all Fidelity transactions against YNAB
    const toImport = []; // New transactions to create
    const toUpdate = []; // Existing uncleared YNAB transactions to update
    const matched = []; // Already processed (cleared or matched)
    const pending = []; // Matched but still processing in Fidelity
    const usedYnabIds = new Set(); // Track which YNAB transactions we've matched

    for (const fidelityTxn of validFidelityTxns) {
      // Find matching YNAB transactions (date + amount)
      const matchingYnabTxns = ynabTransactions.filter((ynabTxn) => {
        if (usedYnabIds.has(ynabTxn.id)) return false;
        return this.isMatch(fidelityTxn, ynabTxn);
      });

      if (matchingYnabTxns.length > 0) {
        // Match found! Use the first one
        const ynabTxn = matchingYnabTxns[0];
        usedYnabIds.add(ynabTxn.id);

        // Check if transaction is still processing in Fidelity
        const isProcessing =
          fidelityTxn.status &&
          (fidelityTxn.status.toLowerCase().includes("processing") ||
            fidelityTxn.status.toLowerCase().includes("pending"));

        if (ynabTxn.cleared === "cleared") {
          matched.push({
            fidelity: fidelityTxn,
            ynab: ynabTxn,
            action: "already_cleared",
          });
        } else if (isProcessing) {
          // Transaction is still processing - don't clear yet
          pending.push({
            fidelity: fidelityTxn,
            ynab: ynabTxn,
            action: "pending",
          });
        } else {
          toUpdate.push({
            fidelity: fidelityTxn,
            ynab: ynabTxn,
            action: "update_clear",
          });
        }
      } else {
        toImport.push(fidelityTxn);
      }
    }

    // Step 4: For each new Fidelity transaction, find unmatched YNAB transactions with same amount (suggestions)
    const toImportWithSuggestions = toImport.map((fidelityTxn) => {
      const fidelityAmount = Math.round((fidelityTxn.amountValue || 0) * 1000);
      const suggestions = ynabTransactions.filter((ynabTxn) => {
        return (
          !usedYnabIds.has(ynabTxn.id) && ynabTxn.amount === fidelityAmount
        );
      });

      return {
        fidelity: fidelityTxn,
        suggestions: suggestions,
      };
    });

    // Step 5: Find unmatched YNAB transactions after (earliest Fidelity date + tolerance)
    // Calculate warning cutoff date: earliest Fidelity date + tolerance
    const warningCutoffDate = new Date(earliestFidelityDate);
    warningCutoffDate.setDate(warningCutoffDate.getDate() + this.dateTolerance);
    const warningCutoffStr = this.formatDate(warningCutoffDate);

    const unmatchedYnabTxns = ynabTransactions.filter((ynabTxn) => {
      return !usedYnabIds.has(ynabTxn.id) && ynabTxn.date >= warningCutoffStr;
    });

    console.log(
      `Analysis: ${toImportWithSuggestions.length} to import, ${toUpdate.length} to update, ${pending.length} pending, ${matched.length} already matched, ${unmatchedYnabTxns.length} unmatched YNAB after ${warningCutoffStr}, ${failedTransactions.length} failed to parse`
    );

    return {
      toImport: toImportWithSuggestions, // Fidelity transactions with suggestions to create in YNAB
      toUpdate, // { fidelity, ynab } pairs to update
      pending, // { fidelity, ynab } pairs still processing
      matched, // { fidelity, ynab } pairs already cleared
      unmatchedYnab: unmatchedYnabTxns, // Unmatched YNAB uncleared transactions (warning)
      failedTransactions, // Transactions with unparseable dates (error)
    };
  }
}

// Export for use in other scripts
if (typeof module !== "undefined" && module.exports) {
  module.exports = { YNABApi, TransactionDeduplicator };
}
