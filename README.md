# Fidelity2YNAB Chrome Extension

A Chrome extension that scrapes transaction data from Fidelity cash management account pages and automatically imports them into YNAB (You Need A Budget) with smart reconciliation.

## Features

- **Smart Transaction Scraping**: Validates and scrapes transaction data from Fidelity Activity & Orders pages
- **Configurable Filtering**: Option to skip Core Fund Buy & Redemptions (enabled by default)
- **YNAB Integration**: Automatic reconciliation and import to You Need A Budget
  - Smart duplicate detection by date and amount
  - Automatically clears matching uncleared YNAB transactions
  - Shows preview of what will be imported before you commit
  - Configurable date tolerance
- **Visual Import Preview**: Color-coded badges showing transaction status (hover for explanation):
  - **GREEN "NEW"** - Will create new transaction in YNAB
  - **WHITE "MATCH AVAILABLE"** - Matching suggestions available, selection required
  - **BLUE "MATCHED"** - Will clear existing uncleared transaction
  - **ORANGE "PENDING"** - Transaction still processing in Fidelity, won't be cleared
  - **GRAY "CLEARED"** - Already cleared in YNAB (no action needed)
  - Hide Cleared option (default on) to focus on transactions needing action
- **Smart Suggestions**: For NEW transactions, shows dropdown to select action
  - If matching YNAB transactions found (same amount): **Selection required** to choose between creating new or matching existing
    - Shows as "pending" in summary until selection made
    - Import blocked until all pending selections are resolved
  - If no matches found: Defaults to "Create new transaction"
  - Dropdown shows date, payee, amount, and cleared status for each suggestion
  - Prevents duplicates when dates are outside tolerance range
- **Unmatched YNAB Transactions**: Shown in UI when no Fidelity transactions to process
  - Warning list displays when Import button is disabled (0 transactions to import/update)
  - Shows YNAB transactions that couldn't be matched with Fidelity
  - Before importing (when transactions exist), asks for confirmation if unmatched transactions remain
  - Helps prevent leaving YNAB transactions unreconciled
- **Settings Saved Automatically**: All preferences persist between sessions
- **Clean UI**: User-friendly interface with helpful error messages

## Quick Start

### Step 0: Build (First Time Setup)

Build and validate:
```bash
make        # Build CSS and validate (default)
# or
make test   # Build, validate, and run tests
```

### Step 1: Load Extension in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle switch in top-right corner)
3. Click "Load unpacked" button
4. Select the `fidelity2ynab` folder

### Step 2: Use the Extension

1. Go to your Fidelity account page:
   - Log in to https://digital.fidelity.com/
   - Navigate to Activity & Orders page

2. Click the extension icon in Chrome toolbar

3. Configure preferences (all on one line):
   - **Skip Core Funds** - Checked by default to filter out core fund transactions
   - **Hide Cleared** - Checked by default to hide already-cleared transactions from view
   - **Tolerance** - Days tolerance for date matching (default: 5)

4. Click "Scrape Transactions"

5. The transactions will appear with status badges

6. If YNAB is configured:
   - Review transactions with NEW badges
   - Transactions with matching YNAB suggestions (same amount):
     - **REQUIRED**: You must select an action from the dropdown
     - "Create new transaction" - Creates a new YNAB transaction
     - "Match with: [date]: [payee]..." - Clears and updates the existing YNAB transaction
     - Import is blocked until all suggestions are resolved
   - Transactions with no matches: Dropdown defaults to "Create new transaction"
   - If no Fidelity transactions to process: Unmatched YNAB transactions shown in warning box
   - Click "Import to YNAB" to process transactions

### Step 3: Configure YNAB (Optional)

To automatically import transactions to YNAB:

1. **Get Your YNAB Personal Access Token**:
   - Visit https://app.ynab.com/settings/developer
   - Click "New Token"
   - Give it a name: "Fidelity Scraper"
   - Copy the token immediately (you can't view it again!)

2. **Configure the Extension**:
   - Click "Configure" in the YNAB status bar
   - Paste your token
   - Select your budget from the dropdown
   - Select your Fidelity account in YNAB
   - Click "Save Configuration"

3. **Import Transactions**:
   - Scrape transactions normally
   - Review the preview with badges
   - Click "Import to YNAB" to process

## How It Works

### Architecture Overview

The extension consists of several key components:

- **content.js** - Content script that scrapes Fidelity pages
- **popup.html/js** - Extension popup UI and event handling
- **lib/ynab-api.js** - YNAB API wrapper and transaction matching logic
- **lib/helpers.js** - HTML template generation and badge rendering
- **lib/constants.js** - Centralized configuration (badge colors, storage keys, etc.)
- **lib/storage-utils.js** - Promise-based Chrome storage utilities

### Transaction Matching Algorithm

The extension uses a smart matching algorithm to prevent duplicates and reconcile transactions:

#### Step 1: Find Earliest Fidelity Date
- Scans all scraped Fidelity transactions to find the earliest date
- Uses this as the anchor point for the matching process

#### Step 2: Fetch YNAB Transactions
- Fetches YNAB transactions from (earliest Fidelity date - tolerance)
- Ensures we have enough YNAB history to match against

#### Step 3: Match All Fidelity Transactions
For each Fidelity transaction:
- Match by **exact amount**
- Match by **date**:
  - Cleared non-transfer YNAB transactions: exact date match only
  - Uncleared YNAB transactions: ±N days tolerance (default 5)
  - Transfer transactions: ±N days tolerance (default 5), regardless of cleared status

#### Step 4: Categorize & Suggest
- **NEW**: Fidelity transaction with no YNAB match → create new transaction
  - For each NEW transaction, finds unmatched YNAB transactions with same amount
  - If suggestions found, shows dropdown to select which YNAB transaction to match (or create new)
- **MATCHED**: Matched with uncleared YNAB transaction → update to cleared (and update date if not a transfer)
- **PENDING**: Transaction still processing in Fidelity and matches YNAB → skip clearing until settled
- **CLEARED**: Matched with already cleared YNAB transaction → skip (already in sync)

#### Step 5: Process & Warn
- Processes NEW transactions based on user selections:
  - Creates new YNAB transactions (if user chose "Create new transaction")
  - Updates user-selected YNAB transactions (if user chose to match with existing) - same logic as automatic MATCHED transactions:
    - Always: sets cleared to 'cleared'
    - For uncleared non-transfers: also updates date to Fidelity date
    - For transfers or already-cleared: only updates cleared status
- Updates automatic MATCHED transactions:
  - Sets cleared status to 'cleared'
  - For uncleared non-transfer transactions: also updates date to match Fidelity date
  - For transfer or already-cleared transactions: only updates cleared status
- Skips PENDING transactions (still processing in Fidelity)
- Shows confirmation if unmatched YNAB transactions remain after user selections
- Shows you exactly which YNAB transaction matched each Fidelity transaction

### Why This Approach?

This algorithm ensures:
- **All scraped transactions are processed** - nothing is ignored
- **No duplicates** - matches existing YNAB transactions before creating new ones
- **Automatic reconciliation** - clears matching uncleared transactions
- **Simple and predictable** - always uses earliest Fidelity date as anchor

### Example Scenario

**Scraped Fidelity Transactions:**
- Jan 10: Grocery Store ($50) - Settled
- Jan 15: Gas Station ($40) - Settled
- Jan 20: Restaurant ($30) - Settled
- Jan 25: Coffee Shop ($5) - Settled
- Jan 28: Online Purchase ($25) - Processing

**Existing YNAB Transactions:**
- Jan 12: Safeway ($50) - uncleared
- Jan 20: Italian Restaurant ($30) - cleared
- Jan 29: Amazon ($25) - uncleared
- Dec 28: Starbucks ($5) - uncleared (outside tolerance window)

**What Happens:**

1. **YNAB Fetch**: Fetches YNAB transactions from Jan 5 (Jan 10 - 5 days tolerance)

2. **Matching & Suggestions**:
   - Grocery Store (Jan 10) → matches uncleared YNAB Jan 12 ($50) → **MATCHED** (within tolerance)
   - Gas Station (Jan 15) → no match → **NEW** with dropdown:
     - Shows: "No matching YNAB transactions found"
     - Dropdown defaults to "Create new transaction" (ready to import)
   - Restaurant (Jan 20) → matches cleared YNAB Jan 20 ($30) → **CLEARED** (exact date)
   - Coffee Shop (Jan 25) → no automatic match → **NEW** with suggestion dropdown:
     - Shows: "💡 1 matching YNAB transaction found with same amount - SELECTION REQUIRED"
     - Dropdown starts with "-- Select action (required) --" (no default)
     - User **must** select either:
       - "Create new transaction" - Creates new YNAB transaction
       - "Match with: Dec 28: Starbucks ($5.00) [uncleared]" - Updates existing
     - Import is blocked until user makes a selection
   - Online Purchase (Jan 28, Processing) → matches YNAB Jan 29 ($25) → **PENDING** (still processing)

3. **Import** (assuming user selected "Match with: Starbucks"):
   - Creates new YNAB transaction for Gas Station
   - Updates Grocery Store YNAB transaction: sets to cleared and updates date from Jan 12 to Jan 10
   - Updates Starbucks YNAB transaction: sets to cleared and updates date from Dec 28 to Jan 25
   - Skips Online Purchase (PENDING - still processing in Fidelity)

4. **Warnings & Display**:
   - Before import, confirmation dialog asks if you want to continue with unmatched transactions
   - If there were no Fidelity transactions to process, unmatched YNAB would be shown in warning box

## Configuration

### Skip Core Funds

By default, the extension filters out core fund transactions to show only meaningful account activity. Core fund transactions are identified by:
- Descriptions ending with "(Cash)"
- Descriptions starting with "REDEMPTION FROM" or "YOU BOUGHT"

Examples of filtered transactions:
- `REDEMPTION FROM CORE ACCOUNT FIDELITY TREASURY ONLY MONEY MARKET FD (FDLXX) (Cash)`
- `YOU BOUGHT PROSPECTUS UNDER SEPARATE COVER FIDELITY TREASURY ONLY MONEY MARKET FD (FDLXX) (Cash)`

Uncheck the "Skip Core Funds" checkbox to include these transactions.

### Hide Cleared

**Purpose**: Reduce clutter by hiding transactions that are already cleared in YNAB

**Default**: Checked (enabled)

**Behavior**: When enabled, transactions with the gray "CLEARED" badge will be hidden from the display. The summary at the top still shows the count of cleared transactions, but they won't be visible in the list. This helps you focus on transactions that need action (NEW or TO CLEAR).

Uncheck the "Hide Cleared" checkbox to show all transactions including already-cleared ones.

### Tolerance

**Purpose**: Allow matching when payment dates differ slightly

**Default**: 5 days

**Behavior**:
- Cleared non-transfer YNAB transactions: **exact date match only**
- Uncleared YNAB transactions: **±N days tolerance** (date will be updated to Fidelity date when cleared)
- Transfer transactions: **±N days tolerance** (regardless of cleared status, date not updated)

**Affects**:
- YNAB fetch start date (earliest Fidelity - tolerance)
- Warning cutoff (earliest Fidelity + tolerance)
- Uncleared and transfer transaction matching window

## Data Formats

### Fidelity Transaction
```json
{
  "date": "Jan-12-2026",
  "description": "Electronic Funds Transfer Received (Cash)",
  "amount": "+$455.84",
  "amountValue": 455.84,
  "type": "credit",
  "cashBalance": "8200.00",
  "status": "Processing"
}
```

### YNAB Transaction Format
```json
{
  "account_id": "uuid",
  "date": "2026-01-12",
  "amount": 455840,
  "payee_name": "Electronic Funds Transfer Received (Cash)",
  "memo": "Processing",
  "cleared": "cleared",
  "approved": false
}
```

Note: YNAB uses milliunits for amounts (multiply by 1000).

## Troubleshooting

### "Please navigate to a Fidelity page first"
- Make sure you're on digital.fidelity.com

### "No transactions found"
- Make sure the Activity & Orders section is visible on the page
- Try scrolling to ensure the transaction table has loaded
- Check that you're on the correct account page

### Extension won't load
- Make sure icon.png exists
- Check that manifest.json is present
- Try reloading the extension from chrome://extensions/

### YNAB import errors
- Verify your Personal Access Token is valid
- Check that you selected the correct budget and account
- Ensure your YNAB account is not closed or deleted

### Date parsing errors
- If you see a red error box with failed transactions, those transactions have invalid date formats
- The extension will show which transactions failed
- Valid transactions will still be processed

### Unmatched YNAB transactions
- When there are no Fidelity transactions to import/update, unmatched YNAB transactions are shown in a warning box
- The warning lists date, payee, amount, and cleared status for each unmatched transaction
- Only visible when Import button is disabled (0 Fidelity transactions to process)
- When importing with Fidelity transactions, you'll see a confirmation dialog if unmatched YNAB transactions remain
- You can choose to "Continue Import" or "Cancel" to review and potentially match them manually first
- Only shows YNAB transactions after (earliest Fidelity date + tolerance)
- This helps you identify transactions that may need manual reconciliation

### "Selection Required" alert
- For NEW transactions with matching YNAB suggestions, you must select an action
- Dropdown shows "-- Select action (required) --" when matches are found
- If no matches found, dropdown defaults to "Create new transaction"
- A popup appears when you try to import with unresolved suggestions (matches found but not selected)
- Summary shows these as "pending" (not "new") until you make a selection
- You must select an action from each yellow dropdown before importing
- The first unselected dropdown will be highlighted and scrolled into view
- Choose either "Create new transaction" or match with a suggested YNAB transaction
- This prevents accidentally creating duplicate transactions

## Files

### Core Files
- `manifest.json` - Chrome extension configuration
- `content.js` - Content script that scrapes transaction data from the page
- `popup.html` - Extension popup UI
- `popup.js` - Popup logic and data handling
- `input.css` - Custom CSS styles (compiled to tailwind.css)
- `tailwind.css` - Compiled Tailwind CSS (generated via `make css`)
- `Makefile` - Build and validation scripts

### Library Files (lib/)
- `lib/ynab-api.js` - YNAB API integration and transaction matching logic
- `lib/helpers.js` - HTML template generation and utility functions
- `lib/constants.js` - Centralized configuration and constants
- `lib/storage-utils.js` - Promise-based Chrome storage wrappers

### Assets
- `icon.png` - Extension icon
- `tailwindcss-macos-arm64` - Tailwind CSS CLI tool (for building)

## Build Commands

Available Makefile commands:

```bash
make           # Build CSS and validate (default)
make all       # Same as default - build CSS and validate
make css       # Build Tailwind CSS from input.css
make validate  # Validate all files and check for common errors
make test      # Run validation and tests
make clean     # Remove generated files (CSS)
```

## Future Enhancements

Potential features to add:
- Automatic scheduled scraping
- Transaction categorization based on description patterns
- Multiple account support
- Historical data import with progress tracking
- CSV import/export improvements
- Custom matching rules
