/**
 * Centralized mapping for chain/network names.
 * Maps internal IDs (from providers like Zerion, Alchemy) to user-friendly display names.
 */
const CHAIN_ALIASES = {
    // Generic / Zerion
    'ethereum': 'Ethereum',
    'arbitrum': 'Arbitrum',
    'optimism': 'Optimism',
    'polygon': 'Polygon',
    'base': 'Base',
    'avalanche': 'Avalanche',
    'bsc': 'BSC',
    'binance-smart-chain': 'BSC',
    'solana': 'Solana',
    'zksync-era': 'zkSync',
    'blast': 'Blast',
    'hyperevm': 'HyperEVM',
    'monad': 'Monad',
    'plasma': 'Plasma',

    // Alchemy keys
    'eth-mainnet': 'Ethereum',
    'arb-mainnet': 'Arbitrum',
    'opt-mainnet': 'Optimism',
    'polygon-mainnet': 'Polygon',
    'base-mainnet': 'Base',
    'hyperliquid-mainnet': 'HyperEVM'
};

/**
 * Returns the friendly display name for a given chain key/ID.
 * @param {string} chainKey - The raw chain string from a provider
 * @returns {string} The formatted display name
 */
export function getChainDisplayName(chainKey) {
    if (!chainKey) return 'Unknown';
    // Try exact match first, then lowercase match
    return CHAIN_ALIASES[chainKey] || CHAIN_ALIASES[chainKey.toLowerCase()] || chainKey;
}

export default { getChainDisplayName };
