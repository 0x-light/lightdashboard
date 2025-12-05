// Centralized CORS Proxy Utility
// Provides multiple fallback strategies for CORS-restricted APIs

import { HttpClient } from './client.js';

// Public CORS proxy services (used as fallbacks)
const PUBLIC_PROXIES = [
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    (url) => `https://cors-anywhere.herokuapp.com/${url}`
];

/**
 * Attempt to fetch a URL with automatic CORS proxy fallback
 * In PRODUCTION: Only use Cloudflare proxy (no public proxies - they violate CSP)
 * In LOCALHOST: Race all proxies in parallel for best speed
 */
export async function fetchWithCorsProxy(url, options = {}) {
    const {
        cloudflareProxy = null,
        timeoutMs = 8000
    } = options;

    const isProduction = HttpClient.isProductionHost();

    // Helper to fetch and parse JSON
    const tryFetch = async (attemptUrl) => {
        const response = await HttpClient.fetchWithTimeout(attemptUrl, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        }, timeoutMs);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            return await response.json();
        }
        const text = await response.text();
        return JSON.parse(text);
    };

    // PRODUCTION: Only use Cloudflare proxy - no fallbacks (CSP blocks public proxies)
    if (isProduction && cloudflareProxy) {
        const urlObj = new URL(url);
        const path = urlObj.pathname + urlObj.search;
        const proxyUrl = cloudflareProxy + encodeURIComponent(path);
        return await tryFetch(proxyUrl);
    }

    // LOCALHOST: Race all available options in parallel
    const attempts = [];

    // Direct URL (may work if CORS headers are present)
    attempts.push(url);

    // Public proxies as fallback for localhost only
    for (const proxyFn of PUBLIC_PROXIES) {
        attempts.push(proxyFn(url));
    }

    try {
        return await Promise.any(attempts.map(attemptUrl => tryFetch(attemptUrl)));
    } catch (aggregateError) {
        // All attempts failed - silent on localhost to avoid spam
        throw new Error('All CORS proxy attempts failed');
    }
}

/**
 * Build a Pyth API URL with Cloudflare proxy in production
 */
export function buildPythUrl(path) {
    if (HttpClient.isProductionHost()) {
        return `/api/pyth?path=${encodeURIComponent(path)}`;
    }
    return `https://hermes.pyth.network${path.startsWith('/') ? path : '/' + path}`;
}

/**
 * Build a CoinGecko API URL with Cloudflare proxy in production
 */
export function buildCoinGeckoUrl(url) {
    if (HttpClient.isProductionHost()) {
        return `/api/coingecko?url=${encodeURIComponent(url)}`;
    }
    return url;
}

export default { fetchWithCorsProxy, buildPythUrl, buildCoinGeckoUrl };
