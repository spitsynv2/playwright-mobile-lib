/** Fold device names. Spaces, underscores, and hyphens match as one separator. */
function normalizeDeviceName(deviceName) {
  return String(deviceName || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Return a catalog value whose folded name matches deviceName. */
function findByNormalizedDeviceName(catalog, deviceName) {
  const requested = normalizeDeviceName(deviceName);
  if (!requested || !catalog) return undefined;
  if (Object.prototype.hasOwnProperty.call(catalog, deviceName)) return catalog[deviceName];
  for (const [name, value] of Object.entries(catalog)) {
    if (normalizeDeviceName(name) === requested) return value;
  }
  return undefined;
}

module.exports = {
  normalizeDeviceName,
  findByNormalizedDeviceName,
};
