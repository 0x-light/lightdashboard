// The Account window: what the portfolio sums up, by account. All ranks the accounts
// by value and lists what needs a look (high margin use, a perp near liquidation, old
// IBKR data); each account then has a tab of its own. Hyperliquid's tab fetches margin,
// funding, fees and staking when opened; the others read the rows already on screen.
import { getMargin, getFundingByDay, getFees, getStaking } from '../data/hl-account.js';

let win = null;
let backdrop = null;
let opener = null;

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function money(v, signed = false) {
  const abs = Math.abs(v);
  const text = '$' + new Intl.NumberFormat(undefined, {
    notation: abs >= 100000 ? 'compact' : 'standard',
    maximumFractionDigits: abs >= 100000 ? 2 : abs >= 100 ? 0 : 2
  }).format(abs).replace(/K$/, 'k'); // "$400k", as in the table
  return (v < 0 ? '−' : signed ? '+' : '') + text;
}

// Trailing zeros after the point go ("0.0196%", "30%"), never the ones before it.
function pct(v, digits = 2) {
  const fixed = (v * 100).toFixed(digits);
  return `${fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed}%`;
}

function amount(v) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: v >= 100 ? 0 : 2 }).format(v);
}

function addresses() {
  try {
    const s = JSON.parse(localStorage.getItem('myDashboardSettings.v2') || '{}');
    return String(s.walletAddresses || '').split(/[\s,]+/).filter(a => /^0x[0-9a-fA-F]{40}$/.test(a));
  } catch (_) {
    return [];
  }
}

// Next hourly funding payment, from the open HL perps on screen: received is +.
// Hyperliquid pays every hour on the hour; longs pay a positive rate.
function nextFunding() {
  const rows = (window.cachedPositions || []).filter(p => p.exchange === 'HL Perps' && Number.isFinite(p.fundingRate));
  if (!rows.length) return null;
  const usd = rows.reduce((sum, p) => sum - Number(p.amount) * Number(p.price) * Number(p.fundingRate), 0);
  const now = new Date();
  const minutes = 60 - now.getMinutes();
  return { usd, minutes };
}

const dayName = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

// A section: its name on the left of the head line and its key figure on the right,
// then label / value rows.
function section(title, figure, body) {
  return `<section class="acct__section"><h3 class="acct__head"><span>${title}</span>${figure ? `<span>${figure}</span>` : ''}</h3>${body}</section>`;
}

function rows(list) {
  const items = list.filter(Boolean);
  return items.length ? `<dl class="acct__rows">${items.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>` : '';
}

function marginSection(m) {
  if (!m) return '';
  const share = Math.min(1, Math.max(0, m.maintenanceShare));
  return section('Margin', `${pct(m.maintenanceShare, 1)} used`,
    `<div class="acct__meter" role="img" aria-label="Maintenance margin used: ${pct(m.maintenanceShare, 1)}. Liquidation at 100%.">` +
    `<span style="width:${(share * 100).toFixed(2)}%"></span></div>` +
    rows([['Withdrawable', money(m.withdrawable)], ['Leverage', `${m.leverage.toFixed(2)}×`]]));
}

function fundingSection(f) {
  const days = f.days;
  const known = days.filter(d => d.known);
  const total = known.reduce((s, d) => s + d.usdc, 0);
  const next = nextFunding();
  if (!known.some(d => d.usdc !== 0) && !next) return '';
  const max = Math.max(1e-9, ...known.map(d => Math.abs(d.usdc)));
  // Bars around a middle line: received above, paid below; days not loaded are blank.
  const bars = days.map(d => {
    const value = d.known ? money(d.usdc, true) : 'Not loaded';
    if (!d.known) return `<span class="acct__bar" data-label="${esc(dayName(d.day))} · ${value}"></span>`;
    const h = d.usdc === 0 ? 0 : Math.max(4, Math.round((Math.abs(d.usdc) / max) * 100));
    const cls = d.usdc >= 0 ? 'acct__bar--up' : 'acct__bar--down';
    return `<span class="acct__bar ${cls}" style="--h:${h}%" data-label="${esc(dayName(d.day))} · ${esc(value)}"></span>`;
  }).join('');
  // Under the bars: the span they cover, or the day being pointed at.
  const rest = known.length === days.length ? `Last ${days.length} days`
    : `Last ${known.length === 1 ? '24 hours' : `${known.length} days`}. Older days are not loaded.`;
  // All received (or all paid): the bars stand on one edge instead of a middle line.
  // Fewer than 3 days loaded: no bars, they would say nothing.
  const sides = (known.some(d => d.usdc > 0) ? 'up' : '') + (known.some(d => d.usdc < 0) ? 'down' : '');
  return section('Funding', money(total, true),
    (known.length < 3 ? '' : `<div class="acct__bars acct__bars--${sides || 'up'}" role="img" aria-label="Funding per day">${bars}</div>`) +
    `<p class="acct__readout" data-rest="${esc(rest)}">${esc(rest)}</p>` +
    rows([next && ['Next payment', `≈ ${money(next.usd, true)} in ${next.minutes} min`]]));
}

function feesSection(fe) {
  if (!fe || !(fe.volume14d > 0)) return '';
  return section('Fees', '', rows([
    fe.taker !== null && ['Taker', pct(fe.taker, 4)],
    fe.maker !== null && ['Maker', `${fe.maker < 0 ? '−' : ''}${pct(Math.abs(fe.maker), 4)}`],
    fe.stakingDiscount && ['Staking discount', pct(fe.stakingDiscount, 0)],
    fe.referralDiscount && ['Referral discount', pct(fe.referralDiscount, 0)],
    ['Volume, 14 days', money(fe.volume14d)]
  ]));
}

function stakingSection(st) {
  if (!st) return '';
  return section('Staking', `${amount(st.staked)} HYPE`, rows([
    st.unstaked > 0 && ['Not staked', `${amount(st.unstaked)} HYPE`],
    st.withdrawing > 0 && ['Withdrawing', `${amount(st.withdrawing)} HYPE`],
    ['Rewards, 30 days', `${amount(st.rewards30d)} HYPE`],
    ['Rewards, all time', `${amount(st.rewardsAllTime)} HYPE`]
  ]));
}

const failed = (title) => section(title, '', '<p class="acct__muted">Cannot load. Try again later.</p>');

// One wallet's sections, each passed to `put(index, html)` as soon as its data arrives.
function loadWallet(address, put) {
  return Promise.all([
    getMargin(address).then(marginSection, () => failed('Margin')).then(h => put(0, h)),
    getFundingByDay(address, 30).then(fundingSection, () => failed('Funding')).then(h => put(1, h)),
    getFees(address).then(feesSection, () => failed('Fees')).then(h => put(2, h)),
    getStaking(address).then(stakingSection, () => failed('Staking')).then(h => put(3, h))
  ]);
}

// ── Accounts, from the rows before they are merged by asset ──
const ACCOUNTS = [
  { id: 'hl', name: 'Hyperliquid', has: p => /^HL /.test(p.exchange || '') },
  { id: 'lighter', name: 'Lighter', has: p => p.exchange === 'Lighter' || p.exchange === 'Lighter Spot' },
  { id: 'ibkr', name: 'IBKR', has: p => p.exchange === 'IBKR' },
  { id: 'manual', name: 'Manual', has: p => /^Manual/.test(p.exchange || '') },
  { id: 'wallets', name: 'Wallets', has: () => true }
];

const isEquity = p => p.isHlAccountEquity || p.isLighterAccountEquity;
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

// The same rule as the portfolio total: a venue's equity row stands for its perps and
// its spot balances there, so those rows don't count twice.
function accountValue(rows) {
  const hasEquity = rows.some(isEquity);
  return rows.reduce((sum, p) => {
    if (isEquity(p)) return sum + num(p.value);
    if (hasEquity && ['HL Perps', 'HL Spot', 'Lighter'].includes(p.exchange)) return sum;
    return num(p.value) > 0 ? sum + num(p.value) : sum;
  }, 0);
}

function accounts() {
  const seen = new Set();
  const groups = ACCOUNTS.map(a => ({ ...a, rows: [] }));
  for (const p of window.venuePositions || []) {
    const key = p._changeDetectionKey || `${p.asset}_${p.exchange}`;
    if (seen.has(key)) continue;
    seen.add(key);
    groups.find(g => g.has(p)).rows.push(p);
  }
  return groups.filter(g => g.rows.length)
    .map(g => ({ ...g, value: accountValue(g.rows) }))
    .sort((a, b) => b.value - a.value);
}

const baseCurrency = () => (window.venuePositions || []).find(p => p.baseCurrency)?.baseCurrency || 'USD';
const amountsHidden = () => document.body.classList.contains('amounts-hidden');

// Values in the portfolio currency; hidden amounts show as dots.
function value(v, signed = false) {
  if (amountsHidden()) return '•••';
  const abs = Math.abs(v);
  const text = new Intl.NumberFormat(undefined, {
    style: 'currency', currency: baseCurrency(),
    notation: abs >= 100000 ? 'compact' : 'standard',
    maximumFractionDigits: abs >= 100000 ? 2 : abs >= 100 ? 0 : 2
  }).format(abs).replace(/K$/, 'k'); // "$400k", as in the table
  return (v < 0 ? '−' : signed ? '+' : '') + text;
}

const perps = rows => rows.filter(p => p.isLeveraged && !isEquity(p));
const fundingOf = rows => perps(rows).filter(p => p.funding != null).reduce((s, p) => s + num(p.funding), 0);
const dateOf = t => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// ── All ──
function allHtml(list) {
  const top = Math.max(1e-9, ...list.map(a => a.value));
  const total = list.reduce((s, a) => s + a.value, 0);
  const bars = list.map(a => `<button type="button" class="acct__venue" data-tab="${a.id}">` +
    `<span class="acct__venue-name">${esc(a.name)}</span>` +
    `<span class="acct__venue-bar" aria-hidden="true"><span style="width:${((a.value / top) * 100).toFixed(2)}%"></span></span>` +
    `<span>${amountsHidden() ? `${Math.round((a.value / (total || 1)) * 100)}%` : value(a.value)}</span></button>`).join('');
  const allRows = list.flatMap(a => a.rows);
  const funding = perps(allRows).some(p => p.funding != null)
    ? rows([['Funding on open positions', value(fundingOf(allRows), true)]]) : '';
  return `<div class="acct__venues">${bars}</div>${funding}<div class="acct__look"></div>`;
}

// What deserves attention: margin use from half, perps within 15% of liquidation, and
// IBKR holdings older than a day and a half. Hyperliquid margin is fetched, so it lands later.
function lookItems(list) {
  const items = [];
  const rowsOf = id => list.find(a => a.id === id)?.rows || [];
  for (const p of rowsOf('lighter').filter(p => p.isLighterAccountEquity && p.maintenanceShare >= 0.5)) {
    items.push(['Lighter margin used', pct(p.maintenanceShare, 0)]);
  }
  const near = list.flatMap(a => perps(a.rows))
    .filter(p => num(p.liquidationPx) > 0 && num(p.price) > 0)
    .map(p => ({ p, d: Math.abs(num(p.price) - num(p.liquidationPx)) / num(p.price) }))
    .filter(x => x.d < 0.15)
    .sort((a, b) => a.d - b.d)
    .slice(0, 3);
  for (const { p, d } of near) items.push([`${esc(p.asset)} to liquidation`, pct(d, 1)]);
  const asOf = Math.min(...rowsOf('ibkr').map(p => num(p.asOf) || Infinity));
  if (Number.isFinite(asOf) && Date.now() - asOf > 36 * 3600 * 1000) items.push(['IBKR holdings as of', dateOf(asOf)]);
  return items;
}

function showLook(box, items) {
  if (!box) return;
  box.innerHTML = items.length ? section('Needs a look', '', rows(items)) : '';
}

// ── One account ──
function lighterHtml(a) {
  const accountsHere = a.rows.filter(p => p.isLighterAccountEquity);
  const open = perps(a.rows);
  const notional = open.reduce((s, p) => s + Math.abs(num(p.value)), 0);
  const equity = accountsHere.reduce((s, p) => s + num(p.value), 0);
  const margin = accountsHere.map(p => {
    const share = Number.isFinite(p.maintenanceShare) ? p.maintenanceShare : null;
    const meter = share === null ? '' :
      `<div class="acct__meter" role="img" aria-label="Maintenance margin used: ${pct(share, 1)}. Liquidation at 100%.">` +
      `<span style="width:${(Math.min(1, share) * 100).toFixed(2)}%"></span></div>`;
    return section('Margin', share === null ? '' : `${pct(share, 1)} used`, meter + rows([
      p.available != null && ['Available', value(num(p.available) * (num(p.fxRate) || 1))],
      equity > 0 && open.length && ['Leverage', `${(notional / equity).toFixed(2)}×`]
    ]));
  }).join('');
  const byFunding = open.filter(p => p.funding != null).sort((x, y) => Math.abs(num(y.funding)) - Math.abs(num(x.funding)));
  const funding = byFunding.length ? section('Funding on open positions', value(fundingOf(a.rows), true),
    rows(byFunding.slice(0, 6).map(p => [esc(p.asset), value(num(p.funding), true)]))) : '';
  const spot = a.rows.filter(p => p.exchange === 'Lighter Spot' && num(p.value) > 0);
  const spotHtml = spot.length ? section('Spot', '', rows(spot.map(p => [esc(p.asset), value(num(p.value))]))) : '';
  return margin + funding + spotHtml;
}

function ibkrHtml(a) {
  const cash = a.rows.filter(p => p.category === 'cash');
  const held = a.rows.filter(p => p.category !== 'cash');
  const asOf = Math.min(...a.rows.map(p => num(p.asOf) || Infinity));
  const largest = held.filter(p => num(p.value) > 0).sort((x, y) => num(y.value) - num(x.value)).slice(0, 6);
  return section('Holdings', value(a.value), rows([
    ['Positions', value(held.reduce((s, p) => s + num(p.value), 0))],
    cash.length && ['Cash', value(cash.reduce((s, p) => s + num(p.value), 0))],
    Number.isFinite(asOf) && ['As of', dateOf(asOf)]
  ])) + (largest.length ? section('Largest', '', rows(largest.map(p => [esc(p.asset), value(num(p.value))]))) : '');
}

// Wallets by chain, manual entries by type: the biggest few, the rest as Other.
function byLabelHtml(a, title, labelOf) {
  const sums = new Map();
  for (const p of a.rows) if (num(p.value) > 0) sums.set(labelOf(p), (sums.get(labelOf(p)) || 0) + num(p.value));
  const sorted = [...sums].sort((x, y) => y[1] - x[1]);
  const head = sorted.length > 8 ? sorted.slice(0, 7) : sorted;
  const rest = sorted.slice(head.length).reduce((s, [, v]) => s + v, 0);
  if (rest > 0) head.push(['Other', rest]);
  return section(title, value(a.value), rows(head.map(([k, v]) => [esc(k), value(v)])));
}

// Hyperliquid, per wallet, filled in section by section as requests return. Wallets with
// nothing on Hyperliquid are left out; with more than one left, each gets a frame with
// its address on the border.
async function fillHl(content, draw) {
  const list = addresses();
  if (!list.length) {
    content.innerHTML = '<p class="acct__muted">Add an EVM wallet in Settings to see your Hyperliquid account.</p>';
    return;
  }
  const parts = list.map(() => ['', '', '', '']);
  let pending = list.length * 4;
  const render = () => {
    if (draw !== drawn) return;
    const shown = list.map((a, i) => [a, parts[i].join('')]).filter(([, html]) => html);
    if (!shown.length) {
      content.innerHTML = pending ? '<p class="acct__muted">Loading…</p>' : '<p class="acct__muted">Your wallets have no Hyperliquid account.</p>';
      return;
    }
    content.innerHTML = (shown.length === 1 && list.length === 1 ? shown[0][1] : shown.map(([a, html]) =>
      `<div class="acct__wallet"><p class="acct__address">${esc(a.slice(0, 6))}…${esc(a.slice(-4))}</p>${html}</div>`).join('')) +
      (pending ? '<p class="acct__muted">Loading…</p>' : '');
  };
  render();
  await Promise.all(list.map((address, i) => loadWallet(address, (k, html) => {
    parts[i][k] = html;
    pending--;
    render();
  })));
}

let tab = 'all';
let drawn = 0; // a newer draw makes an older, slower one drop its result

async function fill(win) {
  const list = accounts();
  const tabs = win.querySelector('.acct__tabs');
  const content = win.querySelector('.acct');
  const draw = ++drawn;
  if (!list.length) {
    tabs.hidden = true;
    content.innerHTML = '<p class="acct__muted">Loading…</p>';
    return;
  }
  // One account: no tabs, its own view straight away.
  if (list.length === 1) tab = list[0].id;
  else if (tab !== 'all' && !list.some(a => a.id === tab)) tab = 'all';
  tabs.hidden = list.length < 2;
  tabs.innerHTML = [{ id: 'all', name: 'All' }, ...list].map(a =>
    `<button type="button" class="acct__tab" role="tab" data-tab="${a.id}" aria-selected="${a.id === tab}">${esc(a.name)}</button>`).join('');

  const account = list.find(a => a.id === tab);
  if (tab === 'all') {
    content.innerHTML = allHtml(list);
    const items = lookItems(list);
    showLook(content.querySelector('.acct__look'), items);
    if (list.some(a => a.id === 'hl')) {
      const margins = await Promise.all(addresses().map(a => getMargin(a).catch(() => null)));
      if (draw !== drawn) return;
      const high = margins.filter(m => m && m.maintenanceShare >= 0.5).map(m => ['Hyperliquid margin used', pct(m.maintenanceShare, 0)]);
      if (high.length) showLook(content.querySelector('.acct__look'), [...high, ...items]);
    }
    return;
  }
  if (tab === 'hl') {
    await fillHl(content, draw);
    return;
  }
  content.innerHTML = tab === 'lighter' ? lighterHtml(account)
    : tab === 'ibkr' ? ibkrHtml(account)
    : tab === 'manual' ? byLabelHtml(account, 'By type', p => String(p.exchange).replace(/^Manual \((.*)\)$/, '$1'))
    : byLabelHtml(account, 'By chain', p => p.exchange || 'Other');
}

function selectTab(id) {
  tab = id;
  try { localStorage.setItem('pmAccountTab', id); } catch (_) {}
  fill(win);
}

// Pointing at a funding bar names its day and amount under the bars; leaving shows
// yesterday again.
function showDay(e) {
  const bar = e.target.closest?.('.acct__bar');
  const readout = e.target.closest?.('.acct__section')?.querySelector('.acct__readout');
  if (!readout) return;
  readout.textContent = bar ? bar.dataset.label : readout.dataset.rest;
}

function close() {
  if (!win || win.style.display === 'none') return;
  win.style.display = 'none';
  backdrop.style.display = 'none';
  document.body.classList.remove('modal-open');
  opener?.focus?.({ preventScroll: true });
}

export function openAccountWindow() {
  if (!win) {
    backdrop = el('<div class="settings-backdrop" style="display: none;"></div>');
    win = el(
      '<div class="sticker-window pm-account-window" role="dialog" aria-modal="true" aria-labelledby="pmAccountTitle" style="display: none;">' +
      '<div class="sticker-window-header"><h2 id="pmAccountTitle" class="window-title">Account</h2>' +
      '<button type="button" class="btn-text js-acct-close">Close</button></div>' +
      '<div class="acct__tabs" role="tablist" aria-label="Accounts"></div>' +
      '<div class="sticker-window-content acct"></div></div>');
    document.body.append(backdrop, win);
    backdrop.addEventListener('click', close);
    win.querySelector('.acct__tabs').addEventListener('click', (e) => {
      const b = e.target.closest('.acct__tab');
      if (b) selectTab(b.dataset.tab);
    });
    const content = win.querySelector('.acct');
    content.addEventListener('click', (e) => {
      const b = e.target.closest('.acct__venue');
      if (b) selectTab(b.dataset.tab);
    });
    content.addEventListener('mouseover', showDay);
    content.addEventListener('mouseleave', () => content.querySelectorAll('.acct__readout').forEach(r => { r.textContent = r.dataset.rest; }));
    win.querySelector('.js-acct-close').addEventListener('click', close);
    win.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    });
  }
  opener = document.activeElement;
  backdrop.style.display = 'block';
  win.style.display = 'flex';
  document.body.classList.add('modal-open');
  win.querySelector('.js-acct-close').focus({ preventScroll: true });
  try { tab = localStorage.getItem('pmAccountTab') || 'all'; } catch (_) {}
  fill(win);
}

export default { openAccountWindow };
