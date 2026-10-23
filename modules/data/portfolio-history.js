// The portfolio's value over a period, one series per account from that account's own
// source, so every device draws the same line:
//   Hyperliquid   the portfolio endpoint (hl-account.js), per address: its P&L history, so
//                 deposits and withdrawals don't show as gains or losses (its value
//                 history when the P&L line would dip below zero)
//   Lighter       its P&L history per account: the value's changes, hourly or daily
//   EVM wallets   Zerion's balance chart per wallet
//   IBKR          the daily net asset value in the Flex statement, if the query includes it
//   the rest      today's amount at the asset's price history: Hyperliquid candles for
//                 crypto, Yahoo for equities. Manual holdings, Bitcoin, Zcash, Solana,
//                 Hyperliquid staking and Lighter spot are read this way.
// Every series is scaled to end at the value the page shows for it (Lighter's, a series of
// changes, is shifted instead), so the line ends at the portfolio total and never dips
// below zero. A holding with no history stays flat at its value. Before its first point a
// series holds that point's value.
// Fetched only for the period on screen, each series cached five minutes.
import { getPortfolio } from './hl-account.js';
import { fetchCandles } from './providers/hyperliquid.js';
import { fetchPnlHistory } from './providers/lighter.js';
import { getWalletChart } from './providers/zerion.js';
import { getStatement } from './providers/ibkr.js';
import { get24hPriceHistory } from './providers/stocks.js';
import { normalizeBaseCurrency } from '../utils/currency.js';
import { isCoveredByVenueEquity } from '../domain/portfolio.js';

const DAY = 24 * 60 * 60 * 1000;
const TTL_MS = 5 * 60 * 1000;
const YEAR_MS = 365 * DAY;

// Per period: the window, and how each source is asked for it.
export const PERIODS = {
  day: { ms: DAY, zerion: 'day', lighter: ['1h', 25], hl: '1h', yahoo: ['1d', '15m'] },
  week: { ms: 7 * DAY, zerion: 'week', lighter: ['1h', 169], hl: '1h', yahoo: ['5d', '1h'] },
  month: { ms: 30 * DAY, zerion: 'month', lighter: ['1d', 31], hl: '1d', yahoo: ['1mo', '1d'] },
  allTime: { ms: Infinity, zerion: 'max', lighter: ['1d', 366], hl: '1d', yahoo: ['1y', '1d'] }
};

const SYMBOLS = { USD: '$', EUR: '€', GBP: '£' };
// Dollar-pegged tokens: a flat line, and no request.
const STABLE = new Set(['USDC', 'USDT', 'DAI', 'USDE', 'SUSDE', 'USDS', 'FDUSD', 'PYUSD', 'TUSD', 'USDH', 'USD0', 'USR', 'USDB', 'GHO', 'LUSD', 'CRVUSD', 'FRAX', 'USD']);
const EQUITY_CATEGORIES = new Set(['equity', 'etf', 'fund', 'stock']);

const cache = new Map(); // key -> { at, promise }
function cached(key, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const promise = load().catch((err) => {
    cache.delete(key);
    throw err;
  });
  cache.set(key, { at: Date.now(), promise });
  return promise;
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// ── Series arithmetic, on [[t, v]] lists sorted by t ──

// Reads a series in time order: the last point at or before t, the first point before any.
export function stepper(series) {
  let i = 0;
  let v = series.length ? series[0][1] : 0;
  return (t) => {
    while (i < series.length && series[i][0] <= t) v = series[i++][1];
    return v;
  };
}

// The parts added up on every timestamp any of them has from `since` on.
export function sumSeries(parts, since = 0) {
  const ts = [];
  for (const s of parts) for (const [t] of s) if (t >= since) ts.push(t);
  ts.sort((a, b) => a - b);
  const steps = parts.map(stepper);
  const values = [];
  let last = null;
  for (const t of ts) {
    if (t === last) continue;
    last = t;
    let v = 0;
    for (const at of steps) v += at(t);
    values.push([t, v]);
  }
  return values;
}

// The window from `since`, keeping the last point before it so the start is known.
export function clip(series, since) {
  let i = 0;
  while (i + 1 < series.length && series[i + 1][0] < since) i++;
  return series.slice(i);
}

// Shifted to end at `live`, which is added as the final point.
export function anchored(series, live, now) {
  if (!series.length) return [[now, live]];
  const shift = live - series[series.length - 1][1];
  return series.map(([t, v]) => [t, v + shift]).concat([[now, live]]);
}

// Scaled to end at `live`, which is added as the final point: a price history becomes the
// holding's value, an account's value history keeps its shape and its zero. A series that
// ends at or below zero can't be scaled, so it is shifted.
export function scaled(series, live, now) {
  const last = series.length ? series[series.length - 1][1] : 0;
  if (!(last > 0)) return anchored(series, live, now);
  return series.map(([t, v]) => [t, live * v / last]).concat([[now, live]]);
}

// An account's line without its deposits and withdrawals: today's value less the P&L made
// since each point. Its value history instead when that would dip below zero, as for an
// account that took out more than it now holds.
export function netOfTransfers(values, pnl, live, now) {
  const net = pnl.length ? anchored(pnl, live, now) : [];
  return net.length && net.every(([, v]) => v >= 0) ? net : scaled(values, live, now);
}

// ── Which rows belong to which account ──

// Rows sorted into accounts with their live values (base currency), and the holdings
// priced one by one. Rows inside a venue's equity row add nothing of their own, by the
// same rule as calculatePortfolioTotals.
export function plan(rows) {
  const hasHlEquity = rows.some(p => p?.isHlAccountEquity);
  const hasLighterEquity = rows.some(p => p?.isLighterAccountEquity);
  const hl = new Map();
  const lighter = new Map();
  const zerion = new Map();
  let ibkr = null;
  const priced = [];
  const add = (map, key, value) => map.set(key, (map.get(key) || 0) + value);
  for (const p of rows) {
    if (!p) continue;
    const value = Number(p.value);
    if (!Number.isFinite(value) || value === 0) continue;
    const src = String(p._source || '');
    if (p.isHlAccountEquity) { add(hl, src.replace(/^Hyperliquid_/, ''), value); continue; }
    if (p.isLighterAccountEquity) { add(lighter, String(p._changeDetectionKey || '').split('_').pop(), value); continue; }
    if (isCoveredByVenueEquity(p, hasHlEquity, hasLighterEquity)) continue;
    if (src.startsWith('Zerion_')) { add(zerion, src.slice('Zerion_'.length), value); continue; }
    if (src === 'IBKR') { ibkr = (ibkr || 0) + value; continue; }
    priced.push(p);
  }
  return { hl, lighter, zerion, ibkr, priced };
}

// Where a holding's price history comes from: "hl:ETH", "yahoo:AAPL", or null for none.
export function priceKeyOf(p) {
  const asset = String(p?.asset || '').trim();
  const exchange = String(p?.exchange || '');
  const category = String(p?.category || '').toLowerCase();
  if (!asset || exchange === 'Manual (Custom)') return null;
  if (EQUITY_CATEGORIES.has(category) || /^Manual \(Stock/.test(exchange)) {
    return /^[A-Z0-9.\-]{1,12}$/i.test(asset) ? `yahoo:${asset.toUpperCase()}` : null;
  }
  if (category && category !== 'crypto') return null;
  const coin = asset.toUpperCase();
  if (STABLE.has(coin) || !/^[A-Z0-9]{1,12}$/.test(coin)) return null;
  return `hl:${coin}`;
}

// ── Each source's series, in dollars (or the statement's currency for IBKR) ──

async function hlPrices(coin, period) {
  const cfg = PERIODS[period];
  const now = Date.now();
  const start = now - Math.min(cfg.ms, YEAR_MS);
  let candles = await fetchCandles(coin, cfg.hl, start, now, 8000);
  if (!candles.length) candles = await fetchCandles(`${coin}/USDC`, cfg.hl, start, now, 8000);
  return candles.map(c => [num(c.t), num(c.c)]).filter(([t, c]) => t > 0 && c > 0).sort((a, b) => a[0] - b[0]);
}

async function yahooPrices(symbol, period) {
  const [range, interval] = PERIODS[period].yahoo;
  const points = await get24hPriceHistory(symbol, { range, interval, timeoutMs: 8000 });
  return points.map(p => [num(p.timestamp), num(p.price)]).filter(([t, c]) => t > 0 && c > 0);
}

function prices(key, period) {
  const [source, name] = key.split(':');
  return cached(`price:${key}:${period}`, () => (source === 'yahoo' ? yahooPrices(name, period) : hlPrices(name, period)));
}

// IBKR's end-of-day totals, summed over accounts, each in the statement's currency
// converted by `rate`. The statement is the one the positions come from (cached an hour).
async function ibkrNav(settings, rate) {
  const { statement } = await getStatement(settings.ibkrFlexToken, settings.ibkrFlexQueryId, { timeoutMs: 30000 });
  const byDate = new Map();
  for (const account of statement?.accounts || []) {
    const fx = rate(account.currency || 'USD');
    for (const { date, total } of account.nav || []) {
      byDate.set(date, (byDate.get(date) || 0) + total * fx);
    }
  }
  return Array.from(byDate, ([date, total]) => {
    const [y, m, d] = date.split('-').map(Number);
    return [Date.UTC(y, m - 1, d, 21), total]; // after the US close
  }).filter(([t]) => Number.isFinite(t)).sort((a, b) => a[0] - b[0]);
}

/**
 * The portfolio over `period`: { values: [[t, v]], currency, symbol }. `rows` are the
 * page's positions before merging by asset (each still names its source); `renderer`
 * gives the settings and FX rates. Empty `values` when there is nothing to draw.
 */
export async function getPortfolioHistory(period, {
  rows = (typeof window !== 'undefined' && (window.venuePositions || window.cachedPositions)) || [],
  renderer = typeof window !== 'undefined' ? window._portfolioRenderer : null,
  now = Date.now()
} = {}) {
  const cfg = PERIODS[period] || PERIODS.week;
  const since = cfg.ms === Infinity ? 0 : now - cfg.ms;
  const settings = renderer?.settings || {};
  const currency = normalizeBaseCurrency(settings.portfolioBaseCurrency);
  const rate = (c) => {
    const r = renderer?.conversionRateFor?.(c);
    return Number.isFinite(r) && r > 0 ? r : 1;
  };
  const usd = rate('USD');
  const inBase = (series) => series.map(([t, v]) => [t, v * usd]);
  const groups = plan(rows);
  const tasks = [];

  // Account series: fetched (cached), clipped to the window, ending at the live value.
  const account = (key, live, load, fit = scaled) => tasks.push(
    cached(key, load).catch(() => []).then(series => fit(clip(series, since), live, now))
  );
  for (const [wallet, live] of groups.hl) {
    tasks.push(cached(`hl:${wallet}:${period}`, () => getPortfolio(wallet).then(p => p?.[period] || {}))
      .catch(() => ({}))
      .then(p => netOfTransfers(clip(inBase(p.values || []), since), clip(inBase(p.pnl || []), since), live, now)));
  }
  for (const [index, live] of groups.lighter) {
    if (!/^\d+$/.test(index)) { tasks.push(Promise.resolve([[now, live]])); continue; }
    const [resolution, countBack] = cfg.lighter;
    account(`lighter:${index}:${period}`, live, () => fetchPnlHistory(index, { resolution, countBack })
      .then(points => inBase(points.map(p => [p.t, p.equityDelta]))), anchored);
  }
  for (const [wallet, live] of groups.zerion) {
    if (!settings.zerionApiKey) { tasks.push(Promise.resolve([[now, live]])); continue; }
    account(`zerion:${wallet}:${period}`, live, () => getWalletChart(wallet, settings.zerionApiKey, cfg.zerion).then(inBase));
  }
  if (groups.ibkr !== null) {
    account(`ibkr:${currency}`, groups.ibkr, () => ibkrNav(settings, rate));
  }

  // Priced holdings: one price history per asset, each row scaled by it. Rows too small to
  // be listed stay flat rather than cost a request.
  const minValue = Number(settings.minBalanceThreshold) || 100;
  for (const p of groups.priced) {
    const live = Number(p.value);
    const key = Math.abs(live) >= minValue ? priceKeyOf(p) : null;
    if (!key) { tasks.push(Promise.resolve([[now, live]])); continue; }
    tasks.push(prices(key, period).catch(() => []).then(series => scaled(clip(series, since), live, now)));
  }

  const parts = await Promise.all(tasks);
  return { values: sumSeries(parts, since), currency, symbol: SYMBOLS[currency] || `${currency} ` };
}

/** True once every provider has reported this round, so live values are the real ones. */
export function isPortfolioSettled(renderer = typeof window !== 'undefined' ? window._portfolioRenderer : null) {
  if (!renderer) return false;
  if (renderer.isLoading) return false;
  return (renderer.expectedProviders || []).every(name => renderer.providerStatus?.has?.(name));
}

export default { getPortfolioHistory, isPortfolioSettled, PERIODS };
