// The Account window: Hyperliquid account-wide details that don't belong on a row.
// Margin health, funding income (daily bars and the next payment), fee tier and
// staking rewards, one block per wallet. Loaded and fetched only when opened.
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
  }).format(abs);
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

async function walletHtml(address) {
  const [m, f, fe, st] = await Promise.allSettled([getMargin(address), getFundingByDay(address, 30), getFees(address), getStaking(address)]);
  return [
    m.status === 'fulfilled' ? marginSection(m.value) : failed('Margin'),
    f.status === 'fulfilled' ? fundingSection(f.value) : failed('Funding'),
    fe.status === 'fulfilled' ? feesSection(fe.value) : failed('Fees'),
    st.status === 'fulfilled' ? stakingSection(st.value) : failed('Staking')
  ].join('');
}

async function fill(content) {
  const list = addresses();
  if (!list.length) {
    content.innerHTML = '<p class="acct__muted">Add an EVM wallet in Settings to see your Hyperliquid account.</p>';
    return;
  }
  content.innerHTML = '<p class="acct__muted">Loading…</p>';
  const blocks = await Promise.all(list.map(walletHtml));
  // Wallets with nothing on Hyperliquid are left out. With more than one left, each
  // gets a frame with its address on the border.
  const shown = list.map((a, i) => [a, blocks[i]]).filter(([, html]) => html);
  if (!shown.length) {
    content.innerHTML = '<p class="acct__muted">Your wallets have no Hyperliquid account.</p>';
    return;
  }
  content.innerHTML = shown.length === 1 ? shown[0][1] : shown.map(([a, html]) =>
    `<div class="acct__wallet"><p class="acct__address">${esc(a.slice(0, 6))}…${esc(a.slice(-4))}</p>${html}</div>`).join('');
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
      '<div class="sticker-window-content acct"></div></div>');
    document.body.append(backdrop, win);
    backdrop.addEventListener('click', close);
    const content = win.querySelector('.acct');
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
  fill(win.querySelector('.acct'));
}

export default { openAccountWindow };
