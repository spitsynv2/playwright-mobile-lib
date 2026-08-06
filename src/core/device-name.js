// Device-name folding shared by farm matching helpers and local presets.
// Spaces, underscores, and hyphens are the same separator; case is ignored.

function normalizeDeviceName(deviceName) {
  return String(deviceName || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

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
