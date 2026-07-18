const playwright = require('@playwright/test');
const { test, expect } = require('./src/test');
const { withAppiumInputMode } = require('./src/platforms/ios/appium');
const { resolveIOSDevicePreset } = require('./src/platforms/ios/custom-devices');

module.exports = {
  ...playwright,
  test,
  expect,
  withAppiumInputMode,
  resolveIOSDevicePreset,
};
