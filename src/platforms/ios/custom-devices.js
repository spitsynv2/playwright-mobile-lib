const DEVICE_ALIASES = {
  'iphone xr': 'iPhone XR',
  'iphone 16': 'iPhone 16',
  xr: 'iPhone XR',
};

// Real iOS version per device, keyed by resolved (canonical) device name. The
// Playwright presets these devices extend report an older iOS in their UA, so the
// Zebrunner session capabilities use this map as the source of truth instead.
const DEVICE_IOS_VERSIONS = {
  'iPhone 16': '26.4',
  'iPhone 16 landscape': '26.4',
  'iPhone 16 Plus': '26.4',
  'iPhone 16 Plus landscape': '26.4',
};

const CUSTOM_DEVICE_DEFINITIONS = {
  'iPhone 16': {
    extends: 'iPhone 15',
  },
  'iPhone 16 landscape': {
    extends: 'iPhone 15 landscape',
  },
  // iPhone 16 Plus shares the iPhone 15 Plus logical profile until
  // upstream Playwright adds a dedicated preset.
  'iPhone 16 Plus': {
    extends: 'iPhone 15 Plus',
  },
  'iPhone 16 Plus landscape': {
    extends: 'iPhone 15 Plus landscape',
  },
};

const {
  normalizeDeviceName,
  findByNormalizedDeviceName,
} = require('../../core/device-name');

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

function buildCustomDevices(playwrightDevices) {
  const customDevices = {};

  for (const [deviceName, definition] of Object.entries(CUSTOM_DEVICE_DEFINITIONS)) {
    const basePreset = playwrightDevices[definition.extends];
    if (!basePreset) continue;
    customDevices[deviceName] = mergePreset(basePreset, definition.override);
  }

  return customDevices;
}

function getIOSDeviceCatalog(playwrightDevices) {
  return {
    ...playwrightDevices,
    ...buildCustomDevices(playwrightDevices),
  };
}

function resolveCatalogKey(catalog, deviceName) {
  const normalized = normalizeDeviceName(deviceName);
  if (!normalized) return '';
  if (DEVICE_ALIASES[normalized]) return DEVICE_ALIASES[normalized];
  for (const name of Object.keys(catalog)) {
    if (normalizeDeviceName(name) === normalized) return name;
  }
  return String(deviceName || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function resolveDeviceCanonicalName(deviceName) {
  return resolveCatalogKey({ ...CUSTOM_DEVICE_DEFINITIONS, ...DEVICE_IOS_VERSIONS }, deviceName);
}

function resolveIOSDevicePreset(deviceName, playwrightDevices) {
  const catalog = getIOSDeviceCatalog(playwrightDevices);
  const alias = DEVICE_ALIASES[normalizeDeviceName(deviceName)];
  if (alias && catalog[alias]) return catalog[alias];
  return findByNormalizedDeviceName(catalog, deviceName) || null;
}

function resolveIOSVersion(deviceName) {
  const key = resolveDeviceCanonicalName(deviceName);
  return DEVICE_IOS_VERSIONS[key]
    || findByNormalizedDeviceName(DEVICE_IOS_VERSIONS, deviceName)
    || null;
}

module.exports = {
  CUSTOM_DEVICE_DEFINITIONS,
  DEVICE_IOS_VERSIONS,
  getIOSDeviceCatalog,
  resolveIOSDevicePreset,
  resolveIOSVersion,
};
