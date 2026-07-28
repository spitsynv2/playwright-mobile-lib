'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const bundlePath = path.join(__dirname, '..', 'dist', 'index.js');

const requestedModules = new Set();
const originalLoad = Module._load;
Module._load = function recordingLoad(request) {
  requestedModules.add(request);
  return originalLoad.apply(this, arguments);
};
let bundle;
try {
  bundle = require(bundlePath);
} finally {
  Module._load = originalLoad;
}

test('built bundle exposes the public surface', () => {
  for (const name of ['test', 'expect', 'defineConfig', 'withAppiumInputMode', 'resolveIOSDevicePreset']) {
    assert.equal(typeof bundle[name], 'function', `expected ${name} to be exported`);
  }
  assert.ok(bundle.devices && bundle.devices['iPhone 15'], 'expected the Playwright devices catalog to be re-exported');
});

test('built bundle resolves iOS device presets', () => {
  const preset = bundle.resolveIOSDevicePreset('iphone xr', bundle.devices);
  assert.ok(preset && preset.viewport, 'expected a preset with a viewport');
  assert.equal(bundle.resolveIOSDevicePreset('not a device', bundle.devices), null);
});

test('importing the bundle does not load the Android driver', () => {
  assert.equal(
    requestedModules.has('playwright'),
    false,
    'the Android driver requires `playwright` for `_android`; loading it on import breaks driver laziness',
  );
});
