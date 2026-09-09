'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildSessionCapabilities } = require('../src/core/reporting');
const { resolveIOSVersion } = require('../src/platforms/ios/custom-devices');

test('reports selected iOS version as the platform version', () => {
  assert.deepEqual(
    buildSessionCapabilities('iOS', {
      deviceName: 'iPhone_16_Plus',
      platformName: 'iOS',
      osVersion: '26.5',
    }),
    {
      browserName: 'Safari',
      platformVersion: '26.5',
      deviceName: 'iPhone_16_Plus',
      platformName: 'iOS',
    },
  );
});

test('omits platform version when selected device version is unavailable', () => {
  assert.deepEqual(buildSessionCapabilities('iOS', { deviceName: 'iPhone XR' }), {
    browserName: 'Safari',
    deviceName: 'iPhone XR',
    platformName: 'iOS',
  });
});

test('resolves the emulated iOS version for a local pre-flight session', () => {
  // A pre-flight has no bridge session, so the driver fills osVersion from the
  // device catalog. This is what makes the reporter show "Platform: iOS 26.4"
  // instead of a bare "Platform: iOS" for a local pre-flight run.
  const osVersion = resolveIOSVersion('iPhone 16 Plus');
  assert.equal(osVersion, '26.4');
  assert.deepEqual(
    buildSessionCapabilities('iOS', {
      deviceName: 'iPhone 16 Plus',
      platformName: 'iOS',
      osVersion,
    }),
    {
      browserName: 'Safari',
      platformVersion: '26.4',
      deviceName: 'iPhone 16 Plus',
      platformName: 'iOS',
    },
  );
});

test('reports Android sessions as Chrome', () => {
  assert.deepEqual(
    buildSessionCapabilities('Android', { deviceName: 'Pixel 3 XL', platformName: 'Android' }),
    {
      browserName: 'Chrome',
      deviceName: 'Pixel 3 XL',
      platformName: 'Android',
    },
  );
});
