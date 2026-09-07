// Android custom device catalog. Definitions live in custom-devices.json so a new
// device (e.g. a phone newer than this Playwright build ships a preset for) is one
// JSON edit in a commit — no code change. See core/device-catalog.js for the entry
// format. Returns null for an unknown device so the driver can fall back locally.
const catalogConfig = require('./custom-devices.json');
const { buildCatalog, resolvePreset } = require('../../core/device-catalog');

const catalog = buildCatalog(catalogConfig, 'androidVersion');

function resolveAndroidDevicePreset(deviceName, playwrightDevices) {
  return resolvePreset(deviceName, playwrightDevices, catalog);
}

module.exports = {
  CUSTOM_DEVICE_DEFINITIONS: catalog.definitions,
  resolveAndroidDevicePreset,
};
