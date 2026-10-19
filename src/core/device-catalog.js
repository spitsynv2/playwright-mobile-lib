/** Load a custom device catalog from a per-platform JSON file. */
const { normalizeDeviceName } = require('./device-name');

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
 * Build alias and definition maps from a JSON devices config.
 * An entry can set extends, override, and aliases.
 */
function buildCatalog(config) {
  const entries = (config && config.devices) || {};
  const aliases = {};
  const definitions = {};
  for (const [name, rawEntry] of Object.entries(entries)) {
    const entry = rawEntry || {};
    for (const alias of entry.aliases || []) {
      aliases[normalizeDeviceName(alias)] = name;
    }
    if (entry.extends || entry.override) {
      definitions[name] = { extends: entry.extends, override: entry.override };
    }
  }
  return { aliases, definitions };
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

function findPresetName(merged, catalog, deviceName) {
  const alias = catalog.aliases[normalizeDeviceName(deviceName)];
  if (alias && merged[alias]) return alias;
  const requested = normalizeDeviceName(deviceName);
  if (!requested) return null;
  if (Object.prototype.hasOwnProperty.call(merged, deviceName)) return deviceName;
  return Object.keys(merged).find((name) => normalizeDeviceName(name) === requested) || null;
}

// Real iOS Safari keeps portrait `screen` values in landscape. Android Chrome swaps them.
function swapToLandscape(preset, swapScreen) {
  const landscape = cloneValue(preset);
  const flip = (size) => (size && size.height > size.width ? { ...size, width: size.height, height: size.width } : size);
  if (landscape.viewport) landscape.viewport = flip(landscape.viewport);
  if (swapScreen && landscape.screen) landscape.screen = flip(landscape.screen);
  return landscape;
}

/**
 * Return the device descriptor for deviceName. Use aliases and custom devices.
 * A landscape orientation prefers the `<name> landscape` preset and else swaps the viewport.
 */
function resolvePreset(deviceName, playwrightDevices, catalog, { orientation, swapScreen = false } = {}) {
  const merged = getDeviceCatalog(playwrightDevices, catalog.definitions);
  const name = findPresetName(merged, catalog, deviceName);
  if (!name) return null;
  if (orientation !== 'landscape' || normalizeDeviceName(name).endsWith(' landscape')) return merged[name];
  return merged[`${name} landscape`] || swapToLandscape(merged[name], swapScreen);
}

module.exports = {
  buildCatalog,
  getDeviceCatalog,
  resolvePreset,
};
