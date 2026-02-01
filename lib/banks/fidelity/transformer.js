/**
 * Fidelity Bank Adapter & Transformer
 */

const MONTH_MAP = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

const FidelityAdapter = {
  bankName: 'Fidelity',

  matchesUrl(url) {
    return url.includes('fidelity.com');
  },

  parseDate(dateStr) {
    if (!dateStr) throw new Error(`Invalid date: ${dateStr}`);
    const [monthAbbr, day, year] = dateStr.split('-');
    const month = MONTH_MAP[monthAbbr];
    if (!month) throw new Error(`Invalid date: ${dateStr}`);
    return `${year}-${month}-${day.padStart(2, '0')}`;
  },

  formatPayeeName(description) {
    if (!description) return '';
    return description
      .replace(/^DIRECT (DEBIT|DEPOSIT)\s*/i, '')
      .replace(/\s*\(CASH\)\s*$/i, '')
      .toLowerCase()
      .replace(/\b\w/g, c => c.toUpperCase());
  },

  getAmountInMilliunits(txn) {
    return Math.round((txn.amountValue || 0) * 1000);
  },

  isProcessing(txn) {
    return txn.status?.toLowerCase().includes('processing');
  },

  toYNABTransaction(txn, accountId) {
    return {
      account_id: accountId,
      date: this.parseDate(txn.date),
      amount: this.getAmountInMilliunits(txn),
      payee_name: this.formatPayeeName(txn.description),
      memo: txn.status || null,
      cleared: 'cleared',
      approved: false,
    };
  },

  toScheduledTransaction(txn, accountId) {
    return {
      account_id: accountId,
      date_first: this.parseDate(txn.date),
      frequency: 'never', // One-time scheduled transaction
      amount: this.getAmountInMilliunits(txn),
      payee_name: this.formatPayeeName(txn.description),
      memo: `Processing: ${txn.description}`,
    };
  }
};
