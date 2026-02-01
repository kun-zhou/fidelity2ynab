# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
make           # Build CSS and validate (default)
make css       # Build Tailwind CSS from input.css
make validate  # Validate files and check for console.log/debugger
make test      # Run validation and tests
make clean     # Remove generated CSS
```

## Architecture

Chrome/Firefox extension for scraping Fidelity transactions and importing to YNAB.

### Entry Points
- `popup.html` / `popup.js` - Extension popup UI, orchestrates scraping and YNAB import
- `content.js` - Content script injected into Fidelity pages, handles message-based scraping

### Library Structure (`lib/`)
- `banks/fidelity/scraper.js` - DOM scraping logic for Fidelity transaction tables
- `banks/fidelity/transformer.js` - Transforms scraped data to YNAB format
- `ynab/api.js` - YNAB API wrapper (budgets, accounts, transactions)
- `ynab/deduplicator.js` - Transaction matching algorithm (by amount/date with tolerance)
- `helpers.js` - HTML template generation, badge rendering, UI utilities
- `storage-utils.js` - Promise-based wrapper for `browser.storage.local`

### Data Flow
1. `popup.js` sends message to `content.js` via `browser.tabs.sendMessage`
2. `content.js` uses `scraper.js` to extract transactions from DOM
3. `popup.js` receives data, uses `transformer.js` to normalize format
4. `deduplicator.js` matches against existing YNAB transactions
5. User reviews matches, then `api.js` creates/updates YNAB transactions

## Browser API

Uses `browser.*` namespace (WebExtensions API) with `webextension-polyfill` for Chrome compatibility. The polyfill is loaded via:
- `popup.html` - script tag before other scripts
- `manifest.json` - content_scripts array before content.js

## Transaction Matching Algorithm

### Flowchart

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SCRAPE FIDELITY                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    FETCH YNAB TRANSACTIONS                                   │
│                 (since earliest Fidelity date - 5 days)                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      WATERMARK DETECTION                                     │
│         Search YNAB memos for [F2Y:<hash>] matching Fidelity txns            │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
        ┌───────────────────┐           ┌───────────────────┐
        │ Watermark found   │           │ No watermark      │
        │                   │           │                   │
        │ Split txns into:  │           │ Process all       │
        │ BEFORE (imported) │           │ Fidelity txns     │
        │ AFTER (to process)│           │                   │
        └───────────────────┘           └───────────────────┘
                    │                               │
                    └───────────────┬───────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    FOR EACH FIDELITY TXN (after watermark)                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
        ┌───────────────────┐           ┌───────────────────┐
        │ Amount matches    │           │ No amount match   │
        │ YNAB transaction? │           │                   │
        └───────────────────┘           └───────────────────┘
                    │                               │
            ┌───────┴───────┐                       │
            ▼               ▼                       │
    ┌─────────────┐ ┌─────────────┐                 │
    │Date within  │ │Date outside │                 │
    │tolerance?   │ │tolerance    │                 │
    │(5 days for  │ │             │                 │
    │uncleared)   │ │             │                 │
    └─────────────┘ └─────────────┘                 │
            │               │                       │
            ▼               └───────────┬───────────┘
    ┌─────────────┐                     │
    │   MATCHED   │                     ▼
    └─────────────┘             ┌─────────────┐
            │                   │  TO IMPORT  │
            │                   │ (new in YNAB)│
            ▼                   └─────────────┘
    ┌───────────────────┐               │
    │ YNAB txn cleared? │               │
    └───────────────────┘               │
        │           │                   │
        ▼           ▼                   │
┌───────────┐ ┌───────────┐             │
│  CLEARED  │ │ TO UPDATE │             │
│(collapsed)│ │(will clear)│            │
└───────────┘ └───────────┘             │
                    │                   │
                    └─────────┬─────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FIDELITY TXN PROCESSING?                             │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
    ┌─────────────────┐             ┌─────────────────┐
    │      YES        │             │       NO        │
    │                 │             │                 │
    │ Create YNAB     │             │ Create YNAB     │
    │ SCHEDULED txn   │             │ CLEARED txn     │
    │ (no watermark)  │             │ (with watermark │
    │                 │             │  on last one)   │
    └─────────────────┘             └─────────────────┘
```

### Overview
The extension uses a multi-stage matching algorithm to reconcile Fidelity transactions with YNAB:

### Stage 1: Watermark Detection (`lib/watermark.js`)
- Each imported transaction gets a watermark in its YNAB memo: `[F2Y:<hash>]`
- Hash is base64-encoded `date|description|amount`, truncated to 12 chars
- On subsequent scrapes, finds the watermark in YNAB to identify previously imported transactions
- Transactions before the watermark are shown in a collapsed "previously imported" section

### Stage 2: Transaction Matching (`lib/ynab/deduplicator.js`)
For transactions after the watermark:

1. **Exact Match**: Same amount (in milliunits) + date within tolerance
   - Cleared YNAB transactions: exact date match required
   - Uncleared/transfers: 5-day tolerance (configurable via `dateTolerance`)

2. **Match Categories**:
   - `matched` (cleared): Already in YNAB and cleared - shown in collapsible section
   - `toUpdate`: Matched but needs clearing (uncleared YNAB transaction)
   - `pending`: Fidelity shows "Processing" status - matched but not imported yet
   - `toImport`: No match found - will create new YNAB transaction

### Stage 3: UI Presentation
Two-column layout with synchronized scrolling:

**Left Column (Fidelity)**:
- Active transactions with skip (X) button
- Collapsible sections for consecutive cleared transactions (in date order)
- Collapsible "previously imported" section (before watermark)

**Right Column (YNAB)**:
- Matched YNAB transactions aligned with Fidelity counterparts
- "Create New" tiles for unmatched Fidelity transactions
- Collapsible cleared sections matching left column
- Unmatched YNAB transactions at bottom

**Match Canvas** (`lib/ui/match-canvas.js`):
- SVG bezier curves connecting matched transaction pairs
- Blue lines for existing matches
- Green lines for "create new" connections
- Drag handles for manual match adjustment

### Scroll Synchronization

Uses wheel events so scrolling works on either column regardless of content height.

**Scrolling DOWN:**
- Both columns scroll together by the same delta
- When shorter column (Fidelity) hits bottom, longer column (YNAB) continues alone

**Scrolling UP:**
- If YNAB column is scrolled further down than Fidelity:
  - YNAB scrolls up first to "catch up" to Fidelity's position
  - Once aligned, both columns scroll together again
- This prevents jarring jumps when reversing scroll direction

```
DOWN: Both scroll together → Fidelity stops at bottom → YNAB continues alone
UP:   YNAB catches up first → Once aligned → Both scroll together
```

### Import Process
1. User reviews matches, can skip transactions via X button
2. On import, transactions are created/updated via YNAB API
3. Watermark is added to the last processed transaction's memo
4. Next scrape will recognize the watermark and skip already-imported transactions
