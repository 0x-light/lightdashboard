export class PortfolioManager {
    constructor(renderer, providers, settings) {
        this.renderer = renderer;
        this.providers = providers;
        this.settings = settings;
        this.fetchers = {};
        this.isFetching = false;
    }

    registerFetcher(name, fetcher) {
        this.fetchers[name] = fetcher;
    }

    async fetchAll(wallets, solanaAddrs, bitcoinAddrs, zcashAddrs) {
        if (this.isFetching) {
            console.warn('[PortfolioManager] Fetch already in progress');
            return;
        }
        this.isFetching = true;

        try {
            const fetchPromises = [];

            // 1. Hyperliquid
            if (this.fetchers['Hyperliquid'] && wallets.length > 0) {
                fetchPromises.push(this.fetchers['Hyperliquid'].fetch(wallets));
            }

            // 2. Lighter
            if (this.fetchers['Lighter'] && wallets.length > 0) {
                fetchPromises.push(this.fetchers['Lighter'].fetch(wallets));
            }

            // 3. Zerion (or fallback)
            if (this.fetchers['Zerion'] && wallets.length > 0 && this.settings.zerionApiKey) {
                fetchPromises.push(this.fetchers['Zerion'].fetch(wallets));
            } else if (this.fetchers['AlchemyHelius'] && (wallets.length > 0 || solanaAddrs.length > 0)) {
                fetchPromises.push(this.fetchers['AlchemyHelius'].fetch(wallets, solanaAddrs));
            }

            // 4. Bitcoin/Zcash
            if (this.fetchers['BitcoinZcash'] && (bitcoinAddrs.length > 0 || zcashAddrs.length > 0)) {
                fetchPromises.push(this.fetchers['BitcoinZcash'].fetch(bitcoinAddrs, zcashAddrs));
            }

            // 5. Manual
            if (this.fetchers['Manual'] && this.settings.cryptoPositions?.length > 0) {
                fetchPromises.push(this.fetchers['Manual'].fetch(this.settings.cryptoPositions));
            }

            await Promise.allSettled(fetchPromises);
        } catch (e) {
            console.error('[PortfolioManager] Error in fetchAll:', e);
        } finally {
            this.isFetching = false;
        }
    }
}
