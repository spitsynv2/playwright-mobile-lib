/** iOS custom device catalog with entries from `custom-devices.json`. */
const catalogConfig = require('./custom-devices.json');
const {
  buildCatalog,
  getDeviceCatalog,
  resolvePreset,
  resolveVersion,
} = require('../../core/device-catalog');

// Playwright presets can report an older iOS in the UA. `iosVersion` is the source of truth.
const catalog = buildCatalog(catalogConfig, 'iosVersion');

function getIOSDeviceCatalog(playwrightDevices) {
  return getDeviceCatalog(playwrightDevices, catalog.definitions);
}

function resolveIOSDevicePreset(deviceName, playwrightDevices) {
  return resolvePreset(deviceName, playwrightDevices, catalog);
}

function resolveIOSVersion(deviceName) {
  return resolveVersion(deviceName, catalog);
}

module.exports = {
  CUSTOM_DEVICE_DEFINITIONS: catalog.definitions,
  DEVICE_IOS_VERSIONS: catalog.versions,
  getIOSDeviceCatalog,
  resolveIOSDevicePreset,
  resolveIOSVersion,
};
