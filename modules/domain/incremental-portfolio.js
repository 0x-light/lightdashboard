/**
 * Incremental Portfolio Renderer
 * Streams positions as each provider responds (no blocking)
 */
import { getRandomSpinner } from '../ui/unicode-animations.js';
import {
  formatMoney,
  getFxCurrency,
  getQuoteUnitScale,
  normalizeBaseCurrency,
  normalizeCurrencyCode
} from '../utils/currency.js';
import { calculatePortfolioBreakdown, calculatePortfolioTotals } from './portfolio.js';

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// Last finished portfolio, kept so the next page load can paint real numbers immediately instead
// of "Loading portfolio..." while every provider round-trips. Rows from it are marked `_stale` and
// replaced source by source as fresh data arrives.
const SNAPSHOT_KEY = 'viewport.portfolioSnapshot.v1';
const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SNAPSHOT_HISTORY_POINTS = 24;
const SNAPSHOT_SAVE_DELAY_MS = 1500;

// Last good FX rates per base currency, each with the time it was fetched. A failed lookup then
// values EUR or GBP holdings at the last known rate instead of dropping them from the total.
const FX_CACHE_KEY = 'viewport.fxRates.v1';
const FX_REFRESH_MS = 10 * 60 * 1000;
const FX_RETRY_MS = 30 * 1000;
// A rate older than this is shown as stale. Normal refreshes keep it under FX_REFRESH_MS.
const FX_STALE_MS = 60 * 60 * 1000;

// [currency, rate, fetchedAt]. Entries saved before fetchedAt existed read as 0: age unknown.
function loadFxCache(base) {
  try {
    const rates = JSON.parse(localStorage.getItem(FX_CACHE_KEY) || '{}')?.[base];
    return Object.entries(rates || {})
      .map(([currency, entry]) => (typeof entry === 'object' && entry
        ? [currency, Number(entry.rate), Number(entry.at) || 0]
        : [currency, Number(entry), 0]))
      .filter(([, rate]) => rate > 0);
  } catch (_) {
    return [];
  }
}

function saveFxCache(base, rates, fetchedAt) {
  try {
    const all = JSON.parse(localStorage.getItem(FX_CACHE_KEY) || '{}') || {};
    all[base] = Object.fromEntries(Array.from(rates.entries())
      .filter(([currency, rate]) => Number(rate) > 0 && currency !== base)
      .map(([currency, rate]) => [currency, { rate, at: fetchedAt.get(currency) || 0 }]));
    localStorage.setItem(FX_CACHE_KEY, JSON.stringify(all));
  } catch (_) { /* storage unavailable: rates are fetched again next load */ }
}

// A row older than about two refresh cycles is shown as stale.
export const STALE_AFTER_MS = 90 * 1000;

const sourceMatches = (src, name) => src === name || String(src || '').startsWith(`${name}_`);

// "40s ago", "12m ago", "3h ago"; past a day the weekday and time, past a week the date.
export function ageText(at, now = Date.now()) {
  if (!(Number(at) > 0)) return 'age unknown';
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  const date = new Date(at);
  const timeZone = globalThis.window?.larpTimeZone;
  if (seconds < 7 * 86400) {
    return date.toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone });
  }
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone });
}

/**
 * Freshness of one table row. Stale when it comes from the saved snapshot, from a source that
 * failed, when its data or its FX rate is too old. `at` is the oldest time its figures were good.
 * @param {Object} row - converted or aggregated row (dataAt, fxRateAt, _source/_sources, _fromSnapshot)
 * @param {{ now?: number, failing?: string[] }} context
 * @returns {{ stale: boolean, at: number|null, failedSource: string|null, fxStale: boolean }}
 */
export function rowFreshness(row, { now = Date.now(), failing = [] } = {}) {
  const sources = row?._sources || [row?._source];
  const failedSource = failing.find(name => sources.some(src => sourceMatches(src, name))) || null;
  const dataAt = Number(row?.dataAt) > 0 ? Number(row.dataAt) : null;
  // fxRateAt is null when the row needs no FX, 0 when the rate's age is unknown.
  const fxStale = row?.fxRateAt != null && !(now - Number(row.fxRateAt) <= FX_STALE_MS);
  const dataStale = dataAt !== null && now - dataAt > STALE_AFTER_MS;
  const stale = !!row?._fromSnapshot || !!failedSource || fxStale || dataStale;
  const times = [dataAt, fxStale ? Number(row.fxRateAt) : null].filter(t => t !== null);
  return { stale, at: times.length ? Math.min(...times) : null, failedSource, fxStale, fromSnapshot: !!row?._fromSnapshot };
}

// Tooltip for a stale row: the exact time and why.
function staleTitleFor({ at, failedSource, fxStale, fromSnapshot }) {
  const when = at ? `Last updated ${new Date(at).toLocaleString(undefined, { timeZone: globalThis.window?.larpTimeZone })}` : 'Age unknown';
  const why = failedSource ? `${sourceLabel(failedSource)} offline`
    : fromSnapshot ? 'saved copy, reloading'
      : fxStale ? 'old FX rate' : '';
  return why ? `${when} · ${why}` : when;
}

// Short name for a source key: "Hyperliquid_0xfc66…" reads "Hyperliquid".
// The combined Bitcoin/Zcash source fails only together with one of its chains, which names it.
const CHAIN_SOURCES = { 'Bitcoin/Zcash_BTC': 'Bitcoin', 'Bitcoin/Zcash_ZEC': 'Zcash', 'Bitcoin/Zcash': '' };

export function sourceLabel(source) {
  return CHAIN_SOURCES[source] ?? String(source || '').replace(/_.*$/, '');
}

/**
 * What the hero says about the figures it sums: failed sources by name, and the oldest stale row.
 * @returns {{ offline: string[], oldestAt: number|null, stale: boolean }}
 */
export function summarizeFreshness(rows, { now = Date.now(), failing = [] } = {}) {
  const offline = [...new Set(failing.map(sourceLabel).filter(Boolean))];
  let stale = offline.length > 0;
  let oldestAt = null;
  const unpriced = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    // A position the user declared that has no price is missing from the total.
    if (row?.quoteUnavailable && isDeclaredPosition(row)) {
      unpriced.push(row.asset);
      stale = true;
    }
    if (!row || !(Math.abs(Number(row.value)) > 0)) continue;
    const f = rowFreshness(row, { now, failing });
    if (!f.stale) continue;
    stale = true;
    if (f.at !== null && (oldestAt === null || f.at < oldestAt)) oldestAt = f.at;
  }
  return { offline, oldestAt, stale, unpriced };
}

// Manual and IBKR rows are positions the user holds on purpose; an unpriced wallet token is
// usually an airdropped spam token.
export function isDeclaredPosition(row) {
  return /^(Manual|IBKR)/.test(String(row?.exchange || ''));
}

// Yahoo's market states, reduced to the label the 24h figure gets. null during regular hours.
export function marketLabel(row) {
  const state = String(row?.marketState || '').toLowerCase();
  if (!state || state === 'regular') return null;
  if (state.startsWith('pre')) return 'pre';
  if (state.startsWith('post')) return 'post';
  return 'closed';
}

// When a quote was made, in ms. Fetchers may give seconds.
function quoteTimeMs(row) {
  const t = Number(row?.quoteTime);
  if (!(t > 0)) return null;
  return t < 1e12 ? t * 1000 : t;
}

// True when the row's 24h figure is a market move from outside the last 24 hours (a closed
// market's last session). Without a quote time, a closed market counts as that.
export function sessionMoveIsOld(row, now = Date.now()) {
  const label = marketLabel(row);
  if (!label) return false;
  const at = quoteTimeMs(row);
  if (at !== null) return now - at > 24 * 60 * 60 * 1000;
  return label === 'closed';
}

// Native coins by chain, as fetchers name the chain. Only these wallet rows are the
// Hyperliquid asset of the same ticker.
const NATIVE_COINS = {
  Ethereum: 'ETH', Arbitrum: 'ETH', Optimism: 'ETH', Base: 'ETH', zkSync: 'ETH', Blast: 'ETH',
  Polygon: 'POL', Avalanche: 'AVAX', BSC: 'BNB', Solana: 'SOL', HyperEVM: 'HYPE',
  Bitcoin: 'BTC', Zcash: 'ZEC'
};
const HL_PRICED_VENUES = new Set(['HL Perps', 'HL Spot', 'HL Staking', 'Lighter', 'Lighter Spot']);

// True when the row's ticker is the coin Hyperliquid quotes under that ticker.
export function isHyperliquidPricedRow(row) {
  if (!row) return false;
  if (HL_PRICED_VENUES.has(row.exchange)) return true;
  if (row.manualType === 'pyth' && (row.category || 'crypto') === 'crypto') return true;
  return NATIVE_COINS[row.exchange] === String(row.asset || '').toUpperCase();
}

// Hash of everything that decides which positions exist. A snapshot taken under different wallets
// or manual positions would show holdings that are no longer tracked, so it is ignored.
function snapshotFingerprint(settings) {
  const text = JSON.stringify([
    settings?.walletAddresses || '',
    settings?.solanaAddresses || '',
    settings?.bitcoinAddresses || '',
    settings?.zcashAddresses || '',
    settings?.cryptoPositions || [],
    settings?.ibkrFlexQueryId || '',
    normalizeBaseCurrency(settings?.portfolioBaseCurrency)
  ]);
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return String(hash >>> 0);
}

function downsampleHistory(history, points) {
  if (!Array.isArray(history) || history.length <= points) return history;
  const step = (history.length - 1) / (points - 1);
  const out = [];
  for (let i = 0; i < points; i++) out.push(history[Math.round(i * step)]);
  return out;
}

function loadPortfolioSnapshot(settings) {
  try {
    const snapshot = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || 'null');
    if (!snapshot || !Array.isArray(snapshot.positions) || snapshot.positions.length === 0) return null;
    if (!(Date.now() - Number(snapshot.savedAt) < SNAPSHOT_MAX_AGE_MS)) return null;
    if (snapshot.fingerprint !== snapshotFingerprint(settings)) return null;
    const savedAt = Number(snapshot.savedAt);
    snapshot.positions.forEach(row => {
      row._stale = true;
      row._fromSnapshot = true;
      // A row that was already old when saved keeps its own time.
      row._goodAt = Number(row._goodAt) > 0 ? Math.min(Number(row._goodAt), savedAt) : savedAt;
    });
    return snapshot;
  } catch (_) {
    return null;
  }
}

/**
 * One row for several holdings of one ticker (several wallets or venues, or different tokens
 * that share a ticker). Every item has a value of 0 or more. Totals match the rows unmerged:
 * - change24h is the move that gives the same 24h amount as the items, item by item;
 * - pnl sums the items that have one, and pnlValue (only when some lack it) is their value,
 *   the base for the P&L %.
 */
export function mergeRows(asset, items) {
  const totalAmount = items.reduce((sum, p) => sum + (p.amount || 0), 0);
  const totalValue = items.reduce((sum, p) => sum + (p.value || 0), 0);
  const knownPnL = items.filter(p => p.pnl != null && Number.isFinite(Number(p.pnl)));
  const totalPnL = knownPnL.length > 0 ? knownPnL.reduce((sum, p) => sum + Number(p.pnl), 0) : null;
  const weightedPrice = totalAmount !== 0 ? totalValue / Math.abs(totalAmount) : 0;
  const exchanges = [...new Set(items.map(p => p.exchange))];

  // calculatePortfolioBreakdown takes value × pct / (100 + pct) as an item's 24h amount.
  let change = 0;
  let hasChange = false;
  for (const p of items) {
    const pct = Number(p.change24h);
    if (p.change24h == null || !Number.isFinite(pct) || pct <= -100) continue;
    change += (Number(p.value) || 0) * (pct / (100 + pct));
    hasChange = true;
  }
  const change24h = hasChange && totalValue - change > 0 ? (100 * change) / (totalValue - change) : null;

  const priceHistory = items.find(p => p.priceHistory)?.priceHistory || null;
  const sources = [...new Set(items.map(p => p._source).filter(Boolean))];
  const currencies = new Set(items.map(p => p.sourceCurrency || p.currency));
  const knownSourcePnL = items.filter(p => p.sourcePnl != null && Number.isFinite(Number(p.sourcePnl)));
  const dataTimes = items.map(p => Number(p.dataAt)).filter(t => t > 0);
  const fxTimes = items.map(p => p.fxRateAt).filter(t => t != null).map(Number);
  // If multiple exchanges, use the asset name itself as the exchange for stable keying
  const exchangeKey = exchanges.length > 1 ? asset : exchanges[0];

  return {
    asset,
    exchange: exchanges.length > 1 ? 'Multiple' : exchanges[0],
    _changeDetectionKey: `${asset}_${exchangeKey}`, // Stable key for change detection
    amount: totalAmount,
    value: totalValue,
    price: weightedPrice,
    change24h,
    pnl: totalPnL,
    pnlValue: totalPnL !== null && knownPnL.length < items.length
      ? knownPnL.reduce((sum, p) => sum + (Number(p.value) || 0), 0)
      : undefined,
    priceHistory,
    _source: sources.length === 1 ? sources[0] : undefined,
    _sources: sources,
    sourcePnl: currencies.size === 1 && knownSourcePnL.length === knownPnL.length && knownPnL.length > 0
      ? knownSourcePnL.reduce((sum, p) => sum + Number(p.sourcePnl), 0)
      : undefined,
    entryIsEstimate: items.some(p => p.entryIsEstimate) || undefined,
    _fromSnapshot: items.some(p => p._fromSnapshot) || undefined,
    dataAt: dataTimes.length ? Math.min(...dataTimes) : null,
    fxRateAt: fxTimes.length ? Math.min(...fxTimes) : null,
    isAggregated: true
  };
}

export class IncrementalPortfolioRenderer {
  constructor({ providers, settings, containers, ui, expectedProviders = [], initialPositions = null }) {
    this.providers = providers;
    this.settings = settings;
    this.containers = containers; // { positionsBody, mobileContainer, summaryEl }
    this.ui = ui; // { HeroUI, PositionsUI }

    // Accumulated state - use cached positions if available to prevent flicker on refresh
    // This allows the UI to show existing data while fresh data is being fetched
    this.allPositions = initialPositions || window.cachedPositions || [];
    this.providerStatus = new Map(); // track which providers finished
    this.providerErrors = new Map();
    this.providerDoneAt = new Map(); // when each source last loaded; kept across refreshes
    // Sources whose last report failed; kept across refreshes until they report again.
    this.providerFailing = new Set();
    this._roundDoneAt = null;
    this.renderDebounce = null;
    // If we have initial positions, we're not really "loading" - just refreshing in background
    this.isLoading = this.allPositions.length === 0;
    this.expectedProviders = expectedProviders; // List of provider names we're waiting for
    // Preserve previous render data from last renderer instance for smooth transitions
    // This prevents flickering when tab visibility changes or portfolio refreshes
    this.previousRenderData = window._previousRenderData || [];
    this.renderCount = 0; // Track render calls for performance monitoring
    this.isRendering = false; // Lock to prevent concurrent renders
    this.pendingRender = false; // Flag to schedule another render after current completes

    // Memoization: aggregation + totals are pure over `allPositions`. A token bumped whenever
    // positions change lets filter-only renders (hide-small, edit mode, amount visibility) reuse
    // prior work instead of rebuilding Maps and re-summing every time.
    this._positionsToken = 0;
    this._cachedAggregation = null;
    this._cachedAggregationToken = -1;
    this._cachedTotals = null;
    this._cachedTotalsToken = -1;
    this._fxRatesToken = 0;
    this._fxRatesBase = null;
    this._fxRates = new Map();
    this._fxFetchedAt = new Map(); // currency -> when its rate was fetched (0: unknown)
    this._fxRatesLoading = new Set();
    // currency -> time of the last attempt, so stale rates refresh and failed ones retry.
    this._fxCheckedAt = new Map();

    // Nothing in memory yet (fresh page load): start from the last saved portfolio, if it still
    // matches the configured wallets and positions.
    if (!initialPositions && this.allPositions.length === 0) {
      const snapshot = loadPortfolioSnapshot(settings);
      if (snapshot) {
        this.allPositions = snapshot.positions;
        const base = this.getBaseCurrency();
        if (snapshot.baseCurrency === base && Array.isArray(snapshot.fxRates)) {
          this._fxRatesBase = base;
          this.setFxRatesFromCache(base);
          // The FX cache is saved on every lookup, so the snapshot's rates only fill gaps.
          for (const [currency, rate] of snapshot.fxRates) {
            if (Number(rate) > 0 && !this._fxRates.has(currency)) {
              this._fxRates.set(currency, Number(rate));
              this._fxFetchedAt.set(currency, Number(snapshot.savedAt) || 0);
            }
          }
        }
        this.isLoading = false;
      }
    }
    this._snapshotSaveTimer = null;
    this._staleCarry = new Map(); // row key -> { priceHistory } from the snapshot

    // Store reference to renderer IMMEDIATELY for external re-renders
    window._portfolioRenderer = this;

    // Only show loader if we don't have initial positions
    if (this.isLoading) {
      this.showGreetingLoader();
    }

    // Safety timeout: force hide loader after 10 seconds no matter what
    this.safetyTimeout = setTimeout(() => {
      if (this.isLoading) {
        this.hideGreetingLoader();
      }
    }, 10000);

    // If we have initial positions, render them immediately
    if (this.allPositions.length > 0) {
      this.render();
    }
  }

  /**
   * Show mini loader in greeting while loading
   */
  showGreetingLoader() {
    const greeting = document.getElementById('newGreeting');
    if (!greeting) return;

    // Check if a spinner already exists (prevent duplicates)
    if (document.getElementById('greetingLoader') || greeting.querySelector('span[style*="marginLeft"]')) {
      return;
    }

    // Pick a random spinner each time
    const { frames, interval } = getRandomSpinner();
    let currentFrame = 0;

    // Create loader span
    const loader = document.createElement('span');
    loader.id = 'greetingLoader';
    loader.style.marginLeft = '8px';
    loader.style.color = 'var(--accent)';
    loader.textContent = frames[0];

    // Animate the spinner
    this.spinnerInterval = setInterval(() => {
      currentFrame = (currentFrame + 1) % frames.length;
      if (loader.parentElement) {
        loader.textContent = frames[currentFrame];
      }
    }, interval);

    greeting.appendChild(loader);
  }

  /**
   * Hide loader in greeting
   */
  hideGreetingLoader() {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }

    if (this.safetyTimeout) {
      clearTimeout(this.safetyTimeout);
      this.safetyTimeout = null;
    }

    const loader = document.getElementById('greetingLoader');
    if (loader) {
      loader.remove();
    }

    // Also remove hero loading animation
    const summaryEl = document.getElementById('newSummary');
    if (summaryEl) {
      summaryEl.classList.remove('fading');
    }

    this.isLoading = false;
  }

  /**
   * Start a hard refresh: reset every source's status and reload its rows
   */
  clearPositions() {
    // The rows stay on screen while they reload, as after a snapshot: each is replaced when its
    // source reports, and dropped once every source has reported if it no longer exists.
    this.allPositions.forEach(row => { row._stale = true; });
    this._staleCarry.clear();
    this._positionsToken++;
    this.providerStatus.clear();
    this.providerErrors.clear();
    this.isLoading = true;
    this.showGreetingLoader();
    this.render();
  }

  /**
   * Remove positions matching a predicate
   * @param {Function} predicate - Function that returns true for positions to remove
   */
  removePositions(predicate) {
    if (typeof predicate !== 'function') return;
    const before = this.allPositions.length;
    this.allPositions = this.allPositions.filter(p => !predicate(p));
    if (this.allPositions.length !== before) {
      this._positionsToken++;
      this.render();
    }
  }

  /**
   * Append new positions and re-render immediately
   * When refreshing, removes old positions from the same source to prevent duplicates
   */
  /**
   * Drop saved-snapshot rows that `source` is now reporting fresh data for. A fresh row that has
   * no sparkline yet, or whose quote is still loading, keeps the last known values meanwhile so
   * charts and totals don't blink out while enrichment requests finish. A partial update (one
   * that doesn't mark the source completed) only replaces the rows it carries.
   */
  dropStaleRows(source, newRows, { partial = false } = {}) {
    if (!this.allPositions.some(p => p._stale && p._source === source)) return false;
    const keyOf = p => p._changeDetectionKey || `${p.asset}_${p.exchange}`;
    const newKeys = partial ? new Set(newRows.map(keyOf)) : null;
    const staleByKey = new Map();
    this.allPositions = this.allPositions.filter(p => {
      if (!(p._stale && p._source === source)) return true;
      if (newKeys && !newKeys.has(keyOf(p))) return true;
      staleByKey.set(keyOf(p), p);
      return false;
    });
    if (staleByKey.size === 0) return false;
    for (const row of newRows) {
      const stale = staleByKey.get(keyOf(row));
      if (!stale) continue;
      // Kept on the side, not copied onto the row: fetchers skip enrichment for rows that already
      // have a sparkline, so copying would freeze a days-old chart in place.
      // The sparkline only: a carried 24h move could be days old and would count in Today.
      this._staleCarry.set(keyOf(row), { priceHistory: stale.priceHistory });
      if (row.quoteLoading && Number(stale.value) > 0) {
        // The old figures stand in while the quote loads, marked as old as they are.
        Object.assign(row, {
          price: stale.price,
          value: stale.value,
          pnl: stale.pnl,
          change24h: null,
          currency: row.currency || stale.currency,
          quoteLoading: false,
          _goodAt: stale._goodAt,
          _fromSnapshot: stale._fromSnapshot
        });
      }
    }
    this._positionsToken++;
    return true;
  }

  /**
   * Once every provider has reported, any snapshot rows left belong to holdings that no longer
   * exist. Rows from providers that failed this round are kept: last known beats missing.
   */
  purgeStaleRows() {
    const failed = [];
    for (const [provider, status] of this.providerStatus.entries()) {
      if (status === 'failed') failed.push(provider);
    }
    const before = this.allPositions.length;
    this.allPositions = this.allPositions.filter(p => {
      if (!p._stale) return true;
      const src = String(p._source || '');
      return failed.some(name => src === name || src.startsWith(`${name}_`));
    });
    if (this.allPositions.length !== before) {
      this._positionsToken++;
      this.forceRender();
    }
  }

  scheduleSnapshotSave() {
    clearTimeout(this._snapshotSaveTimer);
    this._snapshotSaveTimer = setTimeout(() => {
      if (this.isLoading || this.allPositions.length === 0) return;
      try {
        const base = this.getBaseCurrency();
        // Sparklines only for rows big enough to be listed; dust rows still count toward totals.
        const minThreshold = this.settings?.minBalanceThreshold || 100;
        const positions = this.allPositions.map(row => {
          const { _stale, _fromSnapshot, isHiddenPosition, isManuallyHidden, ...rest } = row;
          if (rest.priceHistory) {
            rest.priceHistory = Math.abs(Number(rest.value) || 0) >= minThreshold
              ? downsampleHistory(rest.priceHistory, SNAPSHOT_HISTORY_POINTS)
              : undefined;
          }
          return rest;
        });
        localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({
          savedAt: Date.now(),
          fingerprint: snapshotFingerprint(this.settings),
          baseCurrency: base,
          fxRates: this._fxRatesBase === base ? Array.from(this._fxRates.entries()) : [],
          positions
        }));
      } catch (_) { /* storage full or unavailable: next load simply starts empty */ }
    }, SNAPSHOT_SAVE_DELAY_MS);
  }

  appendPositions(newRows, source, options = {}) {
    const markCompleted = options.markCompleted !== false;
    const now = Date.now();
    if (Array.isArray(newRows)) {
      for (const row of newRows) {
        row._source = source;
        // When the row's figures were last good: the fetcher's asOf when it has older data.
        row._goodAt = Number(row.asOf) > 0 ? Math.min(Number(row.asOf), now) : now;
        delete row._fromSnapshot;
      }
    }
    const droppedStale = this.dropStaleRows(source, Array.isArray(newRows) ? newRows : [], { partial: !markCompleted });
    if (!Array.isArray(newRows) || newRows.length === 0) {
      // A complete report with no rows means the source holds nothing now.
      const before = this.allPositions.length;
      if (markCompleted) this.allPositions = this.allPositions.filter(p => p._source !== source);
      if (this.allPositions.length !== before) this._positionsToken++;
      if (droppedStale || this.allPositions.length !== before) this.forceRender();
      if (markCompleted) {
        this.providerStatus.set(source, 'completed');
        this.providerErrors.delete(source);
        this.providerDoneAt.set(source, now);
        this.providerFailing.delete(source);
        this.checkIfAllProvidersFinished();
      }
      this.renderProviderStatus();
      return;
    }

    const lengthBefore = this.allPositions.length;

    // If a removeFilter is provided, use it to remove specific old positions
    // This is useful for refreshing specific wallets/providers without clearing everything
    if (options.removeFilter && typeof options.removeFilter === 'function') {
      try {
        this.allPositions = this.allPositions.filter(p => {
          try {
            return !options.removeFilter(p);
          } catch (e) {
            console.warn('[Portfolio] removeFilter error:', e);
            return true; // Keep position if filter fails
          }
        });
      } catch (e) {
        console.error('[Portfolio] Failed to apply removeFilter:', e);
      }
    }
    // Otherwise a source's rows are replaced by its new report: all of them for a complete report
    // (closed positions disappear), only the matching ones for a partial one. This used to depend
    // on providerStatus, which beginRefresh() clears, so every 30s refresh appended a full extra
    // copy of each source's rows (hidden by aggregation, but allPositions grew without bound).
    else {
      const keyOf = r => r._changeDetectionKey || `${r.asset}_${r.exchange}`;
      const newKeys = new Set(newRows.map(keyOf));
      this.allPositions = this.allPositions.filter(p => {
        if (p._source === source) return !markCompleted && !newKeys.has(keyOf(p));
        // Rows without a source predate source tagging; keep the old replace-by-key behavior.
        return p._source || !newKeys.has(keyOf(p));
      });
    }

    if (this.allPositions.length !== lengthBefore) this._positionsToken++;

    this.allPositions.push(...newRows);
    this._positionsToken++;
    this.providerErrors.delete(source);
    if (markCompleted) {
      this.providerStatus.set(source, 'completed');
      this.providerDoneAt.set(source, now);
      this.providerFailing.delete(source);

      // Check if all providers finished
      this.checkIfAllProvidersFinished();
    }
    const fxPromise = this.loadFxRatesForPositions(newRows);

    // Debouncing tuned for streaming providers: render first batch quickly, coalesce the rest.
    // Prior value (250ms) added ~750ms to first paint with 3 providers. 80ms feels instant while
    // still batching the common "multiple providers return within one tick" case.
    const debounceDelay = this.renderCount === 0 ? 16 : 80;
    const scheduleRender = () => {
      clearTimeout(this.renderDebounce);
      this.renderDebounce = setTimeout(() => this.render(), debounceDelay);
    };
    if (fxPromise) {
      fxPromise.finally(scheduleRender);
    } else {
      scheduleRender();
    }
    this.renderProviderStatus();
  }

  /**
   * Mark provider as failed (render what we have so far)
   */
  markProviderFailed(source, error) {
    console.warn(`[${source}] Failed:`, error?.message || error);
    this.providerStatus.set(source, 'failed');
    this.providerErrors.set(source, error?.message || String(error || 'Unknown error'));
    this.providerFailing.add(source);
    this.checkIfAllProvidersFinished();
    if (!this.isLoading) this.updateLastUpdatedLabel();
    this.renderProviderStatus();
    this.forceRender();
  }

  updateLastUpdatedLabel(state = 'updated') {
    const el = this.containers?.lastUpdatedEl || document.getElementById('lastUpdateTimestamp');
    if (!el) return;
    el.dataset.state = state;
    // A braille spinner while checking, a tick when done
    let mark = el.querySelector('.last-update-mark');
    let label = el.querySelector('.last-update-label');
    if (!mark) {
      el.textContent = '';
      mark = document.createElement('span');
      mark.className = 'last-update-mark';
      mark.setAttribute('aria-hidden', 'true');
      label = document.createElement('span');
      label.className = 'last-update-label';
      el.append(mark, label);
    }
    clearInterval(this.lastUpdatedSpinner);
    if (state === 'refreshing') {
      const frames = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
      let i = 0;
      mark.textContent = frames[0];
      if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        this.lastUpdatedSpinner = setInterval(() => {
          mark.textContent = frames[++i % frames.length];
        }, 80);
      }
      label.textContent = 'Checking';
      return;
    }
    const updatedAt = new Date(this._roundDoneAt || Date.now());
    // 24-hour, like the clock on the portfolio card
    const time = updatedAt.toLocaleTimeString('en-GB', {
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: window.larpTimeZone
    });
    // A tick only when no source is failing. Same set as the hero, which also holds FX
    // between its retries.
    const failed = [...new Set(Array.from(this.providerFailing, sourceLabel).filter(Boolean))];
    el.dataset.state = failed.length ? 'failed' : state;
    mark.textContent = failed.length ? '×' : '✓';
    label.textContent = failed.length ? `Updated ${time} · ${failed.length} failed` : `Updated ${time}`;
    const when = updatedAt.toLocaleString(undefined, { timeZone: window.larpTimeZone });
    el.title = failed.length ? `${when}\nFailed: ${failed.join(', ')}` : when;
  }

  beginRefresh(expectedProviders = this.expectedProviders) {
    this.expectedProviders = Array.from(new Set(expectedProviders || []));
    // A source no longer configured (wallet removed, Zerion swapped for Cielo) can't report
    // again, so it must not stay "offline".
    const expected = new Set(this.expectedProviders.map(name => name.replace(/_.*$/, '')));
    for (const source of this.providerFailing) {
      if (source !== 'FX' && !expected.has(source.replace(/_.*$/, ''))) this.providerFailing.delete(source);
    }
    this.providerStatus.clear();
    this.providerErrors.clear();
    this.isLoading = true;
    this.showGreetingLoader();
    this.updateLastUpdatedLabel('refreshing');
    this.renderProviderStatus();
  }

  getBaseCurrency() {
    return normalizeBaseCurrency(this.settings?.portfolioBaseCurrency);
  }

  resetFxRatesIfNeeded() {
    const base = this.getBaseCurrency();
    if (this._fxRatesBase === base) return;
    this._fxRatesBase = base;
    this.setFxRatesFromCache(base);
    this._fxRatesLoading.clear();
    this._fxCheckedAt.clear();
    this._fxRatesToken++;
  }

  setFxRatesFromCache(base) {
    const cached = loadFxCache(base);
    this._fxRates = new Map([...cached.map(([currency, rate]) => [currency, rate]), [base, 1]]);
    this._fxFetchedAt = new Map(cached.map(([currency, , at]) => [currency, at]));
  }

  localConversionRate(currency) {
    const base = this.getBaseCurrency();
    const normalized = normalizeCurrencyCode(currency, 'USD');
    const fxCurrency = getFxCurrency(normalized);
    if (fxCurrency === base) return getQuoteUnitScale(normalized);
    return null;
  }

  conversionRateFor(currency) {
    this.resetFxRatesIfNeeded();
    const normalized = normalizeCurrencyCode(currency, 'USD');
    const localRate = this.localConversionRate(normalized);
    if (Number.isFinite(localRate)) return localRate;
    const rate = Number(this._fxRates.get(normalized));
    return Number.isFinite(rate) && rate > 0 ? rate : null;
  }

  currenciesNeedingFx(positions) {
    this.resetFxRatesIfNeeded();
    const missing = new Set();
    const now = Date.now();
    for (const position of Array.isArray(positions) ? positions : []) {
      const currency = normalizeCurrencyCode(position?.currency || position?.sourceCurrency || 'USD', 'USD');
      if (this.localConversionRate(currency) !== null) continue;
      if (this._fxRatesLoading.has(currency)) continue;
      const age = now - (this._fxCheckedAt.get(currency) || 0);
      if (age < (Number(this._fxRates.get(currency)) > 0 ? FX_REFRESH_MS : FX_RETRY_MS)) continue;
      missing.add(currency);
    }
    return Array.from(missing);
  }

  fxCurrenciesInUse() {
    const used = new Set();
    for (const position of this.allPositions) {
      const currency = normalizeCurrencyCode(position?.currency || position?.sourceCurrency || 'USD', 'USD');
      if (this.localConversionRate(currency) === null) used.add(currency);
    }
    return Array.from(used);
  }

  loadFxRatesForPositions(positions) {
    const missing = this.currenciesNeedingFx(positions);
    if (missing.length === 0) return null;
    const base = this.getBaseCurrency();
    missing.forEach(currency => {
      this._fxRatesLoading.add(currency);
      this._fxCheckedAt.set(currency, Date.now());
    });

    return (async () => {
      let error = null;
      try {
        const rates = await this.providers?.stocks?.getFxRates?.(missing, base, { timeoutMs: 5000 });
        const fetchedAt = Date.now();
        let updated = false;
        for (const currency of missing) {
          const rate = Number(rates?.[currency]);
          if (Number.isFinite(rate) && rate > 0) {
            this._fxRates.set(currency, rate);
            this._fxFetchedAt.set(currency, fetchedAt);
            updated = true;
          }
        }
        if (updated) saveFxCache(base, this._fxRates, this._fxFetchedAt);
      } catch (e) {
        error = e;
      } finally {
        // A failed lookup keeps the last good rate, shown as stale once it is FX_STALE_MS old;
        // a currency with no rate at all retries after FX_RETRY_MS.
        // Judge every currency the positions use: a later lookup for GBP must not clear a missing EUR.
        const now = Date.now();
        const inUse = this.fxCurrenciesInUse();
        const unresolved = inUse.filter(currency => !(Number(this._fxRates.get(currency)) > 0));
        const old = inUse.filter(currency => !unresolved.includes(currency) &&
          !(now - (this._fxFetchedAt.get(currency) || 0) <= FX_STALE_MS));
        if (unresolved.length > 0 || old.length > 0) {
          this.providerStatus.set('FX', 'failed');
          this.providerFailing.add('FX');
          this.providerErrors.set('FX', unresolved.length > 0
            ? (error?.message || `missing ${unresolved.join(', ')} rate`)
            : `${old.join(', ')} rate ${ageText(Math.min(...old.map(c => this._fxFetchedAt.get(c) || 0)), now)}`);
        } else {
          this.providerStatus.set('FX', 'completed');
          this.providerFailing.delete('FX');
          this.providerErrors.delete('FX');
        }
        if (!this.isLoading) this.updateLastUpdatedLabel();
        missing.forEach(currency => this._fxRatesLoading.delete(currency));
        this._fxRatesToken++;
        this.renderProviderStatus();
        this.forceRender();
      }
    })();
  }

  convertPositionToBase(position) {
    const baseCurrency = this.getBaseCurrency();
    const sourceCurrency = normalizeCurrencyCode(position?.currency || position?.sourceCurrency || 'USD', 'USD');
    const rate = this.conversionRateFor(sourceCurrency);
    const sourcePrice = Number(position?.sourcePrice ?? position?.price ?? 0);
    const sourceValue = Number(position?.sourceValue ?? position?.value ?? 0);
    const sourcePnl = position?.sourcePnl ?? position?.pnl;
    const sourceFunding = position?.sourceFunding ?? position?.funding;
    const hasRate = Number.isFinite(rate) && rate > 0;

    const carry = this._staleCarry.size > 0
      ? this._staleCarry.get(position?._changeDetectionKey || `${position?.asset}_${position?.exchange}`)
      : null;
    const needsFx = this.localConversionRate(sourceCurrency) === null;
    // A closed market's last session is not today's move: shown as such, left out of Today.
    const oldSession = sessionMoveIsOld(position);

    return {
      ...position,
      priceHistory: position?.priceHistory || carry?.priceHistory,
      change24h: oldSession ? null : (position?.change24h ?? null),
      sessionChange24h: oldSession ? (position?.change24h ?? null) : undefined,
      marketLabel: marketLabel(position),
      dataAt: Number(position?._goodAt) > 0 ? Number(position._goodAt) : null,
      fxRateAt: needsFx && hasRate ? (this._fxFetchedAt.get(sourceCurrency) || 0) : null,
      price: sourcePrice,
      sourcePrice,
      sourceValue,
      sourcePnl,
      sourceFunding,
      sourceCurrency,
      currency: sourceCurrency,
      baseCurrency,
      fxRate: hasRate ? rate : null,
      fxConversionMissing: !hasRate,
      value: hasRate && Number.isFinite(sourceValue) ? sourceValue * rate : 0,
      // Number(null) is 0, so check for null first: unknown P&L/funding must stay unknown, not $0.
      pnl: hasRate && sourcePnl != null && Number.isFinite(Number(sourcePnl)) ? Number(sourcePnl) * rate : null,
      funding: hasRate && sourceFunding != null && Number.isFinite(Number(sourceFunding)) ? Number(sourceFunding) * rate : sourceFunding
    };
  }

  convertPositionsToBase(positions) {
    this.loadFxRatesForPositions(positions);
    return (Array.isArray(positions) ? positions : []).map(position => this.convertPositionToBase(position));
  }

  // The footer: a telemetry readout, one source per line. Each line is a lamp, the source,
  // its wallet, a dotted leader and the time it last loaded. A spinner while a source loads
  // for the first time; a red blinking lamp with the reason and a Retry chip when it failed.
  // A source that loaded before keeps its lamp during the next refresh, so the footer doesn't
  // flicker every 30 seconds. The head line counts the sources that are online.
  renderProviderStatus() {
    const el = this.containers?.providerStatusEl || document.getElementById('newProviderStatus');
    if (!el) return;

    const names = Array.from(new Set([...(this.expectedProviders || []), ...this.providerStatus.keys()]));
    // One wallet's source is "Hyperliquid_0x…": split it into "Hyperliquid" and "0xfc66…ca06"
    const split = (provider) => {
      const m = provider.match(/^(.*)_(\w{6})\w+(\w{4})$/);
      return m ? [m[1], `${m[2]}…${m[3]}`] : [provider, ''];
    };
    // Group a source's wallets together; FX and the other shared sources keep their place.
    const order = new Map(names.map((n, i) => [split(n)[0], i]));
    names.sort((a, b) => {
      const [na, wa] = split(a), [nb, wb] = split(b);
      return (order.get(na) - order.get(nb)) || wa.localeCompare(wb);
    });
    const time = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: window.larpTimeZone });
    const cells = (provider) => {
      const [name, wallet] = split(provider);
      return `<span class="provider-line__name">${escapeHtml(name)}</span>` +
        `<span class="provider-line__wallet">${escapeHtml(wallet)}</span><span class="provider-line__leader" aria-hidden="true"></span>`;
    };
    let failed = 0;
    let pending = 0;
    let online = 0;
    const rows = names.map(provider => {
      const status = this.providerStatus.get(provider);
      const doneAt = this.providerDoneAt.get(provider);
      if (status === 'failed') {
        failed++;
        const message = this.providerErrors.get(provider);
        return `<span class="provider-line is-failed"><span class="provider-line__mark" aria-label="Failed"></span>${cells(provider)}` +
          '<span class="provider-line__note">Offline</span>' +
          (message ? `<span class="provider-line__error">${escapeHtml(message)}</span>` : '') +
          '<button type="button" class="chip provider-line__retry"><kbd aria-hidden="true">R</kbd><span class="chip__label">Retry</span></button></span>';
      }
      if (status === 'completed' || doneAt) {
        online++;
        return `<span class="provider-line"><span class="provider-line__mark" aria-label="Online"></span>${cells(provider)}` +
          `<span class="provider-line__note">${doneAt ? time(doneAt) : 'OK'}</span></span>`;
      }
      if (!this.isLoading) return '';
      pending++;
      return `<span class="provider-line is-loading"><span class="provider-line__mark loading-terminal" aria-label="Loading"></span>${cells(provider)}` +
        '<span class="provider-line__note">…</span></span>';
    }).join('');
    const total = online + failed + pending;
    const lines = rows && `<span class="provider-head"><span>Sources</span><span class="provider-head__count">` +
      `${online}/${total} online</span></span>` + rows;

    if (!lines) {
      el.hidden = true;
      el.innerHTML = '';
      delete el.dataset.state;
      return;
    }

    el.hidden = false;
    el.dataset.state = failed ? 'failed' : pending ? 'loading' : 'done';
    // Same lines: leave them, so the spinners keep turning instead of starting over.
    if (el.innerHTML !== lines) el.innerHTML = lines;
  }

  /**
   * Check if all expected providers have finished (completed or failed)
   */
  checkIfAllProvidersFinished() {
    if (!this.isLoading) return;

    // If no expected providers specified, hide after first data
    if (this.expectedProviders.length === 0) {
      if (this.allPositions.length > 0) {
        this._roundDoneAt = Date.now();
        this.hideGreetingLoader();
        this.updateLastUpdatedLabel();
      }
      return;
    }

    // Check if all expected providers have reported in
    const finished = [];
    const pending = [];

    for (const provider of this.expectedProviders) {
      if (this.providerStatus.has(provider)) {
        finished.push(provider);
      } else {
        pending.push(provider);
      }
    }

    const allFinished = pending.length === 0;

    if (allFinished) {
      this._roundDoneAt = Date.now();
      this.purgeStaleRows();
      this.hideGreetingLoader();
      this.updateLastUpdatedLabel();
      if (this.allPositions.length === 0) this.render(); // Loading becomes No positions
      // Trigger Pyth enrichment for positions missing 24h change
      this.enrichMissing24hWithPyth();
    }
  }

  /**
   * Enrich positions missing 24h change using Pyth historical prices
   */
  async enrichMissing24hWithPyth() {
    // Find positions missing 24h change. Lookups go by bare ticker, so only rows whose ticker is
    // that coin qualify: Hyperliquid and Lighter rows, native coins, manual crypto. A wallet token
    // or a stock with the same ticker is another asset.
    const needsEnrichment = this.allPositions.filter(p =>
      (p.change24h === null || p.change24h === undefined) && isHyperliquidPricedRow(p)
    );

    if (needsEnrichment.length === 0) return;

    try {
      // Keyless path: Hyperliquid's prevDayPx by symbol, no feed-id lookup needed.
      if (this.providers?.pyth?.getDayAgoPricesBySymbol) {
        const dayAgo = await this.providers.pyth.getDayAgoPricesBySymbol(needsEnrichment.map(p => p.asset));
        let updated = false;
        for (const pos of needsEnrichment) {
          const price24hAgo = dayAgo[String(pos.asset || '').toUpperCase()];
          if (price24hAgo > 0 && pos.price > 0) {
            pos.change24h = ((pos.price - price24hAgo) / price24hAgo) * 100;
            updated = true;
          }
        }
        if (updated) {
          this._positionsToken++; // mutated change24h in place, invalidate aggregation/totals cache
          this.render();
        }
        return;
      }

      // Get Pyth feed map
      const feedMap = await this.providers?.pyth?.getPriceFeeds?.();
      if (!feedMap) return;

      // Map asset symbols to feed IDs
      const symbolToFeedId = {};
      for (const [symbol, id] of Object.entries(feedMap)) {
        symbolToFeedId[symbol.toUpperCase()] = id;
      }

      // Find positions that have matching Pyth feeds
      const positionsWithFeeds = [];
      for (const pos of needsEnrichment) {
        const feedId = symbolToFeedId[pos.asset?.toUpperCase()];
        if (feedId) {
          positionsWithFeeds.push({ pos, feedId });
        }
      }

      if (positionsWithFeeds.length === 0) return;

      // Get 24h ago timestamp
      const ts24hAgo = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);

      // Fetch historical prices from Pyth
      const feedIds = positionsWithFeeds.map(p => p.feedId);
      const historicalPrices = await this.providers?.pyth?.getAtTimestampByFeedIds?.(feedIds, ts24hAgo, 10000);

      if (!historicalPrices) return;

      let updated = false;
      for (const { pos, feedId } of positionsWithFeeds) {
        const normalizedFeedId = feedId.toLowerCase().startsWith('0x') ? feedId.toLowerCase() : `0x${feedId.toLowerCase()}`;
        const price24hAgo = historicalPrices[normalizedFeedId];

        if (price24hAgo && price24hAgo > 0 && pos.price && pos.price > 0) {
          pos.change24h = ((pos.price - price24hAgo) / price24hAgo) * 100;
          updated = true;
        }
      }

      // Re-render if we updated any positions
      if (updated) {
        this._positionsToken++; // mutated change24h in place, invalidate aggregation/totals cache
        this.render();
      }
    } catch (e) {
      console.warn('[Portfolio] Pyth 24h enrichment failed:', e);
    }
  }


  /**
   * Re-render positions table and hero with current data
   * Uses a render lock to prevent concurrent renders that cause flickering
   */
  render() {
    // If a render is in progress, mark that we need another render when it completes
    if (this.isRendering) {
      this.pendingRender = true;
      return;
    }

    this.isRendering = true;
    this.renderCount++;
    this.renderProviderStatus();
    const { PositionsUI, HeroUI } = this.ui;
    const { positionsBody, mobileContainer, summaryEl } = this.containers;

    if (this.allPositions.length === 0) {
      // While sources load, say so; once they have all answered, there is nothing.
      if (positionsBody) {
        positionsBody.innerHTML = `<tr><td colspan="9" class="loading">${this.isLoading ? 'Loading positions…' : 'No positions.'}</td></tr>`;
        const count = positionsBody.closest('section')?.querySelector('.panel-count');
        if (count) count.textContent = '';
      }
      if (summaryEl) {
        summaryEl.innerHTML = this.isLoading ? 'Loading portfolio…' : 'Your portfolio is empty.';
      }
      this.isRendering = false;
      return;
    }

    // Aggregate + totals are memoized on the positions token. Toggle-driven renders
    // (hide amounts, edit mode, small-position filter) reuse the cached result.
    let sorted;
    const baseCurrency = this.getBaseCurrency();
    const aggregationToken = `${this._positionsToken}:${this._fxRatesToken}:${baseCurrency}`;
    if (this._cachedAggregationToken === aggregationToken && this._cachedAggregation) {
      sorted = this._cachedAggregation;
    } else {
      const converted = this.convertPositionsToBase(this.allPositions);
      const aggregated = this.aggregatePositions(converted);
      sorted = aggregated.sort((a, b) => (b.value || 0) - (a.value || 0));
      this._cachedAggregation = sorted;
      // Before merging by asset, so each row still names its venue (the Account window).
      this._cachedConverted = converted;
      this._cachedAggregationToken = aggregationToken;
    }

    let totals;
    if (this._cachedTotalsToken === aggregationToken && this._cachedTotals) {
      totals = this._cachedTotals;
    } else {
      totals = { ...this.calculateTotals(sorted), ...calculatePortfolioBreakdown(sorted) };
      this._cachedTotals = totals;
      this._cachedTotalsToken = aggregationToken;
    }
    const { totalValue, totalPnL, totalPnLPercent, allocation, change24h, change24hPercent } = totals;

    // Freshness changes with time and source status, so it is worked out on every render.
    const now = Date.now();
    const failing = Array.from(this.providerFailing);
    for (const p of sorted) {
      const f = rowFreshness(p, { now, failing });
      p.isStale = f.stale;
      p.staleAt = f.stale ? f.at : null;
      p.staleNote = f.stale ? ageText(f.at, now) : '';
      p.staleTitle = f.stale ? staleTitleFor(f, now) : '';
    }
    const freshness = summarizeFreshness(sorted, { now, failing });

    // Filter for display (hide special positions + apply filters)
    // Edit mode: shows manually hidden positions (for editing), but NOT <$100 positions
    // Normal mode: hides both unless showHiddenPositions is true
    const hideSmallPositions = window.hideSmallPositions ?? true;
    const showHiddenPositions = window.showHiddenPositions ?? false;
    const editMode = window.editMode ?? false;
    const minThreshold = this.settings.minBalanceThreshold || 100;
    const hiddenAssets = window.hiddenAssets || new Set();

    let anyHidden = false;
    const visible = sorted.filter(p => {
      // Hide special tracking positions always
      if (p.isHlAccountEquity || p.isLighterAccountEquity) return false;

      const assetKey = `${p.asset}_${p.exchange}`;
      const isManuallyHidden = hiddenAssets.has(assetKey);
      // Declared positions without a price stay visible: hiding them would make the holding
      // silently vanish. Unpriced wallet tokens are hidden like dust.
      const keepUnpriced = p.quoteUnavailable && isDeclaredPosition(p);
      const isSmall = !p.fxConversionMissing && !p.quoteLoading && !keepUnpriced && hideSmallPositions && Math.abs(p.value || 0) < minThreshold;

      // Clear flags first
      p.isHiddenPosition = false;
      p.isManuallyHidden = false;

      if (isManuallyHidden || isSmall) anyHidden = true;

      // Handle manually hidden positions
      if (isManuallyHidden) {
        if (editMode || showHiddenPositions) {
          // Show in edit mode (or when showing hidden)
          p.isHiddenPosition = true;
          p.isManuallyHidden = true; // Flag for [+] button
          return true;
        }
        return false;
      }

      // Handle <$100 positions (never get [+], just filtered)
      if (isSmall) {
        if (showHiddenPositions) {
          // Show with styling but NO [+] button (not restorable, just filtered)
          p.isHiddenPosition = true;
          p.isManuallyHidden = false; // No [+] button for these
          return true;
        }
        return false;
      }

      return true;
    });

    // Show <$100 only when there is something to show.
    const showHiddenBtn = document.getElementById('newShowHiddenBtn');
    if (showHiddenBtn) showHiddenBtn.hidden = !anyHidden;

    // Render positions table
    if (PositionsUI && positionsBody) {
      const rendered = PositionsUI.renderPositions({
        positions: visible,
        containers: { positionsBody, mobilePositionsContainer: mobileContainer },
        options: {
          amountsVisible: !document.body.classList.contains('amounts-hidden'),
          hideSmallPositions: false, // Already filtered above
          editMode: window.editMode || false,
          openKey: window.openPositionKey || null,
          shares: totals.shareByRow || {},
          sort: window.positionsSort || null,
          query: window.positionsQuery || '',
          settings: {
            minBalanceThreshold: minThreshold,
            showExactAmounts: this.settings.showExactAmounts || false,
            useColoredPnL: this.settings.useColoredPnL ?? true,
            showPriceChart: this.settings.showPriceChart ?? true,
            groupPositions: this.settings.groupPositions ?? true,
            combineOptionLegs: this.settings.combineOptionLegs ?? true,
            positionColumns: this.settings.positionColumns,
            hiddenPositionColumns: this.settings.hiddenPositionColumns,
            portfolioBaseCurrency: baseCurrency
          }
        },
        previousPositions: this.previousRenderData || window._previousRenderData || []
      });
      // Cache for next render (like watchlist) - update both local and global
      this.previousRenderData = rendered;
      window._previousRenderData = rendered;
    }

    // Render hero
    if (HeroUI && summaryEl) {
      const heroHtml = HeroUI.composeSummary({
        portfolioValue: totalValue,
        amountsVisible: !document.body.classList.contains('amounts-hidden'),
        heroPnLMode: 'total',
        totalPnL,
        totalPnLPercent,
        totalDailyChange: change24h,
        totalDailyChangePercent: change24hPercent,
        baseCurrency,
        useColoredPnL: this.settings.useColoredPnL ?? true,
        allocation,
        freshness,
        highlightsHtml: [],
        weather: window.cachedWeather || null
      });
      summaryEl.innerHTML = heroHtml;
    }

    // Tab title: "$119.4k ▲ 5.0% · Viewport", so a pinned tab shows the portfolio.
    // Hidden amounts keep only the percentage; Settings can turn it off (data-title-value).
    if (document.documentElement.dataset.titleValue !== 'off') {
      const pct = Number(change24hPercent);
      const move = Number.isFinite(pct) ? `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%` : '';
      const value = document.body.classList.contains('amounts-hidden')
        ? ''
        : formatMoney(totalValue, { currency: baseCurrency, visible: true, compact: true });
      const head = [value, move].filter(Boolean).join(' ');
      const title = head ? `${head} · Viewport` : 'Viewport';
      if (document.title !== title) document.title = title;
    }

    if (!this.isLoading) this.scheduleSnapshotSave();

    // Store in global cache for other functions
    window.cachedPositions = sorted;
    window.venuePositions = this._cachedConverted || [];
    window.cachedSummaryData = { totalValue, totalPnL, totalPnLPercent };

    // Store reference to renderer for external re-renders
    window._portfolioRenderer = this;

    // Release render lock
    this.isRendering = false;

    // If another render was requested while we were rendering, do it now
    if (this.pendingRender) {
      this.pendingRender = false;
      // Use requestAnimationFrame to batch the next render with the browser's paint cycle
      requestAnimationFrame(() => this.render());
    }
  }

  /**
   * Force re-render with current data (for filter toggles)
   * Uses minimal debounce to coalesce rapid clicks
   */
  forceRender() {
    clearTimeout(this.renderDebounce);
    this.renderDebounce = setTimeout(() => this.render(), 16); // ~1 frame
  }

  /**
   * Aggregate duplicate assets
   */
  aggregatePositions(positions) {
    // First, deduplicate positions by unique key (asset + exchange)
    // This prevents duplicates from showing up when providers are called multiple times
    const uniquePositions = new Map();
    for (const row of positions) {
      const key = row._changeDetectionKey || `${row.asset}_${row.exchange}`;
      // Keep the LAST occurrence of each position (newer data takes precedence)
      uniquePositions.set(key, row);
    }

    const aggregated = [];
    const assetGroups = new Map();

    for (const row of uniquePositions.values()) {
      // Keep special positions separate
      if (row.isLeveraged || row.isHlAccountEquity || row.isLighterAccountEquity) {
        aggregated.push(row);
        continue;
      }

      // Keep HL Perps/Spot and Lighter Spot separate
      if (row.exchange === 'HL Perps' || row.exchange === 'HL Spot' || row.exchange === 'HL Staking' || row.exchange === 'Lighter Spot') {
        aggregated.push(row);
        continue;
      }

      // Keep Manual positions separate (to allow deletion)
      if (row.exchange && typeof row.exchange === 'string' && row.exchange.startsWith('Manual')) {
        aggregated.push(row);
        continue;
      }

      // Debts and shorts stay on their own row. The total counts an IBKR one and skips any other,
      // which a merged sum could not do.
      if (Number(row.value) < 0) {
        aggregated.push(row);
        continue;
      }

      // Group by asset
      const key = row.asset;
      if (!assetGroups.has(key)) {
        assetGroups.set(key, []);
      }
      assetGroups.get(key).push(row);
    }

    // Combine grouped positions
    for (const [asset, items] of assetGroups) {
      if (items.length === 1) {
        aggregated.push(items[0]);
      } else {
        aggregated.push(mergeRows(asset, items));
      }
    }

    return aggregated;
  }

  calculateTotals(positions) {
    return calculatePortfolioTotals(positions);
  }
}

export default { IncrementalPortfolioRenderer };
