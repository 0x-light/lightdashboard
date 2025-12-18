// Cielo Finance provider
// API for wallet portfolio and token PNL data
import { HttpClient } from '../../http/client.js';

const BASE = 'https://feed-api.cielo.finance/api/v1';
const USE_PROXY = HttpClient.isProductionHost && HttpClient.isProductionHost();

function authHeaders(apiKey) {
    return {
        'X-API-KEY': apiKey,
        'accept': 'application/json'
    };
}

function buildUrl(path, params, apiKey) {
    if (USE_PROXY) {
        // Use proxy in production to avoid CORS
        const queryParams = new URLSearchParams({ apiKey, path, ...params });
        return `/api/cielo?${queryParams.toString()}`;
    } else {
        // Direct API call in development
        const queryParams = new URLSearchParams(params);
        const queryString = queryParams.toString();
        return queryString ? `${BASE}/${path}?${queryString}` : `${BASE}/${path}`;
    }
}

/**
 * Get wallet portfolio (token balances + USD values)
 * Supports Solana and EVM chains (Ethereum, Base, HyperEVM)
 * Cost: 20 credits per request
 */
export async function getWalletPortfolio(wallet, apiKey, { timeoutMs = 15000 } = {}) {
    if (!apiKey || !wallet) {
        console.warn('[Cielo] Missing API key or wallet address');
        return null;
    }

    const url = buildUrl(`${wallet}/portfolio`, {}, apiKey);
    const headers = USE_PROXY ? {} : authHeaders(apiKey);

    try {
        const result = await HttpClient.getJson(url, { headers, timeoutMs });
        return result;
    } catch (err) {
        console.warn('[Cielo] getWalletPortfolio failed:', err.message);
        return null;
    }
}

/**
 * Get token PNL for a wallet
 * Cost: 5 credits per request
 * @param {string} wallet - Wallet address
 * @param {string} apiKey - Cielo API key
 * @param {Object} options - Options
 * @param {string} options.timeframe - '1d', '7d', '30d', or 'max' (default: 'max')
 * @param {boolean} options.activePositionsOnly - Filter to active positions only
 */
export async function getTokenPnl(wallet, apiKey, { timeoutMs = 15000, timeframe = 'max', activePositionsOnly = false } = {}) {
    if (!apiKey || !wallet) {
        console.warn('[Cielo] Missing API key or wallet address');
        return null;
    }

    const params = { timeframe };
    if (activePositionsOnly) {
        params.active_positions_only = 'true';
    }

    const url = buildUrl(`${wallet}/pnl/tokens`, params, apiKey);
    const headers = USE_PROXY ? {} : authHeaders(apiKey);

    try {
        const result = await HttpClient.getJson(url, { headers, timeoutMs });
        return result;
    } catch (err) {
        console.warn('[Cielo] getTokenPnl failed:', err.message);
        return null;
    }
}

export default { getWalletPortfolio, getTokenPnl };
