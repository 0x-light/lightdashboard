// UI helper for composing the hero summary string

function formatCurrency(value, amountsVisible) {
  if (!amountsVisible) return '$••••';
  const abs = Math.abs(value);
  
  // Format large numbers compactly
  if (abs >= 1000000) {
    const formatted = (abs / 1000000).toFixed(1);
    return `$${formatted.replace(/\.0$/, '')}M`;
  } else if (abs >= 1000) {
    const formatted = (abs / 1000).toFixed(1);
    return `$${formatted.replace(/\.0$/, '')}k`;
  } else if (abs >= 1) {
    // Show cents, but remove unnecessary trailing zeros
    return `$${abs.toFixed(2).replace(/\.00$/, '')}`;
  } else if (abs === 0) {
    return '$0';
  } else {
    return `$${abs.toFixed(2)}`;
  }
}

function classForChange(value, useColored) {
  if (!useColored) return value >= 0 ? 'positive-neutral' : 'negative-neutral';
  return value >= 0 ? 'positive-pnl' : 'negative-pnl';
}

export function composeSummary({
  portfolioValue,
  amountsVisible,
  heroPnLMode, // 'total' | '24h'
  totalPnL,
  totalPnLPercent,
  totalDailyChange,
  totalDailyChangePercent,
  useColoredPnL,
  highlightsHtml, // array of already-escaped HTML strings
  weather // { temp, city, icon, moonText } | null
}) {
  const summaryParts = [];
  // Always show portfolio value (it's a price/total, not a position size)
  const valueText = formatCurrency(portfolioValue, true);

  if (heroPnLMode === 'total') {
    if (totalPnL !== 0 && Math.abs(totalPnL) > 0.01) {
      const cls = classForChange(totalPnL, useColoredPnL);
      const sign = totalPnLPercent >= 0 ? '+' : '';
      // Always show percentage, but hide dollar amount when amountsVisible is false
      if (amountsVisible) {
        summaryParts.push(`Your portfolio is worth ${valueText}, <strong class="${cls}">${totalPnL >= 0 ? 'up' : 'down'} ${formatCurrency(totalPnL, amountsVisible)} (${sign}${totalPnLPercent.toFixed(2)}%)</strong>`);
      } else {
        summaryParts.push(`Your portfolio is worth ${valueText}, <strong class="${cls}">${totalPnL >= 0 ? 'up' : 'down'} ${sign}${totalPnLPercent.toFixed(2)}%</strong>`);
      }
    } else {
      summaryParts.push(`Your portfolio is worth ${valueText}`);
    }
  } else {
    if (totalDailyChange !== 0 && Math.abs(totalDailyChange) > 0.01) {
      const cls = classForChange(totalDailyChange, useColoredPnL);
      const sign = totalDailyChangePercent >= 0 ? '+' : '-';
      // Always show percentage, but hide dollar amount when amountsVisible is false
      if (amountsVisible) {
        summaryParts.push(`Your portfolio is worth ${valueText}, <strong class="${cls}">${totalDailyChange >= 0 ? 'up' : 'down'} ${formatCurrency(totalDailyChange, amountsVisible)} (${sign}${Math.abs(totalDailyChangePercent).toFixed(2)}%)</strong> today`);
      } else {
        summaryParts.push(`Your portfolio is worth ${valueText}, <strong class="${cls}">${totalDailyChange >= 0 ? 'up' : 'down'} ${sign}${Math.abs(totalDailyChangePercent).toFixed(2)}%</strong> today`);
      }
    } else {
      summaryParts.push(`Your portfolio is worth ${valueText}`);
    }
  }

  if (Array.isArray(highlightsHtml) && highlightsHtml.length > 0) {
    // Optionally append highlights later if desired
  }

  if (weather) {
    const { temp, city, icon, moonText, precipitation } = weather;
    if (typeof temp === 'number' && city) {
      if (precipitation && precipitation > 0) {
        summaryParts.push(`It's ${Math.round(temp)}°C ${icon} in <strong>${city}</strong> with rain forecasted${moonText || ''}`);
      } else {
        summaryParts.push(`It's ${Math.round(temp)}°C ${icon} in <strong>${city}</strong>${moonText || ''}`);
      }
    }
  }

  return summaryParts.join('. ') + '.';
}

export default { composeSummary };


