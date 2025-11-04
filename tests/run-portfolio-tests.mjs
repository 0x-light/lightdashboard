import pkg from '../modules/domain/portfolio.js';
const { calculatePortfolio24hChange, calculateTotalPnLSummary } = pkg;

function approxEqual(a, b, eps = 1e-6) {
  return Math.abs(a - b) < eps;
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`Test failed: ${msg}`);
    process.exitCode = 1;
  }
}

// Test 1: 24h change simple long
{
  const positions = [
    { asset: 'BTC', exchange: 'Hyperliquid', amount: 1 },
    { asset: 'ETH', exchange: 'Hyperliquid', amount: 10 }
  ];
  const currentPrices = { 'BTC_Hyperliquid': 50000, 'ETH_Hyperliquid': 3000 };
  const prices24hAgo = { 'BTC_Hyperliquid': 49000, 'ETH_Hyperliquid': 2500 };
  const r = calculatePortfolio24hChange({ positions, currentPrices, prices24hAgo });
  // Change USD = (1*(50k-49k)) + (10*(3k-2.5k)) = 1000 + 5000 = 6000
  assert(approxEqual(r.changeUsd, 6000), '24h change USD');
  // Value 24h ago = 1*49k + 10*2.5k = 49k + 25k = 74k; pct ≈ 8.108%
  assert(approxEqual(r.value24hAgoUsd, 74000), '24h base value');
  assert(Math.abs(r.changePct - (6000/74000*100)) < 1e-6, '24h change pct');
}

// Test 2: 24h change with NFT keying
{
  const positions = [
    { asset: 'CoolCats', exchange: 'OpenSea', amount: 1, collectionSlug: 'cool-cats' }
  ];
  const currentPrices = { 'cool-cats_NFT': 2.5 };
  const prices24hAgo = { 'cool-cats_NFT': 2.0 };
  const r = calculatePortfolio24hChange({ positions, currentPrices, prices24hAgo, keyFn: (p)=> `${p.collectionSlug}_NFT` });
  assert(approxEqual(r.changeUsd, 0.5), 'NFT 24h change USD');
}

// Test 3: Total PnL - using explicit pnl/value
{
  const positions = [
    { asset: 'BTC', exchange: 'Hyperliquid', value: 10000, pnl: 2000 },
    { asset: 'ETH', exchange: 'Hyperliquid', value: 5000, pnl: -500 }
  ];
  const r = calculateTotalPnLSummary(positions);
  assert(approxEqual(r.totalPnlUsd, 1500), 'Total PnL from explicit pnl');
  const costBasis = (10000-2000) + (5000-(-500)); // 8000 + 5500 = 13500
  assert(approxEqual(r.totalCostBasisUsd, costBasis), 'Derived cost basis');
  assert(approxEqual(r.totalPnlPercent, (1500/costBasis)*100), 'PnL percent');
}

// Test 4: Total PnL - using entry price + current prices
{
  const positions = [
    { asset: 'BTC', exchange: 'Hyperliquid', amount: 1, entryPrice: 30000 },
    { asset: 'ETH', exchange: 'Hyperliquid', amount: 2, entryPrice: 2000 }
  ];
  const currentPrices = { 'BTC_Hyperliquid': 35000, 'ETH_Hyperliquid': 2500 };
  const r = calculateTotalPnLSummary(positions, currentPrices);
  // PnL = 1*(35k-30k) + 2*(2.5k-2k) = 5k + 1k = 6k
  assert(approxEqual(r.totalPnlUsd, 6000), 'PnL from entries');
  const cb = 1*30000 + 2*2000; // 34000
  assert(approxEqual(r.totalCostBasisUsd, cb), 'Cost basis from entries');
  assert(approxEqual(r.totalPnlPercent, (6000/34000)*100), 'PnL% from entries');
}

if (process.exitCode === 1) {
  console.error('Some tests failed');
} else {
  console.log('All portfolio domain tests passed');
}


