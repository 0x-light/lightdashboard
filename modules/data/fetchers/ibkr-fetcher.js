import { getFxCurrency, getQuoteUnitScale } from '../../utils/currency.js';

// IBKR listing exchange -> Yahoo ticker suffix. US venues take no suffix. Anything missing here
// keeps IBKR's own mark price from the statement.
const US_EXCHANGES = new Set([
  'NASDAQ', 'NYSE', 'ARCA', 'AMEX', 'BATS', 'BYX', 'IEX', 'PINK', 'NYSENAT', 'ISLAND', 'BEX', 'PSX', 'CBOE', 'MEMX'
]);
const YAHOO_SUFFIX = {
  LSE: '.L', LSEETF: '.L', LSEIOB1: '.IL',
  IBIS: '.DE', IBIS2: '.DE', XETRA: '.DE', FWB: '.F', FWB2: '.F', GETTEX: '.MU', TGATE: '.DE',
  SBF: '.PA', AEB: '.AS', ENEXT_BE: '.BR', 'ENEXT.BE': '.BR', BVL: '.LS',
  EBS: '.SW', SWX: '.SW', VIRTX: '.SW',
  BVME: '.MI', 'BVME.ETF': '.MI', BM: '.MC',
  SFB: '.ST', CPH: '.CO', OSE: '.OL', HEX: '.HE', VSE: '.VI', WSE: '.WA',
  TSE: '.TO', VENTURE: '.V', ASX: '.AX', SEHK: '.HK', TSEJ: '.T', SGX: '.SI', NSE: '.NS'
};
// Asset categories whose price Yahoo carries under the plain ticker.
const QUOTABLE = new Set(['STK', 'ETF', 'FUND']);

const CATEGORY = {
  STK: 'equity', ETF: 'etf', FUND: 'fund', OPT: 'option', FOP: 'option', FUT: 'commodity',
  BOND: 'bond', CASH: 'fx', WAR: 'equity', CFD: 'equity', CRYPTO: 'crypto'
};

function yahooSymbolFor(pos) {
  if (!QUOTABLE.has(pos.assetCategory)) return null;
  const exchange = pos.listingExchange;
  const symbol = pos.symbol.trim().replace(/\s+/g, '-'); // "BRK B" -> "BRK-B"
  if (!/^[A-Za-z0-9.\-]{1,12}$/.test(symbol)) return null;
  if (!exchange || US_EXCHANGES.has(exchange)) return pos.currency === 'USD' ? symbol.toUpperCase() : null;
  const suffix = YAHOO_SUFFIX[exchange];
  if (!suffix) return null;
  // Hong Kong tickers are numeric and Yahoo pads them to four digits: "700" -> "0700.HK".
  const base = suffix === '.HK' && /^\d+$/.test(symbol) ? symbol.padStart(4, '0') : symbol.toUpperCase();
  return `${base}${suffix}`;
}

// A Yahoo price in the position's own currency, or null when the two can't be matched
// (LSE quotes in pence while IBKR reports pounds; a cross-listing could be another currency).
function livePriceFor(pos, quote) {
  if (!(Number(quote?.price) > 0) || !quote.currency) return null;
  if (getFxCurrency(quote.currency) !== pos.currency) return null;
  return quote.price * getQuoteUnitScale(quote.currency);
}

function buildPositionRow(pos, quote) {
  const live = livePriceFor(pos, quote);
  const price = live ?? pos.markPrice;
  const value = live !== null
    ? live * pos.position * pos.multiplier
    : (pos.positionValue ?? pos.markPrice * pos.position * pos.multiplier);
  const pnl = Number.isFinite(pos.costBasisMoney)
    ? value - pos.costBasisMoney
    : pos.unrealizedPnl;
  // Per-unit cost, in the same unit as price. Derived from the total so the option multiplier
  // can't be applied twice.
  const units = pos.position * pos.multiplier;
  const entryPrice = Number.isFinite(pos.costBasisMoney) && units !== 0
    ? Math.abs(pos.costBasisMoney / units)
    : (Number(pos.costBasisPrice) > 0 ? pos.costBasisPrice : undefined);

  // Option and future symbols are OCC-style codes ("SPY   261218P00550000"); the description
  // ("SPY 18DEC26 550 P") reads better.
  const isDerivative = ['OPT', 'FOP', 'FUT', 'WAR'].includes(pos.assetCategory);
  const asset = isDerivative && pos.description ? pos.description.replace(/\s+/g, ' ').trim() : pos.symbol;

  return {
    asset,
    exchange: 'IBKR',
    amount: pos.position,
    price,
    value,
    change24h: live !== null && Number.isFinite(quote?.change24h) ? quote.change24h : null,
    pnl: Number.isFinite(pnl) ? pnl : null,
    entryPrice,
    assetName: pos.description || pos.symbol,
    currency: pos.currency,
    priceHistory: live !== null && Array.isArray(quote?.priceHistory) && quote.priceHistory.length > 1
      ? quote.priceHistory
      : undefined,
    category: CATEGORY[pos.assetCategory] || 'other',
    ibkrAccount: pos.accountId,
    _changeDetectionKey: `IBKR_${pos.accountId}_${pos.conid || pos.symbol}`
  };
}

function buildCashRow(cash) {
  return {
    asset: cash.currency,
    exchange: 'IBKR',
    amount: cash.amount,
    price: 1,
    value: cash.amount,
    change24h: null,
    pnl: null,
    assetName: `${cash.currency} cash`,
    currency: cash.currency,
    category: 'cash',
    ibkrAccount: cash.accountId,
    _changeDetectionKey: `IBKR_${cash.accountId}_CASH_${cash.currency}`
  };
}

// Flex times read "20251020;101530" (or with dashes and colons); they are in the account's
// time zone, which the statement doesn't give, so local time is close enough for a date.
function flexTime(text) {
  const m = String(text || '').match(/(\d{4})-?(\d{2})-?(\d{2})(?:[;, T]+(\d{2}):?(\d{2}):?(\d{2}))?/);
  if (!m) return null;
  const t = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
  return Number.isFinite(t) ? t : null;
}

export class IbkrFetcher {
    constructor(providers, renderer, settings) {
        this.providers = providers;
        this.renderer = renderer;
        this.settings = settings;
    }

    async fetch() {
        try {
            const { statement, stale } = await this.providers.ibkr.getStatement(
                this.settings.ibkrFlexToken,
                this.settings.ibkrFlexQueryId
            );
            if (stale) console.warn('[IBKR] Refresh failed; showing the last statement');

            const positions = statement.accounts.flatMap(a => a.positions);
            const cash = statement.accounts.flatMap(a => a.cash);
            const cashRows = cash.map(buildCashRow);

            const symbols = new Map(); // position -> Yahoo symbol
            for (const pos of positions) {
                const yahoo = yahooSymbolFor(pos);
                if (yahoo) symbols.set(pos, yahoo);
            }

            let quotes = {};
            if (symbols.size > 0 && this.providers.stocks?.getQuotes) {
                try {
                    quotes = await this.providers.stocks.getQuotes([...symbols.values()], { timeoutMs: 5000 }) || {};
                } catch (e) {
                    console.warn('[IBKR] Live quotes failed; using statement prices:', e);
                }
            }

            const rows = positions.map(pos => buildPositionRow(pos, quotes[symbols.get(pos)]));
            // When IBKR made the statement, so the Account window can say how old the holdings are.
            const asOf = flexTime(statement.generatedAt);
            const all = [...rows, ...cashRows];
            if (asOf) all.forEach(row => { row.asOf = asOf; });
            this.renderer.appendPositions(all, 'IBKR');
        } catch (e) {
            this.renderer.markProviderFailed('IBKR', e);
        }
    }
}
