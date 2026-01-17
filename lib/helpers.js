/**
 * HTML Template Helpers
 */

const html = {
  transaction(txn, amountClass, badgeType, badgeText, matchInfo = '', dropdownId = '', suggestions = []) {
    const opacity = badgeType === 'badge-cleared' ? 'opacity-60' : '';
    const badgeBg = { 'badge-new': 'bg-green-600', 'badge-clear': 'bg-blue-600', 'badge-pending': 'bg-orange-600' }[badgeType] || 'bg-gray-600';
    const hasMatches = suggestions?.length > 0;

    const badgeElement = hasMatches
      ? `<button type="button" class="px-2 py-0.5 text-xs text-gray-700 bg-white border border-gray-300 rounded-full mt-1 cursor-pointer hover:bg-gray-50 custom-dropdown-btn flex items-center gap-1" data-dropdown-id="${dropdownId}" data-txn-index="${matchInfo}">${badgeText} <span style="font-size: 0.6rem;">▼</span></button>`
      : `<span class="px-2 py-0.5 text-xs text-white rounded-full ${badgeBg} mt-1">${badgeText}</span>`;

    return `
      <div class="border-b border-gray-200 py-3 last:border-b-0 ${opacity}">
        <div class="flex justify-between items-start">
          <div class="flex-1">
            <div class="text-sm text-gray-900">${txn.description || 'N/A'}</div>
            ${!hasMatches && matchInfo?.includes?.('Matched') ? matchInfo : ''}
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
      </div>`;
  },

  dateGroup(date, transactionsHtml) {
    return `
      <div class="bg-white border border-gray-200 rounded-lg mb-3">
        <div class="px-4 py-2 border-b border-gray-200"><span class="text-sm font-medium text-gray-700">${date}</span></div>
        <div class="px-4">${transactionsHtml}</div>
      </div>`;
  },

  badgeDropdown(dropdownId, txnIndex, suggestions) {
    return `
      <input type="hidden" class="suggestion-dropdown" data-txn-index="${txnIndex}" value="" />
      <div id="${dropdownId}" class="hidden fixed bg-white border border-gray-300 rounded shadow-lg z-50 custom-dropdown-menu" style="min-width: 15.625rem; max-width: 21.875rem; max-height: 12.5rem; overflow-y: auto;">
        <div class="dropdown-option px-2 py-1.5 text-xs hover:bg-gray-100 cursor-pointer" data-value="__CREATE_NEW__" data-txn-index="${txnIndex}">Create new transaction</div>
        ${suggestions.map(y => `<div class="dropdown-option px-2 py-1.5 text-xs hover:bg-gray-100 cursor-pointer border-t border-gray-200" data-value="${y.id}" data-txn-index="${txnIndex}">
          <div class="font-medium">${y.payee_name || 'Unknown'}</div>
          <div class="text-gray-600">${y.date} • $${(y.amount / 1000).toFixed(2)} • [${y.cleared}]</div>
        </div>`).join('')}
      </div>`;
  },

  matchInfo(ynab) {
    return `<div class="text-xs text-blue-600 mt-2">✓ Matched: ${ynab.payee_name || 'Unknown'}${ynab.date ? ` (${ynab.date})` : ''}</div>`;
  },

  importSummary(totalActions, parts, matchedCount) {
    if (totalActions === 0) {
      return `<div class="text-xs text-gray-500 mb-3 text-right">${matchedCount > 0 ? `${matchedCount} transaction${matchedCount !== 1 ? 's' : ''} already cleared` : ''}</div>`;
    }
    return `
      <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-3 flex justify-between items-center">
        <div class="text-sm text-gray-700">${parts.join(' • ')}${matchedCount > 0 ? ` • <strong>${matchedCount}</strong> already cleared` : ''}</div>
        <button id="ynabImportBtn" class="px-3 py-1.5 text-sm text-white bg-blue-600 rounded hover:bg-blue-700 disabled:bg-gray-300">Import to YNAB</button>
      </div>`;
  },

  warningBox(unmatchedYnab) {
    return `
      <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-3">
        <div class="text-sm">
          <div class="text-gray-900 font-medium mb-2">⚠️ ${unmatchedYnab.length} YNAB transaction${unmatchedYnab.length !== 1 ? 's' : ''} unmatched:</div>
          <ul class="list-disc list-inside text-gray-700 space-y-1">
            ${unmatchedYnab.map(t => `<li class="text-xs">${t.date}: ${t.payee_name || 'Unknown'} - $${(t.amount / 1000).toFixed(2)} [${t.cleared}]</li>`).join('')}
          </ul>
        </div>
      </div>`;
  },

  errorBox(failedTransactions) {
    return `
      <div class="bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
        <div class="text-sm">
          <div class="text-red-900 font-medium mb-2">❌ ${failedTransactions.length} transaction${failedTransactions.length !== 1 ? 's' : ''} failed to parse:</div>
          <ul class="list-disc list-inside text-red-700 space-y-1">
            ${failedTransactions.map(t => `<li class="text-xs">Date: "${t.date}" - ${t.description}</li>`).join('')}
          </ul>
        </div>
      </div>`;
  }
};

if (typeof window !== 'undefined') window.html = html;
