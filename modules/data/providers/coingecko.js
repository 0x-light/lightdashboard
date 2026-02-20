// CoinGecko provider client (uses Cloudflare proxy in production via HttpClient)
import { HttpClient } from '../../http/client.js';
import { buildCoinGeckoUrl } from '../../http/cors-proxy.js';

function proxy(url) {
  return buildCoinGeckoUrl(url);
}

export async function getSimplePrice(idsCsv, { timeoutMs = 15000, ttlMs = 60000 } = {}) {
  if (!idsCsv) return {};
  const url = proxy(`https://api.coingecko.com/api/v3/simple/price?ids=${idsCsv}&vs_currencies=usd&include_24hr_change=true`);
  return await HttpClient.getJson(url, { timeoutMs, ttlMs }).catch(() => ({}));
}

export async function getHistoricalUsd(coinId, dateStr, { timeoutMs = 15000, ttlMs = 60000 } = {}) {
  const url = proxy(`https://api.coingecko.com/api/v3/coins/${coinId}/history?date=${dateStr}&localization=false`);
  const data = await HttpClient.getJson(url, { timeoutMs, ttlMs }).catch(() => null);
  const usd = data?.market_data?.current_price?.usd;
  return typeof usd === 'number' ? usd : null;
}

export default { getSimplePrice, getHistoricalUsd };

