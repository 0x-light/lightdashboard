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
 * Strategy: Race all proxies in PARALLEL and use the first success
 */
export async function fetchWithCorsProxy(url, options = {}) {
    const {
        cloudflareProxy = null,
        timeoutMs = 8000, // Reduced default timeout
        usePublicProxies = true
    } = options;

    const isProduction = HttpClient.isProductionHost();
    const attempts = [];

    // Build list of URLs to try
    if (isProduction && cloudflareProxy) {
        const urlObj = new URL(url);
        const path = urlObj.pathname + urlObj.search;
        attempts.push(cloudflareProxy + encodeURIComponent(path));
    }

    // Direct URL (may work if CORS headers are present)
    attempts.push(url);

    // Public proxies as fallback
    if (usePublicProxies) {
        for (const proxyFn of PUBLIC_PROXIES) {
            attempts.push(proxyFn(url));
        }
    }

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
        return JSON.parse(text); // Will throw if not valid JSON
    };

    // RACE all attempts in parallel - first success wins
    try {
        return await Promise.any(attempts.map(attemptUrl => tryFetch(attemptUrl)));
    } catch (aggregateError) {
        // All attempts failed
        console.error('[CORS Proxy] All attempts failed:', aggregateError.errors?.map(e => e.message));
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
