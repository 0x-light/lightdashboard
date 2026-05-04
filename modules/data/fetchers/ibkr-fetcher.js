function finiteNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function cleanText(value) {
  return String(value ?? '').trim();
}

function parseAccountFilter(value) {
  return new Set(String(value || '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean));
}

function resolveAccountId(account) {
  return cleanText(account?.accountId || account?.id || account?.acctId);
}

function resolveAsset(row) {
  return cleanText(
    row?.ticker ||
    row?.symbol ||
    row?.contractDesc ||
    row?.description ||
    row?.localSymbol ||
    row?.conid
  );
}

function resolveExchange(row) {
  const secType = cleanText(row?.secType || row?.assetClass);
  return secType ? `IBKR ${secType}` : 'IBKR';
}

function rowToPosition(row, accountId) {
  const asset = resolveAsset(row);
  if (!asset) return null;

  const amount = finiteNumber(row.position, row.quantity, row.qty);
  if (!Number.isFinite(amount) || amount === 0) return null;

  const price = finiteNumber(row.marketPrice, row.mktPrice, row.last, row.price);
  const marketValue = finiteNumber(row.marketValue, row.mktValue);
  const value = Number.isFinite(marketValue)
    ? marketValue
    : (Number.isFinite(price) ? amount * price : 0);
  const avgPrice = finiteNumber(row.avgPrice);
  const avgCost = finiteNumber(row.avgCost);
  const entryPrice = Number.isFinite(avgPrice)
    ? avgPrice
    : (Number.isFinite(avgCost) && amount !== 0 ? Math.abs(avgCost / amount) : null);
  const pnl = finiteNumber(row.unrealizedPnl, row.unrealizedPNL, row.pnl);
  const exchange = resolveExchange(row);
  const conid = cleanText(row.conid);

  return {
    asset,
    exchange,
    amount,
    price: Number.isFinite(price) ? price : 0,
    value: Number.isFinite(value) ? value : 0,
    currency: cleanText(row.currency) || 'USD',
    change24h: null,
    pnl: Number.isFinite(pnl) ? pnl : null,
    entryPrice: Number.isFinite(entryPrice) ? entryPrice : undefined,
    assetName: cleanText(row.description || row.contractDesc || row.name || asset),
    category: cleanText(row.assetClass || row.secType) || undefined,
    ibkrAccountId: accountId,
    ibkrConid: conid || undefined,
    _changeDetectionKey: `IBKR_${accountId}_${conid || asset}_${exchange}`
  };
}

export class IbkrFetcher {
  constructor(providers, renderer, settings) {
    this.providers = providers;
    this.renderer = renderer;
    this.settings = settings;
  }

  async fetch() {
    try {
      const ibkr = this.providers?.ibkr;
      if (!ibkr?.getAccounts || !ibkr?.getPositions) return;

      const baseUrl = this.settings.ibkrGatewayUrl || ibkr.getDefaultGatewayUrl?.();
      const accountFilter = parseAccountFilter(this.settings.ibkrAccountIds);
      const accounts = await ibkr.getAccounts({ baseUrl, timeoutMs: 8000 });
      const selectedAccounts = accountFilter.size > 0
        ? accounts.filter(account => accountFilter.has(resolveAccountId(account)))
        : accounts;

      const rows = [];
      await Promise.all(selectedAccounts.map(async (account) => {
        const accountId = resolveAccountId(account);
        if (!accountId) return;
        const positions = await ibkr.getPositions(accountId, { baseUrl, timeoutMs: 8000 });
        for (const row of positions) {
          const position = rowToPosition(row, accountId);
          if (position) rows.push(position);
        }
      }));

      this.renderer.appendPositions(rows, 'IBKR', {
        removeFilter: (position) => typeof position.exchange === 'string' && position.exchange.startsWith('IBKR')
      });
    } catch (e) {
      this.renderer.markProviderFailed('IBKR', e);
    }
  }
}

export const _internal = {
  finiteNumber,
  parseAccountFilter,
  rowToPosition
};
