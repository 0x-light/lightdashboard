// OpenSea provider
import { HttpClient } from '../../http/client.js';

const BASE = 'https://api.opensea.io/api/v2';

function headers(apiKey) {
  const h = { 'accept': 'application/json' };
  if (apiKey) h['X-API-KEY'] = apiKey;
  return h;
}

export async function fetchAccountNFTs(chain, address, apiKey, { timeoutMs = 15000 } = {}) {
  const url = `${BASE}/chain/${chain}/account/${address}/nfts?limit=200`;
  return await HttpClient.getJson(url, { headers: headers(apiKey), timeoutMs }).catch(() => null);
}

export async function fetchCollectionStats(slug, apiKey, { timeoutMs = 15000 } = {}) {
  const url = `${BASE}/collections/${slug}/stats`;
  return await HttpClient.getJson(url, { headers: headers(apiKey), timeoutMs }).catch(() => null);
}

export async function fetchNFTEvents(chain, contractAddress, tokenId, apiKey, { timeoutMs = 15000 } = {}) {
  const url = `${BASE}/events/chain/${chain}/contract/${contractAddress}/nfts/${tokenId}?event_type=sale`;
  return await HttpClient.getJson(url, { headers: headers(apiKey), timeoutMs }).catch(() => null);
}

export default { fetchAccountNFTs, fetchCollectionStats, fetchNFTEvents };


