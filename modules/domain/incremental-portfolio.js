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

// Last good FX rates per base currency. A failed lookup then values EUR or GBP holdings at the
// last known rate instead of dropping them from the total.
const FX_CACHE_KEY = 'viewport.fxRates.v1';
const FX_REFRESH_MS = 10 * 60 * 1000;
const FX_RETRY_MS = 30 * 1000;

function loadFxCache(base) {
  try {
    const rates = JSON.parse(localStorage.getItem(FX_CACHE_KEY) || '{}')?.[base];
    return Object.entries(rates || {}).filter(([, rate]) => Number(rate) > 0);
  } catch (_) {
    return [];
  }
}

function saveFxCache(base, rates) {
  try {
    const all = JSON.parse(localStorage.getItem(FX_CACHE_KEY) || '{}') || {};
    all[base] = Object.fromEntries(Array.from(rates.entries()).filter(([, rate]) => Number(rate) > 0));
    localStorage.setItem(FX_CACHE_KEY, JSON.stringify(all));
  } catch (_) { /* storage unavailable: rates are fetched again next load */ }
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
    snapshot.positions.forEach(row => { row._stale = true; });
    return snapshot;
  } catch (_) {
    return null;
  }
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
          this._fxRates = new Map([...loadFxCache(base), ...snapshot.fxRates.filter(([, rate]) => Number(rate) > 0)]);
          this._fxRates.set(base, 1);
        }
        this.isLoading = false;
      }
    }
    this._snapshotSaveTimer = null;
    this._staleCarry = new Map(); // row key -> { priceHistory, change24h } from the snapshot

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
      this._staleCarry.set(keyOf(row), { priceHistory: stale.priceHistory, change24h: stale.change24h });
      if (row.quoteLoading && Number(stale.value) > 0) {
        Object.assign(row, {
          price: stale.price,
          value: stale.value,
          pnl: stale.pnl,
          change24h: stale.change24h,
          currency: row.currency || stale.currency,
          quoteLoading: false
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
          const { _stale, isHiddenPosition, isManuallyHidden, ...rest } = row;
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
    if (Array.isArray(newRows)) {
      for (const row of newRows) row._source = source;
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
        this.providerDoneAt.set(source, Date.now());
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
      this.providerDoneAt.set(source, Date.now());

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
    this.checkIfAllProvidersFinished();
    this.renderProviderStatus();
  }

  updateLastUpdatedLabel(state = 'updated') {
    const el = this.containers?.lastUpdatedEl || document.getElementById('lastUpdateTimestamp');
    if (!el) return;
    el.dataset.state = state;
    if (state === 'refreshing') {
      el.textContent = 'Refreshing…';
      return;
    }
    const updatedAt = new Date();
    // 24-hour, like the clock on the portfolio card
    const time = updatedAt.toLocaleTimeString('en-GB', {
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: window.larpTimeZone
    });
    el.textContent = `Updated ${time}`;
    el.title = updatedAt.toLocaleString(undefined, { timeZone: window.larpTimeZone });
  }

  beginRefresh(expectedProviders = this.expectedProviders) {
    this.expectedProviders = Array.from(new Set(expectedProviders || []));
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
    this._fxRates = new Map([...loadFxCache(base), [base, 1]]);
    this._fxRatesLoading.clear();
    this._fxCheckedAt.clear();
    this._fxRatesToken++;
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
        let updated = false;
        for (const currency of missing) {
          const rate = Number(rates?.[currency]);
          if (Number.isFinite(rate) && rate > 0) {
            this._fxRates.set(currency, rate);
            updated = true;
          }
        }
        if (updated) saveFxCache(base, this._fxRates);
      } catch (e) {
        error = e;
      } finally {
        // A failed lookup keeps the last good rate; a currency with none retries after FX_RETRY_MS.
        const unresolved = missing.filter(currency => !(Number(this._fxRates.get(currency)) > 0));
        if (unresolved.length > 0) {
          this.providerStatus.set('FX', 'failed');
          this.providerErrors.set('FX', error?.message || `missing ${unresolved.join(', ')} rate`);
        } else {
          this.providerStatus.set('FX', 'completed');
          this.providerErrors.delete('FX');
        }
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

    return {
      ...position,
      priceHistory: position?.priceHistory || carry?.priceHistory,
      change24h: position?.change24h ?? carry?.change24h ?? null,
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

  // The footer: each source on its own line, as SRCL's table with a block loader. A spinner
  // while a source loads for the first time; a tick and the time it last loaded; an inverted
  // × with the reason and a Retry chip when it failed. A source that loaded before keeps its
  // tick during the next refresh, so the footer doesn't flicker every 30 seconds.
  renderProviderStatus() {
    const el = this.containers?.providerStatusEl || document.getElementById('newProviderStatus');
    if (!el) return;

    const names = Array.from(new Set([...(this.expectedProviders || []), ...this.providerStatus.keys()]));
    // One wallet's source is "Hyperliquid_0x…": name it as "Hyperliquid 0xfc66…ca06"
    const label = (provider) => escapeHtml(provider.replace(/_(\w{6})\w+(\w{4})$/, ' $1…$2'));
    const time = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: window.larpTimeZone });
    let failed = 0;
    let pending = 0;
    const lines = names.map(provider => {
      const status = this.providerStatus.get(provider);
      const doneAt = this.providerDoneAt.get(provider);
      if (status === 'failed') {
        failed++;
        const message = this.providerErrors.get(provider);
        return `<span class="provider-line is-failed"><span class="provider-line__mark">×</span><span>${label(provider)}</span>` +
          (message ? `<span class="provider-line__note">${escapeHtml(message)}</span>` : '') +
          '<button type="button" class="chip provider-line__retry"><kbd aria-hidden="true">R</kbd><span class="chip__label">Retry</span></button></span>';
      }
      if (status === 'completed' || doneAt) {
        return `<span class="provider-line"><span class="provider-line__mark">✓</span><span>${label(provider)}</span>` +
          (doneAt ? `<span class="provider-line__note">${time(doneAt)}</span>` : '') + '</span>';
      }
      if (!this.isLoading) return '';
      pending++;
      return `<span class="provider-line"><span class="loading-terminal">${label(provider)}</span></span>`;
    }).join('');

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
    // Find positions missing 24h change
    // Custom manual entries have a fixed, user-entered value: a market's 24h move doesn't apply.
    // IBKR tickers are brokerage symbols; a crypto symbol with the same name is another asset.
    const needsEnrichment = this.allPositions.filter(p =>
      (p.change24h === null || p.change24h === undefined) && p.manualType !== 'custom' && p.exchange !== 'IBKR'
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
      // Rows without a price are kept visible: hiding them would make the holding silently vanish.
      const isSmall = !p.fxConversionMissing && !p.quoteLoading && !p.quoteUnavailable && hideSmallPositions && Math.abs(p.value || 0) < minThreshold;

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
        const totalAmount = items.reduce((sum, p) => sum + (p.amount || 0), 0);
        const totalValue = items.reduce((sum, p) => sum + (p.value || 0), 0);
        const knownPnL = items.filter(p => p.pnl != null && Number.isFinite(Number(p.pnl)));
        const totalPnL = knownPnL.length > 0 ? knownPnL.reduce((sum, p) => sum + Number(p.pnl), 0) : null;
        const weightedPrice = totalAmount !== 0 ? totalValue / Math.abs(totalAmount) : 0;
        const exchanges = [...new Set(items.map(p => p.exchange))];

        // Use the first non-null change24h value from any of the items
        const change24h = items.find(p => p.change24h !== null && p.change24h !== undefined)?.change24h ?? null;

        // Get priceHistory from first item that has it
        const priceHistory = items.find(p => p.priceHistory)?.priceHistory || null;

        // Use consistent exchange name for aggregated positions (for change detection)
        // If multiple exchanges, use the asset name itself as the exchange for stable keying
        const exchangeKey = exchanges.length > 1 ? asset : exchanges[0];

        aggregated.push({
          asset,
          exchange: exchanges.length > 1 ? 'Multiple' : exchanges[0],
          _changeDetectionKey: `${asset}_${exchangeKey}`, // Stable key for change detection
          amount: totalAmount,
          value: totalValue,
          price: weightedPrice,
          change24h,
          pnl: totalPnL,
          priceHistory,
          isAggregated: true
        });
      }
    }

    return aggregated;
  }

  calculateTotals(positions) {
    return calculatePortfolioTotals(positions);
  }
}

export default { IncrementalPortfolioRenderer };
