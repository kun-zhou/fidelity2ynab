/**
 * HTML Template Helpers
 */

const html = {
  // Two-column layout templates

  twoColumnContainer(fidelityHtml, ynabHtml) {
    return `
      <div class="match-container relative flex gap-4 h-full w-full max-w-full overflow-hidden">
        <div id="fidelityColumn" class="column-scroll max-w-full">
          <div class="text-xs font-medium text-gray-500 mb-2 sticky top-0 bg-gray-50 py-1 z-10">Fidelity</div>
          ${fidelityHtml}
        </div>
        <svg id="matchLines" class="match-lines absolute inset-0 pointer-events-none z-20"></svg>
        <div id="ynabColumn" class="column-scroll max-w-full">
          <div class="text-xs font-medium text-gray-500 mb-2 sticky top-0 bg-gray-50 py-1 z-10">YNAB</div>
          ${ynabHtml}
        </div>
      </div>`;
  },

  fidelityItem(txn, index, isSkipped, matchState) {
    const amountClass = txn.type === 'credit' ? 'text-green-600' : 'text-gray-900';
    const opacity = isSkipped ? 'opacity-40' : '';
    const strikethrough = isSkipped ? 'line-through' : '';

    let stateClass = '';
    if (matchState === 'matched') stateClass = 'border-l-4 border-l-blue-500';
    else if (matchState === 'new') stateClass = 'border-l-4 border-l-green-500';
    else if (matchState === 'before-watermark') stateClass = 'border-l-4 border-l-gray-300';

    return `
      <div class="fidelity-item bg-white border border-gray-200 rounded px-2.5 py-1.5 mb-2 ${opacity} ${stateClass}" data-index="${index}" data-amount="${txn.amountValue}">
        <div class="flex items-start gap-1.5">
          <button type="button" class="skip-btn flex items-center justify-center w-3.5 h-3.5 mt-0.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors ${isSkipped ? 'text-red-500 bg-red-50' : ''}" data-index="${index}" data-skipped="${isSkipped}">
            <svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between text-xs">
              <span class="text-gray-500">${txn.date}${txn.status ? ` <span class="text-orange-600 italic">(${txn.status})</span>` : ''}</span>
              <span class="font-medium ${amountClass} ${strikethrough}">${txn.amount || 'N/A'}</span>
            </div>
            <div class="text-sm text-gray-900 truncate ${strikethrough}">${txn.description || 'N/A'}</div>
          </div>
          <div class="drag-handle w-3.5 h-3.5 mt-0.5 flex items-center justify-center cursor-grab text-gray-400 hover:text-gray-600" data-index="${index}">
            <svg class="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20"><circle cx="6" cy="4" r="2"/><circle cx="14" cy="4" r="2"/><circle cx="6" cy="10" r="2"/><circle cx="14" cy="10" r="2"/><circle cx="6" cy="16" r="2"/><circle cx="14" cy="16" r="2"/></svg>
          </div>
        </div>
      </div>`;
  },

  ynabItem(txn, matchState, matchedFidelityIndex = null) {
    const amountClass = txn.amount >= 0 ? 'text-green-600' : 'text-gray-900';
    const clearedBadge = txn.cleared === 'cleared' ? 'text-green-600' : 'text-yellow-600';

    let stateClass = '';
    if (matchState === 'matched') stateClass = 'border-r-4 border-r-blue-500 bg-blue-50';
    else if (matchState === 'available') stateClass = 'border-r-4 border-r-gray-300';

    return `
      <div class="ynab-item bg-white border border-gray-200 rounded px-2.5 py-1.5 mb-2 ${stateClass}" data-ynab-id="${txn.id}" data-amount="${txn.amount}" data-matched-index="${matchedFidelityIndex !== null ? matchedFidelityIndex : ''}">
        <div class="flex items-center justify-between text-xs">
          <span class="text-gray-500">${txn.date} <span class="${clearedBadge}">(${txn.cleared})</span></span>
          <span class="font-medium ${amountClass}">$${(txn.amount / 1000).toFixed(2)}</span>
        </div>
        <div class="text-sm text-gray-900 truncate">${txn.payee_name || 'Unknown'}</div>
      </div>`;
  },

  createNewTarget(index, txn, formattedPayee = null) {
    if (!txn) {
      return `<div class="create-new-target bg-gray-100 border border-gray-200 rounded px-2.5 py-1.5 mb-2 opacity-40" data-target-index="${index}">
        <div class="text-xs text-gray-400 text-center">Skipped</div>
      </div>`;
    }
    const amountClass = txn.type === 'credit' ? 'text-green-600' : 'text-gray-900';
    const displayName = formattedPayee || txn.description || 'N/A';
    return `
      <div class="create-new-target bg-green-50 border border-dashed border-green-400 rounded px-2.5 py-1.5 mb-2 hover:bg-green-100 transition-colors" data-target-index="${index}">
        <div class="flex items-center justify-between text-xs">
          <span class="text-green-600 font-medium">+ Create New</span>
          <span class="font-medium ${amountClass}">${txn.amount || ''}</span>
        </div>
        <div class="text-sm text-gray-700 truncate">${displayName}</div>
      </div>`;
  },

  beforeWatermarkSection(txns, watermarkInfo) {
    if (!txns || txns.length === 0) return '';
    const lastTxn = watermarkInfo ? txns[txns.length - 1] : null;
    const watermarkLabel = lastTxn
      ? `Last import: ${lastTxn.date} - ${lastTxn.description?.substring(0, 30) || 'Unknown'}${lastTxn.description?.length > 30 ? '...' : ''}`
      : '';
    return `
      <details class="before-watermark-section mb-3">
        <summary class="text-xs text-gray-500 cursor-pointer hover:text-gray-700 py-1">
          <span class="font-medium">${txns.length} previously imported</span>
          ${watermarkLabel ? `<span class="ml-2 text-gray-400">(${watermarkLabel})</span>` : ''}
        </summary>
        <div class="mt-2 opacity-50">
          ${txns.map((txn, i) => this.fidelityItem(txn, `before-${i}`, false, 'before-watermark')).join('')}
        </div>
      </details>`;
  },

  clearedSection(txns) {
    if (!txns || txns.length === 0) return '';
    return `
      <details class="cleared-section mb-3">
        <summary class="text-xs text-gray-500 cursor-pointer hover:text-gray-700 py-1 flex items-center gap-1">
          <span class="font-medium">${txns.length} cleared</span>
        </summary>
        <div class="mt-2 opacity-60">
          ${txns.map(({ txn, index }) => this.fidelityItem(txn, `cleared-${index}`, false, 'matched')).join('')}
        </div>
      </details>`;
  },

  ynabClearedSection(txns) {
    if (!txns || txns.length === 0) return '';
    return `
      <details class="cleared-section mb-2">
        <summary class="text-xs text-gray-500 cursor-pointer hover:text-gray-700 py-1 bg-gray-100 rounded px-2">
          ${txns.length} cleared transaction${txns.length !== 1 ? 's' : ''}
        </summary>
        <div class="mt-1 opacity-70">
          ${txns.map(t => this.ynabItem(t.ynab, 'matched', t.fidelityIndex)).join('')}
        </div>
      </details>`;
  },

  // Returns just the stats text for the action bar
  matchSummaryText(counts) {
    const { toCreate, toMatch, toSkip, beforeWatermark } = counts;
    const parts = [];
    if (toCreate > 0) parts.push(`<strong>${toCreate}</strong> new`);
    if (toMatch > 0) parts.push(`<strong>${toMatch}</strong> matched`);
    if (toSkip > 0) parts.push(`<span class="text-gray-400">${toSkip} skipped</span>`);
    if (beforeWatermark > 0) parts.push(`<span class="text-gray-400">${beforeWatermark} imported</span>`);

    if (parts.length === 0) {
      return 'All up to date';
    }
    return parts.join(' • ');
  }
};

if (typeof window !== 'undefined') window.html = html;
