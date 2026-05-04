const STORED_MANUAL_TYPES = new Set(['custom', 'pyth', 'stock']);

export const MANUAL_EXCHANGE_LABELS = Object.freeze([
  'Manual',
  'Manual (Custom)',
  'Manual (Pyth)',
  'Manual (Stock)',
  'Manual (ETF)',
  'Manual (Fund)',
  'Manual (Index)',
  'Manual (FX)',
  'Manual (Metal)',
  'Manual (Commodity)'
]);

function cleanText(value) {
  return String(value ?? '').trim();
}

function cleanManualType(value) {
  const type = cleanText(value);
  return STORED_MANUAL_TYPES.has(type) ? type : null;
}

export function getManualPositionAsset(position) {
  return getManualPositionAssetAliases(position)[0] || '';
}

export function getManualPositionAssetAliases(position) {
  if (!position) return [];
  const candidates = [position.symbol, position.name];
  return Array.from(new Set(candidates.map(cleanText).filter(Boolean)));
}

export function getManualPositionHiddenKeys(asset) {
  const normalized = cleanText(asset);
  if (!normalized) return [];
  return MANUAL_EXCHANGE_LABELS.map(label => `${normalized}_${label}`);
}

export function manualTypeFromExchange(exchange) {
  const label = cleanText(exchange);
  if (!label.startsWith('Manual')) return null;
  if (label.includes('Custom')) return 'custom';
  if (label.includes('Pyth')) return 'pyth';
  if (label.includes('Stock') || label.includes('ETF') || label.includes('Fund') || label.includes('Index')) {
    return 'stock';
  }
  return null;
}

export function storedManualPositionMatches(position, asset, manualType) {
  const targetAsset = cleanText(asset);
  if (!targetAsset || !position || !STORED_MANUAL_TYPES.has(position.type)) return false;
  if (!getManualPositionAssetAliases(position).includes(targetAsset)) return false;

  const targetType = cleanManualType(manualType);
  return !targetType || position.type === targetType;
}

export function removeManualPositionByAsset(positions, asset, manualType) {
  if (!Array.isArray(positions)) return [];
  return positions.filter(position => !storedManualPositionMatches(position, asset, manualType));
}

export function renderedManualPositionMatches(position, asset, manualType) {
  const targetAsset = cleanText(asset);
  if (!targetAsset || !position) return false;

  const isManual = position.isManual ||
    (typeof position.exchange === 'string' && position.exchange.startsWith('Manual'));
  if (!isManual || cleanText(position.asset) !== targetAsset) return false;

  const targetType = cleanManualType(manualType);
  const positionType = cleanManualType(position.manualType) || manualTypeFromExchange(position.exchange);
  return !targetType || positionType === targetType;
}
