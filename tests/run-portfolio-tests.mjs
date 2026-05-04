import assert from 'node:assert/strict';
import { calculatePortfolioTotals } from '../modules/domain/portfolio.js';
import { ManualFetcher } from '../modules/data/fetchers/manual-fetcher.js';
import { AlchemyHeliusFetcher } from '../modules/data/fetchers/alchemy-helius-fetcher.js';
import { LighterFetcher } from '../modules/data/fetchers/lighter-fetcher.js';
import { IbkrFetcher, _internal as ibkrFetcherInternal } from '../modules/data/fetchers/ibkr-fetcher.js';
import * as StocksProvider from '../modules/data/providers/stocks.js';
import * as IbkrProvider from '../modules/data/providers/ibkr.js';
import { _internal as pythInternal } from '../modules/data/providers/pyth.js';
import { normalizeEntries } from '../modules/features/watchlist.js';
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
  assert.equal(totals.totalPnL, 50);
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

function testMultiWalletHlEquityAggregates() {
  const totals = calculatePortfolioTotals([
    { exchange: 'HL Perps', isHlAccountEquity: true, value: 1000, pnl: 30 },
    { exchange: 'HL Perps', isHlAccountEquity: true, value: 500, pnl: -20 },
    { exchange: 'HL Perps', value: 300, pnl: 100 }, // raw perp row — must be skipped
    { exchange: 'HL Spot', value: 150, pnl: 5 }     // spot row — must also be skipped
  ]);
  assert.equal(totals.totalValue, 1500, 'HL equity rows should sum across wallets');
  assert.equal(totals.totalPnL, 10);
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

  const manualCall = calls.find(c => c.source === 'Manual');
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
    assert.equal(calls.length, 1);
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

async function testIbkrProviderUsesPortfolio2Positions() {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const textUrl = String(url);
    calls.push(textUrl);
    const target = textUrl.includes('/api/yahoo?url=')
      ? decodeURIComponent(new URL(textUrl, 'https://viewport.test').searchParams.get('url') || '')
      : textUrl;

    if (target.endsWith('/portfolio/accounts')) {
      return new Response(JSON.stringify([{ accountId: 'U1234567' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (target.includes('/portfolio2/U1234567/positions')) {
      return new Response(JSON.stringify([
        {
          position: 12,
          conid: '9408',
          avgPrice: 266.2,
          currency: 'USD',
          description: 'MCD',
          marketPrice: 258.83,
          marketValue: 3105.96,
          unrealizedPnl: 88.55,
          secType: 'STK',
          assetClass: 'STK'
        }
      ]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const accounts = await IbkrProvider.getAccounts({ baseUrl: 'https://localhost:5000/v1/api', timeoutMs: 1000 });
    const positions = await IbkrProvider.getPositions(accounts[0].accountId, {
      baseUrl: 'https://localhost:5000/v1/api',
      timeoutMs: 1000
    });
    assert.equal(accounts.length, 1);
    assert.equal(positions.length, 1);
    assert.equal(positions[0].description, 'MCD');
    assert.ok(calls.some(url => url.includes('/portfolio2/U1234567/positions')));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testIbkrFetcherMapsRowsForRenderer() {
  const calls = [];
  const renderer = {
    appendPositions: (rows, source, options) => calls.push({ rows, source, options }),
    markProviderFailed: (_, err) => { throw err; }
  };
  const providers = {
    ibkr: {
      getDefaultGatewayUrl: () => 'https://localhost:5000/v1/api',
      getAccounts: async () => [{ accountId: 'U1234567' }, { accountId: 'U7654321' }],
      getPositions: async (accountId) => accountId === 'U1234567'
        ? [{
            position: 12,
            conid: '9408',
            avgPrice: 266.2,
            description: 'MCD',
            marketPrice: 258.83,
            marketValue: 3105.96,
            unrealizedPnl: 88.55,
            secType: 'STK',
            assetClass: 'STK'
          }]
        : []
    }
  };
  const fetcher = new IbkrFetcher(providers, renderer, {
    ibkrEnabled: true,
    ibkrGatewayUrl: 'https://localhost:5000/v1/api',
    ibkrAccountIds: 'U1234567'
  });

  await fetcher.fetch();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].source, 'IBKR');
  assert.equal(calls[0].rows.length, 1);
  assert.equal(calls[0].rows[0].asset, 'MCD');
  assert.equal(calls[0].rows[0].exchange, 'IBKR STK');
  assert.equal(calls[0].rows[0].amount, 12);
  assert.equal(calls[0].rows[0].price, 258.83);
  assert.equal(calls[0].rows[0].value, 3105.96);
  assert.equal(calls[0].rows[0].pnl, 88.55);
  assert.equal(calls[0].rows[0].ibkrAccountId, 'U1234567');
  assert.equal(calls[0].options.removeFilter({ exchange: 'IBKR STK' }), true);
  assert.equal(calls[0].options.removeFilter({ exchange: 'Manual (Stock)' }), false);

  const optionRow = ibkrFetcherInternal.rowToPosition({
    position: 1,
    contractDesc: 'AAPL  260116C00200000',
    mktPrice: 10,
    mktValue: 1000,
    secType: 'OPT'
  }, 'U1234567');
  assert.equal(optionRow.exchange, 'IBKR OPT');
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

async function run() {
  await testManualCustomLegacySchema();
  testLighterTotalsWithoutEquity();
  testLighterTotalsWithEquity();
  testHyperliquidTotalsFallbackWhenNoEquity();
  testCostBasisOnLosses();
  testNaNPnlIsSkipped();
  testMultiWalletHlEquityAggregates();
  testLighterLeverageDoesNotInflateTotals();
  testShortPnlSignPreserved();
  testPythFeedParserRecognisesAllCategories();
  testWatchlistNormalizeEntriesAcceptsLegacyAndMixed();
  await testManualFetcherLabelsStockPositions();
  await testManualFetcherLegacyPythPositionFallsBackToCrypto();
  await testManualFetcherRoutesStockPositionsThroughYahoo();
  await testManualFetcherPreservesCustomPositionCurrency();
  await testStocksQuotesUseExtendedHoursSparkData();
  await testStocksSearchCarriesQuoteCurrency();
  await testCurrencyFormattingAndFxRates();
  await testIbkrProviderUsesPortfolio2Positions();
  await testIbkrFetcherMapsRowsForRenderer();
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
