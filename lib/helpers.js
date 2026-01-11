/**
 * Helper functions for HTML generation using Tailwind CSS
 */

// HTML Template Helpers using Tailwind
const html = {
  transaction(txn, amountClass, badgeType, badgeText, matchInfo = '', dropdownId = '', suggestions = []) {
    const opacity = badgeType === 'badge-cleared' ? 'opacity-60' : '';
    const badgeBg = badgeType === 'badge-new' ? 'bg-green-600' :
                    badgeType === 'badge-clear' ? 'bg-blue-600' :
                    badgeType === 'badge-pending' ? 'bg-orange-600' : 'bg-gray-600';

    // Tooltip text for each badge type
    const badgeTooltip = badgeType === 'badge-new' ? 'Transaction will be created in YNAB' :
                         badgeType === 'badge-clear' ? 'Transaction will be marked as cleared' :
                         badgeType === 'badge-pending' ? 'Transaction is still processing in Fidelity' :
                         badgeType === 'badge-cleared' ? 'Transaction is already cleared in YNAB' : '';

    const hasMatches = suggestions && suggestions.length > 0;
    const badgeElement = hasMatches
      ? `<button type="button" class="px-2 py-0.5 text-xs text-gray-700 bg-white border border-gray-300 rounded-full mt-1 cursor-pointer hover:bg-gray-50 custom-dropdown-btn flex items-center gap-1 badge-tooltip" data-dropdown-id="${dropdownId}" data-fidelity-index="${matchInfo}" data-tooltip="Select an action for this transaction">${badgeText} <span style="font-size: 0.6rem;">▼</span></button>`
      : `<span class="px-2 py-0.5 text-xs text-white rounded-full ${badgeBg} mt-1 badge-tooltip" data-tooltip="${badgeTooltip}">${badgeText}</span>`;

    return `
      <div class="border-b border-gray-200 py-3 last:border-b-0 ${opacity}">
        <div class="flex justify-between items-start">
          <div class="flex-1">
            <div class="text-sm text-gray-900">${txn.description || 'N/A'}</div>
            ${!hasMatches && matchInfo && typeof matchInfo === 'string' && matchInfo.includes('Matched') ? matchInfo : ''}
            ${txn.status ? `<div class="text-xs text-orange-600 italic mt-1">Status: ${txn.status}</div>` : ''}
          </div>
          <div class="flex flex-col items-end ml-4">
            <span class="text-sm ${amountClass === 'credit' ? 'text-green-600' : 'text-gray-900'}">${txn.amount || 'N/A'}</span>
            <div class="relative">
              ${badgeElement}
              ${hasMatches ? this.badgeDropdown(dropdownId, matchInfo, suggestions) : ''}
            </div>
          </div>
        </div>
      </div>
    `;
  },

  dateGroup(date, transactionsHtml) {
    return `
      <div class="bg-white border border-gray-200 rounded-lg mb-3">
        <div class="px-4 py-2 border-b border-gray-200">
          <span class="text-sm font-medium text-gray-700">${date}</span>
        </div>
        <div class="px-4">
          ${transactionsHtml}
        </div>
      </div>
    `;
  },

  badgeDropdown(dropdownId, fidelityIndex, suggestions) {
    if (!Array.isArray(suggestions)) {
      throw new Error('suggestions must be an array in badgeDropdown');
    }

    return `
      <input type="hidden" class="suggestion-dropdown" data-fidelity-index="${fidelityIndex}" value="" />
      <div id="${dropdownId}" class="hidden fixed bg-white border border-gray-300 rounded shadow-lg z-50 custom-dropdown-menu" style="min-width: 15.625rem; max-width: 21.875rem; max-height: 12.5rem; overflow-y: auto;">
        <div class="dropdown-option px-2 py-1.5 text-xs hover:bg-gray-100 cursor-pointer" data-value="__CREATE_NEW__" data-fidelity-index="${fidelityIndex}">
          Create new transaction
        </div>
        ${suggestions.map(y => {
          if (y.amount == null) {
            throw new Error('Transaction amount is missing in suggestion');
          }
          const amount = (y.amount / 1000).toFixed(2);
          return `<div class="dropdown-option px-2 py-1.5 text-xs hover:bg-gray-100 cursor-pointer border-t border-gray-200" data-value="${y.id}" data-fidelity-index="${fidelityIndex}">
            <div class="font-medium">${y.payee_name || 'Unknown'}</div>
            <div class="text-gray-600">${y.date} • $${amount} • [${y.cleared}]</div>
          </div>`;
        }).join('')}
      </div>
    `;
  },

  matchInfo(ynab) {
    return `<div class="text-xs text-blue-600 mt-2">✓ Matched: ${ynab.payee_name || 'Unknown'}${ynab.date ? ` (${ynab.date})` : ''}</div>`;
  },

  importSummary(totalActions, parts, matchedCount) {
    if (totalActions === 0) {
      return `
        <div class="text-xs text-gray-500 mb-3 text-right">
          ${matchedCount > 0 ? `${matchedCount} transaction${matchedCount !== 1 ? 's' : ''} already cleared` : ''}
        </div>
      `;
    }
    return `
      <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-3 flex justify-between items-center">
        <div class="text-sm text-gray-700">
          ${parts.join(' • ')}${matchedCount > 0 ? ` • <strong class="font-semibold">${matchedCount}</strong> already cleared` : ''}
        </div>
        <button id="ynabImportBtn" class="px-3 py-1.5 text-sm text-white bg-blue-600 rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed">
          Import to YNAB
        </button>
      </div>
    `;
  },

  warningBox(unmatchedYnab) {
    return `
      <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-3">
        <div class="text-sm">
          <div class="text-gray-900 font-medium mb-2">⚠️ ${unmatchedYnab.length} YNAB transaction${unmatchedYnab.length !== 1 ? 's' : ''} unmatched:</div>
          <ul class="list-disc list-inside text-gray-700 space-y-1">
            ${unmatchedYnab.map(txn => {
              const amount = (txn.amount / 1000).toFixed(2);
              return `<li class="text-xs">${txn.date}: ${txn.payee_name || 'Unknown'} - $${amount} [${txn.cleared}]</li>`;
            }).join('')}
          </ul>
        </div>
      </div>
    `;
  },

  errorBox(failedTransactions) {
    return `
      <div class="bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
        <div class="text-sm">
          <div class="text-red-900 font-medium mb-2">❌ ${failedTransactions.length} transaction${failedTransactions.length !== 1 ? 's' : ''} failed to parse:</div>
          <ul class="list-disc list-inside text-red-700 space-y-1">
            ${failedTransactions.map(txn => `<li class="text-xs">Date: "${txn.date}" - ${txn.description}</li>`).join('')}
          </ul>
        </div>
      </div>
    `;
  }
};

// YNAB Transaction Updater
const ynabUpdater = {
  async updateTransaction(api, budgetId, match, deduplicator) {
    const updates = { cleared: 'cleared' };
    const isTransfer = match.ynab.transfer_account_id !== null && match.ynab.transfer_account_id !== undefined;

    if (!isTransfer) {
      const fidelityDate = deduplicator.parseFidelityDate(match.fidelity.date);
      if (fidelityDate) updates.date = fidelityDate;
    }

    await api.updateTransaction(budgetId, match.ynab.id, updates);
  },

  async processMatches(api, budgetId, matches, deduplicator) {
    for (const match of matches) {
      await this.updateTransaction(api, budgetId, match, deduplicator);
    }
    return matches.length;
  }
};

// Export to window for use in popup.js
if (typeof window !== 'undefined') {
  window.html = html;
  window.ynabUpdater = ynabUpdater;
}
