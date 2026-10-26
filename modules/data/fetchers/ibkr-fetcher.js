import { getFxCurrency, getQuoteUnitScale } from '../../utils/currency.js';
import { occSymbol, parseOptionSymbol } from '../../domain/instruments.js';

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

// Where a currency's listings usually trade, for a holding whose listing exchange is missing
// from the statement or from YAHOO_SUFFIX. A candidate counts only when its quote is in the
// holding's own currency (livePriceFor).
const SUFFIXES_BY_CURRENCY = {
  EUR: ['.DE', '.AS', '.PA', '.MI', '.MC', '.BR', '.LS', '.VI', '.HE', '.F'],
  GBP: ['.L'], CHF: ['.SW'], CAD: ['.TO', '.V'], AUD: ['.AX'], HKD: ['.HK'], JPY: ['.T'],
  SGD: ['.SI'], INR: ['.NS'], SEK: ['.ST'], DKK: ['.CO'], NOK: ['.OL'], PLN: ['.WA']
};

// Yahoo tickers to try for a holding, best first: its listing exchange, then its currency's.
export function yahooSymbolsFor(pos) {
  if (!QUOTABLE.has(pos.assetCategory)) return [];
  const exchange = pos.listingExchange;
  const symbol = pos.symbol.trim().replace(/\s+/g, '-'); // "BRK B" -> "BRK-B"
  if (!/^[A-Za-z0-9.\-]{1,12}$/.test(symbol)) return [];
  if (pos.currency === 'USD') return !exchange || US_EXCHANGES.has(exchange) ? [symbol.toUpperCase()] : [];
  const suffixes = [YAHOO_SUFFIX[exchange], ...(SUFFIXES_BY_CURRENCY[pos.currency] || [])].filter(Boolean);
  // Hong Kong tickers are numeric and Yahoo pads them to four digits: "700" -> "0700.HK".
  return [...new Set(suffixes)].map(suffix => {
    const base = suffix === '.HK' && /^\d+$/.test(symbol) ? symbol.padStart(4, '0') : symbol.toUpperCase();
    return `${base}${suffix}`;
  });
}

// A Yahoo price in the position's own currency, or null when the two can't be matched
// (LSE quotes in pence while IBKR reports pounds; a cross-listing could be another currency).
function livePriceFor(pos, quote) {
  if (!(Number(quote?.price) > 0) || !quote.currency) return null;
  if (getFxCurrency(quote.currency) !== pos.currency) return null;
  return quote.price * getQuoteUnitScale(quote.currency);
}

// The contract an option row is on, read from its OCC symbol or IBKR's description.
function optionOf(pos) {
  if (!['OPT', 'FOP'].includes(pos.assetCategory)) return null;
  return parseOptionSymbol(pos.symbol) || parseOptionSymbol(pos.description);
}

// Yahoo quotes US options under their OCC symbol, so a contract can carry its own live
// price and chart instead of the statement's mark.
function optionSymbolFor(pos) {
  const option = optionOf(pos);
  if (!option || pos.currency !== 'USD') return null;
  const symbol = occSymbol(option);
  return symbol && /^[A-Z0-9.]{1,6}\d{6}[CP]\d{8}$/.test(symbol) ? symbol : null;
}

// The Yahoo ticker of an option's underlying, when it is a US stock quoted in dollars.
function underlyingSymbolFor(pos) {
  const option = optionOf(pos);
  if (!option || pos.currency !== 'USD') return null;
  return /^[A-Z0-9.\-]{1,12}$/.test(option.underlying) ? option.underlying : null;
}

// Shares per contract. A Flex query without the multiplier field reports 1, which would
// make a contract's cost, breakeven and payoff a hundred times out; the statement's own
// position value gives it away, and a US equity option is 100 shares otherwise.
function multiplierOf(pos) {
  if (Number(pos.multiplier) > 1) return pos.multiplier;
  if (!['OPT', 'FOP'].includes(pos.assetCategory)) return Number(pos.multiplier) || 1;
  const implied = pos.positionValue / (pos.markPrice * pos.position);
  return Number.isFinite(implied) && implied > 1.5 ? Math.round(implied) : 100;
}

function buildPositionRow(pos, quote, underlyingQuote) {
  const multiplier = multiplierOf(pos);
  const live = livePriceFor(pos, quote);
  const price = live ?? pos.markPrice;
  const value = live !== null
    ? live * pos.position * multiplier
    : (pos.positionValue ?? pos.markPrice * pos.position * multiplier);
  const pnl = Number.isFinite(pos.costBasisMoney)
    ? value - pos.costBasisMoney
    : pos.unrealizedPnl;
  // Per-unit cost, in the same unit as price. Derived from the total so the option multiplier
  // can't be applied twice.
  const units = pos.position * multiplier;
  const entryPrice = Number.isFinite(pos.costBasisMoney) && units !== 0
    ? Math.abs(pos.costBasisMoney / units)
    : (Number(pos.costBasisPrice) > 0 ? pos.costBasisPrice : undefined);

  // Option and future symbols are OCC-style codes ("SPY   261218P00550000"); the description
  // ("SPY 18DEC26 550 P") reads better.
  const isDerivative = ['OPT', 'FOP', 'FUT', 'WAR'].includes(pos.assetCategory);
  const asset = isDerivative && pos.description ? pos.description.replace(/\s+/g, ' ').trim() : pos.symbol;
  // Options carry their contract and, when Yahoo quotes the underlying, its price now.
  const option = optionOf(pos);
  const underlying = option ? livePriceFor(pos, underlyingQuote) : null;

  return {
    asset,
    exchange: 'IBKR',
    livePrice: live !== null,
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
    ...(option ? {
      option,
      multiplier,
      underlyingPrice: underlying,
      underlyingChange24h: underlying !== null && Number.isFinite(underlyingQuote?.change24h) ? underlyingQuote.change24h : null,
      underlyingPriceHistory: underlying !== null && Array.isArray(underlyingQuote?.priceHistory) && underlyingQuote.priceHistory.length > 1
        ? underlyingQuote.priceHistory
        : undefined
    } : {}),
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
            const { statement, savedAt, stale, error } = await this.providers.ibkr.getStatement(
                this.settings.ibkrFlexToken,
                this.settings.ibkrFlexQueryId
            );

            const positions = statement.accounts.flatMap(a => a.positions);
            const cash = statement.accounts.flatMap(a => a.cash);
            const cashRows = cash.map(buildCashRow);

            const symbols = new Map(); // position -> Yahoo symbols to try, best first
            const underlyings = new Map(); // option position -> Yahoo symbol of its underlying
            for (const pos of positions) {
                const option = optionSymbolFor(pos);
                const candidates = option ? [option] : yahooSymbolsFor(pos);
                if (candidates.length > 0) symbols.set(pos, candidates);
                const underlying = underlyingSymbolFor(pos);
                if (underlying) underlyings.set(pos, underlying);
            }

            let quotes = {};
            const wanted = [...new Set([...[...symbols.values()].flat(), ...underlyings.values()])];
            if (wanted.length > 0 && this.providers.stocks?.getQuotes) {
                try {
                    quotes = await this.providers.stocks.getQuotes(wanted, { timeoutMs: 5000 }) || {};
                } catch (e) {
                    console.warn('[IBKR] Live quotes failed; using statement prices:', e);
                }
            }

            // The first candidate with a price in the holding's own currency.
            const quoteFor = pos => (symbols.get(pos) || []).map(sym => quotes[sym]).find(q => livePriceFor(pos, q) !== null);
            const rows = positions.map(pos => buildPositionRow(pos, quoteFor(pos), quotes[underlyings.get(pos)]));
            // When IBKR made the statement (end of day). Every row carries it as holdingsAsOf.
            // Rows priced from the statement (no live quote) carry it as asOf, the age of
            // their numbers. Cash changes only with trades, so the latest statement's cash is
            // current; it is old only when the statement is a saved one after a failed refresh.
            const generatedAt = flexTime(statement.generatedAt) ?? savedAt;
            const all = [...rows, ...cashRows];
            for (const row of all) {
                if (generatedAt) {
                    row.holdingsAsOf = generatedAt;
                    const isCash = row.category === 'cash';
                    if ((!row.livePrice && !isCash) || (isCash && stale)) row.asOf = generatedAt;
                }
                delete row.livePrice;
            }
            this.renderer.appendPositions(all, 'IBKR');
            // The rows above come from a saved statement: say the refresh failed.
            if (stale) this.renderer.markProviderFailed('IBKR', error || new Error('IBKR refresh failed'));
        } catch (e) {
            this.renderer.markProviderFailed('IBKR', e);
        }
    }
}
