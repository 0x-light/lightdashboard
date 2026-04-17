// Cloudflare Pages Function: Yahoo Finance CORS proxy.
// Forwards GETs to `query1.finance.yahoo.com` / `query2.finance.yahoo.com` so the browser can
// reach them without CORS. Target URL is passed in the `url` query param; we only allow the
// two Yahoo hosts to prevent the proxy from being used as an open relay.

const ALLOWED_HOSTS = new Set([
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com'
]);

function cors(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...extra
  };
}

export async function onRequest(context) {
  const { request } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors() });
  }
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: cors() });
  }

  const url = new URL(request.url);
  const targetParam = url.searchParams.get('url');
  if (!targetParam) {
    return new Response('Missing url parameter', { status: 400, headers: cors() });
  }

  let target;
  try {
    target = new URL(targetParam);
  } catch {
    return new Response('Invalid target URL', { status: 400, headers: cors() });
  }
  if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname)) {
    return new Response('Target host not allowed', { status: 400, headers: cors() });
  }

  try {
    const upstream = await fetch(target.toString(), {
      // Yahoo serves different bodies based on User-Agent; a browser-looking UA is required
      // to get JSON from the search and quote endpoints.
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json,text/plain,*/*',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      cf: { cacheTtl: 30, cacheEverything: true }
    });

    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: cors({
        'Content-Type': upstream.headers.get('content-type') || 'application/json',
        // Short cache reduces rate-limit pressure when several users hit the same quote.
        'Cache-Control': 'public, max-age=30'
      })
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 502,
      headers: cors({ 'Content-Type': 'application/json' })
    });
  }
}
