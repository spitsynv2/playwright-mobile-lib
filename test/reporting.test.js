'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildIOSCapabilities } = require('../src/reporting');

test('reports selected iOS version as Safari version', () => {
  assert.deepEqual(
    buildIOSCapabilities({
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
  assert.deepEqual(buildIOSCapabilities({ deviceName: 'iPhone XR' }), {
    browserName: 'Safari',
    deviceName: 'iPhone XR',
    platformName: 'iOS',
  });
});
