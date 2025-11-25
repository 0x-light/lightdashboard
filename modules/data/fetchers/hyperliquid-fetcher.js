export class HyperliquidFetcher {
    constructor(providers, renderer) {
        this.providers = providers;
        this.renderer = renderer;
    }

    async fetch(wallets) {
        try {
            // 1. Fetch Market Data (Prices)
            const [hlMarketData, hlAllMids, hlSpotMeta] = await Promise.all([
                this.providers.hyperliquid.fetchMetaAndAssetCtxs(3000),
                this.providers.hyperliquid.fetchAllMids(3000),
                this.providers.hyperliquid.fetchSpotMeta(3000)
            ]);

            const hlPriceMap = {};
            if (hlMarketData?.[0] && hlMarketData?.[1]) {
                for (let i = 0; i < hlMarketData[1].length; i++) {
                    const ctx = hlMarketData[1][i];
                    const assetName = hlMarketData[0].universe[i]?.name;
                    if (assetName && ctx?.markPx) {
                        hlPriceMap[assetName] = parseFloat(ctx.markPx);
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

            // 2. Fetch Positions per Wallet
            for (const wallet of wallets) {
                try {
                    const data = await this.providers.hyperliquid.fetchPositions(wallet, 3000);
                    const rows = [];

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

                                rows.push({
                                    asset: position.coin,
                                    exchange: 'Hyperliquid',
                                    amount: szi,
                                    price: currentPrice,
                                    value: notionalValue,
                                    change24h: null,
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
                    }

                    // Append to Renderer
                    this.renderer.appendPositions(rows, `Hyperliquid_${wallet}`);

                } catch (e) {
                    console.warn(`[Hyperliquid] Failed for wallet ${wallet}:`, e);
                }
            }
        } catch (e) {
            this.renderer.markProviderFailed('Hyperliquid', e);
        }
    }
}
