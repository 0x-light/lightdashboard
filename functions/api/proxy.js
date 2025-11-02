// Cloudflare Function: CORS Proxy for Comics
// This allows fetching comic strips from GoComics and The Far Side
// without being blocked by CORS policies

export async function onRequest(context) {
  const { request } = context;
  
  // Only allow GET requests
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }
  
  // Get the target URL from query parameter
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get('url');
  
  if (!targetUrl) {
    return new Response('Missing url parameter', { status: 400 });
  }
  
  // Whitelist allowed domains for security
  const allowedDomains = [
    'www.gocomics.com',
    'www.thefarside.com',
    'assets.amuniversal.com',
    'featureassets.amuniversal.com'
  ];
  
  let targetHostname;
  try {
    targetHostname = new URL(targetUrl).hostname;
  } catch (e) {
    return new Response('Invalid URL', { status: 400 });
  }
  
  if (!allowedDomains.includes(targetHostname)) {
    return new Response('Domain not allowed', { status: 403 });
  }
  
  try {
    // Fetch the target URL with proper headers
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Cache-Control': 'no-cache',
        'Referer': targetUrl
      }
    });
    
    if (!response.ok) {
      return new Response(`Failed to fetch: ${response.status}`, { status: response.status });
    }
    
    // Get the response body
    const body = await response.text();
    
    // Return with CORS headers
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'text/html',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
      }
    });
  } catch (error) {
    return new Response(`Error: ${error.message}`, { status: 500 });
  }
}

