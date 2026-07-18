'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildSessionCapabilities } = require('../src/core/reporting');

test('reports selected iOS version as Safari version', () => {
  assert.deepEqual(
    buildSessionCapabilities('iOS', {
      deviceName: 'iPhone_16_Plus',
      platformName: 'iOS',
      osVersion: '26.5',
    }),
    {
      browserName: 'Safari',
      browserVersion: '26.5',
      deviceName: 'iPhone_16_Plus',
      platformName: 'iOS',
    },
  );
});

test('omits Safari version when selected device version is unavailable', () => {
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
