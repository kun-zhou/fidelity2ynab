/**
 * Transaction Service
 *
 * Handles all transaction business logic:
 * - Watermark filtering
 * - YNAB matching/deduplication
 * - State computation
 * - Import preparation
 *
 * UI layer should only call this service and render results.
 */

class TransactionService {
  constructor(bankAdapter) {
    this.bankAdapter = bankAdapter;
  }

  /**
   * Analyze scraped transactions against YNAB data.
   * Returns a unified list with all state computed.
   *
   * @param {Array} scrapedTxns - Raw transactions from bank scraper
   * @param {Array} ynabTxns - Transactions from YNAB API
   * @param {Array} scheduledTxns - Scheduled transactions from YNAB API
   * @returns {Object} { transactions, unmatchedYnab, watermarkIndex }
   */
  analyze(scrapedTxns, ynabTxns, scheduledTxns = []) {
    if (!scrapedTxns?.length) {
      return { transactions: [], unmatchedYnab: [], watermarkIndex: -1 };
    }

    // Find watermark (Fidelity shows newest first, so lowest index = most recent)
    const watermarkInfo = Watermark.findWatermarkIndex(ynabTxns, scrapedTxns);
    const watermarkIndex = watermarkInfo ? watermarkInfo.fidelityIndex : -1;

    // Build unified transaction list with initial state
    const transactions = scrapedTxns.map((fidelity, index) => ({
      fidelity,
      index,
      state: 'new',
      ynab: null,
      scheduledYnab: null,
      isProcessing: this.bankAdapter.isProcessing(fidelity)
    }));

    // Mark transactions at/after watermark as already imported
    if (watermarkIndex >= 0) {
      for (let i = watermarkIndex; i < transactions.length; i++) {
        transactions[i].state = 'before-watermark';
      }
    }

    // Run deduplication only on active transactions (before watermark)
    const activeTxns = transactions.filter(t => t.state !== 'before-watermark');
    if (activeTxns.length === 0 || !ynabTxns?.length) {
      return { transactions, unmatchedYnab: [], watermarkIndex };
    }

    const deduplicator = new TransactionDeduplicator(this.bankAdapter);
    const result = deduplicator.findTransactionsToImport(
      activeTxns.map(t => t.fidelity),
      ynabTxns
    );

    // Build lookup maps for matching results
    const toKey = (txn) => `${txn.date}|${txn.description}|${txn.amountValue}`;
    const updateMap = new Map(result.toUpdate.map(r => [toKey(r.bank), r.ynab]));
    const pendingMap = new Map((result.pending || []).map(r => [toKey(r.bank), r.ynab]));
    const matchedMap = new Map(result.matched.map(r => [toKey(r.bank), r.ynab]));

    // Build scheduled transaction lookup (by amount, since dates may differ)
    const scheduledByAmount = new Map();
    for (const sched of scheduledTxns) {
      const amount = sched.amount;
      if (!scheduledByAmount.has(amount)) scheduledByAmount.set(amount, []);
      scheduledByAmount.get(amount).push(sched);
    }
    const usedScheduledIds = new Set();

    // Apply deduplication results to unified list
    for (const txn of transactions) {
      if (txn.state === 'before-watermark') continue;

      const key = toKey(txn.fidelity);
      if (matchedMap.has(key)) {
        txn.state = 'cleared';
        txn.ynab = matchedMap.get(key);
      } else if (updateMap.has(key)) {
        txn.state = 'matched';
        txn.ynab = updateMap.get(key);
      } else if (pendingMap.has(key)) {
        txn.state = 'pending';
        txn.ynab = pendingMap.get(key);
      } else if (txn.isProcessing) {
        // Check if processing transaction matches a scheduled transaction
        const bankAmount = this.bankAdapter.getAmountInMilliunits(txn.fidelity);
        const candidates = scheduledByAmount.get(bankAmount) || [];
        const match = candidates.find(s => !usedScheduledIds.has(s.id));
        if (match) {
          usedScheduledIds.add(match.id);
          txn.state = 'scheduled';
          txn.scheduledYnab = match;
        }
      }
      // else stays 'new'
    }

    return {
      transactions,
      unmatchedYnab: result.unmatchedYnab || [],
      watermarkIndex
    };
  }

  /**
   * Prepare transactions for import to YNAB.
   * Filters by state and skip list, sorts chronologically.
   *
   * @param {Array} transactions - Unified transaction list from analyze()
   * @param {Set} skippedIndices - Indices user chose to skip
   * @returns {Object} { toCreate, toMatch, toSchedule }
   */
  prepareImport(transactions, skippedIndices = new Set()) {
    const toCreate = [];
    const toMatch = [];
    const toSchedule = [];

    for (const txn of transactions) {
      // Skip before-watermark, cleared, scheduled (already in YNAB), and user-skipped
      if (txn.state === 'before-watermark') continue;
      if (txn.state === 'cleared') continue;
      if (txn.state === 'scheduled') continue; // Already exists as scheduled in YNAB
      if (skippedIndices.has(txn.index)) continue;

      if (txn.state === 'new') {
        if (txn.isProcessing) {
          toSchedule.push(txn.fidelity);
        } else {
          toCreate.push(txn.fidelity);
        }
      } else if (txn.state === 'matched' || txn.state === 'pending') {
        if (txn.ynab && txn.ynab.cleared !== 'cleared') {
          toMatch.push({ bank: txn.fidelity, ynab: txn.ynab });
        }
      }
    }

    // Sort chronologically (oldest first) for clean partial failures
    const getDate = (txn) => this.bankAdapter.parseDate(txn.date);
    toCreate.sort((a, b) => getDate(a).localeCompare(getDate(b)));
    toMatch.sort((a, b) => getDate(a.bank).localeCompare(getDate(b.bank)));
    toSchedule.sort((a, b) => getDate(a).localeCompare(getDate(b)));

    return { toCreate, toMatch, toSchedule };
  }

  /**
   * Compute summary statistics for display.
   *
   * @param {Array} transactions - Unified transaction list
   * @param {Set} skippedIndices - Indices user chose to skip
   * @returns {Object} { toCreate, toMatch, toSkip, beforeWatermark, cleared }
   */
  getStats(transactions, skippedIndices = new Set()) {
    const active = transactions.filter(t => t.state !== 'before-watermark');

    return {
      toCreate: active.filter(t => t.state === 'new' && !skippedIndices.has(t.index)).length,
      toMatch: active.filter(t => (t.state === 'matched' || t.state === 'pending') && !skippedIndices.has(t.index)).length,
      toSkip: skippedIndices.size,
      beforeWatermark: transactions.filter(t => t.state === 'before-watermark').length,
      cleared: active.filter(t => t.state === 'cleared').length,
      scheduled: active.filter(t => t.state === 'scheduled').length
    };
  }

  /**
   * Get the watermark transaction (most recent previously imported).
   *
   * @param {Array} transactions - Unified transaction list
   * @returns {Object|null} The watermark fidelity transaction or null
   */
  getWatermarkTransaction(transactions) {
    const beforeWatermark = transactions.filter(t => t.state === 'before-watermark');
    return beforeWatermark[0]?.fidelity || null;
  }

  /**
   * Check if there's anything to import.
   *
   * @param {Array} transactions - Unified transaction list
   * @param {Set} skippedIndices - Indices user chose to skip
   * @returns {boolean}
   */
  hasImportableTransactions(transactions, skippedIndices = new Set()) {
    const { toCreate, toMatch, toSchedule } = this.prepareImport(transactions, skippedIndices);
    return toCreate.length > 0 || toMatch.length > 0 || toSchedule.length > 0;
  }
}

if (typeof window !== 'undefined') window.TransactionService = TransactionService;
