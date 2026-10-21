// Cloudflare Pages Function: Interactive Brokers Flex Web Service proxy.
// IBKR serves no CORS headers, and a Flex report takes two calls: SendRequest starts the report
// and returns a reference code, GetStatement fetches it once it is ready. This function does both
// and returns the statement XML. The token and query ID arrive in headers so they stay out of
// URLs and logs. Responses are never cached: the token belongs to one person.

const FLEX_BASE = 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService';

// IBKR allows 1 request per second and 10 per minute per token. Up to 5 GetStatement attempts
// keeps one refresh well inside that.
const POLL_DELAYS_MS = [1500, 2500, 3500, 5000, 7000];

// Codes that mean "report not ready yet, ask again".
const RETRY_CODES = new Set(['1001', '1004', '1005', '1006', '1007', '1008', '1009', '1019', '1021']);

function cors(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Ibkr-Token, X-Ibkr-Query',
    'Cache-Control': 'no-store',
    ...extra
  };
}

function jsonError(status, message, code = null) {
  return new Response(JSON.stringify({ error: message, code }), {
    status,
    headers: cors({ 'Content-Type': 'application/json' })
  });
}

function tag(xml, name) {
  const match = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return match ? match[1].trim() : null;
}

async function flexGet(path, params) {
  const url = `${FLEX_BASE}/${path}?${new URLSearchParams({ ...params, v: '3' })}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'lightdashboard/1.0', 'Accept': 'application/xml,text/xml,*/*' }
  });
  return res.text();
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export async function onRequest(context) {
  const { request } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors({ 'Access-Control-Max-Age': '86400' }) });
  }
  if (request.method !== 'GET') {
    return jsonError(405, 'Method not allowed');
  }

  const token = (request.headers.get('x-ibkr-token') || '').trim();
  const queryId = (request.headers.get('x-ibkr-query') || '').trim();
  if (!/^[A-Za-z0-9]{6,64}$/.test(token) || !/^\d{3,20}$/.test(queryId)) {
    return jsonError(400, 'Missing or invalid token or query ID');
  }

  try {
    const started = await flexGet('SendRequest', { t: token, q: queryId });
    if (tag(started, 'Status') !== 'Success') {
      return jsonError(502, tag(started, 'ErrorMessage') || 'IBKR did not start the report', tag(started, 'ErrorCode'));
    }
    const reference = tag(started, 'ReferenceCode');
    if (!reference) return jsonError(502, 'IBKR sent no reference code');

    let lastError = null;
    for (const delay of POLL_DELAYS_MS) {
      await sleep(delay);
      const body = await flexGet('GetStatement', { t: token, q: reference });
      if (body.includes('<FlexQueryResponse')) {
        return new Response(body, { status: 200, headers: cors({ 'Content-Type': 'application/xml; charset=utf-8' }) });
      }
      const code = tag(body, 'ErrorCode');
      lastError = { message: tag(body, 'ErrorMessage') || 'IBKR sent an unexpected response', code };
      if (!RETRY_CODES.has(code)) break;
    }
    return jsonError(502, lastError?.message || 'IBKR report not ready', lastError?.code);
  } catch (err) {
    return jsonError(502, String(err?.message || err));
  }
}
