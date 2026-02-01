/**
 * Watermark system for tracking imported transactions
 * Uses YNAB memo field to store a hash of the Fidelity transaction
 */

const Watermark = {
  PREFIX: '[F2Y:',

  /**
   * Generate a hash from a Fidelity transaction
   * Uses date, description, and amount to create a unique identifier
   */
  generateHash(txn) {
    const data = `${txn.date}|${txn.description}|${txn.amountValue}`;
    return btoa(data).slice(0, 12);
  },

  /**
   * Create a memo string with watermark appended
   * Preserves existing memo content (without old watermarks)
   */
  createMemo(txn, existingMemo = '') {
    const hash = this.generateHash(txn);
    const clean = existingMemo?.replace(/\[F2Y:[^\]]+\]\s*/g, '') || '';
    return `${this.PREFIX}${hash}] ${clean}`.trim();
  },

  /**
   * Extract the hash from a memo string
   * Returns null if no watermark found
   */
  extractHash(memo) {
    const match = memo?.match(/\[F2Y:([^\]]+)\]/);
    return match ? match[1] : null;
  },

  /**
   * Find watermark match in YNAB transactions
   * Returns the matching YNAB transaction and Fidelity index, or null
   */
  findWatermarkIndex(ynabTxns, fidelityTxns) {
    for (const ynab of ynabTxns) {
      const hash = this.extractHash(ynab.memo);
      if (!hash) continue;
      const idx = fidelityTxns.findIndex(f => this.generateHash(f) === hash);
      if (idx !== -1) return { ynabTxn: ynab, fidelityIndex: idx };
    }
    return null;
  }
};

if (typeof window !== 'undefined') window.Watermark = Watermark;
