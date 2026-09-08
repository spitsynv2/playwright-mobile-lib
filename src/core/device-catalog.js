/** Load a custom device catalog from a per-platform JSON file. */
const {
  normalizeDeviceName,
  findByNormalizedDeviceName,
} = require('./device-name');

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergePreset(basePreset, overridePreset = {}) {
  const preset = {
    ...cloneValue(basePreset),
    ...cloneValue(overridePreset),
  };

  if (basePreset.viewport || overridePreset.viewport) {
    preset.viewport = {
      ...(basePreset.viewport || {}),
      ...(overridePreset.viewport || {}),
    };
  }

  if (basePreset.screen || overridePreset.screen) {
    preset.screen = {
      ...(basePreset.screen || {}),
      ...(overridePreset.screen || {}),
    };
  }

  return preset;
}

/**
 * Build alias, version, and definition maps from a JSON devices config.
 * An entry can set extends, override, aliases, and an OS version key.
 */
function buildCatalog(config, versionKey) {
  const entries = (config && config.devices) || {};
  const aliases = {};
  const versions = {};
  const definitions = {};
  for (const [name, rawEntry] of Object.entries(entries)) {
    const entry = rawEntry || {};
    for (const alias of entry.aliases || []) {
      aliases[normalizeDeviceName(alias)] = name;
    }
    if (versionKey && entry[versionKey]) versions[name] = entry[versionKey];
    if (entry.extends || entry.override) {
      definitions[name] = { extends: entry.extends, override: entry.override };
    }
  }
  return { aliases, versions, definitions };
}

function buildCustomDevices(playwrightDevices, definitions) {
  const custom = {};
  for (const [deviceName, definition] of Object.entries(definitions)) {
    const basePreset = definition.extends ? playwrightDevices[definition.extends] : null;
    // Skip a named extends value that Playwright does not ship. Do not emit an empty preset.
    if (definition.extends && !basePreset) continue;
    custom[deviceName] = basePreset
      ? mergePreset(basePreset, definition.override)
      : cloneValue(definition.override || {});
  }
  return custom;
}

/** Overlay JSON device definitions on Playwright presets. */
function getDeviceCatalog(playwrightDevices, definitions) {
  return {
    ...playwrightDevices,
    ...buildCustomDevices(playwrightDevices, definitions),
  };
}

/** Return the device descriptor for deviceName. Use aliases and custom devices. */
function resolvePreset(deviceName, playwrightDevices, catalog) {
  const merged = getDeviceCatalog(playwrightDevices, catalog.definitions);
  const alias = catalog.aliases[normalizeDeviceName(deviceName)];
  if (alias && merged[alias]) return merged[alias];
  return findByNormalizedDeviceName(merged, deviceName) || null;
}

function resolveCanonicalName(deviceName, catalog) {
  const normalized = normalizeDeviceName(deviceName);
  if (!normalized) return '';
  if (catalog.aliases[normalized]) return catalog.aliases[normalized];
  const named = { ...catalog.definitions, ...catalog.versions };
  for (const name of Object.keys(named)) {
    if (normalizeDeviceName(name) === normalized) return name;
  }
  return String(deviceName || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Return the OS version for deviceName, or null. */
function resolveVersion(deviceName, catalog) {
  const key = resolveCanonicalName(deviceName, catalog);
  return catalog.versions[key]
    || findByNormalizedDeviceName(catalog.versions, deviceName)
    || null;
}

module.exports = {
  buildCatalog,
  getDeviceCatalog,
  resolvePreset,
  resolveVersion,
};
