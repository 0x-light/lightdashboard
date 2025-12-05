// Cloudflare Function: Pyth Network CORS Proxy
// Purpose: Bypass CORS restrictions for Pyth Hermes API

export async function onRequest(context) {
    const { request } = context;
    const url = new URL(request.url);

    // Handle preflight OPTIONS requests
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Max-Age': '86400'
            }
        });
    }

    // Get target path from query parameter
    const path = url.searchParams.get('path');

    if (!path) {
        return new Response('Missing path parameter', {
            status: 400,
            headers: {
                'Content-Type': 'text/plain',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }

    // Construct the full Pyth Hermes URL
    const targetUrl = `https://hermes.pyth.network${path.startsWith('/') ? path : '/' + path}`;

    try {
        // Fetch from Pyth
        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; PortfolioTracker/1.0)',
                'Accept': 'application/json'
            }
        });

        // Get the response data
        const data = await response.text();

        // Return with CORS headers
        return new Response(data, {
            status: response.status,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Cache-Control': 'public, max-age=30' // Cache for 30 seconds (price data needs to be fresh)
            }
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
}
