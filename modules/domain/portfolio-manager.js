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

            // 3. Onchain wallet data (Zerion, Cielo, or Alchemy/Helius fallback)
            const onchainProvider = this.settings.onchainProvider || 'zerion';
            if (wallets.length > 0) {
                if (onchainProvider === 'cielo' && this.fetchers['Cielo'] && this.settings.cieloApiKey) {
                    fetchPromises.push(this.fetchers['Cielo'].fetch(wallets));
                } else if (onchainProvider === 'zerion' && this.fetchers['Zerion'] && this.settings.zerionApiKey) {
                    fetchPromises.push(this.fetchers['Zerion'].fetch(wallets));
                } else if (this.fetchers['Zerion'] && this.settings.zerionApiKey) {
                    // Fallback to Zerion if configured
                    fetchPromises.push(this.fetchers['Zerion'].fetch(wallets));
                } else if (this.fetchers['Cielo'] && this.settings.cieloApiKey) {
                    // Fallback to Cielo if configured  
                    fetchPromises.push(this.fetchers['Cielo'].fetch(wallets));
                } else if (this.fetchers['AlchemyHelius'] && (this.settings.alchemyApiKey || this.settings.heliusApiKey)) {
                    fetchPromises.push(this.fetchers['AlchemyHelius'].fetch(wallets, solanaAddrs));
                }
            } else if (this.fetchers['AlchemyHelius'] && solanaAddrs.length > 0 && this.settings.heliusApiKey) {
                // Solana-only via Helius
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
