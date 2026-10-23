// Made-up portfolios to start from in Settings > Demo. Each replaces the portfolio and keeps
// the name and city. The sample is in larp-mode.js, which needs it before modules load.
// Crypto in `manual` gets a feed id when it is loaded (see larp-settings.js).

export const PRESETS = [
  {
    id: 'whale',
    label: 'Whale',
    portfolio: {
      manual: [
        { type: 'pyth', symbol: 'BTC', name: 'Bitcoin', amount: 42, gain: 210, category: 'crypto', currency: 'USD' },
        { type: 'pyth', symbol: 'ETH', name: 'Ethereum', amount: 650, gain: 40, category: 'crypto', currency: 'USD' },
        { type: 'custom', name: 'Treasury bills', symbol: 'Treasury bills', amount: 1, price: 1500000, value: 1500000, currency: 'USD' }
      ],
      hlPerps: [
        { coin: 'BTC', size: 12, gain: 14, lev: 5, mode: 'cross' },
        { coin: 'HYPE', size: 40000, gain: 61, lev: 3, mode: 'cross' },
        { coin: 'ETH', size: -300, gain: 6, lev: 5, mode: 'cross' }
      ],
      hlSpot: [
        { coin: 'HYPE', amount: 85000, gain: 180 },
        { coin: 'USDC', amount: 2500000, gain: 0 }
      ],
      hlStaked: 250000,
      lighterPerps: [
        { symbol: 'ETH', size: 200, gain: 9, lev: 5 }
      ],
      stocks: [
        { symbol: 'NVDA', description: 'NVIDIA CORP', exchange: 'NASDAQ', currency: 'USD', qty: 3000, gain: 240 },
        { symbol: 'MSFT', description: 'MICROSOFT CORP', exchange: 'NASDAQ', currency: 'USD', qty: 1500, gain: 55 },
        { symbol: 'GOOGL', description: 'ALPHABET INC-CL A', exchange: 'NASDAQ', currency: 'USD', qty: 2500, gain: 70 }
      ],
      options: [
        { underlying: 'MSFT', expiry: '2027-06-18', strike: 600, right: 'C', qty: 50, entry: 30 }
      ],
      ibkrCash: [
        { currency: 'USD', amount: 1200000 }
      ],
      watchlist: 'MSTR, COIN, GC=F, ^GSPC'
    }
  },
  {
    id: 'degen',
    label: 'Degen perps',
    portfolio: {
      manual: [
        { type: 'custom', name: 'Rent money', symbol: 'Rent money', amount: 1, price: 1200, value: 1200, currency: 'USD' }
      ],
      hlPerps: [
        { coin: 'BTC', size: 1.5, gain: 12, lev: 40, mode: 'cross' },
        { coin: 'ETH', size: 40, gain: -8, lev: 25, mode: 'cross' },
        { coin: 'SOL', size: 600, gain: 31, lev: 20, mode: 'cross' },
        { coin: 'HYPE', size: 3000, gain: 48, lev: 10, mode: 'isolated' },
        { coin: 'FARTCOIN', size: 120000, gain: -22, lev: 10, mode: 'isolated' },
        { coin: 'kPEPE', size: 9000000, gain: 66, lev: 10, mode: 'isolated' },
        { coin: 'WIF', size: -40000, gain: 18, lev: 10, mode: 'isolated' }
      ],
      hlSpot: [
        { coin: 'USDC', amount: 1800, gain: 0 },
        { coin: 'HYPE', amount: 40, gain: 12 }
      ],
      hlStaked: 0,
      lighterPerps: [
        { symbol: 'ETH', size: 25, gain: 14, lev: 25 },
        { symbol: 'SOL', size: -300, gain: 9, lev: 20 },
        { symbol: 'DOGE', size: 400000, gain: -5, lev: 10 }
      ],
      stocks: [],
      options: [],
      ibkrCash: [],
      watchlist: 'COIN, MSTR, HOOD'
    }
  },
  {
    id: 'boomer',
    label: 'Boomer ETFs',
    portfolio: {
      manual: [
        { type: 'stock', symbol: 'AAPL', name: 'AAPL', amount: 150, gain: 210, category: 'equity', currency: 'USD', exchange: 'NASDAQ' },
        { type: 'custom', name: 'House', symbol: 'House', amount: 1, price: 680000, value: 680000, currency: 'USD' },
        { type: 'custom', name: 'Gold coins', symbol: 'Gold coins', amount: 1, price: 32000, value: 32000, currency: 'USD' }
      ],
      hlPerps: [],
      hlSpot: [],
      hlStaked: 0,
      lighterPerps: [],
      stocks: [
        { symbol: 'VOO', description: 'VANGUARD S&P 500 ETF', exchange: 'ARCA', currency: 'USD', qty: 420, gain: 64, category: 'ETF' },
        { symbol: 'VTI', description: 'VANGUARD TOTAL STOCK MKT ETF', exchange: 'ARCA', currency: 'USD', qty: 300, gain: 51, category: 'ETF' },
        { symbol: 'BND', description: 'VANGUARD TOTAL BOND MARKET', exchange: 'NASDAQ', currency: 'USD', qty: 900, gain: -4, category: 'ETF' },
        { symbol: 'SCHD', description: 'SCHWAB US DVD EQUITY ETF', exchange: 'ARCA', currency: 'USD', qty: 1100, gain: 22, category: 'ETF' },
        { symbol: 'KO', description: 'COCA-COLA CO/THE', exchange: 'NYSE', currency: 'USD', qty: 400, gain: 35 },
        { symbol: 'JNJ', description: 'JOHNSON & JOHNSON', exchange: 'NYSE', currency: 'USD', qty: 200, gain: 8 }
      ],
      options: [
        { underlying: 'KO', expiry: '2026-12-18', strike: 75, right: 'C', qty: -4, entry: 1.1 }
      ],
      ibkrCash: [
        { currency: 'USD', amount: 48000 }
      ],
      watchlist: '^GSPC, ^DJI, GC=F, TLT'
    }
  }
];
