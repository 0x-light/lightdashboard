// Centralized CORS Proxy Utility
// Provides multiple fallback strategies for CORS-restricted APIs

import { HttpClient } from './client.js';

// Public CORS proxy services (used as fallbacks)
const PUBLIC_PROXIES = [
    { name: 'allorigins', build: (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}` },
    { name: 'corsproxy', build: (url) => `https://corsproxy.io/?${encodeURIComponent(url)}` },
    { name: 'cors-anywhere', build: (url) => `https://cors-anywhere.herokuapp.com/${url}` }
];
const PROXY_COOLDOWN_UNTIL = new Map();
const DEFAULT_PROXY_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

function parseHttpStatus(error) {
    if (!error) return null;
    if (Number.isFinite(error.status)) return Number(error.status);
    const message = String(error.message || '');
    const match = message.match(/\bHTTP\s+(\d{3})\b/i);
    return match ? Number(match[1]) : null;
}

function isProxyCoolingDown(name) {
    const until = PROXY_COOLDOWN_UNTIL.get(name) || 0;
    return until > Date.now();
}

function putProxyOnCooldown(name, status, cooldownMs = DEFAULT_PROXY_COOLDOWN_MS) {
    if (!name) return;
    // 403/429 proxies are typically blocked/rate-limited; avoid hammering them.
    if (status === 403 || status === 429) {
        PROXY_COOLDOWN_UNTIL.set(name, Date.now() + cooldownMs);
    }
}

/**
 * Attempt to fetch a URL with automatic CORS proxy fallback
 * In PRODUCTION: Only use Cloudflare proxy (no public proxies - they violate CSP)
 * In LOCALHOST: Try direct first, then a limited number of public proxies sequentially
 */
export async function fetchWithCorsProxy(url, options = {}) {
    const {
        cloudflareProxy = null,
        timeoutMs = 8000,
        preferDirect = true,
        maxPublicProxyAttempts = 2,
        publicProxyCooldownMs = DEFAULT_PROXY_COOLDOWN_MS
    } = options;

    const isProduction = HttpClient.isProductionHost();

    // Helper to fetch and parse JSON
    const tryFetch = async (attempt) => {
        const { attemptUrl, proxyName } = attempt;
        const response = await HttpClient.fetchWithTimeout(attemptUrl, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        }, timeoutMs);

        if (!response.ok) {
            const error = new Error(`HTTP ${response.status}`);
            error.status = response.status;
            error.proxyName = proxyName || null;
            throw error;
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
        return await tryFetch({ attemptUrl: proxyUrl, proxyName: 'cloudflare' });
    }

    // LOCALHOST/DEV: Try direct + limited public proxy fallbacks sequentially.
    // Sequential execution avoids creating request storms and proxy rate-limits.
    const attempts = [];

    if (preferDirect) {
        attempts.push({ attemptUrl: url, proxyName: null });
    }

    // Public proxies as fallback for localhost only
    if (!isProduction && maxPublicProxyAttempts > 0) {
        let added = 0;
        for (const proxy of PUBLIC_PROXIES) {
            if (added >= maxPublicProxyAttempts) break;
            if (isProxyCoolingDown(proxy.name)) continue;
            attempts.push({ attemptUrl: proxy.build(url), proxyName: proxy.name });
            added += 1;
        }
    }

    if (attempts.length === 0) {
        throw new Error('No CORS proxy attempts available');
    }

    let lastError = null;
    for (const attempt of attempts) {
        try {
            return await tryFetch(attempt);
        } catch (error) {
            lastError = error;
            const status = parseHttpStatus(error);
            if (attempt.proxyName) {
                putProxyOnCooldown(attempt.proxyName, status, publicProxyCooldownMs);
            }
        }
    }

    throw lastError || new Error('All CORS proxy attempts failed');
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
