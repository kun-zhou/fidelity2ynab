/**
 * YNAB API Client
 */

const YNAB_API_BASE = 'https://api.ynab.com/v1';

class YNABApi {
  constructor(accessToken) {
    this.accessToken = accessToken;
  }

  async makeRequest(endpoint, method = 'GET', body = null) {
    const options = {
      method,
      headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
    };
    if (body) options.body = JSON.stringify(body);

    const response = await fetch(`${YNAB_API_BASE}${endpoint}`, options);
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`YNAB API error: ${err.error?.detail || response.statusText}`);
    }
    return response.json();
  }

  async getBudgets() {
    return (await this.makeRequest('/budgets')).data.budgets;
  }

  async getAccounts(budgetId) {
    return (await this.makeRequest(`/budgets/${budgetId}/accounts`)).data.accounts;
  }

  async getTransactionsSinceDate(budgetId, accountId, sinceDate) {
    return (await this.makeRequest(`/budgets/${budgetId}/accounts/${accountId}/transactions?since_date=${sinceDate}`)).data.transactions;
  }

  async updateTransaction(budgetId, transactionId, updates) {
    return (await this.makeRequest(`/budgets/${budgetId}/transactions/${transactionId}`, 'PUT', { transaction: updates })).data.transaction;
  }

  async createTransactions(budgetId, transactions) {
    return (await this.makeRequest(`/budgets/${budgetId}/transactions`, 'POST', { transactions })).data;
  }
}
