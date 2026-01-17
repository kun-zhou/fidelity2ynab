/**
 * Fidelity Transaction Scraper - Content Script
 */

function validateFidelityActivityPage() {
  const activityTab = document.querySelector('a.new-tab__tab[href*="activity"]');
  if (!activityTab) return { valid: false, error: 'Activity & Orders tab not found.' };

  const tabText = activityTab.querySelector('.new-tab__text-wrapper.tab-label');
  if (!tabText?.textContent.includes('Activity')) return { valid: false, error: 'Not on Activity & Orders page.' };

  if (!document.querySelector('activity-list, account-activity-container')) {
    return { valid: false, error: 'Transaction data not found. Make sure the page is loaded.' };
  }

  return { valid: true };
}

function isCoreFundTransaction(description) {
  if (!description) return false;
  const t = description.trim();
  return t.endsWith('(Cash)') && (t.startsWith('REDEMPTION FROM') || t.startsWith('YOU BOUGHT'));
}

function parseAmount(amountText, color) {
  const match = amountText.match(/[$]?([\d,]+\.\d{2})/);
  if (!match) throw new Error(`Unable to parse amount: "${amountText}"`);

  const sign = amountText.includes('-') ? -1 : 1;
  const amountValue = sign * parseFloat(match[1].replace(/,/g, ''));

  let type;
  if (color.includes('54, 135, 39') || color.includes('green')) type = 'credit';
  else if (color.includes('0, 0, 0') || color.includes('black')) type = 'debit';
  else throw new Error(`Unable to determine transaction type from color: "${color}"`);

  return { amount: amountText, amountValue, type };
}

function scrapeTransactions(skipCoreFunds = true) {
  const transactions = [];

  document.querySelectorAll('div[role="rowgroup"].gridRow').forEach(rowGroup => {
    const row = rowGroup.querySelector('div[role="row"]');
    if (!row) return;

    const txn = {};
    const dateCell = row.querySelector('.activity-item-context');
    if (dateCell) txn.date = dateCell.textContent.trim();

    const descCell = row.querySelector('.activity-item-break-wording .pvd-grid__item');
    if (descCell) txn.description = descCell.textContent.trim();

    const amountCell = row.querySelector('.ao-status.grid-item__status');
    if (amountCell) {
      try {
        Object.assign(txn, parseAmount(amountCell.textContent.trim(), amountCell.style.color));
      } catch { return; }
    }

    row.querySelectorAll('.pvd-grid__item').forEach(cell => {
      if (cell.textContent.trim() === 'Processing') txn.status = 'Processing';
    });

    if (txn.date && txn.description && (!skipCoreFunds || !isCoreFundTransaction(txn.description))) {
      transactions.push(txn);
    }
  });

  return transactions;
}
