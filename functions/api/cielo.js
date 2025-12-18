// Cloudflare Function: Cielo Finance API Proxy
// This proxies Cielo API requests to avoid CORS issues in production

export async function onRequest(context) {
    const { request, env } = context;

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-KEY',
                'Access-Control-Max-Age': '86400'
            }
        });
    }

    // Only allow GET requests
    if (request.method !== 'GET') {
        return new Response('Method not allowed', { status: 405 });
    }

    // Get parameters
    const url = new URL(request.url);
    const apiKey = url.searchParams.get('apiKey');
    const path = url.searchParams.get('path'); // e.g., "0x.../portfolio" or "0x.../pnl/tokens"

    if (!apiKey) {
        return new Response('Missing apiKey parameter', { status: 400 });
    }

    if (!path) {
        return new Response('Missing path parameter', { status: 400 });
    }

    // Build Cielo URL
    const targetUrl = `https://feed-api.cielo.finance/api/v1/${path}`;

    // Get all other query parameters (except apiKey and path)
    const params = new URLSearchParams();
    for (const [key, value] of url.searchParams.entries()) {
        if (key !== 'apiKey' && key !== 'path') {
            params.append(key, value);
        }
    }

    const finalUrl = params.toString() ? `${targetUrl}?${params.toString()}` : targetUrl;

    try {
        // Fetch from Cielo API
        const response = await fetch(finalUrl, {
            headers: {
                'X-API-KEY': apiKey,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            const error = await response.text();
            return new Response(error, {
                status: response.status,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                }
            });
        }

        // Get the response
        const data = await response.json();

        // Return with CORS headers
        return new Response(JSON.stringify(data), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-KEY',
                'Cache-Control': 'public, max-age=10' // Cache for 10 seconds
            }
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            }
        });
    }
}
