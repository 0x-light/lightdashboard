const SPOT_META_CACHE_KEY = 'hl_spot_meta_compact_v1';
const SPOT_META_TTL_MS = 24 * 60 * 60 * 1000;

export class HyperliquidFetcher {
    constructor(providers, renderer, settings) {
        this.providers = providers;
        this.renderer = renderer;
        this.settings = settings;
        this.historyCache = new Map(); // key: asset, value: { priceHistory, change24h, timestamp }
    }

    async fetch(wallets) {
        const hl = this.providers.hyperliquid;
        try {
            // Everything starts at once: account state doesn't depend on market data, so waiting
            // for metadata before asking for positions only added round trips.
            const positionResults = wallets.map(wallet => hl.fetchPositions(wallet, 4000)
                .then(data => ({ wallet, data }), error => ({ wallet, error })));
            const midsPromise = hl.fetchAllMids(3000);
            // Perp contexts (prevDayPx, funding) are 70KB uncompressed, and each HIP-3 dex has its
            // own. Skip them when the last fetch showed no positions there; they're fetched late if
            // positions appear.
            let perpCtxPromise = this.hasPerps !== false ? hl.fetchMetaAndAssetCtxs(3000) : null;
            const dexCtxPromises = new Map(); // dex -> contexts promise
            const startDexCtx = (dex) => {
                if (dexCtxPromises.has(dex)) return;
                dexCtxPromises.set(dex, hl.fetchDexMetaAndAssetCtxs?.(dex, 3000).catch(() => null) ?? Promise.resolve(null));
            };
            for (const dex of this.dexesWithPerps || []) startDexCtx(dex);
            const spotMetaPromise = this.getSpotMeta();

            // Staked HYPE isn't in the clearinghouse states; ask alongside them (kept 10 min).
            // It's part of the equity, so a wallet whose stake can't be read fails like one
            // whose positions can't: a lower equity would be recorded as a loss.
            const stakingPromises = wallets.map(wallet => this.getStaking(wallet)
                .then(value => ({ value }), error => ({ error })));
            const results = await Promise.all(positionResults);
            const staking = await Promise.all(stakingPromises);
            results.forEach((r, i) => {
                if (!r.data) return;
                if (staking[i].error) { r.error = staking[i].error; r.data = null; }
                else r.data.staking = staking[i].value;
            });
            const allPerps = results.flatMap(r => r.data?.perp?.assetPositions || [])
                .filter(p => Math.abs(parseFloat(p.position?.szi || 0)) > 0);
            this.hasPerps = allPerps.length > 0;
            // A HIP-3 position's coin is 'dex:NAME'.
            this.dexesWithPerps = [...new Set(allPerps
                .map(p => String(p.position?.coin || ''))
                .filter(coin => coin.includes(':'))
                .map(coin => coin.slice(0, coin.indexOf(':'))))];
            if (this.hasPerps && !perpCtxPromise) perpCtxPromise = hl.fetchMetaAndAssetCtxs(3000);
            for (const dex of this.dexesWithPerps) startDexCtx(dex);

            // Spot balances in a token the cached map doesn't know yet (new listing) force a refresh.
            let spotMeta = await spotMetaPromise;
            const knownTokens = new Set((spotMeta?.tokens || []).map(t => t.name));
            const hasUnknownToken = results.some(r => (r.data?.spot?.balances || [])
                .some(bal => parseFloat(bal.total || 0) > 0 && !knownTokens.has(bal.coin)));
            if (hasUnknownToken) spotMeta = await this.getSpotMeta({ force: true });

            // Positions and mids are enough for values; prevDayPx/funding contexts are the slowest
            // responses (~70KB, uncompressed). Show rows as soon as values are known, then rebuild
            // them with 24h change and funding when the contexts land.
            const hlAllMids = await midsPromise;
            const emit = (market, { enrich }) => {
                for (const { wallet, data, error } of results) {
                    if (error) {
                        if (enrich) console.warn(`[Hyperliquid] Failed for wallet ${wallet}:`, error);
                        continue;
                    }
                    try {
                        const rows = this.buildWalletRows(wallet, data, market);
                        this.renderer.appendPositions(rows, `Hyperliquid_${wallet}`, { markCompleted: enrich });
                        // Charts and missing 24h changes load after the rows are on screen.
                        if (enrich) this.enrichWithHistory(rows, wallet);
                    } catch (e) {
                        if (enrich) console.warn(`[Hyperliquid] Failed for wallet ${wallet}:`, e);
                    }
                }
            };

            const contextsPromise = Promise.all([perpCtxPromise, Promise.all([...dexCtxPromises.values()])]);
            const contextsReady = await Promise.race([
                contextsPromise.then(() => true),
                new Promise(resolve => setTimeout(() => resolve(false), 0))
            ]);
            if (!contextsReady) emit(this.buildMarket(hlAllMids, null, [], spotMeta), { enrich: false });
            const [hlMarketData, dexMarketData] = await contextsPromise;
            emit(this.buildMarket(hlAllMids, hlMarketData, dexMarketData, spotMeta), { enrich: true });

            // Mark the main 'Hyperliquid' provider as completed
            this.renderer.appendPositions([], 'Hyperliquid');
        } catch (e) {
            this.renderer.markProviderFailed('Hyperliquid', e);
        }
    }

    /**
     * Token/pair index for spot balances. Only names and indexes are needed, so a compact copy is
     * kept in localStorage for a day instead of downloading ~140KB of metadata on every load.
     */
    async getSpotMeta({ force = false } = {}) {
        const now = Date.now();
        if (!force && this.spotMeta && now - (this.spotMetaFetchedAt || 0) < SPOT_META_TTL_MS) {
            return this.spotMeta;
        }
        if (!force && !this.spotMeta) {
            try {
                const cached = JSON.parse(localStorage.getItem(SPOT_META_CACHE_KEY) || 'null');
                if (cached && now - Number(cached.savedAt) < SPOT_META_TTL_MS) {
                    this.spotMeta = {
                        tokens: cached.tokens.map(([name, index]) => ({ name, index })),
                        universe: cached.universe.map(([name, base, quote, index]) => ({ name, tokens: [base, quote], index }))
                    };
                    this.spotMetaFetchedAt = Number(cached.savedAt);
                    return this.spotMeta;
                }
            } catch (_) { /* fall through to network */ }
        }
        const meta = await this.providers.hyperliquid.fetchSpotMeta(5000);
        if (meta?.tokens && meta?.universe) {
            this.spotMeta = meta;
            this.spotMetaFetchedAt = now;
            try {
                localStorage.setItem(SPOT_META_CACHE_KEY, JSON.stringify({
                    savedAt: now,
                    tokens: meta.tokens.map(t => [t.name, t.index]),
                    universe: meta.universe.map(p => [p.name, p.tokens?.[0], p.tokens?.[1], p.index])
                }));
            } catch (_) { /* quota: keep in memory only */ }
        }
        return this.spotMeta;
    }

    // Staked, unstaked-but-in-staking and withdrawing HYPE for one wallet, or null when the
    // provider has no staking call. When the exchange doesn't answer, the last answer is
    // kept (it's a stake, it moves slowly); with none, the error goes to the caller.
    async getStaking(wallet) {
        this.stakingCache ||= new Map();
        const hit = this.stakingCache.get(wallet);
        if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.value;
        let summary;
        try {
            summary = await this.providers.hyperliquid.fetchDelegatorSummary?.(wallet, 4000);
        } catch (error) {
            if (hit) return hit.value;
            throw error;
        }
        const value = summary ? {
            staked: parseFloat(summary.delegated || 0) || 0,
            unstaked: parseFloat(summary.undelegated || 0) || 0,
            withdrawing: parseFloat(summary.totalPendingWithdrawal || 0) || 0
        } : null;
        this.stakingCache.set(wallet, { at: Date.now(), value });
        return value;
    }

    buildMarket(hlAllMids, hlMarketData, dexMarketData, spotMeta) {
        const hlPriceMap = {};
        const hlPrevDayPxMap = {};
        const hlFundingRateMap = {}; // Map of asset name to current funding rate
        if (hlMarketData?.[0] && hlMarketData?.[1]) {
            for (let i = 0; i < hlMarketData[1].length; i++) {
                const ctx = hlMarketData[1][i];
                const assetName = hlMarketData[0].universe[i]?.name;
                if (assetName && ctx?.markPx) {
                    hlPriceMap[assetName] = parseFloat(ctx.markPx);
                    if (ctx.prevDayPx) {
                        hlPrevDayPxMap[assetName] = parseFloat(ctx.prevDayPx);
                    }
                    // Store current funding rate (funding is per-hour rate as decimal)
                    if (ctx.funding !== undefined) {
                        hlFundingRateMap[assetName] = parseFloat(ctx.funding);
                    }
                }
            }
        }

        // HIP-3 dex funding rates and prevDayPx (xyz:GOOGL, mkts:US500, ...). Names come
        // dex-prefixed, as the positions do.
        for (const dexData of dexMarketData || []) {
            if (!dexData?.[0] || !dexData?.[1]) continue;
            for (let i = 0; i < dexData[1].length; i++) {
                const ctx = dexData[1][i];
                const assetName = dexData[0].universe[i]?.name;
                if (assetName) {
                    if (ctx?.funding !== undefined) {
                        hlFundingRateMap[assetName] = parseFloat(ctx.funding);
                    }
                    // Also extract prevDayPx for 24h change calculation
                    if (ctx?.prevDayPx) {
                        hlPrevDayPxMap[assetName] = parseFloat(ctx.prevDayPx);
                    }
                }
            }
        }

        if (hlAllMids) {
            for (const [key, value] of Object.entries(hlAllMids)) {
                if (value && !key.startsWith('@')) {
                    hlPriceMap[key] = parseFloat(value);
                }
            }
        }

        const spotPriceMap = this.providers.hyperliquid.buildSpotPriceMap(hlAllMids, spotMeta);
        return { hlPriceMap, hlPrevDayPxMap, hlFundingRateMap, spotPriceMap };
    }

    buildWalletRows(wallet, data, market) {
        const { hlPriceMap, hlPrevDayPxMap, hlFundingRateMap, spotPriceMap } = market;
        const rows = [];

        const resolvePerpEquity = (state) => {
            const marginValue = Number(state?.marginSummary?.accountValue);
            const crossValue = Number(state?.crossMarginSummary?.accountValue);
            const withdrawable = Number(state?.withdrawable);
            const values = [marginValue, crossValue].filter(Number.isFinite);
            const best = values.length > 0 ? values[0] : null;

            if (best !== null && Number.isFinite(withdrawable)) {
                if (best >= 0 && withdrawable >= 0) {
                    return Math.max(best, withdrawable);
                }
                return best;
            }

            if (best !== null) return best;
            return Number.isFinite(withdrawable) ? withdrawable : 0;
        };

        const perpEquity = this.providers.hyperliquid.resolvePerpAccountValue
            ? (this.providers.hyperliquid.resolvePerpAccountValue(data?.perp) ?? 0)
            : resolvePerpEquity(data?.perp);

        let spotEquity = 0;
        if (data?.spot?.balances) {
            for (const bal of data.spot.balances) {
                const total = parseFloat(bal.total || 0);
                if (total > 0) {
                    const price = parseFloat(spotPriceMap[bal.coin] || 0);
                    spotEquity += total * price;
                }
            }
        }

        // Staked HYPE counts in the account's value on Hyperliquid (its portfolio history has
        // it, at the spot price), so it goes into the equity row; its own row below is covered
        // by the equity, like spot. Stake sizes come with the positions; the price is the
        // spot mid, with the perp mid as a stand-in.
        const staking = data?.staking;
        const stakedTotal = staking ? staking.staked + staking.unstaked + staking.withdrawing : 0;
        const hypePrice = parseFloat(spotPriceMap.HYPE || hlPriceMap.HYPE || 0);
        const stakingValue = stakedTotal > 0 && hypePrice > 0 ? stakedTotal * hypePrice : 0;

        const hlAccountEquity = perpEquity + spotEquity + stakingValue;
        let totalHlPnL = 0;

        // Process Perp Positions
        if (data?.perp?.assetPositions) {
            for (const pos of data.perp.assetPositions) {
                const position = pos.position;
                const szi = parseFloat(position?.szi || 0);
                if (Math.abs(szi) > 0) {
                    const entryPrice = parseFloat(position?.entryPx || 0);
                    const notionalValue = Math.abs(parseFloat(position?.positionValue || 0));
                    let currentPrice = notionalValue / Math.abs(szi);

                    if (!currentPrice || isNaN(currentPrice)) {
                        currentPrice = hlPriceMap[position.coin] || entryPrice;
                    }

                    const pnl = parseFloat(position?.unrealizedPnl || 0);
                    totalHlPnL += pnl;

                    // Calculate 24h change
                    let change24h = null;
                    const prevDayPx = hlPrevDayPxMap[position.coin];
                    if (prevDayPx && prevDayPx > 0) {
                        change24h = ((currentPrice - prevDayPx) / prevDayPx) * 100;
                    }

                    // Extract funding since position opened (positive = received, negative = paid)
                    // Use sinceOpen (not allTime) to show funding for the CURRENT position only
                    // Negate the value: Hyperliquid returns negative when you RECEIVE funding
                    let funding = null;
                    if (position?.cumFunding?.sinceOpen !== undefined) {
                        funding = -parseFloat(position.cumFunding.sinceOpen);
                    }

                    // Get current funding rate for this asset
                    const fundingRate = hlFundingRateMap[position.coin] ?? null;

                    // Leverage ({ type: 'cross' | 'isolated', value }) and liquidation price come
                    // with each position; shown in the row's detail line.
                    const leverage = Number(position?.leverage?.value) || null;
                    const liquidationPx = parseFloat(position?.liquidationPx);

                    rows.push({
                        asset: position.coin,
                        exchange: 'HL Perps',
                        amount: szi,
                        price: currentPrice,
                        value: notionalValue,
                        change24h,
                        pnl,
                        entryPrice,
                        isLeveraged: true,
                        funding,
                        fundingRate,
                        leverage,
                        leverageType: position?.leverage?.type || null,
                        liquidationPx: Number.isFinite(liquidationPx) && liquidationPx > 0 ? liquidationPx : null
                    });
                }
            }
        }

        // Process Spot Balances. Their 24h change comes from the candle enrichment below; the
        // contexts that carry prevDayPx for every spot pair are a 350KB download.
        if (data?.spot?.balances) {
            for (const bal of data.spot.balances) {
                const total = parseFloat(bal.total || 0);
                const available = total - parseFloat(bal.hold || 0);
                if (available > 0) {
                    const price = parseFloat(spotPriceMap[bal.coin] || 0);
                    const value = available * price;
                    // entryNtl is the cost of the whole balance; scale it to the
                    // available part we value, or held tokens read as a loss.
                    const entryNtl = parseFloat(bal.entryNtl || 0) * (total > 0 ? available / total : 0);
                    const pnl = (entryNtl > 0 && value > 0) ? (value - entryNtl) : null;

                    if (pnl !== null && !isNaN(pnl)) {
                        totalHlPnL += pnl;
                    }

                    rows.push({
                        asset: bal.coin,
                        exchange: 'HL Spot',
                        amount: available,
                        price,
                        value,
                        change24h: null,
                        pnl,
                        entryNtl
                    });
                }
            }
        }

        // Account Equity Position
        if (hlAccountEquity > 0) {
            rows.push({
                asset: 'HL_ACCOUNT_EQUITY',
                exchange: 'HL Perps',
                amount: 1,
                price: hlAccountEquity,
                value: hlAccountEquity,
                pnl: totalHlPnL,
                isHlAccountEquity: true,
                isLeveraged: false
            });
        }

        // Ensure Unique Keys
        for (const row of rows) {
            if (!row._changeDetectionKey) {
                row._changeDetectionKey = `${row.asset}_${row.exchange}_${wallet}`;
            }

            // Apply cached history if available
            if (this.historyCache.has(row.asset)) {
                const cached = this.historyCache.get(row.asset);
                // Use cache if less than 15 minutes old
                if (Date.now() - cached.timestamp < 15 * 60 * 1000) {
                    row.priceHistory = cached.priceHistory;
                    if (row.change24h === null && cached.change24h !== null) {
                        row.change24h = cached.change24h;
                    }
                }
            }
        }

        // Staked HYPE as its own holding, inside the equity above.
        if (stakingValue > 0) {
            const prev = hlPrevDayPxMap.HYPE;
            rows.push({
                asset: 'HYPE',
                exchange: 'HL Staking',
                amount: stakedTotal,
                price: hypePrice,
                value: stakingValue,
                change24h: prev > 0 ? ((hypePrice - prev) / prev) * 100 : null,
                staking
            });
        }

        return rows;
    }

    async enrichWithHistory(rows, wallet) {
        if (!rows || rows.length === 0) return;
        const chartsOn = !(this.settings && this.settings.showPriceChart === false);

        const now = Date.now();
        const startTime = now - 24 * 60 * 60 * 1000;

        // Only rows that will be on screen: wallets often hold dozens of dust spot balances, and one
        // candle request each (all at once) delays the charts that matter and risks rate limits.
        // With charts off, candles are still needed for spot rows' 24h change.
        const threshold = this.settings?.minBalanceThreshold || 100;
        const hideSmall = window.hideSmallPositions ?? true;
        const hiddenAssets = this.settings?.hiddenAssets || [];
        const itemsToFetch = rows.filter(r =>
            !r.isHlAccountEquity &&
            !r.priceHistory &&
            (chartsOn || r.change24h === null) &&
            !(hideSmall && (r.value || 0) < threshold) &&
            !hiddenAssets.includes(`${r.asset}_${r.exchange}`) &&
            r.asset !== 'USDC' // Skip stablecoins if needed, though HL usually trades against USDC
        );

        // console.log(`[Hyperliquid] Enriching ${itemsToFetch.length} items with history. Assets: ${itemsToFetch.map(r => r.asset).join(', ')}`);

        if (itemsToFetch.length === 0) return;

        // Fetch in parallel with concurrency limit if needed, but for now Promise.all is fine for typical portfolio size
        const historyPromises = itemsToFetch.map(async (item) => {
            try {
                // Check cache again (though we checked before render, maybe another fetch updated it)
                if (this.historyCache.has(item.asset)) {
                    const cached = this.historyCache.get(item.asset);
                    if (now - cached.timestamp < 15 * 60 * 1000) {
                        item.priceHistory = cached.priceHistory;
                        if (cached.change24h !== null) item.change24h = cached.change24h;
                        return true;
                    }
                }

                // Use 1h candles for 24h chart (24 points) - efficient and sufficient for sparkline
                // Or 15m (96 points) for more detail. Let's go with 15m.
                // API expects ms timestamps

                // For Spot assets, the coin name in candleSnapshot must be the exact pair name from universe
                // e.g. "@248". The API errors with 500 if we send "BZEC" or "BZEC/USDC".
                let coin = item.asset;
                if (item.exchange === 'HL Spot') {
                    let foundPair = false;
                    // Robust lookup: Token Name -> Token Index -> Spot Pair -> Pair Name
                    if (this.spotMeta && this.spotMeta.tokens && this.spotMeta.universe) {
                        // 1. Find token index
                        const token = this.spotMeta.tokens.find(t => t.name === item.asset);
                        if (token) {
                            // 2. Find pair with this token as base and USDC (0) as quote
                            const spotPair = this.spotMeta.universe.find(p =>
                                p.tokens && p.tokens[0] === token.index && p.tokens[1] === 0
                            );
                            if (spotPair) {
                                coin = spotPair.name;
                                foundPair = true;
                            }
                        } else {
                            // Fallback: try to find by name in universe directly (unlikely for spot but possible)
                            const spotPair = this.spotMeta.universe.find(p => p.name === item.asset);
                            if (spotPair) {
                                coin = spotPair.name;
                                foundPair = true;
                            }
                        }
                    }

                    // If we couldn't find the canonical pair name (e.g. @248), SKIP fetching candles.
                    // Sending "BZEC" or "BZEC/USDC" causes 500 errors.
                    if (!foundPair && !coin.startsWith('@')) {
                        // console.warn(`[Hyperliquid] Could not find spot pair for ${item.asset}, skipping candles.`);
                        return false;
                    }
                }

                const candles = await this.providers.hyperliquid.fetchCandles(
                    coin,
                    '15m',
                    startTime,
                    now,
                    5000 // Short timeout for enrichment
                );

                if (candles && candles.length > 0) {
                    // console.log(`[Hyperliquid] Got ${candles.length} candles for ${item.asset}`);
                    // Format for sparkline: array of { price, timestamp } or just objects with price
                    // The sparkline component expects { price } objects
                    const priceHistory = candles.map(c => ({ price: c.c, timestamp: c.t }));
                    item.priceHistory = priceHistory;

                    // Update 24h change if missing (e.g. for special assets like xyz:GOOGL that don't have prevDayPx)
                    let change24h = item.change24h;
                    if (change24h === null && candles.length >= 2) {
                        const first = candles[0].c;
                        const last = candles[candles.length - 1].c;
                        if (first > 0) {
                            change24h = ((last - first) / first) * 100;
                            item.change24h = change24h;
                        }
                    }

                    // Update cache
                    this.historyCache.set(item.asset, {
                        priceHistory,
                        change24h,
                        timestamp: Date.now()
                    });

                    return true;
                } else {
                    // console.log(`[Hyperliquid] No candles returned for ${item.asset}`);
                }
            } catch (e) {
                // Silent fail for enrichment
            }
            return false;
        });

        await Promise.all(historyPromises);

        // Re-render with history
        // We need to trigger an update. Since we modified the rows in place (which are references),
        // we can just call appendPositions again or a specific update method.
        // However, the renderer might dedupe based on keys.
        // Let's force update by calling appendPositions again.
        this.renderer.appendPositions(rows, `Hyperliquid_${wallet}`);
    }
}
