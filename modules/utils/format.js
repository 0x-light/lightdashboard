// Shared formatting utilities

export const STABLECOINS = new Set(['USDC', 'USDT', 'DAI', 'USDE', 'FDUSD', 'TUSD', 'USDP', 'GUSD', 'BUSD', 'FEUSD']);

export function isStablecoin(asset) {
  return STABLECOINS.has(asset?.toUpperCase());
}

export function formatUsd(num, visible = true, showPlusSign = false) {
  if (!visible) return '$••••';
  const n = Number(num || 0);
  if (!Number.isFinite(n)) return '—';
  
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : (showPlusSign && n > 0 ? '+' : '');
  
  if (abs >= 1000000) {
    const formatted = (abs / 1000000).toFixed(1);
    return `${sign}$${formatted.replace(/\.0$/, '')}M`;
  } else if (abs >= 1000) {
    const formatted = (abs / 1000).toFixed(1);
    return `${sign}$${formatted.replace(/\.0$/, '')}k`;
  } else if (abs >= 1) {
    return `${sign}$${abs.toFixed(2).replace(/\.00$/, '')}`;
  } else if (abs === 0) {
    return '$0';
  } else {
    return `${sign}$${abs.toFixed(2)}`;
  }
}

export function formatAmount(num, visible = true, showExact = false) {
  if (!visible) return '••••';
  const n = Number(num || 0);
  if (!Number.isFinite(n)) return '—';
  
  if (showExact) {
    return n.toLocaleString(undefined, { maximumFractionDigits: 8 });
  }
  
  const abs = Math.abs(n);
  if (abs >= 1000000) {
    const formatted = (abs / 1000000).toFixed(2);
    return (n < 0 ? '−' : '') + formatted.replace(/\.?0+$/, '') + 'M';
  } else if (abs >= 1000) {
    const formatted = (abs / 1000).toFixed(2);
    return (n < 0 ? '−' : '') + formatted.replace(/\.?0+$/, '') + 'k';
  } else if (abs >= 1) {
    return (n < 0 ? '−' : '') + abs.toFixed(2).replace(/\.?0+$/, '');
  } else if (abs === 0) {
    return '0';
  } else {
    return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }
}

export function formatPct(num) {
  if (num === null || num === undefined || Number.isNaN(num)) return '—';
  const n = Number(num);
  if (!Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : (n < 0 ? '−' : '');
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}

export function formatCurrency(value, amountsVisible = true) {
  if (!amountsVisible) return '$••••';
  const abs = Math.abs(value);

  if (abs >= 1000000) {
    const formatted = (abs / 1000000).toFixed(1);
    return `$${formatted.replace(/\.0$/, '')}M`;
  } else if (abs >= 1000) {
    const formatted = (abs / 1000).toFixed(1);
    return `$${formatted.replace(/\.0$/, '')}k`;
  } else if (abs >= 1) {
    return `$${abs.toFixed(2).replace(/\.00$/, '')}`;
  } else if (abs === 0) {
    return '$0';
  } else {
    return `$${abs.toFixed(2)}`;
  }
}

export function get24hAgoTsSec() {
  return Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
}


