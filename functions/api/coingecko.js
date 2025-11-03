// Cloudflare Function: CoinGecko CORS Proxy
// Purpose: Bypass CORS restrictions for CoinGecko API

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  
  // Get target URL from query parameter
  const targetUrl = url.searchParams.get('url');
  
  if (!targetUrl || !targetUrl.startsWith('https://api.coingecko.com/')) {
    return new Response('Invalid URL parameter. Must start with https://api.coingecko.com/', {
      status: 400,
      headers: { 'Content-Type': 'text/plain' }
    });
  }

  try {
    // Fetch from CoinGecko
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
        'Cache-Control': 'public, max-age=60' // Cache for 1 minute
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

