// Made-up accounts for larp mode (see larp-mode.js). The Hyperliquid, Lighter and IBKR providers
// are given the accounts from the larp config; everything else (prices, charts, funding,
// option quotes) is the live feed, so the rows go through the same fetchers and look real.
// The last good price of everything is kept (window.larp.prices), so a failed or rate-limited
// request shows the last price instead of dropping rows. The Account window's Hyperliquid
// details and the portfolio chart are made up too, as the sample address has no history.
import { overrideAccount } from '../data/hl-account.js';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const IBKR_ACCOUNT = 'U1234567';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// How far the liquidation price is from the live price: far enough that the Account window
// never lists a sample perp as near liquidation.
const LIQUIDATION_DISTANCE = 0.45;

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

// The price a position was entered at, for a profit of `gain` percent at today's price. The same
// entry is kept for the visit, so a refresh does not move it.
const entries = new Map();
function entryFor(key, price, size, gain) {
  const id = `${key}|${size}|${gain}`;
  if (!entries.has(id)) {
    const g = Math.min(Math.max(num(gain) / 100, -5), 0.95);
    entries.set(id, size < 0 ? price / (1 - g) : price / (1 + g));
  }
  return entries.get(id);
}

function optionIdentity(o) {
  const [y, m, d] = String(o.expiry).split('-');
  const strike = String(Math.round(num(o.strike) * 1000)).padStart(8, '0');
  const underlying = String(o.underlying || '').toUpperCase();
  return {
    symbol: `${underlying.padEnd(6)}${y.slice(2)}${m}${d}${o.right}${strike}`,
    occ: `${underlying}${y.slice(2)}${m}${d}${o.right}${strike}`,
    description: `${underlying} ${d}${MONTHS[Number(m) - 1]}${y.slice(2)} ${num(o.strike)} ${o.right}`
  };
}

const validOption = o => o && o.underlying && /^\d{4}-\d{2}-\d{2}$/.test(o.expiry || '')
  && num(o.strike) > 0 && ['C', 'P'].includes(o.right) && num(o.qty) !== 0;

// A number in [-1, 1] for an integer, the same on every load.
function hash(n, seed) {
  let h = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(seed + 1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff * 2 - 1;
}

// Smooth noise along x: hash values at whole numbers, eased in between.
function smooth(x, seed) {
  const i = Math.floor(x);
  const f = x - i;
  const e = f * f * (3 - 2 * f);
  return hash(i, seed) * (1 - e) + hash(i + 1, seed) * e;
}

// The made-up portfolio's log value at time t: a slow rise with swings on every scale. It
// depends on t alone, so every period, reload and device draws the same line.
const SWINGS = [[0.125, 0.004], [0.5, 0.008], [2, 0.015], [9, 0.03], [40, 0.06], [120, 0.09]];
function walk(t) {
  const days = t / DAY;
  return 0.0013 * days + SWINGS.reduce((sum, [scale, amp], k) => sum + amp * smooth(days / scale, k), 0);
}

// The portfolio chart: points over the period that end at `total`.
function history(periodMs, now, total) {
  if (!(total > 0)) return [];
  const span = Number.isFinite(periodMs) ? periodMs : 365 * DAY;
  const step = span <= DAY ? 15 * 60 * 1000 : span <= 7 * DAY ? HOUR : span <= 31 * DAY ? 4 * HOUR : DAY;
  const end = walk(now);
  const values = [];
  for (let t = now - span; t < now; t += step) values.push([t, total * Math.exp(walk(t) - end)]);
  values.push([now, total]);
  return values;
}

// Providers are module namespaces, which can't be changed; the fetchers read them off the
// shared providers object, so a patched copy takes their place there.
function patched(providers, key, overrides) {
  providers[key] = { ...providers[key], ...overrides };
  return providers[key];
}

export function installLarp(providers) {
  const config = () => window.larp?.config || {};
  const memory = rememberPrices(providers);
  const book = installHyperliquid(providers, config);
  installLighter(providers, config);
  const ibkr = installIbkr(providers, config);

  // Manual positions give a gain in percent; the manual fetcher asks for the entry here.
  window.larp.entryOf = (pos, price) => {
    const symbol = String(pos?.symbol || '').toUpperCase();
    if (!(price > 0) || !symbol) return undefined;
    memory.manual[symbol] = price;
    window.larp.rememberPrices?.();
    if (typeof pos.gain !== 'number' || !Number.isFinite(pos.gain)) return undefined;
    return entryFor(`manual:${symbol}`, price, num(pos.amount), pos.gain);
  };
  window.larp.history = history;
  // After an edit: the next fetch builds the accounts again from the config. The Hyperliquid
  // fetcher keeps staking for 10 minutes; the sample's stake changes when you type.
  window.larp.refresh = () => {
    ibkr.reset();
    Object.values(window._portfolioManager?.fetchers || {}).forEach(f => f?.stakingCache?.clear?.());
  };
  installAccount(config, book);
}

// Keeps the last good price of every coin, feed and ticker, and answers with it when a
// request fails or leaves one out.
function rememberPrices(providers) {
  const memory = window.larp.prices;
  const keep = () => window.larp.rememberPrices?.();

  const hl = providers.hyperliquid;
  if (hl?.fetchAllMids) {
    patched(providers, 'hyperliquid', {
      fetchAllMids: async (...args) => {
        let mids = null;
        try { mids = await hl.fetchAllMids(...args); } catch (_) { /* the last good mids below */ }
        for (const [coin, px] of Object.entries(mids || {})) if (num(px) > 0) memory.hl[coin] = px;
        keep();
        return { ...memory.hl, ...(mids || {}) };
      }
    });
  }

  const pyth = providers.pyth;
  if (pyth?.getLatestByFeedIds) {
    patched(providers, 'pyth', {
      getLatestByFeedIds: async (ids, ...rest) => {
        let got = {};
        try { got = (await pyth.getLatestByFeedIds(ids, ...rest)) || {}; } catch (_) { /* the last good prices below */ }
        for (const [id, px] of Object.entries(got)) if (num(px) > 0) memory.feed[id.toLowerCase()] = num(px);
        keep();
        const out = {};
        for (const id of ids || []) {
          const px = memory.feed[String(id).toLowerCase()];
          if (px > 0) out[id] = px;
        }
        return { ...out, ...got };
      }
    });
  }

  const stocks = providers.stocks;
  if (stocks?.getQuotes) {
    patched(providers, 'stocks', {
      getQuotes: async (symbols, ...rest) => {
        let got = {};
        try { got = (await stocks.getQuotes(symbols, ...rest)) || {}; } catch (_) { /* the last good quotes below */ }
        for (const [symbol, q] of Object.entries(got)) {
          if (num(q?.price) > 0) {
            memory.yahoo[symbol] = { price: q.price, change24h: q.change24h ?? null, currency: q.currency || null, name: q.name || null };
          }
        }
        keep();
        const out = {};
        for (const symbol of symbols || []) if (memory.yahoo[symbol]) out[symbol] = { ...memory.yahoo[symbol] };
        return { ...out, ...got };
      }
    });
  }
  return memory;
}

function installHyperliquid(providers, config) {
  const hl = providers.hyperliquid;
  if (!hl) return async () => null;

  // The perp account from the config at today's prices, as Hyperliquid would report it.
  async function book(given) {
    const mids = given || await hl.fetchAllMids(4000);
    const mid = coin => num(mids?.[coin]);
    let totalPnl = 0;
    let margin = 2000;
    let notional = 0;
    let marginUsed = 0;
    const perps = [];
    const assetPositions = (config().hlPerps || [])
      .filter(p => p.coin && num(p.size) !== 0 && mid(String(p.coin).trim()) > 0)
      .map(p => {
        const coin = String(p.coin).trim();
        const size = num(p.size);
        const price = mid(coin);
        const lev = Math.max(1, num(p.lev, 5));
        const entryPx = entryFor(`hl:${coin}`, price, size, p.gain);
        const pnl = size * (price - entryPx);
        const value = Math.abs(size) * price;
        totalPnl += pnl;
        notional += value;
        marginUsed += value / lev;
        margin += value / lev * 1.5;
        const side = Math.sign(size);
        perps.push({ coin, side, size, price, value });
        const funding = -side * value * 0.0006;
        return {
          type: 'oneWay',
          position: {
            coin,
            szi: String(size),
            entryPx: String(entryPx),
            positionValue: String(value),
            unrealizedPnl: String(pnl),
            leverage: { type: p.mode === 'isolated' ? 'isolated' : 'cross', value: lev },
            liquidationPx: String(price * (1 - side * LIQUIDATION_DISTANCE)),
            cumFunding: { sinceOpen: String(funding), allTime: String(funding) }
          }
        };
      });
    const equity = assetPositions.length ? margin + totalPnl : 0;
    return { assetPositions, perps, equity, notional, marginUsed };
  }

  patched(providers, 'hyperliquid', {
    fetchPositions: async () => {
      const mids = await hl.fetchAllMids(4000);
      const { assetPositions, equity } = await book(mids);
      const balances = (config().hlSpot || [])
        .filter(b => b.coin && num(b.amount) > 0)
        .map(b => {
          const coin = String(b.coin).trim();
          const price = coin === 'USDC' ? 1 : num(mids?.[coin]);
          const amount = num(b.amount);
          return {
            coin,
            total: String(amount),
            hold: '0',
            entryNtl: String(price > 0 ? amount * entryFor(`spot:${coin}`, price, amount, b.gain) : 0)
          };
        });
      return {
        perp: {
          assetPositions,
          marginSummary: { accountValue: String(equity) },
          crossMarginSummary: { accountValue: String(equity) },
          withdrawable: String(Math.max(0, equity * 0.4))
        },
        spot: { balances },
        dexes: ['']
      };
    },
    fetchDelegatorSummary: async () => ({
      delegated: String(Math.max(0, num(config().hlStaked))),
      undelegated: '0',
      totalPendingWithdrawal: '0'
    })
  });
  return book;
}

// The Account window's Hyperliquid tab and the perp rows' TP/SL, from the same book.
function installAccount(config, book) {
  overrideAccount({
    getMargin: async () => {
      const b = await book();
      if (!b || !(b.equity > 0)) return null;
      const maintenance = b.marginUsed * 0.25;
      return {
        accountValue: b.equity,
        maintenance,
        marginUsed: b.marginUsed,
        notional: b.notional,
        withdrawable: b.equity * 0.4,
        maintenanceShare: maintenance / b.equity,
        leverage: b.notional / b.equity
      };
    },
    getFundingByDay: async (_address, days = 30) => {
      const b = await book();
      const end = Date.now();
      const out = [];
      for (let t = end - (days - 1) * DAY; t <= end; t += DAY) {
        const n = Math.floor(t / DAY);
        // Longs pay and shorts receive, about 0.01% a day, more on some days than others.
        const rate = 0.0001 * (1 + 0.6 * hash(n, 7));
        const usdc = (b?.perps || []).reduce((sum, p) => sum - p.side * p.value * rate, 0);
        out.push({ day: new Date(t).toISOString().slice(0, 10), usdc, known: true });
      }
      return { days: out, complete: true };
    },
    getFees: async () => {
      const b = await book();
      if (!b || !(b.notional > 0)) return null;
      return {
        taker: 0.00035,
        maker: 0.0001,
        stakingDiscount: num(config().hlStaked) > 0 ? 0.05 : 0,
        referralDiscount: 0,
        volume14d: b.notional * 6
      };
    },
    getStaking: async () => {
      const staked = Math.max(0, num(config().hlStaked));
      if (!staked) return null;
      return { staked, unstaked: 0, withdrawing: 0, rewardsAllTime: staked * 0.031, rewards30d: staked * 0.0019 };
    },
    getOpenOrders: async () => {
      const b = await book();
      const byCoin = {};
      for (const p of b?.perps || []) {
        byCoin[p.coin] = [
          { kind: 'tp', px: p.price * (1 + p.side * 0.18), sz: 0, reduceOnly: true, wholePosition: true, label: 'Take Profit Market' },
          { kind: 'sl', px: p.price * (1 - p.side * 0.25), sz: 0, reduceOnly: true, wholePosition: true, label: 'Stop Market' }
        ];
      }
      return byCoin;
    },
    getPortfolio: async () => ({})
  });
}

function installLighter(providers, config) {
  const lighter = providers.lighter;
  const hl = providers.hyperliquid;
  if (!lighter || !hl) return;

  patched(providers, 'lighter', {
    fetchAccountByAddress: async () => {
      const mids = await hl.fetchAllMids(4000);
      let totalPnl = 0;
      let margin = 1000;
      // Lighter's markets are priced from Hyperliquid's, which spell some coins in mixed case (kPEPE).
      const priceOf = p => num(mids?.[String(p.symbol).trim()]) || num(mids?.[String(p.symbol).trim().toUpperCase()]);
      const positions = (config().lighterPerps || [])
        .filter(p => p.symbol && num(p.size) !== 0 && priceOf(p) > 0)
        .map((p, i) => {
          const symbol = String(p.symbol).trim().toUpperCase();
          const size = num(p.size);
          const price = priceOf(p);
          const lev = Math.max(1, num(p.lev, 5));
          const entry = entryFor(`lighter:${symbol}`, price, size, p.gain);
          const pnl = size * (price - entry);
          totalPnl += pnl;
          margin += Math.abs(size) * price / lev * 1.5;
          const side = Math.sign(size);
          return {
            market_id: i,
            symbol,
            position: String(Math.abs(size)),
            sign: side,
            avg_entry_price: String(entry),
            position_value: String(Math.abs(size) * price),
            unrealized_pnl: String(pnl),
            liquidation_price: String(price * (1 - side * LIQUIDATION_DISTANCE)),
            initial_margin_fraction: String(100 / lev),
            margin_mode: 0,
            total_funding_paid_out: String(side * Math.abs(size) * price * 0.0004)
          };
        });
      if (positions.length === 0) return { accounts: [] };
      const free = 3500;
      return {
        accounts: [{
          index: 4242,
          total_asset_value: String(margin + free + totalPnl),
          available_balance: String(free),
          unrealized_pnl: String(totalPnl),
          positions
        }]
      };
    }
  });
}

function installIbkr(providers, config) {
  let built = null;
  const reset = () => { built = null; };
  if (!providers.ibkr) return { reset };

  async function build() {
    const cfg = config();
    const stocks = (cfg.stocks || []).filter(s => s.symbol && num(s.qty) !== 0);
    const options = (cfg.options || []).filter(validOption);
    const yahooOf = s => s.yahoo || String(s.symbol).trim().toUpperCase();
    const symbols = [...stocks.map(yahooOf), ...options.map(o => optionIdentity(o).occ)];
    let quotes = {};
    try { quotes = (symbols.length && await providers.stocks?.getQuotes?.(symbols, { timeoutMs: 6000 })) || {}; } catch (_) { /* marks below */ }

    const positions = [];
    for (const s of stocks) {
      const symbol = String(s.symbol).trim().toUpperCase();
      const mark = num(quotes[yahooOf(s)]?.price);
      if (!(mark > 0)) continue; // a ticker with no price, as a typo; Settings > Demo says so
      const qty = num(s.qty);
      const entry = entryFor(`ibkr:${symbol}`, mark, qty, s.gain);
      positions.push({
        accountId: IBKR_ACCOUNT,
        conid: String(positions.length + 1000),
        symbol,
        description: s.description || symbol,
        assetCategory: s.category || 'STK',
        listingExchange: s.exchange || 'NASDAQ',
        currency: s.currency || 'USD',
        position: qty,
        multiplier: 1,
        markPrice: mark,
        positionValue: mark * qty,
        costBasisPrice: entry,
        costBasisMoney: entry * qty,
        unrealizedPnl: (mark - entry) * qty,
        reportDate: ''
      });
    }
    for (const o of options) {
      const id = optionIdentity(o);
      const qty = num(o.qty);
      const entry = Math.max(0.01, num(o.entry, 1));
      const live = num(quotes[id.occ]?.price);
      const mark = live > 0 ? live : entry;
      positions.push({
        accountId: IBKR_ACCOUNT,
        conid: String(positions.length + 1000),
        symbol: id.symbol,
        description: id.description,
        assetCategory: 'OPT',
        listingExchange: 'CBOE',
        currency: 'USD',
        position: qty,
        multiplier: 100,
        markPrice: mark,
        positionValue: mark * qty * 100,
        costBasisPrice: entry,
        costBasisMoney: entry * qty * 100,
        unrealizedPnl: (mark - entry) * qty * 100,
        reportDate: ''
      });
    }
    const cash = (cfg.ibkrCash || [])
      .filter(c => /^[A-Za-z]{3}$/.test(String(c.currency || '').trim()) && num(c.amount) !== 0)
      .map(c => ({ accountId: IBKR_ACCOUNT, currency: String(c.currency).trim().toUpperCase(), amount: num(c.amount) }));

    // Local time, as the IBKR fetcher reads it.
    const now = new Date();
    const p2 = n => String(n).padStart(2, '0');
    const generatedAt = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())};${p2(now.getHours())}${p2(now.getMinutes())}00`;
    return { generatedAt, accounts: [{ accountId: IBKR_ACCOUNT, positions, cash, nav: [], currency: 'USD' }] };
  }

  patched(providers, 'ibkr', {
    getStatement: async () => {
      built ||= build();
      return { statement: await built, savedAt: Date.now(), stale: false };
    }
  });
  return { reset };
}
