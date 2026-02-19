import assert from 'node:assert/strict';
import { calculatePortfolioTotals } from '../modules/domain/portfolio.js';
import { ManualFetcher } from '../modules/data/fetchers/manual-fetcher.js';
import { AlchemyHeliusFetcher } from '../modules/data/fetchers/alchemy-helius-fetcher.js';
import { LighterFetcher } from '../modules/data/fetchers/lighter-fetcher.js';

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
  assert.ok(walletCall.rows.some(r => r.asset === 'USDC' && r.exchange === 'Lighter' && r.value === 1500), 'collateral fallback should create USDC row');
  assert.ok(walletCall.rows.some(r => r.asset === 'LIT' && r.exchange === 'Lighter Spot' && r.amount === 8), 'spot row should be parsed from alternate schema');
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
  assert.ok(walletCall.rows.some(r => r.asset === 'USDC' && r.exchange === 'Lighter' && r.value === 2000), 'equity fallback should populate USDC balance row');
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

async function run() {
  await testManualCustomLegacySchema();
  testLighterTotalsWithoutEquity();
  testLighterTotalsWithEquity();
  testHyperliquidTotalsFallbackWhenNoEquity();
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
