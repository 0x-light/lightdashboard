// Lighter Fetcher - Optimized for Performance
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes for price data
const CUM_FUNDING_CACHE_TTL = 15 * 60 * 1000; // 15 minutes for cumulative funding

export class LighterFetcher {
    constructor(providers, renderer) {
        this.providers = providers;
        this.renderer = renderer;
        this.priceDataCache = new Map(); // { symbol -> { priceHistory, change24h, timestamp } }
        this.fundingRatesCache = null;
        this.fundingRatesCacheTime = 0;
        this.cumFundingCache = new Map(); // { cacheKey -> { value, timestamp } }
    }

    // Check if cached data is still valid
    _isCacheValid(timestamp, ttl) {
        return timestamp && (Date.now() - timestamp) < ttl;
    }

    // Generate cache key for cumulative funding
    _getCumFundingKey(accountIndex, symbol) {
        return `${accountIndex}_${symbol}`;
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
        const walletRows = [];

        try {
            const data = await this.providers.lighter.fetchAccountByAddress(wallet, { timeoutMs: 3000 });
            if (!data?.accounts?.length) return;

            // Collect positions to process
            const positionsData = [];
            const symbolsNeeded = new Set();

            for (const account of data.accounts) {
                if (!account.positions?.length) continue;
                for (const pos of account.positions) {
                    const size = parseFloat(pos.position || 0);
                    if (Math.abs(size) > 0) {
                        symbolsNeeded.add(pos.symbol);
                        positionsData.push({ account, pos, isLong: pos.sign !== -1 });
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
            const cumFundingPromises = positionsData.map(async ({ account, pos, isLong }) => {
                const cacheKey = this._getCumFundingKey(account.account_index, pos.symbol);
                const cached = this.cumFundingCache.get(cacheKey);

                let cumFunding;
                if (this._isCacheValid(cached?.timestamp, CUM_FUNDING_CACHE_TTL)) {
                    cumFunding = cached.value;
                } else {
                    cumFunding = await this.providers.lighter.fetchCumFunding(
                        account.account_index, pos.symbol, isLong,
                        { timeoutMs: 3000, days: 30 }
                    ).catch(() => null);

                    if (cumFunding !== null) {
                        this.cumFundingCache.set(cacheKey, { value: cumFunding, timestamp: Date.now() });
                    }
                }
                return { account, pos, isLong, cumFunding };
            });

            // Wait for static data first, then funding (can start processing while funding loads)
            await Promise.all(promises);
            const positionsWithFunding = await Promise.all(cumFundingPromises);

            // Build position rows
            for (const { account, pos, isLong, cumFunding } of positionsWithFunding) {
                const size = parseFloat(pos.position || 0);
                const positionValue = parseFloat(pos.position_value || 0);
                const absSize = Math.abs(size);
                const priceData = this.priceDataCache.get(pos.symbol);

                const position = {
                    asset: pos.symbol,
                    exchange: 'Lighter',
                    amount: isLong ? absSize : -absSize,
                    price: absSize > 0 ? Math.abs(positionValue) / absSize : 0,
                    value: Math.abs(positionValue),
                    pnl: parseFloat(pos.unrealized_pnl || 0),
                    entryPrice: parseFloat(pos.avg_entry_price || 0),
                    isLeveraged: true,
                    _changeDetectionKey: `${pos.symbol}_Lighter_${wallet}_${account.account_index}`
                };

                // Add cached data
                if (priceData) {
                    position.priceHistory = priceData.priceHistory;
                    if (priceData.change24h != null) position.change24h = priceData.change24h;
                }
                if (this.fundingRatesCache?.[pos.symbol] != null) {
                    position.fundingRate = this.fundingRatesCache[pos.symbol];
                }
                if (cumFunding != null) {
                    position.funding = cumFunding;
                    position.cumFunding = cumFunding;
                }

                walletRows.push(position);
            }

            // Add USDC balances
            for (const account of data.accounts) {
                const balance = parseFloat(account.available_balance || 0);
                if (balance > 1) {
                    walletRows.push({
                        asset: 'USDC',
                        exchange: 'Lighter',
                        amount: balance,
                        price: 1,
                        value: balance,
                        pnl: 0,
                        isLeveraged: false,
                        _changeDetectionKey: `USDC_Lighter_${wallet}_${account.account_index}`
                    });
                }
            }
        } catch (e) {
            // Suppress expected errors (account not found)
            if (!e.message?.includes('400') && !e.message?.includes('404')) {
                console.warn('[Lighter] Error:', e.message);
            }
        }

        this.renderer.appendPositions(walletRows, `Lighter_${wallet}`);
    }
}
