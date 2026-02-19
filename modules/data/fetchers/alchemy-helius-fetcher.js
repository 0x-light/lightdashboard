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
                const walletId = token.address || token.walletAddress || 'unknown';
                rows.push({
                    asset: token.tokenSymbol || 'Unknown',
                    exchange: token.blockchain,
                    amount: token.balance,
                    price: token.tokenPrice || 0,
                    value: token.balanceUsd || 0,
                    change24h: null,
                    pnl: null,
                    _source: 'Alchemy/Helius',
                    _changeDetectionKey: `${token.tokenSymbol || 'Unknown'}_${token.blockchain}_${walletId}`
                });
            }
            for (const token of heliusTokens) {
                const walletId = token.address || token.walletAddress || 'unknown';
                rows.push({
                    asset: token.tokenSymbol || 'Unknown',
                    exchange: token.blockchain,
                    amount: token.balance,
                    price: token.tokenPrice || 0,
                    value: token.balanceUsd || 0,
                    change24h: null,
                    pnl: null,
                    _source: 'Alchemy/Helius',
                    _changeDetectionKey: `${token.tokenSymbol || 'Unknown'}_${token.blockchain}_${walletId}`
                });
            }

            // Calculate PnL if utility is available
            if (window.AppModules?.utils?.entryPriceTracker) {
                const result = window.AppModules.utils.entryPriceTracker.calculatePositionsPnL(rows);
                rows = result.positions;
            }

            this.renderer.appendPositions(rows, 'Alchemy/Helius', {
                removeFilter: (p) => {
                    return p && p._source === 'Alchemy/Helius';
                }
            });
        } catch (e) {
            this.renderer.markProviderFailed('Alchemy/Helius', e);
        }
    }
}
