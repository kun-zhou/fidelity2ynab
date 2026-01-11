/**
 * Application-wide constants
 */

// UI Constants
export const CONSTANTS = {
  TOAST_DURATION_MS: 3000,
  DEBOUNCE_DELAY_MS: 500,
  DATE_TOLERANCE_DAYS: 5,
  POPUP_WIDTH: 600,
  POPUP_HEIGHT: 600,
};

// Badge Types
export const BADGE_TYPES = {
  NEW: 'badge-new',
  CLEAR: 'badge-clear',
  PENDING: 'badge-pending',
  CLEARED: 'badge-cleared',
};

// Badge Configuration
export const BADGE_CONFIGS = {
  [BADGE_TYPES.NEW]: {
    color: 'bg-green-600',
    text: 'NEW',
    tooltip: 'Transaction will be created in YNAB'
  },
  [BADGE_TYPES.CLEAR]: {
    color: 'bg-blue-600',
    text: 'MATCHED',
    tooltip: 'Transaction will be marked as cleared'
  },
  [BADGE_TYPES.PENDING]: {
    color: 'bg-orange-600',
    text: 'PENDING',
    tooltip: 'Transaction is still processing in Fidelity'
  },
  [BADGE_TYPES.CLEARED]: {
    color: 'bg-gray-600',
    text: 'CLEARED',
    tooltip: 'Transaction is already cleared in YNAB'
  }
};

// Status Toast Configuration
export const STATUS_CONFIGS = {
  success: { bg: 'bg-green-600' },
  error: { bg: 'bg-red-600' },
  info: { bg: 'bg-blue-600' },
  warning: { bg: 'bg-yellow-600' }
};

// Month Abbreviations for Date Parsing
export const MONTH_ABBREVIATIONS = {
  'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
  'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
  'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
};

// Storage Keys
export const STORAGE_KEYS = {
  YNAB_CONFIG: 'ynabConfig',
  SKIP_CORE_FUNDS: 'skipCoreFunds',
  HIDE_CLEARED: 'hideCleared',
};
