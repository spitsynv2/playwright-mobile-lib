'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { devices } = require('@playwright/test');

const {
  normalizeDeviceName,
  findByNormalizedDeviceName,
} = require('../src/core/device-name');
const { resolveIOSDevicePreset } = require('../src/platforms/ios/custom-devices');

test('normalizes spaces, underscores, hyphens, and case', () => {
  for (const name of ['Pixel 3 XL', 'pixel_3_xl', 'Pixel_3_XL', 'pixel-3-xl', '  PIXEL--3__XL  ']) {
    assert.equal(normalizeDeviceName(name), 'pixel 3 xl');
  }
});

test('finds Playwright Android presets under alternate separators', () => {
  const expected = devices['Pixel 7'];
  assert.ok(expected);
  for (const name of ['Pixel 7', 'pixel_7', 'pixel-7', 'PIXEL 7']) {
    assert.equal(findByNormalizedDeviceName(devices, name), expected);
  }
  assert.equal(findByNormalizedDeviceName(devices, 'not-a-device'), undefined);
});

test('resolves iOS presets under alternate separators', () => {
  const expected = devices['iPhone XR'];
  assert.ok(expected);
  for (const name of ['iPhone XR', 'iphone_xr', 'iphone-xr', 'IPHONE XR']) {
    const preset = resolveIOSDevicePreset(name, devices);
    assert.equal(preset.userAgent, expected.userAgent);
  }
  assert.equal(resolveIOSDevicePreset('iPhone_16_Plus', devices).viewport.width,
    resolveIOSDevicePreset('iphone-16-plus', devices).viewport.width);
});
