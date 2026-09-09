/** Android custom device catalog from custom-devices.json. */
const catalogConfig = require('./custom-devices.json');
const { buildCatalog, resolvePreset } = require('../../core/device-catalog');

const catalog = buildCatalog(catalogConfig);

/**
 * Resolves an Android device preset from the custom catalog or Playwright devices.
 * @returns {object|null} Device preset, or null if the device is unknown.
 */
function resolveAndroidDevicePreset(deviceName, playwrightDevices) {
  return resolvePreset(deviceName, playwrightDevices, catalog);
}

module.exports = {
  CUSTOM_DEVICE_DEFINITIONS: catalog.definitions,
  resolveAndroidDevicePreset,
};
