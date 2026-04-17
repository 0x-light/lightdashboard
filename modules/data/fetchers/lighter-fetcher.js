// Lighter Fetcher - Optimized for Performance
import { getCoingeckoId } from '../../utils/asset-mapping.js';

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes for price data
const CUM_FUNDING_CACHE_TTL = 15 * 60 * 1000; // 15 minutes for cumulative funding
const WALLET_ROWS_CACHE_TTL = 30 * 60 * 1000; // 30 minutes stale fallback for transient API failures
const LIGHTER_DEBUG = (() => {
    try {
        return typeof window !== 'undefined' &&
            window.localStorage &&
            window.localStorage.getItem('debug.lighter') === '1';
    } catch (_) {
        return false;
    }
})();

function lighterDebugWarn(...args) {
    if (LIGHTER_DEBUG) {
        console.warn(...args);
    }
}

function firstFiniteNumber(...values) {
    for (const value of values) {
        const n = Number(value);
        if (Number.isFinite(n)) return n;
    }
    return null;
}

function getAccountIndex(account) {
    const idx = account?.account_index ??
        account?.accountIndex ??
        account?.index ??
        account?.id ??
        account?.sub_account_index ??
        account?.subAccountIndex ??
        account?.account?.index ??
        account?.account?.account_index;
    return (idx === undefined || idx === null || idx === '') ? null : idx;
}

function normalizeObjectValues(value) {
    if (Array.isArray(value)) return value.filter(item => item && typeof item === 'object');
    if (value && typeof value === 'object') {
        return Object.values(value).filter(item => item && typeof item === 'object');
    }
    return [];
}

function looksLikePerpPosition(item) {
    if (!item || typeof item !== 'object') return false;
    return item.symbol !== undefined ||
        item.market_symbol !== undefined ||
        item.marketSymbol !== undefined ||
        item.market_id !== undefined ||
        item.position !== undefined ||
        item.position_size !== undefined ||
        item.size !== undefined ||
        item.quantity !== undefined ||
        item.qty !== undefined ||
        item.szi !== undefined ||
        item.unrealized_pnl !== undefined ||
        item.unrealizedPnl !== undefined;
}

function looksLikeSpotAsset(item) {
    if (!item || typeof item !== 'object') return false;
    const hasBalanceFields = item.balance !== undefined ||
        item.total_balance !== undefined ||
        item.total !== undefined ||
        item.available_balance !== undefined ||
        item.available !== undefined ||
        item.locked_balance !== undefined ||
        item.locked !== undefined ||
        item.hold !== undefined ||
        item.asset_id !== undefined;
    const hasPositionFields = item.position !== undefined ||
        item.position_size !== undefined ||
        item.szi !== undefined ||
        item.unrealized_pnl !== undefined;
    return hasBalanceFields && !hasPositionFields;
}

function collectMatchingItems(account, matcher) {
    const results = [];
    if (!account || typeof account !== 'object') return results;
    for (const value of Object.values(account)) {
        const items = normalizeObjectValues(value);
        if (items.length === 0) continue;
        for (const item of items) {
            if (matcher(item)) {
                results.push(item);
            }
        }
    }
    return results;
}

function getPerpPositions(account) {
    const directCollections = [
        account?.positions,
        account?.perpetual_positions,
        account?.perp_positions,
        account?.open_positions,
        account?.open_perp_positions
    ];

    const byDirectKey = [];
    for (const collection of directCollections) {
        byDirectKey.push(...normalizeObjectValues(collection).filter(looksLikePerpPosition));
    }
    if (byDirectKey.length > 0) return byDirectKey;

    return collectMatchingItems(account, looksLikePerpPosition);
}

function getSpotAssets(account) {
    const directCollections = [
        account?.assets,
        account?.spot_assets,
        account?.balances,
        account?.spot_balances,
        account?.tokens
    ];

    const byDirectKey = [];
    for (const collection of directCollections) {
        byDirectKey.push(...normalizeObjectValues(collection).filter(looksLikeSpotAsset));
    }
    if (byDirectKey.length > 0) return byDirectKey;

    return collectMatchingItems(account, looksLikeSpotAsset);
}

function getPositionSymbol(pos, getSymbolByMarketId) {
    const explicit = String(pos?.symbol || pos?.market_symbol || pos?.marketSymbol || pos?.market?.symbol || '').trim().toUpperCase();
    if (explicit) return explicit;

    const marketId = firstFiniteNumber(pos?.market_id, pos?.marketId, pos?.marketID, pos?.asset_id);
    if (marketId !== null && typeof getSymbolByMarketId === 'function') {
        const mapped = getSymbolByMarketId(marketId);
        if (mapped) return String(mapped).trim().toUpperCase();
    }

    return '';
}

function getAssetSymbol(asset, spotAssetMap = null) {
    const explicit = String(asset?.symbol || asset?.token_symbol || asset?.asset_symbol || '').trim().toUpperCase();
    if (explicit) return explicit;

    const assetId = firstFiniteNumber(asset?.asset_id, asset?.assetId, asset?.id);
    if (assetId !== null && spotAssetMap && typeof spotAssetMap === 'object') {
        const mapped = spotAssetMap[assetId] ?? spotAssetMap[String(assetId)];
        if (mapped) return String(mapped).trim().toUpperCase();
    }

    return '';
}

// Total account NAV (equity) — includes free collateral, open-position margin, and unrealized PnL.
// Prefer explicit total fields; these correspond to real account value the user sees on Lighter.
function getAccountTotalValue(account) {
    return firstFiniteNumber(
        account?.total_asset_value,
        account?.totalAssetValue,
        account?.equity,
        account?.account_value,
        account?.accountValue,
        account?.total_value,
        account?.totalValue,
        account?.net_asset_value,
        account?.netAssetValue,
        account?.portfolio_value,
        account?.portfolioValue
    );
}

// Free collateral — just unallocated USDC. NOT account equity when positions are open.
function getAccountFreeCollateral(account) {
    return firstFiniteNumber(
        account?.available_balance,
        account?.availableBalance,
        account?.collateral,
        account?.free_collateral,
        account?.freeCollateral
    );
}

function getAccountPnl(account) {
    return firstFiniteNumber(
        account?.unrealized_pnl,
        account?.unrealizedPnl,
        account?.total_unrealized_pnl,
        account?.totalUnrealizedPnl,
        account?.pnl
    );
}

export class LighterFetcher {
    constructor(providers, renderer) {
        this.providers = providers;
        this.renderer = renderer;
        this.priceDataCache = new Map(); // { symbol -> { priceHistory, change24h, timestamp } }
        this.fundingRatesCache = null;
        this.fundingRatesCacheTime = 0;
        this.cumFundingCache = new Map(); // { cacheKey -> { value, timestamp } }
        this.walletRowsCache = new Map(); // { wallet -> { rows, timestamp } }
    }

    // Check if cached data is still valid
    _isCacheValid(timestamp, ttl) {
        return timestamp && (Date.now() - timestamp) < ttl;
    }

    // Generate cache key for cumulative funding
    _getCumFundingKey(accountIndex, symbol) {
        return `${accountIndex}_${symbol}`;
    }

    _cloneRows(rows) {
        if (!Array.isArray(rows)) return [];
        return rows.map(row => {
            const cloned = { ...row };
            if (Array.isArray(row?.priceHistory)) {
                cloned.priceHistory = row.priceHistory.map(point => ({ ...point }));
            }
            return cloned;
        });
    }

    _getCachedWalletRows(wallet) {
        const entry = this.walletRowsCache.get(wallet);
        if (!entry) return [];
        if (!this._isCacheValid(entry.timestamp, WALLET_ROWS_CACHE_TTL)) {
            this.walletRowsCache.delete(wallet);
            return [];
        }
        return this._cloneRows(entry.rows);
    }

    _setCachedWalletRows(wallet, rows) {
        if (!wallet || !Array.isArray(rows) || rows.length === 0) return;
        this.walletRowsCache.set(wallet, {
            rows: this._cloneRows(rows),
            timestamp: Date.now()
        });
    }

    _hasMeaningfulValue(rows) {
        return Array.isArray(rows) && rows.some(row => Number(row?.value || 0) > 0);
    }

    async fetch(wallets) {
        if (!wallets?.length) return;

        try {
            await Promise.all(wallets.map(wallet => this._fetchWallet(wallet)));
            this.renderer.appendPositions([], 'Lighter');
        } catch (e) {
            this.renderer.markProviderFailed('Lighter', e);
        }
    }

    async _fetchWallet(wallet) {
        let walletRows = [];
        const spotAssetMap = (typeof this.providers?.lighter?.getSpotAssetMap === 'function')
            ? this.providers.lighter.getSpotAssetMap()
            : null;
        const getSymbolByMarketId = (typeof this.providers?.lighter?.getSymbolByMarketId === 'function')
            ? this.providers.lighter.getSymbolByMarketId.bind(this.providers.lighter)
            : null;
        const cachedRows = this._getCachedWalletRows(wallet);
        const cachedRowsHaveValue = this._hasMeaningfulValue(cachedRows);
        let hadRuntimeError = false;
        let hasAccountsPayload = false;
        let sawSpotBalance = false;
        let sawSpotValued = false;

        try {
            const data = await this.providers.lighter.fetchAccountByAddress(wallet, { timeoutMs: 6000 });
            const accounts = Array.isArray(data?.accounts)
                ? data.accounts.filter(account => account && typeof account === 'object')
                : [];
            hasAccountsPayload = accounts.length > 0;
            if (accounts.length === 0) {
                lighterDebugWarn('[Lighter] No accounts returned for wallet:', wallet, data);
                // Keep stale rows on transient upstream no-account responses.
                if (cachedRows.length > 0) {
                    walletRows = cachedRows;
                }
                this.renderer.appendPositions(walletRows, `Lighter_${wallet}`);
                return;
            }

            // Collect positions and spot assets to process
            const positionsData = [];
            const symbolsNeeded = new Set();
            const spotAssetsData = [];
            const coinGeckoBySymbol = new Map();

            for (const account of accounts) {
                const accountIndex = getAccountIndex(account);
                // Collect perp positions
                const perpPositions = getPerpPositions(account);
                if (perpPositions.length) {
                    for (const pos of perpPositions) {
                        const symbol = getPositionSymbol(pos, getSymbolByMarketId);
                        const size = firstFiniteNumber(
                            pos.position,
                            pos.size,
                            pos.position_size,
                            pos.positionSize,
                            pos.quantity,
                            pos.qty,
                            pos.signed_position,
                            pos.signedPosition,
                            pos.net_position,
                            pos.netPosition,
                            pos.position_qty,
                            pos.contracts,
                            pos.szi
                        ) || 0;
                        const sign = firstFiniteNumber(pos.sign, pos.side_sign);
                        const side = String(pos.side || pos.direction || '').toLowerCase();
                        const isLong = size > 0 ? true : (size < 0 ? false : (sign !== null ? sign >= 0 : side !== 'short'));

                        if (Math.abs(size) > 0) {
                            if (symbol) symbolsNeeded.add(symbol);
                            positionsData.push({ account, accountIndex, pos, symbol, size, isLong });
                        }
                    }
                }

                // Collect spot assets (need price data too)
                const spotAssets = getSpotAssets(account);
                if (spotAssets.length) {
                    for (const asset of spotAssets) {
                        const symbol = getAssetSymbol(asset, spotAssetMap);
                        const totalBalance = firstFiniteNumber(
                            asset.balance,
                            asset.total_balance,
                            asset.total,
                            asset.amount,
                            asset.quantity,
                            asset.qty
                        ) || 0;
                        const lockedBalance = firstFiniteNumber(
                            asset.locked_balance,
                            asset.locked,
                            asset.hold,
                            asset.lockedAmount,
                            asset.reserved
                        ) || 0;
                        const availableBalance = firstFiniteNumber(
                            asset.available_balance,
                            asset.available,
                            asset.free,
                            totalBalance - lockedBalance
                        ) || 0;
                        if (availableBalance > 0 && symbol) {
                            sawSpotBalance = true;
                            symbolsNeeded.add(symbol);
                            spotAssetsData.push({ account, accountIndex, asset, symbol, balance: availableBalance });
                        }
                    }
                }
            }

            // Batch all async operations together
            const promises = [];

            // 1. Candlestick data (only for symbols not in cache or expired)
            for (const symbol of symbolsNeeded) {
                const cached = this.priceDataCache.get(symbol);
                if (!this._isCacheValid(cached?.timestamp, CACHE_TTL)) {
                    promises.push(
                        this.providers.lighter.fetchCandlesticks(symbol, { timeoutMs: 3000, days: 7 })
                            .then(d => d && this.priceDataCache.set(symbol, { ...d, timestamp: Date.now() }))
                            .catch(() => { })
                    );
                }
            }

            // 2. Funding rates (if cache expired)
            if (!this._isCacheValid(this.fundingRatesCacheTime, CACHE_TTL)) {
                promises.push(
                    this.providers.lighter.fetchFundingRates({ timeoutMs: 3000 })
                        .then(rates => {
                            this.fundingRatesCache = rates;
                            this.fundingRatesCacheTime = Date.now();
                        })
                        .catch(() => { })
                );
            }

            // 3. Cumulative funding (only for positions not in cache or expired)
            const cumFundingPromises = positionsData.map(async ({ accountIndex, pos, symbol, isLong }) => {
                const accountKey = accountIndex ?? 'unknown';
                const cacheKey = this._getCumFundingKey(accountKey, symbol);
                const cached = this.cumFundingCache.get(cacheKey);

                let cumFunding;
                if (this._isCacheValid(cached?.timestamp, CUM_FUNDING_CACHE_TTL)) {
                    cumFunding = cached.value;
                } else {
                    if (accountIndex !== null && accountIndex !== undefined && accountIndex !== '') {
                        cumFunding = await this.providers.lighter.fetchCumFunding(
                            accountIndex, symbol, isLong,
                            { timeoutMs: 3000, days: 30 }
                        ).catch(() => null);
                    } else {
                        cumFunding = null;
                    }

                    if (cumFunding !== null) {
                        this.cumFundingCache.set(cacheKey, { value: cumFunding, timestamp: Date.now() });
                    }
                }
                return { accountIndex, pos, symbol, isLong, cumFunding };
            });

            // Wait for static data first, then funding (can start processing while funding loads)
            await Promise.all(promises);

            // 2.5 CoinGecko fallback pricing only for symbols missing source data.
            // Source-of-truth remains Lighter; fallback is used strictly when Lighter has no usable candle price/change.
            if (this.providers?.coingecko?.getSimplePrice && symbolsNeeded.size > 0) {
                const symbolsMissingSourceData = Array.from(symbolsNeeded).filter(symbol => {
                    const sourceData = this.priceDataCache.get(symbol);
                    const hasSourcePrice = firstFiniteNumber(sourceData?.currentPrice) !== null;
                    const hasSourceChange = sourceData?.change24h !== null && sourceData?.change24h !== undefined;
                    return !hasSourcePrice || !hasSourceChange;
                });

                if (symbolsMissingSourceData.length > 0) {
                    const symbolToId = new Map();
                    for (const symbol of symbolsMissingSourceData) {
                        const coinId = getCoingeckoId(symbol);
                        if (coinId) symbolToId.set(symbol, coinId);
                    }

                    if (symbolToId.size > 0) {
                        const idsCsv = Array.from(new Set(symbolToId.values())).join(',');
                        if (idsCsv) {
                            const cgData = await this.providers.coingecko.getSimplePrice(
                                idsCsv,
                                { timeoutMs: 3000, ttlMs: 60000 }
                            ).catch(() => ({}));

                            for (const [symbol, coinId] of symbolToId.entries()) {
                                const entry = cgData?.[coinId];
                                if (!entry || typeof entry !== 'object') continue;
                                const price = firstFiniteNumber(entry.usd);
                                const change24h = firstFiniteNumber(entry.usd_24h_change);
                                if (price !== null || change24h !== null) {
                                    coinGeckoBySymbol.set(symbol, { price, change24h });
                                }
                            }
                        }
                    }
                }
            }

            const positionsWithFunding = await Promise.all(cumFundingPromises);

            // Track per-account unrealized PnL so the equity row reflects position PnL even when the
            // API omits a top-level pnl field.
            const perpPnlByAccount = new Map();
            const addPerpPnl = (accountKey, pnl) => {
                if (!Number.isFinite(pnl)) return;
                perpPnlByAccount.set(accountKey, (perpPnlByAccount.get(accountKey) || 0) + pnl);
            };

            // Build position rows
            for (const { accountIndex, pos, symbol, isLong, cumFunding } of positionsWithFunding) {
                const size = firstFiniteNumber(
                    pos.position,
                    pos.size,
                    pos.position_size,
                    pos.positionSize,
                    pos.quantity,
                    pos.qty,
                    pos.signed_position,
                    pos.signedPosition,
                    pos.net_position,
                    pos.netPosition,
                    pos.position_qty,
                    pos.contracts,
                    pos.szi
                ) || 0;
                const positionValueRaw = firstFiniteNumber(
                    pos.position_value,
                    pos.positionValue,
                    pos.notional,
                    pos.notional_value,
                    pos.position_value_usd,
                    pos.value_usd,
                    pos.notionalValue,
                    pos.position_usd,
                    pos.market_value
                );
                const absSize = Math.abs(size);
                const priceData = this.priceDataCache.get(symbol);
                const coinGeckoData = coinGeckoBySymbol.get(symbol);
                const markPrice = firstFiniteNumber(
                    pos.mark_price,
                    pos.markPrice,
                    pos.mark_px,
                    pos.price,
                    pos.current_price,
                    pos.currentPrice,
                    priceData?.currentPrice,
                    coinGeckoData?.price
                ) || 0;
                const entryPrice = firstFiniteNumber(
                    pos.avg_entry_price,
                    pos.avgEntryPrice,
                    pos.entry_price,
                    pos.entryPrice,
                    pos.entry_px
                ) || 0;

                let value = positionValueRaw !== null ? Math.abs(positionValueRaw) : 0;
                if (value <= 0 && absSize > 0 && markPrice > 0) {
                    value = absSize * markPrice;
                } else if (value <= 0 && absSize > 0 && entryPrice > 0) {
                    value = absSize * entryPrice;
                }

                const derivedPrice = absSize > 0 && value > 0 ? (value / absSize) : 0;
                const price = derivedPrice || markPrice || entryPrice;

                const positionPnl = firstFiniteNumber(
                    pos.unrealized_pnl,
                    pos.unrealizedPnl,
                    pos.uPnl,
                    pos.unrealized_pnl_usd,
                    pos.pnl
                );
                addPerpPnl(accountIndex ?? 'unknown', positionPnl || 0);

                const position = {
                    asset: symbol || 'Unknown',
                    exchange: 'Lighter',
                    amount: isLong ? absSize : -absSize,
                    price,
                    value,
                    pnl: positionPnl || 0,
                    entryPrice,
                    isLeveraged: true,
                    _changeDetectionKey: `${symbol || 'Unknown'}_Lighter_${wallet}_${accountIndex ?? 'unknown'}`
                };

                // Add cached data
                if (priceData) {
                    position.priceHistory = priceData.priceHistory;
                    if (priceData.change24h != null) position.change24h = priceData.change24h;
                }
                if (position.change24h == null && coinGeckoData?.change24h != null) {
                    position.change24h = coinGeckoData.change24h;
                }
                if (this.fundingRatesCache?.[symbol] != null) {
                    position.fundingRate = this.fundingRatesCache[symbol];
                }
                if (cumFunding != null) {
                    position.funding = cumFunding;
                    position.cumFunding = cumFunding;
                }

                walletRows.push(position);
            }

            // Emit one synthetic Lighter account-equity row per account.
            // This is the single source of truth for Lighter NAV in portfolio totals. Per-position
            // perp rows above are kept for display but are *excluded* from totals by the
            // `isLighterAccountEquity` flag, preventing notional-value inflation.
            for (const account of accounts) {
                const accountIndex = getAccountIndex(account);
                const accountKey = accountIndex ?? 'unknown';
                const totalValue = getAccountTotalValue(account);
                const freeCollateral = getAccountFreeCollateral(account);
                const accountLevelPnl = getAccountPnl(account);
                const perpPnlSum = perpPnlByAccount.get(accountKey) || 0;
                const pnl = Number.isFinite(accountLevelPnl) ? accountLevelPnl : perpPnlSum;

                // Prefer API-reported total equity (already includes margin + unrealized PnL).
                // When absent, approximate NAV = free collateral + unrealized PnL. This undercounts
                // position margin but is safe: it never over-reports by counting notional.
                let equityValue;
                if (Number.isFinite(totalValue)) {
                    equityValue = totalValue;
                } else if (Number.isFinite(freeCollateral)) {
                    equityValue = freeCollateral + perpPnlSum;
                } else {
                    equityValue = null;
                }

                if (Number.isFinite(equityValue) && equityValue > 1) {
                    walletRows.push({
                        asset: 'LIGHTER_ACCOUNT_EQUITY',
                        exchange: 'Lighter',
                        amount: 1,
                        price: equityValue,
                        value: equityValue,
                        pnl,
                        isLighterAccountEquity: true,
                        isLeveraged: false,
                        _changeDetectionKey: `LIGHTER_ACCOUNT_EQUITY_${wallet}_${accountKey}`
                    });
                }
            }

            // Add spot asset balances (e.g., LIT token) - price data already pre-fetched
            for (const { accountIndex, asset, symbol, balance } of spotAssetsData) {
                const priceData = this.priceDataCache.get(symbol);
                const coinGeckoData = coinGeckoBySymbol.get(symbol);
                const price = priceData?.currentPrice ||
                    firstFiniteNumber(asset.price, asset.mark_price, asset.usd_price, asset.price_usd, coinGeckoData?.price) || 0;
                const assetUsdValue = firstFiniteNumber(asset.value_usd, asset.usd_value, asset.notional, asset.notional_value) || 0;
                const value = (balance * price) || assetUsdValue;

                const spotPosition = {
                    asset: symbol,
                    exchange: 'Lighter Spot',
                    amount: balance,
                    price: price,
                    value: value,
                    pnl: null, // No entry price data for spot
                    isLeveraged: false,
                    _changeDetectionKey: `${symbol}_LighterSpot_${wallet}_${accountIndex ?? 'unknown'}`
                };

                // Add price history and 24h change if available
                if (priceData) {
                    if (priceData.priceHistory) spotPosition.priceHistory = priceData.priceHistory;
                    if (priceData.change24h != null) spotPosition.change24h = priceData.change24h;
                }
                if (spotPosition.change24h == null && coinGeckoData?.change24h != null) {
                    spotPosition.change24h = coinGeckoData.change24h;
                }
                if (Number(spotPosition.value || 0) > 0) {
                    sawSpotValued = true;
                }

                walletRows.push(spotPosition);
            }

            if (walletRows.length === 0) {
                // Fallback: no parseable positions/balances but the API returned accounts. Try to
                // synthesize a single equity row from any total/free field the payload exposes.
                const fallbackEquity = accounts.reduce((sum, account) => {
                    const total = getAccountTotalValue(account);
                    if (Number.isFinite(total)) return sum + total;
                    const free = getAccountFreeCollateral(account);
                    return Number.isFinite(free) ? sum + free : sum;
                }, 0);
                if (fallbackEquity > 0) {
                    const fallbackPnl = accounts.reduce((sum, account) => {
                        const p = getAccountPnl(account);
                        return Number.isFinite(p) ? sum + p : sum;
                    }, 0);
                    walletRows.push({
                        asset: 'LIGHTER_ACCOUNT_EQUITY',
                        exchange: 'Lighter',
                        amount: 1,
                        price: fallbackEquity,
                        value: fallbackEquity,
                        pnl: fallbackPnl,
                        isLighterAccountEquity: true,
                        isLeveraged: false,
                        _changeDetectionKey: `LIGHTER_ACCOUNT_EQUITY_${wallet}`
                    });
                }
            }

            if (walletRows.length === 0) {
                lighterDebugWarn('[Lighter] Accounts found but no renderable positions/balances parsed for wallet:', wallet, accounts);
            }
        } catch (e) {
            hadRuntimeError = true;
            // Suppress expected errors (account not found)
            if (!e.message?.includes('400') && !e.message?.includes('404')) {
                lighterDebugWarn('[Lighter] Error:', e.message);
            }
        }

        // If upstream data is temporarily degraded (runtime error or spot balances with zero pricing),
        // keep last known good wallet rows to prevent flicker/disappearance.
        const hasPricingGap = sawSpotBalance && !sawSpotValued;
        const fetchedRowsHaveValue = this._hasMeaningfulValue(walletRows);
        const shouldUseStaleRows =
            cachedRows.length > 0 &&
            (
                hadRuntimeError ||
                hasPricingGap ||
                (!hasAccountsPayload && walletRows.length === 0) ||
                (!fetchedRowsHaveValue && cachedRowsHaveValue)
            );

        if (shouldUseStaleRows) {
            lighterDebugWarn('[Lighter] Using cached wallet rows due to temporary upstream data gap:', {
                wallet,
                hadRuntimeError,
                hasPricingGap,
                hasAccountsPayload,
                fetchedRows: walletRows.length
            });
            walletRows = cachedRows;
        } else if (walletRows.length > 0) {
            this._setCachedWalletRows(wallet, walletRows);
        }

        this.renderer.appendPositions(walletRows, `Lighter_${wallet}`);
    }
}
