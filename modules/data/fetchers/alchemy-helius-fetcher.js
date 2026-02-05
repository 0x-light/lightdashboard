export class AlchemyHeliusFetcher {
    constructor(providers, renderer, settings) {
        this.providers = providers;
        this.renderer = renderer;
        this.settings = settings;
    }

    async fetch(wallets, solanaAddrs) {
        try {
            const [alchemyTokens, heliusTokens] = await Promise.all([
                this.settings.alchemyApiKey && wallets.length > 0
                    ? this.providers.alchemy.getTokenBalances(wallets, this.settings.alchemyApiKey, { timeoutMs: 5000 })
                    : Promise.resolve([]),
                this.settings.heliusApiKey && solanaAddrs.length > 0
                    ? this.providers.helius.getTokenBalances(solanaAddrs, this.settings.heliusApiKey, { timeoutMs: 5000 })
                    : Promise.resolve([])
            ]);

            let rows = [];
            for (const token of alchemyTokens) {
                rows.push({
                    exchange: token.blockchain,
                    amount: token.balance,
                    price: token.tokenPrice || 0,
                    value: token.balanceUsd || 0,
                    change24h: null,
                    pnl: null,
                    _changeDetectionKey: `${token.tokenSymbol}_${token.blockchain}_${token.walletAddress || 'unknown'}`
                });
            }
            for (const token of heliusTokens) {
                rows.push({
                    asset: token.tokenSymbol,
                    exchange: token.blockchain,
                    amount: token.balance,
                    price: token.tokenPrice || 0,
                    value: token.balanceUsd || 0,
                    change24h: null,
                    pnl: null,
                    _changeDetectionKey: `${token.tokenSymbol}_${token.blockchain}_${token.walletAddress || 'unknown'}`
                });
            }

            // Calculate PnL if utility is available
            if (window.AppModules?.utils?.entryPriceTracker) {
                const result = window.AppModules.utils.entryPriceTracker.calculatePositionsPnL(rows);
                rows = result.positions;
            }

            this.renderer.appendPositions(rows, 'Alchemy/Helius', {
                removeFilter: (p) => {
                    return p.exchange && p.exchange !== 'HL Perps' && p.exchange !== 'HL Spot' && p.exchange !== 'Lighter' && p.exchange !== 'Lighter Spot' && p.exchange !== 'Bitcoin' && p.exchange !== 'Zcash' && !p.exchange.includes('HL Perps') && !p.exchange.includes('HL Spot') && !p.exchange.includes('Lighter');
                }
            });
        } catch (e) {
            this.renderer.markProviderFailed('Alchemy/Helius', e);
        }
    }
}
