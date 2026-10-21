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

function marginBlock(m) {
  if (!m) return '<p class="acct__muted">No perp account.</p>';
  const share = Math.min(1, Math.max(0, m.maintenanceShare));
  return `<p>Using <strong>${pct(m.maintenanceShare, 1)}</strong> of maintenance margin · ${money(m.withdrawable)} withdrawable · ${m.leverage.toFixed(2)}× leverage</p>` +
    `<div class="acct__meter" role="img" aria-label="Maintenance margin used: ${pct(m.maintenanceShare, 1)}">` +
    `<span style="width:${(share * 100).toFixed(2)}%"></span></div>` +
    `<p class="acct__muted">Liquidation starts when maintenance margin reaches 100% of account value.</p>`;
}

function fundingBlock(f) {
  const days = f.days;
  const known = days.filter(d => d.known);
  const total = known.reduce((s, d) => s + d.usdc, 0);
  const yesterday = days.length > 1 && days[days.length - 2].known ? days[days.length - 2].usdc : null;
  const next = nextFunding();
  const max = Math.max(1, ...known.map(d => Math.abs(d.usdc)));
  // Bars around a middle line: received above, paid below; days not loaded are blank.
  const bars = days.map(d => {
    if (!d.known) return '<span class="acct__bar acct__bar--unknown" title="Not loaded"></span>';
    const h = Math.max(2, Math.round((Math.abs(d.usdc) / max) * 100));
    const cls = d.usdc >= 0 ? 'acct__bar--up' : 'acct__bar--down';
    return `<span class="acct__bar ${cls}" style="--h:${h}%" title="${esc(d.day)}: ${esc(money(d.usdc, true))}"></span>`;
  }).join('');
  const parts = [];
  if (yesterday !== null) parts.push(`${money(yesterday, true)} yesterday`);
  const span = known.length === days.length ? `${days.length} days` : known.length === 1 ? 'the last day' : `the last ${known.length} days`;
  parts.push(`${money(total, true)} over ${span}`);
  return `<p>${parts.join(' · ')}</p>` +
    `<div class="acct__bars" role="img" aria-label="Funding per day, received above the line, paid below">${bars}</div>` +
    (next ? `<p>Next payment ≈ <strong>${money(next.usd, true)}</strong> in ${next.minutes} min</p>` : '') +
    (f.complete ? '' : '<p class="acct__muted">Older days are left out: this account has too many payments to load them all.</p>');
}

function feesBlock(fe) {
  if (!fe) return '<p class="acct__muted">No fee data.</p>';
  const bits = [];
  if (fe.taker !== null) bits.push(`${pct(fe.taker, 4)} taker`);
  if (fe.maker !== null) bits.push(`${fe.maker < 0 ? '−' : ''}${pct(Math.abs(fe.maker), 4)} maker`);
  if (fe.stakingDiscount) bits.push(`${pct(fe.stakingDiscount, 0)} staking discount`);
  if (fe.referralDiscount) bits.push(`${pct(fe.referralDiscount, 0)} referral discount`);
  bits.push(`14-day volume ${money(fe.volume14d)}`);
  return `<p>${bits.join(' · ')}</p>`;
}

function stakingBlock(st) {
  if (!st) return '<p class="acct__muted">No staked HYPE.</p>';
  const bits = [`${amount(st.staked)} HYPE staked`];
  if (st.unstaked > 0) bits.push(`${amount(st.unstaked)} not staked`);
  if (st.withdrawing > 0) bits.push(`${amount(st.withdrawing)} withdrawing`);
  return `<p>${bits.join(' · ')}</p><p>Rewards: ${amount(st.rewards30d)} HYPE in 30 days · ${amount(st.rewardsAllTime)} HYPE in all</p>`;
}

function section(title, body) {
  return `<section class="acct__section"><h3 class="acct__title">${title}</h3>${body}</section>`;
}

async function fill(content) {
  const list = addresses();
  if (!list.length) {
    content.innerHTML = '<p class="acct__muted">Add an EVM wallet in Settings to see your Hyperliquid account.</p>';
    return;
  }
  content.innerHTML = list.map(a => `<div class="acct__wallet" data-address="${esc(a)}">` +
    (list.length > 1 ? `<h3 class="acct__address">${esc(a.slice(0, 6))}…${esc(a.slice(-4))}</h3>` : '') +
    ['Margin', 'Funding', 'Fees', 'Staking'].map(t => section(t, '<p class="acct__muted">Loading…</p>')).join('') +
    '</div>').join('');

  await Promise.all(list.map(async (address) => {
    const box = content.querySelector(`[data-address="${address}"]`);
    const put = (index, html) => {
      const s = box.querySelectorAll('.acct__section')[index];
      if (s) s.innerHTML = s.querySelector('.acct__title').outerHTML + html;
    };
    const failed = '<p class="acct__muted">Cannot load this now. Try again in a minute.</p>';
    await Promise.all([
      getMargin(address).then(m => put(0, marginBlock(m)), () => put(0, failed)),
      getFundingByDay(address, 30).then(f => put(1, fundingBlock(f)), () => put(1, failed)),
      getFees(address).then(fe => put(2, feesBlock(fe)), () => put(2, failed)),
      getStaking(address).then(st => put(3, stakingBlock(st)), () => put(3, failed))
    ]);
  }));
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
