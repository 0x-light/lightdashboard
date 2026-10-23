// Made-up accounts for larp mode (see larp-mode.js). The Hyperliquid, Lighter and IBKR providers
// are given the accounts from the larp config; everything else (prices, charts, funding,
// option quotes) is the live feed, so the rows go through the same fetchers and look real.

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const IBKR_ACCOUNT = 'U1234567';

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

// Providers are module namespaces, which can't be changed; the fetchers read them off the
// shared providers object, so a patched copy takes their place there.
function patched(providers, key, overrides) {
  providers[key] = { ...providers[key], ...overrides };
  return providers[key];
}

export function installLarp(providers) {
  const config = () => window.larp?.config || {};
  installHyperliquid(providers, config);
  installLighter(providers, config);
  installIbkr(providers, config);
}

function installHyperliquid(providers, config) {
  const hl = providers.hyperliquid;
  if (!hl) return;

  patched(providers, 'hyperliquid', {
    fetchPositions: async () => {
      const mids = await hl.fetchAllMids(4000);
      const mid = coin => num(mids?.[coin]);
      const cfg = config();

      let totalPnl = 0;
      let margin = 2000;
      const assetPositions = (cfg.hlPerps || [])
        .filter(p => p.coin && num(p.size) !== 0 && mid(String(p.coin).trim()) > 0)
        .map(p => {
          const coin = String(p.coin).trim();
          const size = num(p.size);
          const price = mid(coin);
          const lev = Math.max(1, num(p.lev, 5));
          const entryPx = entryFor(`hl:${coin}`, price, size, p.gain);
          const pnl = size * (price - entryPx);
          totalPnl += pnl;
          margin += Math.abs(size) * price / lev * 1.5;
          const side = Math.sign(size);
          const funding = -side * Math.abs(size) * price * 0.0006;
          return {
            type: 'oneWay',
            position: {
              coin,
              szi: String(size),
              entryPx: String(entryPx),
              positionValue: String(Math.abs(size) * price),
              unrealizedPnl: String(pnl),
              leverage: { type: p.mode === 'isolated' ? 'isolated' : 'cross', value: lev },
              liquidationPx: String(price * (1 - side * 0.8 / lev)),
              cumFunding: { sinceOpen: String(funding), allTime: String(funding) }
            }
          };
        });
      const equity = assetPositions.length ? margin + totalPnl : 0;

      const balances = (cfg.hlSpot || [])
        .filter(b => b.coin && num(b.amount) > 0)
        .map(b => {
          const coin = String(b.coin).trim();
          const price = coin === 'USDC' ? 1 : mid(coin);
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
      const positions = (config().lighterPerps || [])
        .filter(p => p.symbol && num(p.size) !== 0 && num(mids?.[String(p.symbol).trim().toUpperCase()]) > 0)
        .map((p, i) => {
          const symbol = String(p.symbol).trim().toUpperCase();
          const size = num(p.size);
          const price = num(mids[symbol]);
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
            liquidation_price: String(price * (1 - side * 0.9 / lev)),
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
  if (!providers.ibkr) return;
  let built = null;

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
      const live = num(quotes[yahooOf(s)]?.price);
      const mark = live > 0 ? live : 100;
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
    if (positions.length === 0 && cash.length === 0) throw new Error('No IBKR positions in the larp portfolio');

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
}
