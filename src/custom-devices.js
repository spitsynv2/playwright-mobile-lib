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

function normalizeDeviceName(deviceName) {
  return String(deviceName || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function getIOSDeviceCatalog(playwrightDevices) {
  return {
    ...playwrightDevices,
    ...buildCustomDevices(playwrightDevices),
  };
}

function resolveDeviceCanonicalName(deviceName) {
  const normalizedName = normalizeDeviceName(deviceName);
  return DEVICE_ALIASES[normalizedName] || String(deviceName || '').replace(/_/g, ' ');
}

function resolveIOSDevicePreset(deviceName, playwrightDevices) {
  const catalog = getIOSDeviceCatalog(playwrightDevices);
  return catalog[resolveDeviceCanonicalName(deviceName)] || null;
}

function resolveIOSVersion(deviceName) {
  return DEVICE_IOS_VERSIONS[resolveDeviceCanonicalName(deviceName)] || null;
}

module.exports = {
  CUSTOM_DEVICE_DEFINITIONS,
  DEVICE_IOS_VERSIONS,
  getIOSDeviceCatalog,
  resolveIOSDevicePreset,
  resolveIOSVersion,
};
