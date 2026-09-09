/** iOS custom device catalog with entries from `custom-devices.json`. */
const catalogConfig = require('./custom-devices.json');
const {
  buildCatalog,
  getDeviceCatalog,
  resolvePreset,
} = require('../../core/device-catalog');

// Overlay that maps a device name to the nearest Playwright preset.
const catalog = buildCatalog(catalogConfig);

function getIOSDeviceCatalog(playwrightDevices) {
  return getDeviceCatalog(playwrightDevices, catalog.definitions);
}

function resolveIOSDevicePreset(deviceName, playwrightDevices) {
  return resolvePreset(deviceName, playwrightDevices, catalog);
}

module.exports = {
  CUSTOM_DEVICE_DEFINITIONS: catalog.definitions,
  getIOSDeviceCatalog,
  resolveIOSDevicePreset,
};
