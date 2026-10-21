// What kind of thing a position is: spot (anything held outright, cash included), a perp
// (leveraged, funded) or an option (a contract on an underlying). Pure: no DOM, no fetches.

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// OCC option symbol: root (up to 6 chars, space padded), yymmdd, C or P, strike × 1000.
// "ABCL  270115C00008000" → ABCL, 2027-01-15, call, 8.
const OCC = /^([A-Z][A-Z0-9.]{0,5})\s*(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/i;
// IBKR's description of the same contract: "ABCL 15JAN27 8 C".
const IBKR_DESC = /^([A-Z][A-Z0-9.]*)\s+(\d{1,2})([A-Z]{3})(\d{2})\s+(\d+(?:\.\d+)?)\s+([CP])$/i;

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * Parse an option contract out of its symbol or description.
 * @returns {{ underlying: string, expiry: string, right: 'call'|'put', strike: number } | null}
 */
export function parseOptionSymbol(text) {
  const s = String(text || '').trim().replace(/\s+/g, ' ');
  let m = s.match(OCC);
  if (m) {
    const strike = Number(m[6]) / 1000;
    if (!(strike > 0)) return null;
    return {
      underlying: m[1].toUpperCase(),
      expiry: `20${m[2]}-${m[3]}-${m[4]}`,
      right: m[5].toUpperCase() === 'C' ? 'call' : 'put',
      strike
    };
  }
  m = s.match(IBKR_DESC);
  if (m) {
    const month = MONTHS.indexOf(m[3].toUpperCase());
    const strike = Number(m[5]);
    if (month < 0 || !(strike > 0)) return null;
    return {
      underlying: m[1].toUpperCase(),
      expiry: `20${m[4]}-${pad2(month + 1)}-${pad2(m[2])}`,
      right: m[6].toUpperCase() === 'C' ? 'call' : 'put',
      strike
    };
  }
  return null;
}

/** The contract's OCC symbol without padding, as Yahoo quotes it: "MU270115C01300000". */
export function occSymbol(option) {
  if (!option) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(option.expiry || ''));
  const strike = Math.round(Number(option.strike) * 1000);
  if (!m || !(strike > 0)) return null;
  return `${option.underlying}${m[1].slice(2)}${m[2]}${m[3]}${option.right === 'put' ? 'P' : 'C'}${String(strike).padStart(8, '0')}`;
}

/** The option contract behind a position, if it is one. */
export function optionOf(pos) {
  if (!pos) return null;
  if (pos.option && typeof pos.option === 'object') return pos.option;
  if (pos.category && pos.category !== 'option') return null;
  return parseOptionSymbol(pos.asset) || parseOptionSymbol(pos.assetName);
}

/** 'perp' | 'option' | 'spot' */
export function positionKind(pos) {
  if (!pos) return 'spot';
  if (pos._strategy) return 'option'; // several legs on one name, shown as one row
  if (pos.isLeveraged) return 'perp';
  if (optionOf(pos)) return 'option';
  return 'spot';
}

export const KIND_ORDER = ['spot', 'perp', 'option'];
export const KIND_LABELS = { spot: 'Spot', perp: 'Perps', option: 'Options' };

/** Whole days from `now` to the expiry date (UTC calendar days); negative once past. */
export function daysToExpiry(expiry, now = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(expiry || ''));
  if (!m) return null;
  const end = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((end - start) / 86400000);
}

/** "15 Jan 27" */
export function formatExpiry(expiry, { year = 'short' } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(expiry || ''));
  if (!m) return '';
  const month = MONTHS[Number(m[2]) - 1];
  const name = month ? month[0] + month.slice(1).toLowerCase() : m[2];
  return `${Number(m[3])} ${name} ${year === 'short' ? m[1].slice(2) : m[1]}`;
}

/** Strike as people say it: 8, 12.5, 130. */
export function formatStrike(strike) {
  const n = Number(strike);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

/** The price of the underlying at which the contract breaks even at expiry, per share. */
export function breakevenOf(option, premium) {
  if (!option || premium == null || premium === '') return null;
  const p = Number(premium);
  if (!(p >= 0)) return null;
  return option.right === 'call' ? option.strike + p : option.strike - p;
}

/**
 * Profit or loss per share if the underlying is at `price` on expiry, for one contract
 * bought at `premium`. Negative `direction` for a written contract.
 */
export function payoffAtExpiry(option, premium, price, direction = 1) {
  const intrinsic = option.right === 'call'
    ? Math.max(price - option.strike, 0)
    : Math.max(option.strike - price, 0);
  return (intrinsic - Number(premium || 0)) * (direction < 0 ? -1 : 1);
}

/** 'in' when the contract has intrinsic value at `price`, 'out' otherwise, null when unknown. */
export function moneyness(option, price) {
  const s = Number(price);
  if (!option || !(s > 0)) return null;
  const inMoney = option.right === 'call' ? s > option.strike : s < option.strike;
  return inMoney ? 'in' : 'out';
}

// ── Several contracts on one underlying ──
// A leg: one row's contract with its signed count (written contracts count negative),
// the premium per share it was opened at (or its mark when the cost is unknown) and the
// shares per contract.
export function legOf(pos) {
  const option = optionOf(pos);
  if (!option) return null;
  const qty = Number(pos.amount) || 0;
  const entry = Number(pos.entryPrice);
  const mark = Number(pos.price);
  return {
    option,
    qty,
    premium: entry > 0 ? entry : (mark > 0 ? mark : 0),
    atCost: entry > 0,
    multiplier: Number(pos.multiplier) > 0 ? Number(pos.multiplier) : 100,
    pos
  };
}

/** Legs by underlying, each list in expiry then strike order. */
export function legsByUnderlying(positions) {
  const out = {};
  for (const pos of positions || []) {
    const leg = legOf(pos);
    if (!leg) continue;
    (out[leg.option.underlying] ||= []).push(leg);
  }
  for (const legs of Object.values(out)) {
    legs.sort((a, b) => a.option.expiry.localeCompare(b.option.expiry) || a.option.strike - b.option.strike);
  }
  return out;
}

const sum = (list, get) => list.reduce((acc, x) => acc + get(x), 0);

/**
 * What a set of legs with one expiry is called: "bull call spread", "long straddle",
 * "call ratio spread"… Plain words when nothing standard fits ("2 calls").
 */
export function strategyName(legs) {
  if (!legs?.length) return '';
  const calls = legs.filter(l => l.option.right === 'call');
  const puts = legs.filter(l => l.option.right === 'put');
  const longs = legs.filter(l => l.qty > 0);
  const shorts = legs.filter(l => l.qty < 0);
  if (legs.length === 1) return `${legs[0].qty < 0 ? 'short' : 'long'} ${legs[0].option.right}`;

  const oneSided = (side, right) => {
    const L = side.filter(l => l.qty > 0), S = side.filter(l => l.qty < 0);
    if (!S.length) return `long ${right}s`;
    if (!L.length) return `short ${right}s`;
    const qL = sum(L, l => l.qty), qS = -sum(S, l => l.qty);
    const maxL = Math.max(...L.map(l => l.option.strike)), minL = Math.min(...L.map(l => l.option.strike));
    const maxS = Math.max(...S.map(l => l.option.strike)), minS = Math.min(...S.map(l => l.option.strike));
    // Short strikes inside the long ones: a butterfly (one) or condor (two).
    if (minS > minL && maxS < maxL && L.length >= 2) return new Set(S.map(l => l.option.strike)).size === 1 ? `${right} butterfly` : `${right} condor`;
    if (qL !== qS) return `${right} ratio spread`;
    if (maxL < minS) return right === 'call' ? 'bull call spread' : 'bull put spread';
    if (minL > maxS) return right === 'call' ? 'bear call spread' : 'bear put spread';
    return `${right} spread`;
  };
  if (!puts.length) return oneSided(calls, 'call');
  if (!calls.length) return oneSided(puts, 'put');

  if (legs.length === 2) {
    const [c] = calls, [p] = puts;
    const same = c.option.strike === p.option.strike;
    if (c.qty > 0 && p.qty > 0) return same ? 'long straddle' : 'long strangle';
    if (c.qty < 0 && p.qty < 0) return same ? 'short straddle' : 'short strangle';
    return c.qty > 0 ? 'risk reversal' : 'collar';
  }
  if (legs.length === 4 && longs.length === 2 && shorts.length === 2) {
    const shortStrikes = shorts.map(l => l.option.strike), longStrikes = longs.map(l => l.option.strike);
    if (Math.min(...shortStrikes) > Math.min(...longStrikes) && Math.max(...shortStrikes) < Math.max(...longStrikes)) return 'iron condor';
  }
  return `${calls.length} call${calls.length === 1 ? '' : 's'}, ${puts.length} put${puts.length === 1 ? '' : 's'}`;
}

/** Money made or lost on the legs together if the underlying is at `price` on expiry. */
export function combinedPayoff(legs, price) {
  return sum(legs, l => payoffAtExpiry(l.option, l.premium, price, l.qty < 0 ? -1 : 1) * Math.abs(l.qty) * l.multiplier);
}

/** Premium paid for the legs together (negative when more was received than paid). */
export function netPremium(legs) {
  return sum(legs, l => l.premium * l.qty * l.multiplier);
}

/**
 * The payoff's shape: its value at every bend (each strike) and at zero, and how it runs
 * past the highest strike. Gains or losses are unbounded only on that side.
 */
export function payoffProfile(legs) {
  const strikes = [...new Set(legs.map(l => l.option.strike))].sort((a, b) => a - b);
  const at = [0, ...strikes].map(px => ({ px, value: combinedPayoff(legs, px) }));
  // Past the last strike every call is in the money: the slope is the net call count.
  const slopeRight = sum(legs.filter(l => l.option.right === 'call'), l => l.qty * l.multiplier);
  const values = at.map(p => p.value);
  return {
    strikes,
    maxGain: slopeRight > 0 ? Infinity : Math.max(0, ...values),
    maxLoss: slopeRight < 0 ? -Infinity : Math.min(0, ...values)
  };
}

/** Underlying prices where the combined payoff crosses zero, between lo and hi. */
export function breakevens(legs, lo, hi) {
  const xs = [...new Set([lo, hi, ...legs.map(l => l.option.strike)])]
    .filter(px => px >= lo && px <= hi)
    .sort((a, b) => a - b);
  const out = [];
  for (let i = 1; i < xs.length; i++) {
    const a = combinedPayoff(legs, xs[i - 1]), b = combinedPayoff(legs, xs[i]);
    if (a === 0 && (i === 1 || combinedPayoff(legs, xs[i - 2]) !== 0)) out.push(xs[i - 1]);
    if ((a < 0 && b > 0) || (a > 0 && b < 0)) out.push(xs[i - 1] + (xs[i] - xs[i - 1]) * (-a / (b - a)));
  }
  if (combinedPayoff(legs, xs.at(-1)) === 0 && !out.includes(xs.at(-1))) out.push(xs.at(-1));
  return out;
}
