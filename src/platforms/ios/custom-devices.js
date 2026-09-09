/** iOS custom device catalog with entries from `custom-devices.json`. */
const catalogConfig = require('./custom-devices.json');
const {
  buildCatalog,
  getDeviceCatalog,
  resolvePreset,
} = require('../../core/device-catalog');

// The overlay only maps a device name to the nearest Playwright preset for
// local pre-flight. The OS version is not stored here: a real device reports it
// through the bridge, and a pre-flight derives it from the WebKit user agent.
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
