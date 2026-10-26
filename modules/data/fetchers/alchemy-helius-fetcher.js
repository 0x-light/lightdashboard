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

            // A token the provider has no price for is unpriced, not worth $0.
            let rows = [...alchemyTokens, ...heliusTokens].map(token => {
                const walletId = token.address || token.walletAddress || 'unknown';
                const priced = Number(token.tokenPrice) > 0;
                return {
                    asset: token.tokenSymbol || 'Unknown',
                    exchange: token.blockchain,
                    amount: token.balance,
                    price: priced ? token.tokenPrice : null,
                    value: priced ? (token.balanceUsd ?? token.balance * token.tokenPrice) : 0,
                    change24h: null,
                    pnl: null,
                    ...(priced ? {} : { quoteUnavailable: true }),
                    _source: 'Alchemy/Helius',
                    _changeDetectionKey: `${token.tokenSymbol || 'Unknown'}_${token.blockchain}_${walletId}`
                };
            });

            // Calculate PnL if utility is available. Entries of holdings gone from a wallet
            // and chain read in full are reset, so a later re-buy starts fresh.
            if (window.AppModules?.utils?.entryPriceTracker) {
                const read = [...(alchemyTokens.read || []), ...(heliusTokens.read || [])];
                const scope = key => read.some(({ wallet, chain }) => key.endsWith(`_${chain}_${wallet}`));
                rows = window.AppModules.utils.entryPriceTracker.calculatePositionsPnL(rows, { scope }).positions;
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
