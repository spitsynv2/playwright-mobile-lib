const playwright = require('@playwright/test');
const iosBridge = require('./src/ios-bridge');
const { resolveIOSDevicePreset } = require('./src/custom-devices');

module.exports = {
  ...playwright,
  ...iosBridge,
  resolveIOSDevicePreset,
};
