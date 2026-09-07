// iOS custom device catalog. Definitions live in custom-devices.json so a new
// device is one JSON edit shipped in a commit — no code change. The extended
// Playwright presets report an older iOS in their UA, so `iosVersion` is the
// source of truth for Zebrunner session capabilities. See core/device-catalog.js
// for the JSON entry format.
const catalogConfig = require('./custom-devices.json');
const {
  buildCatalog,
  getDeviceCatalog,
  resolvePreset,
  resolveVersion,
} = require('../../core/device-catalog');

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
