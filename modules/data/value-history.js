// Portfolio value over time, recorded on this device. Only Hyperliquid has a history API;
// IBKR, Lighter, wallets and manual holdings have none, so the dashboard keeps its own:
// one point every few minutes while the page is open, thinned to one an hour after a day
// and one a day after a month. The value chart adds these to Hyperliquid's own history.
// Each point is [time, total, hyperliquid], so the chart can take the Hyperliquid part
// out and use the exchange's series for it instead.

const KEY = 'viewport.valueHistory.v1';
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const STEP = 5 * MINUTE;      // closest two points get
const HOURLY_AFTER = DAY;     // older than this: one point an hour
const DAILY_AFTER = 30 * DAY; // older than this: one point a day

let store = null; // { currency, points: [[t, total, hl]] }

function load() {
  if (store) return store;
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (parsed && Array.isArray(parsed.points)) store = parsed;
  } catch (_) { /* unavailable or unreadable: start empty */ }
  return store || (store = { currency: 'USD', points: [] });
}

// Thin old points, keeping the last of each hour or day. Points are oldest first, so the
// buckets only ever get finer along the list.
function thin(points, now) {
  const out = [];
  for (const p of points) {
    const age = now - p[0];
    const bucket = age > DAILY_AFTER ? DAY : age > HOURLY_AFTER ? HOUR : 0;
    const last = out[out.length - 1];
    if (bucket && last && Math.floor(last[0] / bucket) === Math.floor(p[0] / bucket)) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

const cents = (v) => Math.round(v * 100) / 100;

/**
 * Add a point for the portfolio as it stands. Call it only with a complete portfolio
 * (every provider reported), or a half-loaded total would record as a dip.
 */
export function recordPortfolioValue({ positions, totalValue, currency = 'USD' }) {
  if (!(totalValue > 0)) return;
  const now = Date.now();
  const s = load();
  const last = s.points[s.points.length - 1];
  if (last && now - last[0] < STEP) return;
  let hl = 0;
  for (const p of positions || []) if (p?.isHlAccountEquity) hl += Number(p.value) || 0;
  if (s.currency !== currency) { // amounts in another currency don't join up
    s.currency = currency;
    s.points = [];
  }
  s.points.push([now, cents(totalValue), cents(hl)]);
  s.points = thin(s.points, now);
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (_) { /* storage full: kept in memory */ }
  window.dispatchEvent(new CustomEvent('viewport:valuehistory')); // the value chart redraws
}

/** Everything recorded so far: { currency, points: [[t, total, hl]] }, oldest first. */
export function getValueHistory() {
  const s = load();
  return { currency: s.currency, points: s.points };
}

export const _internal = { thin };

export default { recordPortfolioValue, getValueHistory };
