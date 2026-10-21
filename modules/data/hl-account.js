// Hyperliquid account details that aren't needed on every refresh: open orders, the
// account value history, funding payments, fees, staking and margin. Each is fetched
// when something on screen asks for it (an opened perp row, the Account window) and
// kept for a while, so opening and closing things doesn't cost requests.
import { fetchInfo, fetchPerpDexs, getUserDexes } from './providers/hyperliquid.js';

const cache = new Map(); // key -> { at, promise }

function cached(key, ttlMs, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.promise;
  const promise = load().catch((err) => {
    cache.delete(key); // a failure shouldn't stick for the whole TTL
    throw err;
  });
  cache.set(key, { at: Date.now(), promise });
  return promise;
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Orders and margin live on each HIP-3 dex separately. Ask the dexes the address had money
// or positions on when its positions were last read; before that, every dex there is.
async function dexesOf(address) {
  return getUserDexes(address) ?? await fetchPerpDexs(8000);
}

/**
 * Open orders for every address, grouped by coin:
 *   { ETH: [{ kind: 'tp' | 'sl' | 'buy' | 'sell', px, sz, label, reduceOnly, wholePosition }] }
 * Trigger orders (TP/SL) use their trigger price; limits use their limit price.
 */
export function getOpenOrders(addresses) {
  const key = `orders:${addresses.join(',')}`;
  return cached(key, 30 * 1000, async () => {
    const lists = await Promise.all(addresses.map(async user => {
      const dexes = await dexesOf(user);
      return Promise.all(dexes.map(dex =>
        fetchInfo(dex ? { type: 'frontendOpenOrders', user, dex } : { type: 'frontendOpenOrders', user }, 8000)
          .catch(() => [])));
    }));
    const byCoin = {};
    for (const order of lists.flat(2)) {
      if (!order?.coin) continue;
      const type = String(order.orderType || '');
      const isTp = /take profit/i.test(type);
      const isSl = /stop/i.test(type);
      const px = num(order.isTrigger ? order.triggerPx : order.limitPx);
      if (!px) continue;
      const kind = isTp ? 'tp' : isSl ? 'sl' : (order.side === 'B' ? 'buy' : 'sell');
      (byCoin[order.coin] ||= []).push({
        kind,
        px,
        sz: num(order.sz),
        reduceOnly: !!order.reduceOnly,
        // A TP/SL for the whole position comes back with size 0.
        wholePosition: !!order.isPositionTpsl || num(order.sz) === 0,
        label: type
      });
    }
    return byCoin;
  });
}

/** Margin across every dex the address trades on. */
export function getMargin(address) {
  return cached(`margin:${address}`, 30 * 1000, async () => {
    const dexes = await dexesOf(address);
    const states = await Promise.all(dexes.map(dex =>
      fetchInfo(dex ? { type: 'clearinghouseState', user: address, dex } : { type: 'clearinghouseState', user: address }, 8000)
        .catch(() => null)));
    let accountValue = 0, maintenance = 0, marginUsed = 0, notional = 0, withdrawable = 0;
    let any = false;
    for (const s of states) {
      if (!s) continue;
      any = true;
      accountValue += num(s.marginSummary?.accountValue) || 0;
      maintenance += num(s.crossMaintenanceMarginUsed) || 0;
      marginUsed += num(s.marginSummary?.totalMarginUsed) || 0;
      notional += num(s.marginSummary?.totalNtlPos) || 0;
      withdrawable += num(s.withdrawable) || 0;
    }
    if (!any || accountValue <= 0) return null;
    return {
      accountValue,
      maintenance,
      marginUsed,
      notional,
      withdrawable,
      maintenanceShare: maintenance / accountValue,
      leverage: notional / accountValue
    };
  });
}

/**
 * Account value and P&L over day / week / month / all time:
 *   { day: { values: [[t, v]], pnl: [[t, v]] }, week: …, month: …, allTime: … }
 */
export function getPortfolio(address) {
  return cached(`portfolio:${address}`, 5 * 60 * 1000, async () => {
    const data = await fetchInfo({ type: 'portfolio', user: address }, 10000);
    const out = {};
    for (const [period, entry] of Array.isArray(data) ? data : []) {
      if (!['day', 'week', 'month', 'allTime'].includes(period)) continue;
      const toPairs = (list) => (list || []).map(([t, v]) => [Number(t), Number(v)]).filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v));
      out[period] = { values: toPairs(entry?.accountValueHistory), pnl: toPairs(entry?.pnlHistory) };
    }
    return out;
  });
}

/**
 * Funding paid (−) and received (+) per day over the last `days` days, newest last:
 *   { days: [{ day: 'YYYY-MM-DD', usdc, known }], complete }
 * The API returns at most 500 rows per call, oldest first; older days come as daily
 * totals, recent ones hourly per coin. One call covers most accounts. When it doesn't,
 * days are fetched newest first, one at a time, within a request budget, so the recent
 * days are always right; `known: false` marks days the budget didn't reach.
 */
export function getFundingByDay(address, days = 30) {
  return cached(`funding:${address}:${days}`, 60 * 60 * 1000, async () => {
    const DAY = 24 * 60 * 60 * 1000;
    const end = Date.now();
    const start = end - days * DAY;
    const totals = new Map();
    const keyOf = (t) => new Date(t).toISOString().slice(0, 10);
    const add = (rows) => {
      for (const row of rows) {
        const usdc = num(row?.delta?.usdc);
        if (usdc !== null) totals.set(keyOf(row.time), (totals.get(keyOf(row.time)) || 0) + usdc);
      }
    };
    const query = (from, to) => fetchInfo({ type: 'userFunding', user: address, startTime: from, endTime: to }, 10000)
      .then(rows => (Array.isArray(rows) ? rows : []));

    // Everything from `coveredFrom` to now has been read in full.
    let coveredFrom = end;
    const first = await query(start, end);
    if (first.length < 500) {
      add(first);
      coveredFrom = start;
    } else {
      let budget = 6;
      for (let dayEnd = end; dayEnd > start && budget > 0; dayEnd -= DAY) {
        const dayStart = Math.max(start, dayEnd - DAY);
        let from = dayStart;
        let complete = false;
        while (budget-- > 0) {
          const rows = await query(from, dayEnd);
          add(rows);
          if (rows.length < 500) { complete = true; break; }
          from = Math.max(...rows.map(r => Number(r.time))) + 1;
        }
        if (!complete) break;
        coveredFrom = dayStart;
      }
    }
    // A calendar day (UTC) counts as known only if all of it falls in the covered span.
    const dayStartOf = (t) => Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), new Date(t).getUTCDate());
    const isKnown = (t) => dayStartOf(t) >= coveredFrom || coveredFrom <= start;

    const out = [];
    for (let t = end - (days - 1) * DAY; t <= end; t += DAY) {
      const day = keyOf(t);
      out.push({ day, usdc: totals.get(day) || 0, known: isKnown(t) });
    }
    return { days: out, complete: out.every(d => d.known) };
  });
}

/** Fee tier: taker and maker rates, discounts, and 14-day volume. */
export function getFees(address) {
  return cached(`fees:${address}`, 24 * 60 * 60 * 1000, async () => {
    const f = await fetchInfo({ type: 'userFees', user: address }, 10000);
    if (!f) return null;
    const volume = (f.dailyUserVlm || []).reduce((sum, d) => sum + (num(d.userCross) || 0) + (num(d.userAdd) || 0), 0);
    return {
      taker: num(f.userCrossRate),
      maker: num(f.userAddRate),
      stakingDiscount: num(f.activeStakingDiscount?.discount),
      referralDiscount: num(f.activeReferralDiscount),
      volume14d: volume
    };
  });
}

/** Staked HYPE and rewards earned (all time and last 30 days). */
export function getStaking(address) {
  return cached(`staking:${address}`, 60 * 60 * 1000, async () => {
    const [summary, rewards] = await Promise.all([
      fetchInfo({ type: 'delegatorSummary', user: address }, 10000).catch(() => null),
      fetchInfo({ type: 'delegatorRewards', user: address }, 10000).catch(() => [])
    ]);
    const staked = num(summary?.delegated) || 0;
    const unstaked = num(summary?.undelegated) || 0;
    const withdrawing = num(summary?.totalPendingWithdrawal) || 0;
    if (staked + unstaked + withdrawing <= 0) return null;
    const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    let allTime = 0, month = 0;
    for (const r of Array.isArray(rewards) ? rewards : []) {
      const amount = num(r.totalAmount) || 0;
      allTime += amount;
      if (Number(r.time) >= monthAgo) month += amount;
    }
    return { staked, unstaked, withdrawing, rewardsAllTime: allTime, rewards30d: month };
  });
}

export default { getOpenOrders, getMargin, getPortfolio, getFundingByDay, getFees, getStaking };
