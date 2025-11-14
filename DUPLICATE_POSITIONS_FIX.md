# Duplicate Positions Bug Fix

## Problem
Positions were appearing duplicated (2x, 3x, and growing) in the dashboard.

## Root Cause
The issue was caused by **concurrent render calls** without proper synchronization:

1. **Multiple Render Triggers**: `renderPortfolioIncremental()` was being called from multiple places:
   - Initial page load
   - Saving settings
   - Adding manual positions
   - Tab becoming visible again after being hidden

2. **No Concurrency Control**: Each call created a new `IncrementalPortfolioRenderer` instance that launched async provider calls

3. **Race Condition**: When multiple renders happened quickly (e.g., saving settings, adding a position), multiple renderer instances would run concurrently, each:
   - Fetching data from providers (Hyperliquid, Zerion, etc.)
   - Appending positions to their internal array
   - Updating shared global state (`window.cachedPositions`, `window._portfolioRenderer`)

4. **Result**: Positions from multiple concurrent render cycles would accumulate, causing duplicates to appear in the UI

## Solution

### Layer 1: Concurrency Guard (app.js)
Added a mutex-like pattern to prevent concurrent renders:

```javascript
let _renderInProgress = false;
let _pendingRenderRequest = false;

async function renderPortfolioIncremental() {
  // If already rendering, queue another render for after
  if (_renderInProgress) {
    _pendingRenderRequest = true;
    return;
  }
  
  _renderInProgress = true;
  try {
    await _doRenderPortfolioIncremental();
  } finally {
    _renderInProgress = false;
    // Run queued render if one was requested
    if (_pendingRenderRequest) {
      _pendingRenderRequest = false;
      renderPortfolioIncremental();
    }
  }
}
```

**Effect**: Only one render can run at a time. Additional render requests are queued and executed after the current one finishes.

### Layer 2: Position Deduplication (incremental-portfolio.js)
Added deduplication in `aggregatePositions()`:

```javascript
// Deduplicate by unique key (asset + exchange)
const uniquePositions = new Map();
for (const row of positions) {
  const key = row._changeDetectionKey || `${row.asset}_${row.exchange}`;
  if (!uniquePositions.has(key)) {
    uniquePositions.set(key, row);
  }
}
```

**Effect**: Even if duplicate positions somehow make it into the array, they're filtered out during aggregation.

## Testing
After these changes:
- Rapidly clicking through settings → save → add position should no longer cause duplicates
- Switching tabs back and forth should not accumulate positions
- The portfolio should render once per trigger, not multiple times concurrently

## Date
2025-11-14

