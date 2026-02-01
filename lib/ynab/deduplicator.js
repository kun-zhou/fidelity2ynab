/**
 * Transaction matching logic for YNAB imports
 */

class TransactionDeduplicator {
  constructor(bankAdapter, dateTolerance = 5) {
    this.bankAdapter = bankAdapter;
    this.dateTolerance = dateTolerance;
  }

  formatDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  getEarliestBankDate(bankTransactions) {
    const dates = bankTransactions
      .map(txn => { try { return this.bankAdapter.parseDate(txn.date); } catch { return null; } })
      .filter(Boolean)
      .sort();
    return dates[0] || null;
  }

  isMatch(bankTxn, ynabTxn) {
    if (this.bankAdapter.getAmountInMilliunits(bankTxn) !== ynabTxn.amount) return false;

    let bankDate;
    try { bankDate = this.bankAdapter.parseDate(bankTxn.date); } catch { return false; }

    const isTransfer = ynabTxn.transfer_account_id != null;
    const useTolerance = ynabTxn.cleared !== 'cleared' || isTransfer;

    if (!useTolerance) return bankDate === ynabTxn.date;

    const diffDays = Math.abs(new Date(bankDate) - new Date(ynabTxn.date)) / (1000 * 60 * 60 * 24);
    return diffDays <= this.dateTolerance;
  }

  /**
   * Filter transactions by watermark
   * Splits into before (already imported) and after (to process) groups
   */
  filterByWatermark(fidelityTxns, ynabTxns) {
    const watermark = Watermark.findWatermarkIndex(ynabTxns, fidelityTxns);
    if (!watermark) {
      return { before: [], after: fidelityTxns, watermarkInfo: null };
    }

    return {
      before: fidelityTxns.slice(0, watermark.fidelityIndex + 1),
      after: fidelityTxns.slice(watermark.fidelityIndex + 1),
      watermarkInfo: watermark
    };
  }

  findTransactionsToImport(bankTransactions, ynabTransactions) {
    const earliestBankDate = this.getEarliestBankDate(bankTransactions);
    if (!earliestBankDate) {
      return { toImport: [], toUpdate: [], pending: [], matched: [], unmatchedYnab: [], failedTransactions: bankTransactions };
    }

    const validTxns = [], failedTransactions = [];
    for (const txn of bankTransactions) {
      try { this.bankAdapter.parseDate(txn.date); validTxns.push(txn); }
      catch { failedTransactions.push(txn); }
    }

    const toImport = [], toUpdate = [], matched = [], pending = [];
    const usedYnabIds = new Set();

    for (const bankTxn of validTxns) {
      const match = ynabTransactions.find(y => !usedYnabIds.has(y.id) && this.isMatch(bankTxn, y));

      if (match) {
        usedYnabIds.add(match.id);
        if (match.cleared === 'cleared') {
          matched.push({ bank: bankTxn, ynab: match });
        } else if (this.bankAdapter.isProcessing(bankTxn)) {
          pending.push({ bank: bankTxn, ynab: match });
        } else {
          toUpdate.push({ bank: bankTxn, ynab: match });
        }
      } else {
        toImport.push(bankTxn);
      }
    }

    // Add suggestions for new transactions
    const toImportWithSuggestions = toImport.map(bankTxn => {
      const bankAmount = this.bankAdapter.getAmountInMilliunits(bankTxn);
      const suggestions = ynabTransactions.filter(y => !usedYnabIds.has(y.id) && y.amount === bankAmount);
      return { bank: bankTxn, suggestions };
    });

    // Find unmatched YNAB transactions
    const cutoffDate = new Date(earliestBankDate);
    cutoffDate.setDate(cutoffDate.getDate() + this.dateTolerance);
    const cutoffStr = this.formatDate(cutoffDate);
    const unmatchedYnab = ynabTransactions.filter(y => !usedYnabIds.has(y.id) && y.date >= cutoffStr);

    return { toImport: toImportWithSuggestions, toUpdate, pending, matched, unmatchedYnab, failedTransactions };
  }
}
