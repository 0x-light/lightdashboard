export class HyperliquidFetcher {
    constructor(providers, renderer) {
        this.providers = providers;
        this.renderer = renderer;
        this.historyCache = new Map(); // key: asset, value: { priceHistory, change24h, timestamp }
    }

    async fetch(wallets) {
        try {
            // ... (existing fetch logic) ...
            const [hlMarketData, hlAllMids, hlSpotMeta] = await Promise.all([
                this.providers.hyperliquid.fetchMetaAndAssetCtxs(3000),
                this.providers.hyperliquid.fetchAllMids(3000),
                this.providers.hyperliquid.fetchSpotMeta(3000)
            ]);

            // Store spotMeta for enrichment
            this.spotMeta = hlSpotMeta;

            // ... (existing price map logic) ...

            // ... (existing price map logic) ...
            const hlPriceMap = {};
            const hlPrevDayPxMap = {};
            // ... (populate maps) ...
            if (hlMarketData?.[0] && hlMarketData?.[1]) {
                for (let i = 0; i < hlMarketData[1].length; i++) {
                    const ctx = hlMarketData[1][i];
                    const assetName = hlMarketData[0].universe[i]?.name;
                    if (assetName && ctx?.markPx) {
                        hlPriceMap[assetName] = parseFloat(ctx.markPx);
                        if (ctx.prevDayPx) {
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

            const spotPriceMap = this.providers.hyperliquid.buildSpotPriceMap(hlAllMids, hlSpotMeta);

            for (const wallet of wallets) {
                try {
                    const data = await this.providers.hyperliquid.fetchPositions(wallet, 3000);
                    const rows = [];

                    // ... (existing position processing) ...
                    // We need to copy the logic for processing perps and spot
                    // Since I cannot match the entire file easily with replace_file_content for just the middle,
                    // I will assume the user wants me to inject the cache application logic.

                    // I will target the end of the loop where rows are ready.
                    let perpEquity = 0;
                    if (data?.perp?.marginSummary) {
                        perpEquity = parseFloat(data.perp.marginSummary.accountValue || 0);
                    }

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

                    const hlAccountEquity = perpEquity + spotEquity;
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

                                rows.push({
                                    asset: position.coin,
                                    exchange: 'Hyperliquid',
                                    amount: szi,
                                    price: currentPrice,
                                    value: notionalValue,
                                    change24h,
                                    pnl,
                                    entryPrice,
                                    isLeveraged: true
                                });
                            }
                        }
                    }

                    // Process Spot Balances
                    if (data?.spot?.balances) {
                        for (const bal of data.spot.balances) {
                            const available = parseFloat(bal.total || 0) - parseFloat(bal.hold || 0);
                            if (available > 0) {
                                const price = parseFloat(spotPriceMap[bal.coin] || 0);
                                const value = available * price;
                                const entryNtl = parseFloat(bal.entryNtl || 0);
                                const pnl = (entryNtl > 0 && value > 0) ? (value - entryNtl) : null;

                                if (pnl !== null && !isNaN(pnl)) {
                                    totalHlPnL += pnl;
                                }

                                rows.push({
                                    asset: bal.coin,
                                    exchange: 'Hyperliquid Spot',
                                    amount: available,
                                    price,
                                    value,
                                    change24h: null, // TODO: Fetch 24h change for spot
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
                            exchange: 'Hyperliquid',
                            amount: 1,
                            price: hlAccountEquity,
                            value: hlAccountEquity,
                            pnl: totalHlPnL,
                            isHlAccountEquity: true,
                            isLeveraged: false
                        });
                    }

                    // Enrich with CoinGecko (TODO: Move to shared utility if needed)
                    // For now, we assume renderer handles basic display, but enrichment is good.
                    // Skipping complex enrichment here to keep it simple, or we can inject coingecko provider.

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
                                if (cached.change24h !== null) {
                                    row.change24h = cached.change24h;
                                }
                            }
                        }
                    }

                    // Append to Renderer
                    this.renderer.appendPositions(rows, `Hyperliquid_${wallet}`);

                    // 3. Fetch History for Charts (Async enrichment)
                    // We do this after initial render to keep UI snappy
                    this.enrichWithHistory(rows, wallet);

                } catch (e) {
                    console.warn(`[Hyperliquid] Failed for wallet ${wallet}:`, e);
                }
            }
        } catch (e) {
            this.renderer.markProviderFailed('Hyperliquid', e);
        }
    }

    async enrichWithHistory(rows, wallet) {
        if (!rows || rows.length === 0) return;

        const now = Date.now();
        const startTime = now - 24 * 60 * 60 * 1000;

        // Filter out items that don't need history or already have it
        const itemsToFetch = rows.filter(r =>
            !r.isHlAccountEquity &&
            !r.priceHistory &&
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
                // e.g. "PURR/USDC", "HYPE", or "@248"
                let coin = item.asset;
                if (item.exchange === 'Hyperliquid Spot') {
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
                            // Fallback: try to find by name in universe directly
                            const spotPair = this.spotMeta.universe.find(p => p.name === item.asset);
                            if (spotPair) {
                                coin = spotPair.name;
                                foundPair = true;
                            }
                        }
                    }

                    // Only append /USDC if we didn't find a canonical pair name
                    // and it doesn't look like a pair or special identifier
                    if (!foundPair && !coin.includes('/') && !coin.startsWith('@')) {
                        coin = `${coin}/USDC`;
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

                    // Update 24h change if we have better data from candles
                    let change24h = item.change24h;
                    if (candles.length >= 2) {
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
