'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildSessionCapabilities } = require('../src/core/reporting');

test('reports selected iOS version as both platform and browser version', () => {
  assert.deepEqual(
    buildSessionCapabilities('iOS', {
      deviceName: 'iPhone_16_Plus',
      platformName: 'iOS',
      osVersion: '26.5',
    }),
    {
      browserName: 'Safari',
      platformVersion: '26.5',
      browserVersion: '26.5',
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
