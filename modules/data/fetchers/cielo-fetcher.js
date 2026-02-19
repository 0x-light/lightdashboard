import { getChainDisplayName } from '../../utils/chain-mapping.js';

export class CieloFetcher {
    constructor(providers, renderer, settings) {
        this.providers = providers;
        this.renderer = renderer;
        this.settings = settings;
        this.historyCache = new Map(); // key: asset, value: { priceHistory, change24h, timestamp }
    }

    async fetch(wallets) {
        try {
            await Promise.all(wallets.map(async (wallet) => {
                const walletRows = [];
                try {
                    // Fetch portfolio and PNL in parallel
                    const [portfolioData, pnlData] = await Promise.all([
                        this.providers.cielo.getWalletPortfolio(wallet, this.settings.cieloApiKey, { timeoutMs: 10000 }),
                        this.providers.cielo.getTokenPnl(wallet, this.settings.cieloApiKey, { timeoutMs: 10000, activePositionsOnly: true })
                    ]);


                    // Build PNL lookup map by token address
                    const pnlByToken = new Map();
                    if (pnlData?.data?.items) {
                        for (const item of pnlData.data.items) {
                            const tokenAddr = item.token_info?.token_address?.toLowerCase();
                            if (tokenAddr) {
                                pnlByToken.set(tokenAddr, {
                                    realizedPnl: item.realized_pnl_usd || 0,
                                    unrealizedPnl: item.unrealized_pnl_usd || 0,
                                    totalPnl: (item.realized_pnl_usd || 0) + (item.unrealized_pnl_usd || 0)
                                });
                            }
                        }
                    }

                    // Process portfolio data - check multiple possible response structures
                    const portfolio = portfolioData?.data?.portfolio || portfolioData?.portfolio || portfolioData?.data || [];

                    if (Array.isArray(portfolio) && portfolio.length > 0) {
                        for (const item of portfolio) {
                            // Skip zero-value positions
                            const value = item.total_usd_value || item.usd_value || item.value || 0;
                            if (value <= 0) continue;

                            const chain = getChainDisplayName(item.chain || item.network || 'unknown');
                            const tokenAddr = (item.token_address || item.address)?.toLowerCase();
                            const pnlInfo = tokenAddr ? pnlByToken.get(tokenAddr) : null;

                            const row = {
                                asset: item.token_symbol || item.symbol || 'Unknown',
                                exchange: chain,
                                amount: item.balance || item.amount || 0,
                                price: item.token_price_usd || item.price_usd || item.price || 0,
                                value: value,
                                change24h: null, // Cielo doesn't provide 24h change in portfolio
                                pnl: pnlInfo?.totalPnl ?? null,
                                _changeDetectionKey: `${item.token_symbol || item.symbol || 'Unknown'}_${chain}_${wallet}`
                            };

                            walletRows.push(row);
                        }
                    } else if (portfolioData?.status === 'ok' && portfolioData?.data?.portfolio) {
                        // Original format handling
                        for (const item of portfolioData.data.portfolio) {
                            if (!item.total_usd_value || item.total_usd_value <= 0) continue;

                            const chain = getChainDisplayName(item.chain || 'unknown');
                            const tokenAddr = item.token_address?.toLowerCase();
                            const pnlInfo = tokenAddr ? pnlByToken.get(tokenAddr) : null;

                            const row = {
                                asset: item.token_symbol || 'Unknown',
                                exchange: chain,
                                amount: item.balance || 0,
                                price: item.token_price_usd || 0,
                                value: item.total_usd_value || 0,
                                change24h: null,
                                pnl: pnlInfo?.totalPnl ?? null,
                                _changeDetectionKey: `${item.token_symbol || 'Unknown'}_${chain}_${wallet}`
                            };

                            walletRows.push(row);
                        }
                    }

                } catch (err) {
                    console.warn(`[Cielo] Failed for wallet ${wallet}:`, err);
                }

                this.renderer.appendPositions(walletRows, `Cielo_${wallet}`);

                // Enrich with Pyth History for Charts
                this.enrichWithPythHistory(walletRows, wallet);
            }));

            // Mark the main 'Cielo' provider as completed
            this.renderer.appendPositions([], 'Cielo');
        } catch (e) {
            this.renderer.markProviderFailed('Cielo', e);
        }
    }

    async enrichWithPythHistory(rows, wallet) {
        if (!rows || rows.length === 0) return;
        if (this.settings.showPriceChart === false) return;

        try {
            // 1. Get Feed IDs map
            const feedMap = await this.providers.pyth.getPriceFeeds();

            const symbolToId = {};
            for (const [symbol, id] of Object.entries(feedMap)) {
                symbolToId[symbol] = id;
            }

            // 2. Identify rows that need history and have a matching feed
            const itemsToFetch = [];
            for (const row of rows) {
                if (!row.priceHistory && row.asset) {
                    // Check threshold and hidden status
                    const isHidden = this.settings.hiddenAssets && this.settings.hiddenAssets.includes(`${row.asset}_${row.exchange}`);
                    const threshold = this.settings.minBalanceThreshold || 0;
                    if (isHidden || row.value < threshold) {
                        continue;
                    }

                    // Check cache first
                    if (this.historyCache.has(row.asset)) {
                        const cached = this.historyCache.get(row.asset);
                        if (Date.now() - cached.timestamp < 15 * 60 * 1000) {
                            row.priceHistory = cached.priceHistory;
                            if (cached.change24h !== null) row.change24h = cached.change24h;
                            continue;
                        }
                    }

                    let feedId = symbolToId[row.asset.toUpperCase()];

                    // Fallback for known assets if missing from dynamic map
                    if (!feedId) {
                        const FALLBACK_IDS = {
                            'ETH': 'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
                            'WETH': 'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
                            'SOL': 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
                            'USDC': 'eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a'
                        };
                        feedId = FALLBACK_IDS[row.asset.toUpperCase()];
                    }

                    if (feedId) {
                        itemsToFetch.push({ row, feedId });
                    }
                }
            }

            if (itemsToFetch.length === 0) return;

            // 3. Fetch history in batch
            const feedIds = itemsToFetch.map(i => i.feedId);
            const now = Date.now();

            try {
                // Pass 1: Low resolution (24 points / 1h) for FAST load
                const fastResults = await this.providers.pyth.getBatch24hPriceHistory(feedIds, 24, now);

                let hasFastData = false;
                for (const { row, feedId } of itemsToFetch) {
                    const normalizedId = feedId.toLowerCase().startsWith('0x') ? feedId.toLowerCase() : `0x${feedId.toLowerCase()}`;
                    const history = fastResults[normalizedId];

                    if (history && history.length > 0) {
                        row.priceHistory = history;
                        hasFastData = true;
                    }
                }

                if (hasFastData) {
                    this.renderer.appendPositions(rows, `Cielo_${wallet}`);
                }

                // Pass 2: High resolution (96 points / 15m) for FINAL quality
                const fullResults = await this.providers.pyth.getBatch24hPriceHistory(feedIds, 96, now);

                for (const { row, feedId } of itemsToFetch) {
                    const normalizedId = feedId.toLowerCase().startsWith('0x') ? feedId.toLowerCase() : `0x${feedId.toLowerCase()}`;
                    const history = fullResults[normalizedId];

                    if (history && history.length > 0) {
                        row.priceHistory = history;

                        let change24h = row.change24h;
                        if (row.change24h === null && history.length >= 2) {
                            const first = history[0].price;
                            const last = history[history.length - 1].price;
                            if (first > 0) {
                                change24h = ((last - first) / first) * 100;
                                row.change24h = change24h;
                            }
                        }

                        // Update cache
                        this.historyCache.set(row.asset, {
                            priceHistory: history,
                            change24h,
                            timestamp: Date.now()
                        });
                    }
                }
            } catch (e) {
                console.warn(`[Cielo] Error fetching batch history:`, e);
            }

            // 4. Update UI
            this.renderer.appendPositions(rows, `Cielo_${wallet}`);

        } catch (e) {
            console.warn(`[Cielo] Failed to enrich history for ${wallet}:`, e);
        }
    }
}
