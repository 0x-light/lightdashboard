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
const DEFAULT_DEV_PROXY_ORIGIN = 'https://viewport.is';
const DEV_PROXY_ORIGIN_KEY = 'ld_proxy_origin';

function normalizeOrigin(origin) {
    if (typeof origin !== 'string') return null;
    const trimmed = origin.trim().replace(/\/+$/, '');
    if (!trimmed) return null;
    if (!/^https?:\/\//i.test(trimmed)) return null;
    try {
        const parsed = new URL(trimmed);
        return `${parsed.protocol}//${parsed.host}`;
    } catch (_) {
        return null;
    }
}

function getConfiguredDevProxyOrigin() {
    if (HttpClient.isProductionHost()) return '';
    try {
        const fromWindow = normalizeOrigin(window.__LD_PROXY_ORIGIN__);
        if (fromWindow) return fromWindow;
    } catch (_) { /* ignore */ }
    try {
        const fromStorage = normalizeOrigin(localStorage.getItem(DEV_PROXY_ORIGIN_KEY));
        if (fromStorage) return fromStorage;
    } catch (_) { /* ignore */ }
    return DEFAULT_DEV_PROXY_ORIGIN;
}

function resolveProxyPrefix(prefix) {
    if (!prefix || typeof prefix !== 'string') return null;
    if (/^https?:\/\//i.test(prefix)) return prefix;
    if (prefix.startsWith('/')) {
        if (HttpClient.isProductionHost()) return prefix;
        const devOrigin = getConfiguredDevProxyOrigin();
        return `${devOrigin}${prefix}`;
    }
    return prefix;
}

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
 * Attempt to fetch a URL with optional first-party proxy and fallback strategy.
 * In production, public proxies are always disabled.
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

    // Build attempts in priority order.
    const attempts = [];

    const resolvedCloudflareProxy = resolveProxyPrefix(cloudflareProxy);
    if (resolvedCloudflareProxy) {
        let path = '';
        try {
            const urlObj = new URL(url);
            path = urlObj.pathname + urlObj.search;
        } catch (_) {
            path = String(url || '');
        }
        attempts.push({
            attemptUrl: `${resolvedCloudflareProxy}${encodeURIComponent(path)}`,
            proxyName: 'cloudflare'
        });
    }

    if (preferDirect) {
        attempts.push({ attemptUrl: url, proxyName: null });
    }

    // Public proxies as fallback for localhost only (disabled in production).
    const allowedPublicAttempts = isProduction ? 0 : Math.max(0, Number(maxPublicProxyAttempts) || 0);
    if (allowedPublicAttempts > 0) {
        let added = 0;
        for (const proxy of PUBLIC_PROXIES) {
            if (added >= allowedPublicAttempts) break;
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
    const proxyPrefix = resolveProxyPrefix('/api/pyth?path=');
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${proxyPrefix}${encodeURIComponent(normalizedPath)}`;
}

/**
 * Build a CoinGecko API URL with Cloudflare proxy in production
 */
export function buildCoinGeckoUrl(url) {
    const proxyPrefix = resolveProxyPrefix('/api/coingecko?url=');
    return `${proxyPrefix}${encodeURIComponent(url)}`;
}

export default { fetchWithCorsProxy, buildPythUrl, buildCoinGeckoUrl };
