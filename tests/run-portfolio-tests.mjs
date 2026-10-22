import assert from 'node:assert/strict';
import { calculatePortfolioBreakdown, calculatePortfolioTotals } from '../modules/domain/portfolio.js';
import {
  breakevenOf,
  daysToExpiry,
  formatExpiry,
  moneyness,
  optionOf,
  occSymbol,
  parseOptionSymbol,
  payoffAtExpiry,
  positionKind,
  strategyName,
  netPremium,
  payoffProfile,
  breakevens
} from '../modules/domain/instruments.js';
import { ManualFetcher } from '../modules/data/fetchers/manual-fetcher.js';
import { AlchemyHeliusFetcher } from '../modules/data/fetchers/alchemy-helius-fetcher.js';
import { LighterFetcher } from '../modules/data/fetchers/lighter-fetcher.js';
import { HyperliquidFetcher } from '../modules/data/fetchers/hyperliquid-fetcher.js';
import * as HyperliquidProvider from '../modules/data/providers/hyperliquid.js';
import * as StocksProvider from '../modules/data/providers/stocks.js';
import { _internal as pythInternal } from '../modules/data/providers/pyth.js';
import { normalizeEntries } from '../modules/features/watchlist.js';
import { anchored, clip, getPortfolioHistory, plan, priceKeyOf, scaled, sumSeries } from '../modules/data/portfolio-history.js';
import { pnlSeries } from '../modules/data/providers/lighter.js';
import { chartPoints } from '../modules/data/providers/zerion.js';
import {
  formatMoney,
  getFxCurrency,
  getQuoteUnitScale,
  normalizeBaseCurrency
} from '../modules/utils/currency.js';
import {
  getManualPositionAsset,
  getManualPositionHiddenKeys,
  manualTypeFromExchange,
  removeManualPositionByAsset,
  renderedManualPositionMatches
} from '../modules/features/manual-positions.js';

function testInstrumentsReadOptionsAndKinds() {
  // OCC codes, as IBKR's Flex symbol field carries them (root padded to six characters).
  assert.deepEqual(parseOptionSymbol('ABCL  270115C00008000'), { underlying: 'ABCL', expiry: '2027-01-15', right: 'call', strike: 8 });
  assert.deepEqual(parseOptionSymbol('SPY 261218P00550000'), { underlying: 'SPY', expiry: '2026-12-18', right: 'put', strike: 550 });
  assert.equal(parseOptionSymbol('MU 270115C01300000').strike, 1300);
  // IBKR's description of the same contract.
  assert.deepEqual(parseOptionSymbol('SPY 18DEC26 550 P'), { underlying: 'SPY', expiry: '2026-12-18', right: 'put', strike: 550 });
  assert.deepEqual(parseOptionSymbol('BRK.B 15JAN27 450.5 C'), { underlying: 'BRK.B', expiry: '2027-01-15', right: 'call', strike: 450.5 });
  // Plain tickers are not options.
  for (const t of ['VWCE', 'ETH', 'ABCL', 'USDE', 'VWCE.DE', '']) assert.equal(parseOptionSymbol(t), null, t);

  assert.equal(positionKind({ asset: 'ZRO', exchange: 'HL Perps', isLeveraged: true }), 'perp');
  assert.equal(positionKind({ asset: 'ABCL 270115C00008000', exchange: 'IBKR', category: 'option' }), 'option');
  assert.equal(positionKind({ asset: 'VWCE', exchange: 'IBKR', category: 'etf' }), 'spot');
  // A stock whose ticker happens to look like a code stays spot when the category says so.
  assert.equal(positionKind({ asset: 'ABCL 270115C00008000', exchange: 'Manual (Stock)', category: 'equity' }), 'spot');
  // An explicit contract wins over the asset text.
  const explicit = { asset: 'ABCL 15JAN27 8 C', option: { underlying: 'ABCL', expiry: '2027-01-15', right: 'call', strike: 8 } };
  assert.equal(optionOf(explicit).strike, 8);

  const call = { underlying: 'ABCL', expiry: '2027-01-15', right: 'call', strike: 8 };
  const put = { ...call, right: 'put' };
  assert.equal(breakevenOf(call, 1.6), 9.6);
  assert.equal(breakevenOf(put, 1.6), 6.4);
  assert.equal(breakevenOf(call, null), null);
  assert.equal(payoffAtExpiry(call, 1.6, 5), -1.6);   // worthless: the premium is lost
  assert.ok(Math.abs(payoffAtExpiry(call, 1.6, 9.6)) < 1e-9);   // breakeven
  assert.equal(payoffAtExpiry(call, 1.6, 12), 2.4);
  assert.equal(payoffAtExpiry(call, 1.6, 12, -1), -2.4); // written: the mirror image
  assert.equal(payoffAtExpiry(put, 1.6, 5), 1.4);
  assert.equal(moneyness(call, 7.12), 'out');
  assert.equal(moneyness(call, 9), 'in');
  assert.equal(moneyness(put, 9), 'out');
  assert.equal(moneyness(call, null), null);
  assert.equal(daysToExpiry('2027-01-15', new Date('2026-10-21T23:30:00Z')), 86);
  assert.equal(daysToExpiry('2026-10-21', new Date('2026-10-21T03:00:00Z')), 0);
  assert.equal(daysToExpiry('junk'), null);
  assert.equal(formatExpiry('2027-01-15'), '15 Jan 27');
  assert.equal(formatExpiry('2027-01-15', { year: 'long' }), '15 Jan 2027');
  assert.equal(occSymbol(parseOptionSymbol('MU 270115C01300000')), 'MU270115C01300000');
  assert.equal(occSymbol({ underlying: 'BRK.B', expiry: '2027-01-15', right: 'put', strike: 450.5 }), 'BRK.B270115P00450500');

  // Legs on one name and expiry: what they make together.
  const leg = (strike, qty, premium, right = 'call') => ({ option: { underlying: 'MU', expiry: '2027-01-15', right, strike }, qty, premium, atCost: true, multiplier: 100 });
  const spread = [leg(1200, 1, 105), leg(1300, 2, 82), leg(1500, -3, 51)];
  assert.equal(strategyName(spread), 'bull call spread');
  assert.equal(netPremium(spread), 11600);
  assert.deepEqual(payoffProfile(spread), { strikes: [1200, 1300, 1500], maxGain: 58400, maxLoss: -11600 });
  assert.deepEqual(breakevens(spread, 800, 1800).map(x => Math.round(x * 10) / 10), [1305.3]);
  assert.equal(strategyName([leg(1200, 1, 105)]), 'long call');
  assert.equal(strategyName([leg(1500, -3, 51)]), 'short call');
  assert.equal(strategyName([leg(8, 1, 2), leg(15, 1, 1)]), 'long calls');
  assert.equal(strategyName([leg(100, 1, 5, 'put'), leg(90, -1, 2, 'put')]), 'bear put spread');
  assert.equal(strategyName([leg(90, 1, 2, 'put'), leg(100, -1, 5, 'put')]), 'bull put spread');
  assert.equal(strategyName([leg(100, 1, 5), leg(100, 1, 4, 'put')]), 'long straddle');
  assert.equal(strategyName([leg(100, -1, 5), leg(90, -1, 4, 'put')]), 'short strangle');
  assert.equal(strategyName([leg(90, 1, 1), leg(100, -2, 2), leg(110, 1, 1)]), 'call butterfly');
  // A long call alone loses at most its premium and gains without limit.
  assert.deepEqual(payoffProfile([leg(1200, 1, 105)]), { strikes: [1200], maxGain: Infinity, maxLoss: -10500 });
  assert.deepEqual(payoffProfile([leg(1500, -3, 51)]), { strikes: [1500], maxGain: 15300, maxLoss: -Infinity });

  // Allocation counts an option under its underlying, not its code.
  const breakdown = calculatePortfolioBreakdown([
    { asset: 'ABCL 270115C00008000', exchange: 'IBKR', category: 'option', value: 300 },
    { asset: 'ABCL 280121C00007000', exchange: 'IBKR', category: 'option', value: 200 },
    { asset: 'VWCE', exchange: 'IBKR', value: 500 }
  ]);
  assert.deepEqual(breakdown.allocation.map(s => [s.label, s.value]), [['ABCL', 500], ['VWCE', 500]]);
  assert.equal(breakdown.shareByRow['ABCL 270115C00008000_IBKR'], 0.3);
}

function testPortfolioBreakdownAllocationAnd24h() {
  const breakdown = calculatePortfolioBreakdown([
    { asset: 'BTC', exchange: 'Wallet', value: 600, change24h: 20 },
    { asset: 'BTC', exchange: 'Manual (Stock)', value: 0 },
    { asset: 'ETH', exchange: 'Wallet', value: 300, change24h: null },
    { asset: 'HL', exchange: 'Hyperliquid', isHlAccountEquity: true, value: 100 },
    // Covered by HL equity: no allocation slice, but its exposure still moves the 24h number.
    { asset: 'SOL', exchange: 'HL Perps', isLeveraged: true, amount: -10, price: 10, value: 100, change24h: 25 }
  ]);

  // HL equity is attributed to the perp it backs, never labelled "Hyperliquid".
  assert.deepEqual(breakdown.allocation.map(s => s.label), ['BTC', 'ETH', 'SOL']);
  assert.equal(breakdown.allocation[2].value, 100);
  assert.ok(Math.abs(breakdown.allocation.reduce((sum, s) => sum + s.share, 0) - 1) < 1e-9);
  // BTC: 600 * 20/120 = +100. Short SOL: -100 notional * 25/125 = -20.
  assert.equal(Math.round(breakdown.change24h), 80);
  assert.equal(Math.round(breakdown.change24hPercent * 100) / 100, 8.7);
  // BTC made more than half of the move.
  assert.equal(breakdown.topMover.label, 'BTC');

  // No asset made half of the move, so none is named.
  const spread = calculatePortfolioBreakdown([
    { asset: 'BTC', exchange: 'Wallet', value: 110, change24h: 10 },
    { asset: 'ETH', exchange: 'Wallet', value: 110, change24h: 10 },
    { asset: 'SOL', exchange: 'Wallet', value: 110, change24h: 10 }
  ]);
  assert.equal(spread.topMover, null);

  // Venue spot keeps its value; remaining equity splits across perps by notional.
  const venueSplit = calculatePortfolioBreakdown([
    { asset: 'HL', exchange: 'Hyperliquid', isHlAccountEquity: true, value: 1000 },
    { asset: 'HYPE', exchange: 'HL Spot', value: 400 },
    { asset: 'ZRO', exchange: 'HL Perps', isLeveraged: true, amount: 100, price: 9, value: 900 },
    { asset: 'LIT', exchange: 'HL Perps', isLeveraged: true, amount: -100, price: 3, value: 300 }
  ]);
  assert.deepEqual(
    venueSplit.allocation.map(s => [s.label, Math.round(s.value)]),
    [['ZRO', 450], ['HYPE', 400], ['LIT', 150]]
  );

  const idleMargin = calculatePortfolioBreakdown([
    { asset: 'HL', exchange: 'Hyperliquid', isHlAccountEquity: true, value: 500 },
    { asset: 'ETH', exchange: 'Wallet', value: 500 }
  ]);
  assert.deepEqual(idleMargin.allocation.map(s => s.label).sort(), ['Cash', 'ETH']);

  const many = calculatePortfolioBreakdown(
    ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((asset, i) => ({ asset, exchange: 'Wallet', value: 100 - i }))
  );
  assert.equal(many.allocation.length, 6);
  assert.equal(many.allocation.at(-1).label, 'Other');
  assert.equal(many.change24h, null);

  assert.deepEqual(calculatePortfolioBreakdown([]), { allocation: [], shareByRow: {}, change24h: null, change24hPercent: null, topMover: null });
}

async function testManualCustomLegacySchema() {
  const calls = [];
  const renderer = {
    appendPositions: (rows, source, options) => calls.push({ rows, source, options }),
    markProviderFailed: (_, err) => {
      throw err;
    }
  };

  const fetcher = new ManualFetcher({ pyth: {} }, renderer, {
    showPriceChart: false,
    hiddenAssets: [],
    minBalanceThreshold: 0
  });

  await fetcher.fetch([{ type: 'custom', name: 'Gold bars', value: 5000 }]);

  assert.equal(calls.length, 1, 'manual fetch should append rows once');
  assert.equal(calls[0].source, 'Manual');
  assert.equal(calls[0].rows.length, 1, 'manual custom row should be created');

  const [row] = calls[0].rows;
  assert.equal(row.asset, 'Gold bars');
  assert.equal(row.exchange, 'Manual (Custom)');
  assert.equal(row.amount, 1);
  assert.equal(row.price, 5000);
  assert.equal(row.value, 5000);
}

function testLighterTotalsWithoutEquity() {
  const totals = calculatePortfolioTotals([
    { exchange: 'Lighter', value: 100, pnl: 10 },
    { exchange: 'Lighter Spot', value: 50, pnl: 0 }
  ]);

  assert.equal(totals.totalValue, 150, 'lighter positions should count when no equity row exists');
  assert.equal(totals.totalPnL, 10);
}

function testLighterTotalsWithEquity() {
  const totals = calculatePortfolioTotals([
    { exchange: 'Lighter', isLighterAccountEquity: true, value: 500, pnl: 50 },
    { exchange: 'Lighter', value: 100, pnl: 10 },
    { exchange: 'Lighter Spot', value: 25, pnl: 0 }
  ]);

  assert.equal(totals.totalValue, 525, 'lighter perps should be skipped when equity row exists');
  assert.equal(totals.totalPnL, 10, 'P&L comes from position rows, not the account-level field');
}

function testHyperliquidTotalsFallbackWhenNoEquity() {
  const totals = calculatePortfolioTotals([
    { exchange: 'HL Perps', value: 220, pnl: 15 }
  ]);

  assert.equal(totals.totalValue, 220, 'HL positions should count when no equity row exists');
  assert.equal(totals.totalPnL, 15);
}

function testCostBasisOnLosses() {
  // Value $80, PnL -$20 → cost basis must be $100 (original purchase price)
  const totals = calculatePortfolioTotals([
    { exchange: 'Ethereum', value: 80, pnl: -20 }
  ]);
  assert.equal(totals.totalValue, 80);
  assert.equal(totals.totalPnL, -20);
  assert.equal(totals.costBasis, 100, 'cost basis should add back the loss');
  assert.equal(totals.totalPnLPercent, -20, 'pnl% = -20/100 = -20%');
}

function testNaNPnlIsSkipped() {
  const totals = calculatePortfolioTotals([
    { exchange: 'Ethereum', value: 100, pnl: 10 },
    { exchange: 'Arbitrum', value: 50, pnl: Number.NaN },
    { exchange: 'Base', value: 25 } // missing pnl entirely
  ]);
  assert.equal(totals.totalValue, 175);
  assert.equal(totals.totalPnL, 10, 'NaN and missing pnl must not corrupt totalPnL');
}

function testPnlPercentIgnoresPositionsWithoutCostBasis() {
  // $10k of cash/untracked tokens must not dilute the return on the $1k position we can measure.
  const totals = calculatePortfolioTotals([
    { exchange: 'Ethereum', value: 1200, pnl: 200 },
    { exchange: 'Manual (Custom)', value: 10000, pnl: null },
    { exchange: 'Base', value: 500 }
  ]);
  assert.equal(totals.totalValue, 11700);
  assert.equal(totals.totalPnL, 200);
  assert.equal(totals.costBasis, 1000);
  assert.equal(totals.totalPnLPercent, 20);
}

function testHeadlinePnlMatchesPositionRows() {
  // Real-world shape: HL perps + a Lighter account whose generic `pnl` field is lifetime P&L.
  // The headline must equal the P&L column (+41.7k − 31k), not pick up the hidden −31.2k.
  const totals = calculatePortfolioTotals([
    { exchange: 'HL Perps', isHlAccountEquity: true, value: 110000, pnl: 10700 },
    { asset: 'ZRO', exchange: 'HL Perps', isLeveraged: true, amount: 64870, price: 2.124, entryPrice: 1.481, value: 137800, pnl: 41700 },
    { asset: 'LIT', exchange: 'HL Perps', isLeveraged: true, amount: 17930, price: 3.58, entryPrice: 5.31, value: 64200, pnl: -31000 },
    { exchange: 'Lighter', isLighterAccountEquity: true, value: 300, pnl: -31229 },
    { asset: 'MON', exchange: 'Monad', value: 3000, pnl: null }
  ]);
  assert.equal(totals.totalValue, 113300);
  assert.equal(totals.totalPnL, 10700);
  // Perp basis is entry notional: 64870 × 1.481 + 17930 × 5.31.
  assert.equal(Math.round(totals.costBasis), Math.round(64870 * 1.481 + 17930 * 5.31));
}

function testMultiWalletHlEquityAggregates() {
  const totals = calculatePortfolioTotals([
    { exchange: 'HL Perps', isHlAccountEquity: true, value: 1000, pnl: 30 },
    { exchange: 'HL Perps', isHlAccountEquity: true, value: 500, pnl: -20 },
    { exchange: 'HL Perps', value: 300, pnl: 100 }, // raw perp row — must be skipped
    { exchange: 'HL Spot', value: 150, pnl: 5 }     // spot row — must also be skipped
  ]);
  assert.equal(totals.totalValue, 1500, 'HL equity rows should sum across wallets');
  assert.equal(totals.totalPnL, 105, 'P&L is the sum of the per-position rows the table shows');
}

function testLighterLeverageDoesNotInflateTotals() {
  // Realistic scenario: user has $1k equity with a 5x-leveraged BTC long (notional $5k).
  // Before the fix, total read ~$6k. After the fix, the equity row is authoritative.
  const totals = calculatePortfolioTotals([
    { exchange: 'Lighter', isLighterAccountEquity: true, value: 1000, pnl: 50 },
    { exchange: 'Lighter', asset: 'BTC', value: 5000, pnl: 50, isLeveraged: true, amount: 0.1 }
  ]);
  assert.equal(totals.totalValue, 1000, 'leveraged perp notional must not leak into totals');
  assert.equal(totals.totalPnL, 50);
}

function testShortPnlSignPreserved() {
  // Short ETH: amount=-1, entry=2000, current=1800 → pnl = (2000-1800)*1 = +200 via signed amount.
  const totals = calculatePortfolioTotals([
    { exchange: 'HL Perps', value: 1800, pnl: 200 } // HL fetcher already signs pnl correctly
  ]);
  assert.equal(totals.totalPnL, 200);
}

function testPythFeedParserRecognisesAllCategories() {
  const { parsePythFeed, buildFlatMap } = pythInternal;

  const btc = parsePythFeed({
    id: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
    attributes: { symbol: 'Crypto.BTC/USD', description: 'Bitcoin / US Dollar', asset_type: 'Crypto' }
  });
  assert.equal(btc.symbol, 'BTC');
  assert.equal(btc.category, 'crypto');
  assert.equal(btc.marketHours, null);

  const aapl = parsePythFeed({
    id: '0x49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688',
    attributes: { symbol: 'Equity.US.AAPL/USD', description: 'Apple Inc.', asset_type: 'Equity' }
  });
  assert.equal(aapl.symbol, 'AAPL');
  assert.equal(aapl.category, 'equity');
  assert.equal(aapl.name, 'Apple Inc.');
  assert.equal(aapl.marketHours, 'us-equity', 'equities must flag market-hours handling');

  const eurusd = parsePythFeed({
    id: '0xa995d00bb36a63cef7fd2c287dc105fc8f3d93779f062f09551b0af3e81ec30b',
    attributes: { symbol: 'FX.EUR/USD', description: 'Euro / US Dollar' }
  });
  assert.equal(eurusd.symbol, 'EUR/USD');
  assert.equal(eurusd.category, 'fx');

  const gold = parsePythFeed({
    id: '0x765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2',
    attributes: { symbol: 'Metal.XAU/USD', description: 'Gold / US Dollar' }
  });
  assert.equal(gold.symbol, 'XAU');
  assert.equal(gold.category, 'metal');

  // Non-USD quote — ignored (dashboard is USD-denominated)
  const nonUsd = parsePythFeed({
    id: '0xdeadbeef' + '0'.repeat(56),
    attributes: { symbol: 'FX.EUR/GBP' }
  });
  assert.equal(nonUsd, null, 'non-USD quote feeds must be skipped');

  // Crypto wins on ticker collisions so wallet-asset lookups stay stable.
  const ambiguous = buildFlatMap([
    { symbol: 'X', id: '0x1', category: 'equity' },
    { symbol: 'X', id: '0x2', category: 'crypto' }
  ]);
  assert.equal(ambiguous.X, '0x2', 'crypto must take priority in the flat symbol map');
}

async function testManualFetcherLabelsStockPositions() {
  const calls = [];
  const renderer = {
    appendPositions: (rows, source, options) => calls.push({ rows, source, options }),
    markProviderFailed: (_, err) => { throw err; }
  };
  const providers = {
    pyth: {
      getLatestByFeedIds: async (ids) => ({
        '0xaapl': 200
      })
    }
  };
  const fetcher = new ManualFetcher(providers, renderer, {
    showPriceChart: false,
    hiddenAssets: [],
    minBalanceThreshold: 0
  });

  await fetcher.fetch([
    { type: 'pyth', symbol: 'AAPL', feedId: '0xaapl', amount: 10, entryPrice: 150,
      category: 'equity', name: 'Apple Inc.', entryDate: '2024-01-02' }
  ]);

  assert.equal(calls.length, 1);
  const [row] = calls[0].rows;
  assert.equal(row.asset, 'AAPL');
  assert.equal(row.exchange, 'Manual (Stock)', 'equity category must surface as "Manual (Stock)"');
  assert.equal(row.amount, 10);
  assert.equal(row.price, 200);
  assert.equal(row.value, 2000);
  assert.equal(row.pnl, 500, 'pnl = amount * (current - entry)');
  assert.equal(row.entryDate, '2024-01-02', 'entry date should round-trip onto the row');
  assert.equal(row.category, 'equity');
}

async function testManualFetcherLegacyPythPositionFallsBackToCrypto() {
  // Positions saved before the category change must keep displaying as Manual (Pyth).
  const calls = [];
  const renderer = {
    appendPositions: (rows) => calls.push({ rows }),
    markProviderFailed: (_, err) => { throw err; }
  };
  const providers = {
    pyth: { getLatestByFeedIds: async () => ({ '0xbtc': 65000 }) }
  };
  const fetcher = new ManualFetcher(providers, renderer, {
    showPriceChart: false, hiddenAssets: [], minBalanceThreshold: 0
  });

  await fetcher.fetch([
    { type: 'pyth', symbol: 'BTC', feedId: '0xbtc', amount: 0.5, entryPrice: 60000 }
  ]);

  const [row] = calls[0].rows;
  assert.equal(row.exchange, 'Manual (Pyth)', 'legacy positions without category default to Manual (Pyth)');
  assert.equal(row.category, 'crypto');
}

function testEmptyAndMalformedInputs() {
  assert.deepEqual(
    calculatePortfolioTotals([]),
    { totalValue: 0, totalPnL: 0, totalPnLPercent: 0, costBasis: 0 }
  );
  assert.deepEqual(
    calculatePortfolioTotals(null),
    { totalValue: 0, totalPnL: 0, totalPnLPercent: 0, costBasis: 0 }
  );
  // Undefined/null rows should not throw
  const totals = calculatePortfolioTotals([null, undefined, { exchange: 'Base', value: 10, pnl: 1 }]);
  assert.equal(totals.totalValue, 10);
  assert.equal(totals.totalPnL, 1);
}

async function testAlchemyHeliusRowShape() {
  globalThis.window = globalThis.window || {};
  window.AppModules = null;

  const calls = [];
  const renderer = {
    appendPositions: (rows, source, options) => calls.push({ rows, source, options }),
    markProviderFailed: (_, err) => {
      throw err;
    }
  };

  const providers = {
    alchemy: {
      getTokenBalances: async () => [{
        address: '0xabc',
        blockchain: 'Ethereum',
        tokenSymbol: 'ETH',
        balance: 1,
        tokenPrice: 2000,
        balanceUsd: 2000
      }]
    },
    helius: {
      getTokenBalances: async () => [{
        address: 'So11111111111111111111111111111111111111112',
        blockchain: 'Solana',
        tokenSymbol: 'SOL',
        balance: 2,
        tokenPrice: 100,
        balanceUsd: 200
      }]
    }
  };

  const fetcher = new AlchemyHeliusFetcher(providers, renderer, {
    alchemyApiKey: 'alchemy-key',
    heliusApiKey: 'helius-key'
  });

  await fetcher.fetch(['0xabc'], ['So11111111111111111111111111111111111111112']);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].source, 'Alchemy/Helius');
  assert.equal(calls[0].rows.length, 2);
  assert.ok(calls[0].rows.every(r => !!r.asset), 'all rows should include asset');
  assert.ok(calls[0].rows.every(r => r._source === 'Alchemy/Helius'), 'rows should be source-tagged');
  assert.ok(calls[0].rows.some(r => r._changeDetectionKey.includes('0xabc')));
  assert.ok(calls[0].rows.some(r => r._changeDetectionKey.includes('So11111111111111111111111111111111111111112')));

  assert.equal(calls[0].options.removeFilter({ _source: 'Alchemy/Helius' }), true);
  assert.equal(calls[0].options.removeFilter({ exchange: 'Ethereum' }), false);
}

async function testLighterAlternateSchemaRows() {
  const calls = [];
  const renderer = {
    appendPositions: (rows, source, options) => calls.push({ rows, source, options }),
    markProviderFailed: (_, err) => {
      throw err;
    }
  };

  const providers = {
    lighter: {
      fetchAccountByAddress: async () => ({
        accounts: [{
          index: 0,
          perpetual_positions: [{
            market_symbol: 'ETH',
            position_size: '2',
            side: 'long',
            positionValue: '6000',
            unrealizedPnl: '120',
            avgEntryPrice: '2800'
          }],
          spot_assets: [{
            token_symbol: 'LIT',
            total_balance: '10',
            locked: '2',
            usd_value: '80'
          }],
          collateral: '1500'
        }]
      }),
      fetchCandlesticks: async (symbol) => {
        if (symbol === 'ETH') {
          return {
            priceHistory: [{ price: 2900, timestamp: 1 }, { price: 3000, timestamp: 2 }],
            change24h: 3,
            currentPrice: 3000
          };
        }
        if (symbol === 'LIT') {
          return {
            priceHistory: [{ price: 8, timestamp: 1 }, { price: 10, timestamp: 2 }],
            change24h: 25,
            currentPrice: 10
          };
        }
        return null;
      },
      fetchFundingRates: async () => ({ ETH: 0.0001 }),
      fetchCumFunding: async () => 5
    }
  };

  const fetcher = new LighterFetcher(providers, renderer);
  await fetcher.fetch(['0xabc']);

  const walletCall = calls.find(c => c.source === 'Lighter_0xabc');
  assert.ok(walletCall, 'lighter wallet rows should be appended');
  assert.ok(walletCall.rows.some(r => r.asset === 'ETH' && r.exchange === 'Lighter' && r.value === 6000), 'perp row should be parsed from alternate schema');
  const equityRow = walletCall.rows.find(r => r.isLighterAccountEquity);
  assert.ok(equityRow, 'collateral fallback should create synthetic account-equity row');
  assert.equal(equityRow.value, 1620, 'equity row should be free collateral + perp unrealized PnL when total NAV missing');
  assert.equal(equityRow.pnl, 120, 'equity row pnl should reflect aggregated perp unrealized PnL');
  assert.ok(walletCall.rows.some(r => r.asset === 'LIT' && r.exchange === 'Lighter Spot' && r.amount === 8), 'spot row should be parsed from alternate schema');

  // Perp notional ($6000) must not leak into portfolio totals now that an equity row exists.
  const totals = calculatePortfolioTotals(walletCall.rows);
  assert.equal(totals.totalValue, 1700, 'lighter totals = equity row + spot row, not perp notional');
  assert.equal(totals.totalPnL, 120, 'totals pnl should come from equity row');
}

async function testLighterObjectMapSchemaRows() {
  const calls = [];
  const renderer = {
    appendPositions: (rows, source, options) => calls.push({ rows, source, options }),
    markProviderFailed: (_, err) => {
      throw err;
    }
  };

  const providers = {
    lighter: {
      fetchAccountByAddress: async () => ({
        accounts: [{
          account_index: 12,
          positions: {
            '2': {
              market_id: 2,
              szi: '-1.5',
              mark_px: '3200',
              unrealized_pnl: '-40',
              entry_px: '3000'
            }
          },
          assets: {
            '2': {
              asset_id: 2,
              total: '5',
              locked: '1',
              price_usd: '10'
            }
          },
          equity: '2000'
        }]
      }),
      getSymbolByMarketId: (marketId) => (Number(marketId) === 2 ? 'ETH' : null),
      getSpotAssetMap: () => ({ 2: 'LIT' }),
      fetchCandlesticks: async (symbol) => {
        if (symbol === 'ETH') {
          return {
            priceHistory: [{ price: 3100, timestamp: 1 }, { price: 3200, timestamp: 2 }],
            change24h: 2,
            currentPrice: 3200
          };
        }
        if (symbol === 'LIT') {
          return {
            priceHistory: [{ price: 8, timestamp: 1 }, { price: 10, timestamp: 2 }],
            change24h: 25,
            currentPrice: 10
          };
        }
        return null;
      },
      fetchFundingRates: async () => ({}),
      fetchCumFunding: async () => null
    }
  };

  const fetcher = new LighterFetcher(providers, renderer);
  await fetcher.fetch(['0xdef']);

  const walletCall = calls.find(c => c.source === 'Lighter_0xdef');
  assert.ok(walletCall, 'lighter wallet rows should be appended for object-map schema');
  assert.ok(walletCall.rows.some(r => r.asset === 'ETH' && r.exchange === 'Lighter' && r.value === 4800), 'market_id mapping should resolve perp symbol and value');
  assert.ok(walletCall.rows.some(r => r.asset === 'LIT' && r.exchange === 'Lighter Spot' && r.amount === 4), 'asset_id mapping should resolve spot symbol');
  const equityRow = walletCall.rows.find(r => r.isLighterAccountEquity);
  assert.ok(equityRow, 'account-equity row should be emitted when total equity field is present');
  assert.equal(equityRow.value, 2000, 'equity row should use API-reported total equity directly');
  assert.equal(equityRow.pnl, -40, 'equity row pnl should aggregate perp unrealized PnL when account-level pnl missing');

  // Double-check the perp notional ($4800 at 1.5x-ish notional) is skipped by totals.
  const totals = calculatePortfolioTotals(walletCall.rows);
  assert.equal(totals.totalValue, 2040, 'totals = equity row (2000) + LIT spot row (40), no perp notional');
  assert.equal(totals.totalPnL, -40);
}

async function testLighterCoinGeckoFallbackForSpotPrice() {
  const calls = [];
  const renderer = {
    appendPositions: (rows, source, options) => calls.push({ rows, source, options }),
    markProviderFailed: (_, err) => {
      throw err;
    }
  };

  const providers = {
    lighter: {
      fetchAccountByAddress: async () => ({
        accounts: [{
          account_index: 44,
          assets: [{
            symbol: 'LIT',
            balance: '120',
            locked_balance: '0'
          }]
        }]
      }),
      fetchCandlesticks: async () => null,
      fetchFundingRates: async () => ({}),
      fetchCumFunding: async () => null
    },
    coingecko: {
      getSimplePrice: async () => ({
        lighter: {
          usd: 1.5,
          usd_24h_change: 10
        }
      })
    }
  };

  const fetcher = new LighterFetcher(providers, renderer);
  await fetcher.fetch(['0xcoingecko']);

  const walletCall = calls.find(c => c.source === 'Lighter_0xcoingecko');
  assert.ok(walletCall, 'lighter wallet rows should be appended for CoinGecko fallback test');
  const litRow = walletCall.rows.find(r => r.asset === 'LIT' && r.exchange === 'Lighter Spot');
  assert.ok(litRow, 'spot row should be created for LIT');
  assert.equal(litRow.price, 1.5, 'spot price should fall back to CoinGecko');
  assert.equal(litRow.value, 180, 'spot value should be derived from CoinGecko price');
  assert.equal(litRow.change24h, 10, 'spot 24h change should fall back to CoinGecko');
}

async function testManualFetcherRoutesStockPositionsThroughYahoo() {
  const calls = [];
  const renderer = {
    appendPositions: (rows, source, options) => calls.push({ rows, source, options }),
    markProviderFailed: (_, err) => { throw err; }
  };

  const getQuotesCalls = [];
  const providers = {
    stocks: {
      getQuotes: async (symbols) => {
        getQuotesCalls.push(symbols);
        return {
          AAPL: { symbol: 'AAPL', price: 220, change24h: 1.5, marketState: 'REGULAR',
                  name: 'Apple Inc.', previousClose: 217, currency: 'USD' },
          SPY: { symbol: 'SPY', price: 500, change24h: 0.8, marketState: 'CLOSED',
                 name: 'SPDR S&P 500', previousClose: 496, currency: 'USD' }
        };
      },
      get24hPriceHistory: async () => []
    }
  };

  const fetcher = new ManualFetcher(providers, renderer, {
    showPriceChart: false,
    hiddenAssets: [],
    minBalanceThreshold: 0
  });

  await fetcher.fetch([
    { type: 'stock', symbol: 'AAPL', amount: 10, entryPrice: 180, category: 'equity',
      name: 'Apple Inc.', entryDate: '2024-01-02', exchange: 'NASDAQ' },
    { type: 'stock', symbol: 'SPY', amount: 5, entryPrice: 480, category: 'etf',
      name: 'SPDR S&P 500' }
  ]);

  const manualCalls = calls.filter(c => c.source === 'Manual');
  assert.equal(manualCalls[0].options.markCompleted, false, 'stock placeholders should not mark Manual complete');
  assert.equal(manualCalls[0].rows[0].quoteLoading, true, 'stock positions should render while quotes load');
  const manualCall = manualCalls.at(-1);
  assert.ok(manualCall, 'manual rows should be appended under "Manual" source');
  assert.equal(manualCall.rows.length, 2);

  const aapl = manualCall.rows.find(r => r.asset === 'AAPL');
  assert.equal(aapl.exchange, 'Manual (Stock)');
  assert.equal(aapl.amount, 10);
  assert.equal(aapl.price, 220);
  assert.equal(aapl.value, 2200);
  assert.equal(aapl.pnl, 400, 'PnL = 10 * (220 - 180)');
  assert.equal(aapl.change24h, 1.5);
  assert.equal(aapl.entryDate, '2024-01-02');
  assert.equal(aapl.marketState, 'REGULAR');
  assert.equal(aapl.category, 'equity');
  assert.equal(aapl.currency, 'USD');
  assert.equal(aapl.manualType, 'stock');

  const spy = manualCall.rows.find(r => r.asset === 'SPY');
  assert.equal(spy.exchange, 'Manual (ETF)', 'ETF category should surface as Manual (ETF)');
  assert.equal(spy.marketState, 'CLOSED');

  assert.equal(getQuotesCalls.length, 1, 'one batched quote call for both symbols');
  assert.deepEqual(new Set(getQuotesCalls[0]), new Set(['AAPL', 'SPY']));
}

async function testManualFetcherAppendsStockPlaceholderBeforeSlowQuote() {
  const calls = [];
  const renderer = {
    appendPositions: (rows, source, options) => calls.push({ rows, source, options }),
    markProviderFailed: (_, err) => { throw err; }
  };

  let resolveQuotes;
  const quotePromise = new Promise(resolve => { resolveQuotes = resolve; });
  const providers = {
    stocks: {
      getQuotes: async () => quotePromise,
      get24hPriceHistory: async () => []
    }
  };
  const fetcher = new ManualFetcher(providers, renderer, {
    showPriceChart: false,
    hiddenAssets: [],
    minBalanceThreshold: 0
  });

  const fetchPromise = fetcher.fetch([
    { type: 'stock', symbol: 'SIVEF', amount: 10, entryPrice: 3, category: 'equity', currency: 'USD' }
  ]);
  await Promise.resolve();

  assert.equal(calls.length, 1, 'placeholder should append before Yahoo quote resolves');
  assert.equal(calls[0].rows[0].asset, 'SIVEF');
  assert.equal(calls[0].rows[0].quoteLoading, true);
  assert.equal(calls[0].options.markCompleted, false);

  resolveQuotes({
    SIVEF: { symbol: 'SIVEF', price: 5.92, change24h: 0.68, currency: 'USD' }
  });
  await fetchPromise;

  const finalCall = calls.at(-1);
  assert.equal(finalCall.rows[0].quoteLoading, false);
  assert.equal(finalCall.rows[0].quoteUnavailable, false);
  assert.equal(finalCall.rows[0].price, 5.92);
  assert.equal(finalCall.rows[0].value, 59.2);
}

async function testManualFetcherRefreshKeepsLastQuoteWhileLoading() {
  const calls = [];
  const renderer = {
    appendPositions: (rows, source, options) => calls.push({ rows, source, options }),
    markProviderFailed: (_, err) => { throw err; }
  };

  let resolveRefresh;
  const quoteResponses = [
    Promise.resolve({ SIVEF: { symbol: 'SIVEF', price: 5.92, change24h: 0.68, currency: 'USD' } }),
    new Promise(resolve => { resolveRefresh = resolve; })
  ];
  const providers = {
    stocks: {
      getQuotes: async () => quoteResponses.shift(),
      get24hPriceHistory: async () => []
    }
  };
  const fetcher = new ManualFetcher(providers, renderer, {
    showPriceChart: false,
    hiddenAssets: [],
    minBalanceThreshold: 0
  });
  const positions = [
    { type: 'stock', symbol: 'SIVEF', amount: 10, entryPrice: 3, category: 'equity', currency: 'USD' }
  ];

  await fetcher.fetch(positions);
  calls.length = 0;

  const refresh = fetcher.fetch(positions);
  await Promise.resolve();

  // The refresh placeholder carries the previous quote instead of blanking the row.
  assert.equal(calls[0].rows[0].quoteLoading, false);
  assert.equal(calls[0].rows[0].price, 5.92);
  assert.equal(calls[0].rows[0].value, 59.2);

  resolveRefresh({ SIVEF: { symbol: 'SIVEF', price: 6.1, change24h: 1.2, currency: 'USD' } });
  await refresh;
  assert.equal(calls.at(-1).rows[0].price, 6.1);
}

async function testManualPythPositionsSurvivePythOutage() {
  const calls = [];
  const renderer = {
    appendPositions: (rows, source, options) => calls.push({ rows, source, options }),
    markProviderFailed: (_, err) => { throw err; }
  };
  const quoteRequests = [];
  const providers = {
    pyth: {
      getLatestByFeedIds: async () => { throw new Error('HTTP 401 unauthorized'); },
      getBatch24hPriceHistory: async () => ({})
    },
    stocks: {
      getQuotes: async (symbols) => {
        quoteRequests.push(...symbols);
        return { NVDA: { symbol: 'NVDA', price: 230, change24h: -2.9, currency: 'USD', priceHistory: [] } };
      },
      get24hPriceHistory: async () => []
    }
  };
  const fetcher = new ManualFetcher(providers, renderer, { showPriceChart: false, hiddenAssets: [], minBalanceThreshold: 0 });

  await fetcher.fetch([
    { type: 'pyth', symbol: 'NVDA', feedId: '0xnvda', amount: 56.79, entryPrice: 197, category: 'equity' },
    { type: 'pyth', symbol: 'HYPE', feedId: '0xhype', amount: 10, entryPrice: 30, category: 'crypto' }
  ]);

  const rows = calls.at(-1).rows;
  const nvda = rows.find(r => r.asset === 'NVDA');
  assert.equal(nvda.price, 230, 'equity falls back to the Yahoo quote on the same ticker');
  assert.equal(Math.round(nvda.value), Math.round(56.79 * 230));
  assert.equal(Math.round(nvda.pnl), Math.round((230 - 197) * 56.79));
  assert.equal(nvda.quoteUnavailable, false);

  const hype = rows.find(r => r.asset === 'HYPE');
  assert.equal(hype.quoteUnavailable, true, 'crypto is not guessed from Yahoo');
  assert.equal(hype.pnl, null, 'no price must never read as a total loss');
  assert.deepEqual(quoteRequests, ['NVDA']);
}

async function testManualFetcherPreservesCustomPositionCurrency() {
  const calls = [];
  const renderer = {
    appendPositions: (rows, source, options) => calls.push({ rows, source, options }),
    markProviderFailed: (_, err) => { throw err; }
  };

  const fetcher = new ManualFetcher({}, renderer, {
    showPriceChart: false,
    portfolioBaseCurrency: 'EUR'
  });

  await fetcher.fetch([
    { type: 'custom', name: 'London note', value: 500, currency: 'GBP' },
    { type: 'custom', name: 'Euro cash', value: 1000 }
  ]);

  const manualCall = calls.find(c => c.source === 'Manual');
  assert.ok(manualCall, 'manual rows should be appended for custom positions');
  assert.equal(manualCall.rows.find(r => r.asset === 'London note').currency, 'GBP');
  assert.equal(manualCall.rows.find(r => r.asset === 'Euro cash').currency, 'EUR');
}

async function testStocksQuotesUseExtendedHoursSparkData() {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const target = new URL(String(url), 'https://viewport.test').searchParams.get('url') || '';
    if (target.includes('/v8/finance/chart/')) {
      // Listing-currency lookup (spark omits currency).
      return new Response(JSON.stringify({ chart: { result: [{ meta: { currency: 'USD' } }] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    assert.ok(target.includes('includePrePost=true'), 'quote request should include extended-hours candles');

    return new Response(JSON.stringify({
      CRWV: {
        symbol: 'CRWV',
        timestamp: [1777901400, 1777901700],
        close: [125.31, 128.33],
        previousClose: 119.01,
        chartPreviousClose: 119.01
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    const quotes = await StocksProvider.getQuotes(['CRWV'], { timeoutMs: 1000 });
    assert.equal(calls.filter(u => u.includes('spark')).length, 1);
    assert.equal(quotes.CRWV.currency, 'USD');
    assert.equal(quotes.CRWV.price, 128.33);
    assert.equal(quotes.CRWV.previousClose, 119.01);
    assert.ok(quotes.CRWV.change24h > 7);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testStocksSearchCarriesQuoteCurrency() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    quotes: [{
      symbol: 'VOD.L',
      shortname: 'Vodafone Group plc',
      exchDisp: 'London',
      quoteType: 'EQUITY',
      currency: 'GBp'
    }]
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });

  try {
    const results = await StocksProvider.searchSymbols('vod', { timeoutMs: 1000 });
    assert.equal(results.length, 1);
    assert.equal(results[0].symbol, 'VOD.L');
    assert.equal(results[0].currency, 'GBp');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testCurrencyFormattingAndFxRates() {
  assert.equal(normalizeBaseCurrency('EUR'), 'EUR');
  assert.equal(normalizeBaseCurrency('JPY'), 'USD');
  assert.equal(getFxCurrency('GBp'), 'GBP');
  assert.equal(getQuoteUnitScale('GBp'), 0.01);
  assert.equal(formatMoney(1234, { currency: 'EUR' }), '€1.2k');
  assert.equal(formatMoney(150, { currency: 'GBp', compact: false }), '150 GBp');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = new URL(String(url), 'https://viewport.test').searchParams.get('url') || '';
    assert.ok(target.includes('EURUSD%3DX') || target.includes('EURUSD=X'));
    return new Response(JSON.stringify({
      'EURUSD=X': {
        symbol: 'EURUSD=X',
        timestamp: [1],
        close: [1.1],
        previousClose: 1.09
      },
      'GBPUSD=X': {
        symbol: 'GBPUSD=X',
        timestamp: [1],
        close: [1.25],
        previousClose: 1.24
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    const rates = await StocksProvider.getFxRates(['EUR', 'GBp'], 'USD', { timeoutMs: 1000 });
    assert.equal(rates.EUR, 1.1);
    assert.equal(rates.GBp, 0.0125);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function testManualPositionDeletionHandlesStocksAndCategoryKeys() {
  const positions = [
    { type: 'stock', symbol: 'AAPL', amount: 10 },
    { type: 'pyth', symbol: 'AAPL', feedId: '0xaapl', amount: 1 },
    { type: 'custom', name: 'AAPL', value: 100 },
    { type: 'stock', symbol: 'SPY', amount: 5 },
    { type: 'custom', name: 'Gold bars', symbol: 'XAU', value: 2000 }
  ];

  const remaining = removeManualPositionByAsset(positions, 'AAPL', 'stock');
  assert.equal(remaining.length, 4, 'only the Yahoo-backed stock row should be removed');
  assert.ok(remaining.some(p => p.type === 'pyth' && p.symbol === 'AAPL'));
  assert.ok(remaining.some(p => p.type === 'custom' && p.name === 'AAPL'));
  assert.ok(remaining.some(p => p.type === 'stock' && p.symbol === 'SPY'));
  assert.equal(getManualPositionAsset(positions[4]), 'XAU', 'custom deletion should follow rendered asset first');
  assert.equal(removeManualPositionByAsset(positions, 'Gold bars', 'custom').length, 4);

  const hiddenKeys = getManualPositionHiddenKeys('SPY');
  assert.ok(hiddenKeys.includes('SPY_Manual (Stock)'));
  assert.ok(hiddenKeys.includes('SPY_Manual (ETF)'));
  assert.ok(hiddenKeys.includes('SPY_Manual (Fund)'));
  assert.ok(hiddenKeys.includes('SPY_Manual (Index)'));

  assert.equal(manualTypeFromExchange('Manual (ETF)'), 'stock');
  assert.equal(manualTypeFromExchange('Manual (Custom)'), 'custom');
  assert.equal(manualTypeFromExchange('Manual (Pyth)'), 'pyth');
  assert.equal(
    renderedManualPositionMatches({ isManual: true, manualType: 'stock', asset: 'AAPL' }, 'AAPL', 'stock'),
    true
  );
  assert.equal(
    renderedManualPositionMatches({ isManual: true, manualType: 'pyth', asset: 'AAPL' }, 'AAPL', 'stock'),
    false
  );
}

function testWatchlistNormalizeEntriesAcceptsLegacyAndMixed() {
  // Legacy: array of Pyth feed id strings
  const legacy = normalizeEntries([
    '0xabc123',
    '0xdef456'
  ]);
  assert.equal(legacy.length, 2);
  assert.equal(legacy[0].provider, 'pyth');
  assert.equal(legacy[0].id, '0xabc123');

  // New: mixed pyth + yahoo objects
  const mixed = normalizeEntries([
    '0xlegacy',
    { provider: 'pyth', id: '0xexplicit' },
    { provider: 'yahoo', symbol: 'AAPL', name: 'Apple Inc.', category: 'equity' },
    { provider: 'yahoo', symbol: 'spy' } // lowercase — symbol normalization is for keys only
  ]);
  assert.equal(mixed.length, 4, 'all valid entries must survive');
  assert.equal(mixed[0].provider, 'pyth');
  assert.equal(mixed[1].provider, 'pyth');
  assert.equal(mixed[2].provider, 'yahoo');
  assert.equal(mixed[2].name, 'Apple Inc.');
  assert.equal(mixed[3].symbol, 'spy');

  // Defensive: invalid / empty / malformed entries are dropped rather than crashing
  const noise = normalizeEntries([
    null,
    undefined,
    '',
    { provider: 'yahoo' },                // missing symbol
    { provider: 'unknown', id: 'x' },     // unknown provider
    { id: '0xbarefootid' }                // legacy-shaped object without provider
  ]);
  assert.equal(noise.length, 1, 'only the legacy-shaped pyth object should survive');
  assert.equal(noise[0].provider, 'pyth');
  assert.equal(noise[0].id, '0xbarefootid');

  // Non-array input is tolerated
  assert.deepEqual(normalizeEntries(null), []);
  assert.deepEqual(normalizeEntries(undefined), []);
  assert.deepEqual(normalizeEntries('not-an-array'), []);
}

function testPortfolioHistorySeriesMath() {
  // Parts added on every timestamp either has; before its first point a part holds that value.
  const a = [[10, 100], [20, 110], [30, 120]];
  const b = [[15, 50], [25, 70]];
  assert.deepEqual(sumSeries([a, b]), [[10, 150], [15, 150], [20, 160], [25, 180], [30, 190]]);
  assert.deepEqual(sumSeries([a, b], 20), [[20, 160], [25, 180], [30, 190]]);
  assert.deepEqual(sumSeries([[[5, 1], [5, 2]]]), [[5, 2]]);
  // The window keeps the last point before it, so the value at the start is known.
  assert.deepEqual(clip(a, 25), [[20, 110], [30, 120]]);
  assert.deepEqual(clip(a, 5), a);
  assert.deepEqual(clip(a, 99), [[30, 120]]);
  // Account series end at the live value; priced holdings scale with their price.
  assert.deepEqual(anchored([[1, 90], [2, 95]], 100, 3), [[1, 95], [2, 100], [3, 100]]);
  assert.deepEqual(anchored([], 100, 3), [[3, 100]]);
  assert.deepEqual(scaled([[1, 50], [2, 100]], 300, 3), [[1, 150], [2, 300], [3, 300]]);
  assert.deepEqual(scaled([], 300, 3), [[3, 300]]);
  // A series ending at or below zero can't be scaled: shifted instead.
  assert.deepEqual(scaled([[1, -5], [2, 0]], 300, 3), [[1, 295], [2, 300], [3, 300]]);
}

function testPortfolioHistoryPlanAndPriceKeys() {
  const rows = [
    { asset: 'HL_ACCOUNT_EQUITY', exchange: 'HL Perps', isHlAccountEquity: true, value: 1000, _source: 'Hyperliquid_0xabc' },
    { asset: 'ETH', exchange: 'HL Perps', isLeveraged: true, value: 5000, _source: 'Hyperliquid_0xabc' },
    { asset: 'LIGHTER_ACCOUNT_EQUITY', exchange: 'Lighter', isLighterAccountEquity: true, value: 300, _source: 'Lighter_0xabc', _changeDetectionKey: 'LIGHTER_ACCOUNT_EQUITY_0xabc_42' },
    { asset: 'BTC', exchange: 'Lighter', value: 900, _source: 'Lighter_0xabc' },
    { asset: 'LIT', exchange: 'Lighter Spot', value: 40, _source: 'Lighter_0xabc' },
    { asset: 'ETH', exchange: 'Ethereum', value: 700, _source: 'Zerion_0xabc' },
    { asset: 'USDC', exchange: 'Base', value: 100, _source: 'Zerion_0xabc' },
    { asset: 'VWCE', exchange: 'IBKR', category: 'etf', value: 2000, _source: 'IBKR' },
    { asset: 'AAPL', exchange: 'IBKR', category: 'equity', value: 500, _source: 'IBKR' },
    { asset: 'BTC', exchange: 'Bitcoin', value: 600, _source: 'Bitcoin/Zcash' },
    { asset: 'Vault', exchange: 'Manual (Custom)', value: 50, _source: 'Manual' },
    { asset: 'ZERO', exchange: 'Manual (Custom)', value: 0, _source: 'Manual' },
    null
  ];
  const groups = plan(rows);
  assert.deepEqual(Array.from(groups.hl), [['0xabc', 1000]]);
  assert.deepEqual(Array.from(groups.lighter), [['42', 300]]);
  assert.deepEqual(Array.from(groups.zerion), [['0xabc', 800]]);
  assert.equal(groups.ibkr, 2500);
  // Perps inside an equity row add nothing; spot, Bitcoin and manual rows are priced.
  assert.deepEqual(groups.priced.map(p => p.asset), ['LIT', 'BTC', 'Vault']);
  assert.equal(plan([]).ibkr, null);

  assert.equal(priceKeyOf({ asset: 'HYPE', exchange: 'HL Staking' }), 'hl:HYPE');
  assert.equal(priceKeyOf({ asset: 'btc', exchange: 'Bitcoin' }), 'hl:BTC');
  assert.equal(priceKeyOf({ asset: 'AAPL', exchange: 'Manual (Stock)', category: 'equity' }), 'yahoo:AAPL');
  assert.equal(priceKeyOf({ asset: 'VWCE.DE', exchange: 'Manual (Stock)', category: 'etf' }), 'yahoo:VWCE.DE');
  assert.equal(priceKeyOf({ asset: 'USDC', exchange: 'Base' }), null);
  assert.equal(priceKeyOf({ asset: 'Vault', exchange: 'Manual (Custom)' }), null);
  assert.equal(priceKeyOf({ asset: 'GC', exchange: 'Manual (Metal)', category: 'metal' }), null);
  assert.equal(priceKeyOf({ asset: 'ABCL 270115C00008000', exchange: 'IBKR', category: 'option' }), null);
}

async function testPortfolioHistoryFlatHoldingsNeedNoRequests() {
  // Only holdings without a price history: one point, the total, in the base currency.
  const rows = [
    { asset: 'Vault', exchange: 'Manual (Custom)', value: 50, _source: 'Manual' },
    { asset: 'USDC', exchange: 'Base', value: 150, _source: 'Alchemy/Helius' }
  ];
  const renderer = { settings: { portfolioBaseCurrency: 'EUR' }, conversionRateFor: () => 0.9 };
  const out = await getPortfolioHistory('week', { rows, renderer, now: 1000 });
  assert.deepEqual(out, { values: [[1000, 200]], currency: 'EUR', symbol: '€' });
  const empty = await getPortfolioHistory('day', { rows: [], renderer: null, now: 1000 });
  assert.deepEqual(empty.values, []);
}

function testLighterAndZerionHistoryShapes() {
  // Lighter: profits plus deposits minus withdrawals; pool and staking moves cancel out.
  const series = pnlSeries({ pnl: [
    { timestamp: 200, trade_pnl: 5, trade_spot_pnl: 1, pool_pnl: 2, staking_pnl: 0, inflow: 100, outflow: 10, spot_inflow: 3, spot_outflow: 1, pool_inflow: 50, pool_outflow: 0, staking_inflow: 20 },
    { timestamp: 100, trade_pnl: 0, inflow: 100 }
  ] });
  assert.deepEqual(series, [{ t: 100000, equityDelta: 100 }, { t: 200000, equityDelta: 100 }]);
  assert.deepEqual(pnlSeries(null), []);
  // Zerion: [seconds, value] pairs, oldest first, in milliseconds.
  assert.deepEqual(chartPoints({ data: { attributes: { points: [[1700000100, 20], [1700000000, 10], ['x', 5]] } } }), [[1700000000000, 10], [1700000100000, 20]]);
  assert.deepEqual(chartPoints({ data: { attributes: { points: [{ timestamp: 1700000000, value: 7 }] } } }), [[1700000000000, 7]]);
  assert.deepEqual(chartPoints({}), []);
}

function testHyperliquidDexListAndCombinedPerpState() {
  const { perpDexNames, combinePerpStates } = HyperliquidProvider;

  // perpDexs lists the main dex as null and each HIP-3 dex by name.
  assert.deepEqual(perpDexNames([null, { name: 'xyz' }, { name: 'mkts' }, {}]), ['', 'xyz', 'mkts']);
  assert.deepEqual(perpDexNames(null), ['']);

  // The account's perp value is the sum over every dex, not just main and xyz. Positions
  // merge into one list; dexes with dust and no position are left out of the active list.
  const state = (accountValue, withdrawable, coins) => ({
    marginSummary: { accountValue },
    withdrawable,
    assetPositions: coins.map(coin => ({ position: { coin, szi: '1' } }))
  });
  const combined = combinePerpStates([
    { dex: '', state: state('43391420.53', '38167743.21', ['ETH']) },
    { dex: 'xyz', state: state('67693583.99', '36219758.59', ['xyz:GOOGL']) },
    { dex: 'mkts', state: state('4260882.50', '4010150.95', ['mkts:US500']) },
    { dex: 'flx', state: state('0.001804', '0.001804', []) },
    { dex: 'io', state: null }
  ]);
  assert.ok(Math.abs(Number(combined.perp.marginSummary.accountValue) - 115345887.021804) < 1e-6);
  assert.deepEqual(combined.perp.assetPositions.map(p => p.position.coin), ['ETH', 'xyz:GOOGL', 'mkts:US500']);
  assert.deepEqual(combined.activeDexes, ['', 'xyz', 'mkts']);

  // Main dex down, a HIP-3 dex answering: still a perp state.
  const noMain = combinePerpStates([
    { dex: '', state: null },
    { dex: 'xyz', state: state('10', '10', ['xyz:AAPL']) }
  ]);
  assert.equal(noMain.perp.marginSummary.accountValue, '10');
  assert.deepEqual(noMain.perp.assetPositions.map(p => p.position.coin), ['xyz:AAPL']);
  assert.deepEqual(noMain.activeDexes, ['xyz']);

  // Nothing answered: no state at all (fetchPositions throws before this when a dex that
  // may hold money is the one missing).
  assert.deepEqual(combinePerpStates([{ dex: '', state: null }]), { perp: null, activeDexes: [] });
}

function testHyperliquidDexReadPlanAndMissingAnswers() {
  const { planDexRead, unansweredDexes } = HyperliquidProvider;
  const MIN = 60 * 1000;
  const now = 100 * MIN;

  // First look, and every ten minutes: every dex (the caller fetches the list).
  assert.deepEqual(planDexRead(null, now), { probeAll: true, dexes: null });
  assert.deepEqual(planDexRead({ dexes: ['', 'xyz'], probedAt: now - 10 * MIN }, now), { probeAll: true, dexes: null });
  // In between: only the dexes with money or positions, or main when there are none.
  assert.deepEqual(planDexRead({ dexes: ['', 'xyz', 'mkts'], probedAt: now - 3 * MIN }, now), { probeAll: false, dexes: ['', 'xyz', 'mkts'] });
  assert.deepEqual(planDexRead({ dexes: [], probedAt: now - 3 * MIN }, now), { probeAll: false, dexes: [''] });

  // A dex that doesn't answer matters on a first look, or when it held money last time.
  const dexes = ['', 'xyz', 'mkts', 'flx'];
  assert.deepEqual(unansweredDexes(dexes, [true, false, true, false], null), ['xyz', 'flx']);
  assert.deepEqual(unansweredDexes(dexes, [true, false, true, false], { dexes: ['', 'xyz'] }), ['xyz']);
  assert.deepEqual(unansweredDexes(dexes, [true, true, true, false], { dexes: ['', 'xyz'] }), []);
}

async function testHyperliquidStakingReadKeepsLastAnswerOrFails() {
  let fail = false;
  const providers = {
    hyperliquid: {
      fetchDelegatorSummary: async () => {
        if (fail) throw new Error('timeout');
        return { delegated: '4', undelegated: '1', totalPendingWithdrawal: '0' };
      }
    }
  };
  const fetcher = new HyperliquidFetcher(providers, {}, {});
  assert.deepEqual(await fetcher.getStaking('0xabc'), { staked: 4, unstaked: 1, withdrawing: 0 });

  // The exchange stops answering: the last answer stands in, once the cache has aged out.
  fail = true;
  fetcher.stakingCache.get('0xabc').at = 0;
  assert.deepEqual(await fetcher.getStaking('0xabc'), { staked: 4, unstaked: 1, withdrawing: 0 });

  // With no last answer, the failure reaches the caller instead of reading as "nothing staked".
  await assert.rejects(() => fetcher.getStaking('0xdef'), /timeout/);
}

function testHyperliquidEquityRowIsTheAccountValue() {
  // The equity row must equal what Hyperliquid itself reports as the account's value:
  // perps on every dex, spot balances, and staked HYPE at the spot price.
  const fetcher = new HyperliquidFetcher({ hyperliquid: HyperliquidProvider }, {}, {});
  const spotMeta = {
    tokens: [{ name: 'USDC', index: 0 }, { name: 'HYPE', index: 150 }],
    universe: [{ name: '@107', tokens: [150, 0], index: 107 }]
  };
  const market = fetcher.buildMarket(
    { HYPE: '2.1', '@107': '2' },
    null,
    [[{ universe: [{ name: 'mkts:US500' }] }, [{ funding: '0.0001', prevDayPx: '48' }]]],
    spotMeta
  );
  assert.equal(Number(market.spotPriceMap.HYPE), 2);
  assert.equal(market.hlFundingRateMap['mkts:US500'], 0.0001);

  const rows = fetcher.buildWalletRows('0xabc', {
    perp: {
      marginSummary: { accountValue: '100' },
      withdrawable: '80',
      assetPositions: [{ position: { coin: 'mkts:US500', szi: '-2', entryPx: '50', positionValue: '100', unrealizedPnl: '5' } }]
    },
    spot: { balances: [{ coin: 'HYPE', total: '10', hold: '0', entryNtl: '15' }] },
    staking: { staked: 4, unstaked: 1, withdrawing: 0 }
  }, market);

  const equity = rows.find(r => r.isHlAccountEquity);
  assert.equal(equity.value, 130, 'perps 100 + spot 10 HYPE at 2 + staked 5 HYPE at 2');
  const staking = rows.find(r => r.exchange === 'HL Staking');
  assert.equal(staking.value, 10);
  assert.equal(staking.price, 2, 'staked HYPE is valued at the spot mid, as Hyperliquid does');
  const perp = rows.find(r => r.exchange === 'HL Perps' && !r.isHlAccountEquity);
  assert.equal(perp.fundingRate, 0.0001, 'a HIP-3 dex other than xyz gets its funding rate');
  assert.ok(Math.abs(perp.change24h - (50 - 48) / 48 * 100) < 1e-9, 'and its 24h change');

  // Staked HYPE is inside the equity: the headline counts it once.
  assert.equal(calculatePortfolioTotals(rows).totalValue, 130);
  const breakdown = calculatePortfolioBreakdown(rows);
  assert.deepEqual(
    breakdown.allocation.map(s => [s.label, Math.round(s.value)]),
    [['mkts:US500', 100], ['HYPE', 30]]
  );
}

async function run() {
  testPortfolioHistorySeriesMath();
  testPortfolioHistoryPlanAndPriceKeys();
  await testPortfolioHistoryFlatHoldingsNeedNoRequests();
  testLighterAndZerionHistoryShapes();
  await testManualCustomLegacySchema();
  testLighterTotalsWithoutEquity();
  testLighterTotalsWithEquity();
  testHyperliquidTotalsFallbackWhenNoEquity();
  testHyperliquidDexListAndCombinedPerpState();
  testHyperliquidDexReadPlanAndMissingAnswers();
  await testHyperliquidStakingReadKeepsLastAnswerOrFails();
  testHyperliquidEquityRowIsTheAccountValue();
  testCostBasisOnLosses();
  testNaNPnlIsSkipped();
  testPnlPercentIgnoresPositionsWithoutCostBasis();
  testHeadlinePnlMatchesPositionRows();
  testMultiWalletHlEquityAggregates();
  testLighterLeverageDoesNotInflateTotals();
  testShortPnlSignPreserved();
  testPortfolioBreakdownAllocationAnd24h();
  testInstrumentsReadOptionsAndKinds();
  testPythFeedParserRecognisesAllCategories();
  testWatchlistNormalizeEntriesAcceptsLegacyAndMixed();
  await testManualFetcherLabelsStockPositions();
  await testManualFetcherLegacyPythPositionFallsBackToCrypto();
  await testManualFetcherRoutesStockPositionsThroughYahoo();
  await testManualFetcherAppendsStockPlaceholderBeforeSlowQuote();
  await testManualFetcherRefreshKeepsLastQuoteWhileLoading();
  await testManualPythPositionsSurvivePythOutage();
  await testManualFetcherPreservesCustomPositionCurrency();
  await testStocksQuotesUseExtendedHoursSparkData();
  await testStocksSearchCarriesQuoteCurrency();
  await testCurrencyFormattingAndFxRates();
  testManualPositionDeletionHandlesStocksAndCategoryKeys();
  testEmptyAndMalformedInputs();
  await testAlchemyHeliusRowShape();
  await testLighterAlternateSchemaRows();
  await testLighterObjectMapSchemaRows();
  await testLighterCoinGeckoFallbackForSpotPrice();
  console.log('All portfolio tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
