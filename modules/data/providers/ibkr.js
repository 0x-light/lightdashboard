// Interactive Brokers provider, through the Flex Web Service.
// The user makes an Activity Flex Query (Open Positions, optionally Cash Report) in IBKR's
// portal and turns on Flex Web Service, which gives a read-only token. /api/ibkr runs the
// two-step Flex request and returns the statement XML, parsed here.
//
// Flex statements are built from IBKR's end-of-day data and are rate limited (10 per minute),
// so a statement is kept for STATEMENT_TTL_MS; live prices come from Yahoo in the fetcher.

const CACHE_KEY = 'ibkrStatement.v1';
const STATEMENT_TTL_MS = 60 * 60 * 1000;
// After a failed request, wait this long before asking IBKR again (refreshes run every 30s).
const RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000;

let memory = null; // { fingerprint, savedAt, statement }
let inFlight = null; // { fingerprint, promise }
let lastFailure = null; // { fingerprint, at, error }

function fingerprintOf(token, queryId) {
  const text = `${token}:${queryId}`;
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return String(hash >>> 0);
}

function num(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function attrs(el) {
  const out = {};
  for (const a of Array.from(el.attributes || [])) out[a.name] = a.value;
  return out;
}

// Flex XML -> { generatedAt, accounts: [{ accountId, positions, cash }] }.
// Rows with levelOfDetail="LOT" repeat the summary row lot by lot, so only summaries are kept.
export function parseStatement(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('IBKR sent XML that does not parse');

  const accounts = [];
  for (const st of Array.from(doc.getElementsByTagName('FlexStatement'))) {
    const accountId = st.getAttribute('accountId') || '';

    const positions = Array.from(st.getElementsByTagName('OpenPosition'))
      .map(attrs)
      .filter(p => !p.levelOfDetail || p.levelOfDetail.toUpperCase() === 'SUMMARY')
      .map(p => ({
        accountId: p.accountId || accountId,
        conid: p.conid || '',
        symbol: p.symbol || '',
        description: p.description || '',
        assetCategory: (p.assetCategory || '').toUpperCase(),
        listingExchange: (p.listingExchange || '').toUpperCase(),
        currency: p.currency || 'USD',
        position: num(p.position) ?? 0,
        multiplier: num(p.multiplier) || 1,
        markPrice: num(p.markPrice) ?? 0,
        positionValue: num(p.positionValue),
        costBasisPrice: num(p.costBasisPrice),
        costBasisMoney: num(p.costBasisMoney),
        unrealizedPnl: num(p.fifoPnlUnrealized),
        reportDate: p.reportDate || ''
      }))
      .filter(p => p.symbol && p.position !== 0);

    const cash = Array.from(st.getElementsByTagName('CashReportCurrency'))
      .map(attrs)
      .filter(c => c.currency && c.currency !== 'BASE_SUMMARY')
      .filter(c => !c.levelOfDetail || c.levelOfDetail.toUpperCase() === 'CURRENCY')
      .map(c => ({
        accountId: c.accountId || accountId,
        currency: c.currency,
        amount: num(c.endingCash) ?? 0
      }))
      .filter(c => c.amount !== 0);

    // Daily net asset value, when the query includes "Change in NAV" (Equity Summary in Base).
    // Dates come as YYYYMMDD or YYYY-MM-DD.
    const nav = Array.from(st.getElementsByTagName('EquitySummaryByReportDateInBase'))
      .map(attrs)
      .filter(r => r.reportDate && num(r.total) !== null)
      .map(r => ({ date: r.reportDate.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3'), total: num(r.total), currency: r.currency || '' }))
      .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date))
      .sort((a, b) => a.date.localeCompare(b.date));
    // The account's base currency: from Account Information, else from the NAV rows.
    const info = st.getElementsByTagName('AccountInformation')[0];
    const currency = info?.getAttribute('currency') || nav.find(r => r.currency)?.currency || '';

    accounts.push({ accountId, positions, cash, nav, currency });
  }

  if (accounts.length === 0) throw new Error('The Flex Query returned no statement');
  const generated = doc.querySelector('FlexStatement')?.getAttribute('whenGenerated') || '';
  return { generatedAt: generated, accounts };
}

function readCache(fingerprint) {
  if (memory?.fingerprint === fingerprint) return memory;
  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (saved?.fingerprint === fingerprint && saved.statement) {
      memory = saved;
      return saved;
    }
  } catch (_) { /* unavailable storage: fetch fresh */ }
  return null;
}

function writeCache(entry) {
  memory = entry;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(entry)); } catch (_) { /* best effort */ }
}

export function clearCache() {
  memory = null;
  lastFailure = null;
  try { localStorage.removeItem(CACHE_KEY); } catch (_) { /* ignore */ }
}

async function requestStatement(token, queryId, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('/api/ibkr', {
      headers: { 'x-ibkr-token': token, 'x-ibkr-query': queryId },
      cache: 'no-store',
      signal: controller.signal
    });
    const body = await res.text();
    if (!res.ok) {
      let message = `IBKR request failed (${res.status})`;
      try { message = JSON.parse(body).error || message; } catch (_) { /* plain text */ }
      throw new Error(message);
    }
    return parseStatement(body);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Returns { statement, savedAt, stale }. A cached statement younger than the TTL is returned
 * without a request. When a refresh fails, an older cached statement is returned with
 * stale: true instead of the error, so a flaky IBKR keeps the last known positions on screen.
 */
export async function getStatement(token, queryId, { timeoutMs = 30000, force = false } = {}) {
  token = String(token || '').trim();
  queryId = String(queryId || '').trim();
  if (!token || !queryId) throw new Error('IBKR token and query ID are required');

  const fingerprint = fingerprintOf(token, queryId);
  const cached = readCache(fingerprint);
  if (!force && cached && Date.now() - cached.savedAt < STATEMENT_TTL_MS) {
    return { statement: cached.statement, savedAt: cached.savedAt, stale: false };
  }

  const recentFailure = !force && lastFailure?.fingerprint === fingerprint
    && Date.now() - lastFailure.at < RETRY_AFTER_FAILURE_MS;
  if (recentFailure) {
    if (cached) return { statement: cached.statement, savedAt: cached.savedAt, stale: true };
    throw lastFailure.error;
  }

  if (inFlight?.fingerprint !== fingerprint) {
    const promise = requestStatement(token, queryId, timeoutMs)
      .then(statement => {
        const entry = { fingerprint, savedAt: Date.now(), statement };
        writeCache(entry);
        lastFailure = null;
        return entry;
      }, error => {
        lastFailure = { fingerprint, at: Date.now(), error };
        throw error;
      })
      .finally(() => { if (inFlight?.promise === promise) inFlight = null; });
    inFlight = { fingerprint, promise };
  }

  try {
    const entry = await inFlight.promise;
    return { statement: entry.statement, savedAt: entry.savedAt, stale: false };
  } catch (e) {
    if (cached) return { statement: cached.statement, savedAt: cached.savedAt, stale: true };
    throw e;
  }
}

export default { getStatement, parseStatement, clearCache };
